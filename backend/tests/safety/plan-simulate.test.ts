import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { jsonBody, startTestServer, type TestServer } from '../helpers/api-fixtures';
import { resetSafetyServiceForTests } from '../../src/services/safety';

const HANKOU_SCENARIO = path.resolve(__dirname, '../../../data/scenarios/hankou-mvp.json');

async function login(server: TestServer): Promise<Record<string, string>> {
  const response = await server.request('/api/v1/auth/login', jsonBody({
    username: process.env.SKYGUARD_ADMIN_USERNAME || 'admin',
    password: process.env.SKYGUARD_ADMIN_PASSWORD || 'skyguard2026',
  }));
  assert.equal(response.status, 200);
  return {
    Authorization: `Bearer ${response.body.access_token}`,
    'Content-Type': 'application/json',
  };
}

type SampleMap = Record<string, { count: number; confidence: number }>;

/**
 * 写入基线观测。
 *
 * 已知数据缺口：`GET /scenario` 返回的 `simulation_baseline` 只覆盖 33/44 个启用区域，
 * 缺的正好是 11 个 `R_GATE_*_PLAZA`。而 `assessAll()` 会把"没有观测的启用区域"
 * 记成 `untrusted_observation(no_observation)`，状态机随即判 DEGRADED 并跳过规划，
 * 于是 `plan` 必然为 null。要让基线/单闸口/多闸口三个用例有意义，必须先补齐覆盖。
 */
async function seedBaseline(server: TestServer): Promise<{ synthesised: string[]; total: number }> {
  const scenario = await server.request('/api/v1/safety/scenario');
  assert.equal(scenario.status, 200);

  const baseline: SampleMap = scenario.body.simulation_baseline ?? {};
  const observations: SampleMap = { ...baseline };
  const synthesised: string[] = [];

  for (const region of scenario.body.regions as Array<{ id: string; enabled: boolean }>) {
    if (!region.enabled || region.id in observations) continue;
    // 演示基线里没给的区域，用一个保守的小人数占位（不是 0：人数为 0 时，
    // 关闸用例会因为"无人可分配"而拿不到 unresolved_demand，测不出真实语义）。
    observations[region.id] = { count: 200, confidence: 0.9 };
    synthesised.push(region.id);
  }

  const admin = await login(server);
  const response = await server.request('/api/v1/safety/observations/simulate', {
    ...jsonBody({ observations }),
    headers: admin,
  });
  assert.equal(response.status, 201);

  return { synthesised, total: Object.keys(observations).length };
}

test('POST /safety/plan/simulate 只读情景推演契约', async t => {
  process.env.SAFETY_SCENARIO_FILE = HANKOU_SCENARIO;
  resetSafetyServiceForTests();
  const server = await startTestServer();
  try {
    await seedBaseline(server);

    await t.test('基线返回可用方案', async () => {
      const response = await server.request('/api/v1/safety/plan/simulate', jsonBody({
        disabled_exits: [],
        scenario_name: '全部正常',
      }));
      assert.equal(response.status, 200);
      assert.ok(['NORMAL', 'REROUTE'].includes(response.body.state.state));
      assert.ok(response.body.plan);
      assert.equal(response.body.scenario_name, '全部正常');
      assert.equal(response.body.applied.horizon_minutes, null);
    });

    await t.test('单闸口失效不会分配到该出口', async () => {
      const response = await server.request('/api/v1/safety/plan/simulate', jsonBody({
        disabled_exits: ['GATE_02_G02'],
      }));
      assert.equal(response.status, 200);
      assert.ok(response.body.plan);
      assert.equal(response.body.plan.exit_totals.some((item: any) => item.exit_id === 'GATE_02_G02'), false);
      assert.ok(response.body.exclusions.some((item: any) => item.id === 'GATE_02_G02' && item.reason === 'disabled_by_simulation'));
    });

    await t.test('多闸口失效但容量充足时重分配后仍可给出方案', async () => {
      // 注意：11 个出口合计 8040 人/分钟，10 分钟窗口可消化约 8 万人，
      // 基线总需求约 2.02 万人，所以只关 2 个闸口不存在"容量不足"，
      // 正确结果是重分配成功（NORMAL/REROUTE），不是 REJECT。
      const response = await server.request('/api/v1/safety/plan/simulate', jsonBody({
        disabled_exits: ['GATE_02_G02', 'GATE_09_G09'],
      }));
      assert.equal(response.status, 200);
      assert.ok(['NORMAL', 'REROUTE'].includes(response.body.state.state));
      assert.ok(response.body.plan);
      for (const exitId of ['GATE_02_G02', 'GATE_09_G09']) {
        assert.equal(
          response.body.plan.exit_totals.some((item: any) => item.exit_id === exitId),
          false,
          `${exitId} 不应被分配`,
        );
      }
      assert.ok(response.body.exclusions.filter((item: any) => item.reason === 'disabled_by_simulation').length === 2);
    });

    await t.test('容量被打穿时返回拒绝状态', async () => {
      // 只保留 GATE_07（1440 人/分钟）：10 分钟最多消化 1.44 万人 < 2.02 万人需求，
      // 必然存在无法分配的人 → 硬约束不满足 → REJECT。
      const keep = 'GATE_07_G07';
      const scenario = await server.request('/api/v1/safety/scenario');
      const disabled = (scenario.body.exits as Array<{ id: string }>)
        .map(exit => exit.id)
        .filter(id => id !== keep);
      const response = await server.request('/api/v1/safety/plan/simulate', jsonBody({ disabled_exits: disabled }));
      assert.equal(response.status, 200);
      assert.equal(response.body.state.state, 'REJECT');
      assert.equal(response.body.state.publishable, false);
    });

    await t.test('非法 id 以 exclusions 返回而不是报错', async () => {
      const response = await server.request('/api/v1/safety/plan/simulate', jsonBody({
        disabled_exits: ['NOT_EXIST'],
      }));
      assert.equal(response.status, 200);
      assert.ok(response.body.exclusions.some((item: any) => item.kind === 'exit' && item.id === 'NOT_EXIST' && item.reason === 'not_found'));
    });

    await t.test('推演不污染当前状态与版本', async () => {
      const before = await server.request('/api/v1/safety/status');
      const simulated = await server.request('/api/v1/safety/plan/simulate', jsonBody({
        disabled_exits: ['GATE_02_G02'],
        closed_regions: ['R_GATE_01_PLAZA'],
      }));
      const after = await server.request('/api/v1/safety/status');
      assert.equal(simulated.status, 200);
      assert.deepEqual(after.body.versions, before.body.versions);
      // GET /status 每次都会用"当前时刻"重算一次，`decided_at` 必然不同，
      // 因此只比较决策内容，不对整个 state 对象做时间敏感的深比较。
      const decision = (state: any) => ({
        state: state.state,
        headline: state.headline,
        publishable: state.publishable,
        validated_route_display_allowed: state.validated_route_display_allowed,
        candidate_route_display_allowed: state.candidate_route_display_allowed,
        requires_operator_action: state.requires_operator_action,
        reasons: (state.reasons ?? []).map((reason: any) => `${reason.code}|${reason.message}`),
        active_incident_ids: state.active_incident_ids,
        last_valid_observation_at: state.last_valid_observation_at,
      });
      assert.deepEqual(decision(after.body.state), decision(before.body.state));
    });
  } finally {
    await server.close();
    delete process.env.SAFETY_SCENARIO_FILE;
    resetSafetyServiceForTests();
  }
});
