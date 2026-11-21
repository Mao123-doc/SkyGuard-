# Codex 综合指令 · 补齐 P1 情景推演后端接口 + 完成前端剩余页面

> 版本：**v2.0（修订版）**　·　日期：2026-11-21
> 前提：第 1–5 批已提交（`103a0ee`）；第 6 批 P1 界面已提交（`088bdb3`），`build` / `test` / `e2e` 三条已全绿。
> 本次目标：① 加一个后端接口让 P1 真正能算；② 补完 Live / Replay / Audit 三页。
> **执行顺序：先第 1 部分（后端接口），再第 2 部分（前端接线），最后统一验收。**

---

## 0. v2.0 修订了什么（相对 v1.0）

本节是按仓库真实代码核对后做的修正。**v1.0 中的以下写法会导致错误结果或测试空跑，必须按本版执行**：

| # | v1.0 的写法 | 问题 | v2.0 修正 |
|---|---|---|---|
| 1 | `observations.map(o => [o.region_id, o.count])` | 观测字段不是 `count`，规划器会拿到 `undefined`，静默按 0 人算，永远返回 NORMAL | 用 **`estimated_count`**（`DensityObservationSchema`，`types.ts` L149） |
| 2 | `planEvacuation()` / `buildEffectiveNetwork()` / `evaluateSafetyState()` / `loadScenario()` | 这些函数名都不存在 | 真名见 §0.2；规划器在 `SafetyDecisionService` 内，不是自由函数 |
| 3 | 红线“不要修改 `evacuation-planner.ts`” | 该文件**不存在**，会导致误改 `decision-service.ts`（真正的规划器） | 改为点名 `decision-service.ts` |
| 4 | 测试放 `backend/src/api/v1/__tests__/` | `npm test` 只跑 `tsx --test tests/**/*.test.ts`，放那里等于**永不执行** | 放 `backend/tests/safety/plan-simulate.test.ts` |
| 5 | 情景 ⑧「逆流管制启动」body 与 ① 完全相同 | 矩阵两行结果一模一样，等于造假 | ⑧ 改为 `GATE_01_G01` 失效 |
| 6 | 红线禁止改 `frontend/src/services/`，却要求裸 `fetch` | 自相矛盾 | 允许**仅新增** `safetyApi.simulatePlan`，不改任何现有签名 |
| 7 | Live/Replay/Audit「目标 ≥200 / ≥180 行」 | 与验收无关；上一轮已因此跑去 `npx prettier` 卡死 | 删除行数指标，改为“每栏必须有数据来源 + 空态” |
| 8 | 验收只有后端 test + 前端 build/test | 漏掉 e2e | 补 `npm run test:e2e` 及前置条件 |

> v1.0 里的 `exit.status_source` / `exit.updated_at` / `closed_regions: ['R_GATE_01_PLAZA']` **是对的** —— 场景里确实有这两个字段，`R_GATE_01_PLAZA` 也是真实区域 id，不用改。

---

## 0.2 已核实的真实契约（照这个写，不要再猜）

**文件**
```
backend/src/api/v1/safety.ts          22 KB，新增路由加在这里
backend/src/services/safety/
  ├ decision-service.ts    ← 规划 + 校验 + 状态机编排都在 SafetyDecisionService 里
  ├ validator.ts           export validateSafetyPlan(input)
  ├ state-machine.ts       export decideSafetyState(input)
  ├ network.ts             export resolveEffectiveNetwork(...)
  ├ scenario.ts            export loadSafetyScenario(fileName?)
  ├ observations.ts        ObservationStore：latest() / latestValid() / snapshot() / getVersion()
  ├ audit.ts               AuditLog
  └ types.ts               DensityObservation（人数字段 estimated_count）
backend/tests/safety/      ← 后端测试必须放这里
```

**关键类型**
```ts
SafetyStateName = 'NORMAL' | 'REROUTE' | 'DEGRADED' | 'REJECT'

SafetyDecisionOptions = {
  scenario: SafetyScenario;          // 必填
  auditLog?: AuditLog;
  observationStore?: ObservationStore;
  incidentStore?: IncidentStore;
  simulationProvider?: SimulationCrowdProvider;
  planBuilder?: ...; now?: () => Date;
  onStateChange?: () => void;        // 持久化回调
  assertWritable?: () => void;
}

recompute(actor: AuditActor, trigger: string): RecomputeResult
  // RecomputeResult 含 trace / snapshot / plan / validation / exclusions
```

**场景实际数据（来自 `GET /api/v1/safety/scenario`）**
```
出口 11 个：GATE_01_G01 … GATE_11_G11
出口字段：id, name, region_id, status, capacity_per_min, capacity_provenance,
         status_source, verified, updated_at
区域字段：id, name, area_m2, area_provenance, geometry, geometry_provenance,
         holding_capacity_persons, enabled, camera, source, verified
区域 id 示例：R_GATE_01_PLAZA, R_S01_L1_CREST, R_S01_L2_ECO, R_S01_L3_RIVER …
场景规模：44 区域 / 11 出口 / 78 走廊
```

**已存在的相关路由（不要重复造）**
```
GET  /api/v1/safety/status | scenario | plan | observations | incidents | audit | traces | trace/:id
POST /api/v1/safety/observations           ← 写观测
POST /api/v1/safety/observations/simulate  ← 已支持按区域覆盖人数
POST /api/v1/safety/plan/recompute         ← 无参，返回 {state, reasons, plan, validation, exclusions}
POST /api/v1/safety/plan/validate
```

---

# 第一部分：新增后端接口 `POST /plan/simulate`

## 1.1 目标

让前端把「哪些闸口失效、哪些区域封控」传给后端，**复用现有 service 算一次**，且**不污染当前运行状态**。

## 1.2 接口契约

```
POST /api/v1/safety/plan/simulate
（只读推演，不写任何持久状态；不加 writeGuard）

Request:
{
  "disabled_exits": ["GATE_02_G02", "GATE_09_G09"],  // 可选，默认 []
  "closed_regions": [],                              // 可选，默认 []
  "horizon_minutes": 30,                             // 可选，默认取 scenario.config.horizon_minutes
  "scenario_name": "G02+G09 同时失效"                 // 可选，仅回显
}

Response 200:
{
  "simulation_id": "sim-20261121T143000-8f3a",
  "scenario_name": "G02+G09 同时失效",
  "applied": { "disabled_exits": [...], "closed_regions": [...] },
  "state": { "state": "NORMAL|REROUTE|DEGRADED|REJECT", "publishable": bool,
             "headline": "…", "reasons": [{ "code": "…", "message": "…", "severity": "…" }] },
  "plan":       EvacuationPlan | null,
  "validation": SafetyValidationResult | null,
  "exclusions": [{ "kind": "exit|region", "id": "…", "reason": "not_found|disabled_by_simulation" }],
  "solve_ms": 12
}

400 请求体非法（zod 失败）
500 求解异常（附 message）
```
**未找到的 id 一律返回 200 + 写进 `exclusions.reason = "not_found"`**，不要 404、不要静默忽略。

## 1.3 实现（照抄这段结构，不要自创）

```ts
import { getSafetyService } from '../../../services/safety';
import { SafetyDecisionService } from '../../../services/safety/decision-service';

router.post('/plan/simulate', (req, res) => {
  const parsed = PlanSimulateBody.safeParse(req.body ?? {});
  if (!parsed.success) { fail(res, 400, 'INVALID_INPUT', '请求体不合法', parsed.error.issues); return; }

  const started = Date.now();
  const base = getSafetyService();
  const raw = base.getScenario();

  // 1) 克隆，绝不改原对象
  const patched = structuredClone(raw);
  const exclusions: Array<{ kind: 'exit'|'region'; id: string; reason: string }> = [];

  for (const id of parsed.data.disabled_exits ?? []) {
    const exit = patched.exits.find(e => e.id === id);
    if (!exit) { exclusions.push({ kind: 'exit', id, reason: 'not_found' }); continue; }
    exit.status = 'closed';
    exit.status_source = 'simulation';
    exit.updated_at = new Date().toISOString();
    exclusions.push({ kind: 'exit', id, reason: 'disabled_by_simulation' });
  }
  for (const id of parsed.data.closed_regions ?? []) {
    const region = patched.regions.find(r => r.id === id);
    if (!region) { exclusions.push({ kind: 'region', id, reason: 'not_found' }); continue; }
    region.enabled = false;
    exclusions.push({ kind: 'region', id, reason: 'closed_by_simulation' });
  }

  // 2) 用临时实例跑，共享只读依赖；不传 auditLog / onStateChange / assertWritable
  const temp = new SafetyDecisionService({
    scenario: patched,
    observationStore: base.getObservationStore(),
    incidentStore: base.getIncidentStore(),
    now: () => new Date(),
  });
  const result = temp.recompute(actorOf(req), 'plan:simulate');

  res.json({
    simulation_id: `sim-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 15)}-${Math.random().toString(16).slice(2, 6)}`,
    scenario_name: parsed.data.scenario_name ?? '未命名情景',
    applied: { disabled_exits: parsed.data.disabled_exits ?? [], closed_regions: parsed.data.closed_regions ?? [] },
    state: result.snapshot.state,          // { state, publishable, headline, reasons }
    plan: result.plan ?? null,
    validation: result.validation ?? null,
    exclusions,
    solve_ms: Date.now() - started,
  });
});
```

**要点**
- 需求人数由 `ObservationStore` 提供，字段是 **`estimated_count`**；如需自己换算，务必用这个字段名。
- 临时实例**不要**传 `auditLog`：否则每次推演都往审计里写一条假记录。
- `horizon_minutes` 若 service 不支持外部注入，就**不要硬塞** —— 在响应里如实标注 `applied.horizon_minutes: null`，并写进 `docs/API_PLAN_SIMULATE.md` 的「已知限制」。**不要为了“看起来生效”改默认值。**

## 1.4 红线

```
❌ 不要修改 decision-service.ts / validator.ts / state-machine.ts / scenario.ts 的既有逻辑
❌ 不要修改 observations.ts / audit.ts
✅ 只新增：1 个 zod schema + 1 个路由（safety.ts 末尾）
```

## 1.5 测试（必须放这个路径）

`backend/tests/safety/plan-simulate.test.ts`

| 用例 | 输入 | 期望 |
|---|---|---|
| 基线 | `disabled_exits: []` | 200；`state.state ∈ {NORMAL, REROUTE}`；`plan` 非 null |
| 单闸口失效 | `['GATE_02_G02']` | 200；`plan.exit_totals` 不含 `GATE_02_G02` |
| 多闸口失效 | `['GATE_02_G02','GATE_09_G09']` | 容量不足时 `state === 'REJECT'`，否则 `REROUTE` |
| 非法 id | `['NOT_EXIST']` | **200**，`exclusions` 含 `{kind:'exit', id:'NOT_EXIST', reason:'not_found'}` |
| 不污染状态 | 调用前后各取一次 `GET /status` | `versions` 与 `state` 完全不变 |

---

# 第二部分：前端接线与补完

## 2.1 P1 预案推演（`/plan`）

### 唯一允许改 services 的地方

在 `frontend/src/services/safetyApi.ts` **新增一个方法**（不改任何现有方法签名）：

```ts
simulatePlan: (body: {
  disabled_exits?: string[];
  closed_regions?: string[];
  horizon_minutes?: number;
  scenario_name?: string;
}) => api.post('/safety/plan/simulate', body).then(r => r.data)
```

类型按响应契约声明，放在 `safetyApi.ts` 里（不要新建 service 文件）。

### 情景勾选 → 真调用

点击「生成预案」时，把当前勾选传给 `simulatePlan`，返回直接渲染：

- `state` → 右栏结论卡（大字号 + 状态色）
- `validation.violations` → 命中规则列表
- `plan` → 中栏（复用 `NetworkMap`，传 `plan` 与当前 scenario）
- `exclusions` → 结论卡下方小字：「未找到的 id：…」

**删除**之前那句「本地预案输入，后端不接收参数」的说明 —— 现在它已经是真的了。

### 8 情景矩阵（全部用真实 id）

```
① 全部正常                 disabled_exits: [], closed_regions: []
② GATE_02_G02 失效         ['GATE_02_G02']
③ GATE_09_G09 失效         ['GATE_09_G09']
④ GATE_02+G09 同时失效     ['GATE_02_G02','GATE_09_G09']
⑤ 北段全失效               ['GATE_01_G01','GATE_02_G02','GATE_03_G03']
⑥ 中段全失效               ['GATE_04_G04','GATE_05_G05','GATE_06_G06']
⑦ G02 失效 + 门区封控      ['GATE_02_G02'] + closed_regions:['R_GATE_01_PLAZA']
⑧ GATE_01_G01 失效         ['GATE_01_G01']
```

规则：
- 8 格结果**必须全部来自接口**，并发上限 3
- 单格失败显示 `—` + `⚠ 求解失败：<message>`，禁止用默认值填充
- 表头写清：`8 个情景 · 后端实时推演（POST /plan/simulate）`
- 全部完成后显示总耗时（各 `solve_ms` 之和）

## 2.2 LivePage 补完

```
左栏 DutyTable（进场模式）
- 数据：GET /api/v1/mvp/staff（11 条）
- 列：入口 | 值守人 | 排队 | 系统建议 | 当前指令
- 入口：staff[].region_id → 场景区域名（GET /safety/scenario）
- 值守人：staff[].name（真实值）
- 排队 / 系统建议：GET /api/v1/mvp/dashboard 该区域人数；超阈值给建议；无数据 `—`
- 当前指令：后端无字段 → 显示「未知」，title="后端未提供 instruction 字段"

中栏 OccupancyGrid
- 容量：scenario.regions[].holding_capacity_persons
- 当前人数：dashboard 各区域人数（**字段名按 dashboard 实际返回，不要猜 `count`**）
- 每格：已进/容量 + 百分比 + 进度条；>75% 标红

右栏 VerdictCard
- 数据：GET /api/v1/safety/status
- 大字号 state + headline + reasons + 数据新鲜度警示
```

## 2.3 ReplayPage 补完

```
时间轴：GET /api/v1/safety/audit，按时间排序成事件点，可拖动播放头
态势快照：复用 NetworkMap（传该时刻 observations 与 plan）
证据四卡（**不含固定摄像头**）：
  数据快照 ×2 → audit 记录关联的 observation
  无人机帧   → perception 相关记录；无则灰色「该时刻未拍摄」
  人工上报   → GET /api/v1/safety/incidents
推理链：audit 按时间顺序展开；trace 详情走 GET /api/v1/safety/trace/:id
```

## 2.4 AuditPage 补完

```
数据：GET /api/v1/safety/audit
筛选：时间范围 / 类型 / 操作人 / 结果
统计：总条数 / 拒绝次数 / 上报次数 / 无人机架次 / 平均响应 / 最长间隔
主表：时间 | 类型 | 内容 | 操作人 | 结果 | 留痕ID
抽屉：点行展开，完整 JSON + 关联规则 + 关联 trace
空态：无数据时显示「暂无审计记录」，不留空白框
```

---

# 第三部分：验收

## 3.1 前置

```powershell
# 1) 起服务（两个都要在跑，e2e 需要）
cd E:\Downloads\skyguard-evacuation-main
npm run dev          # 后端 :8010 + 前端 :5173

# 2) e2e 浏览器（换机器 / 重装 node_modules 后必须重跑一次）
cd frontend
npx playwright install chromium
```

## 3.2 四条命令，全绿才算完成

```powershell
# 根目录：后端 tsc + 前端 tsc/vite
npm run build

# 后端测试（tsx --test tests/**/*.test.ts）
npm test --prefix backend

# 前端测试（4 个文件 / 18 tests 必须全绿）
npm test --prefix frontend

# e2e（需 3.1 的服务在跑）
npm run test:e2e
```

## 3.3 12 项内容迁移对照（每项必须给 `文件:行号`，不接受只勾选）

| 旧区块 | 新位置 |
|---|---|
| 各区域观测 | LivePage 左栏 / 散场密度列表 |
| 安全决策引擎 | LivePage 中栏（五段状态） |
| 疏散任务状态 | LivePage 散场右栏 |
| 独立校验结果 | ReplayPage 推理链 |
| 风险告警 | LivePage 阈值触发卡 |
| 出口分配 | LivePage 散场右栏 |
| 事件时间线 | AuditPage 主表 |
| 竞赛基准结果 | P1 底部 或 Replay 底部 |
| 多区域协同调查 | P1 底部 |
| 摄像头状态 | LivePage 无人机/摄像头区 |
| 工作人员 | LivePage 值守表 |
| 审批中心与工单 | AuditPage 或 Live 工单区 |

## 3.4 接口文档

新建 `docs/API_PLAN_SIMULATE.md`，写清：请求 / 响应 / 错误码 / 5 个测试用例结果 / **已知限制**：
```
- 只接受闸口失效与区域封控两类情景
- 需求人数取自最新观测（estimated_count），不接受自定义人数
- 一次计算，不写入当前运行状态，不产生审计记录
- horizon_minutes 若未生效，此处如实标注
```

## 3.5 提交

```
feat(backend): 新增 POST /safety/plan/simulate 只读情景推演接口
feat(frontend): P1 接线后端推演 + 补完 Live/Replay/Audit
docs: 补充 /plan/simulate 接口契约
```

---

# 红线（重申）

```
❌ 不改 decision-service.ts / validator.ts / state-machine.ts / scenario.ts 的既有逻辑
   （v1.0 写的 evacuation-planner.ts 不存在，不要去找它）
❌ 不改 frontend/src/services/ 里任何现有方法签名；只允许新增 simulatePlan
❌ 不改 NetworkMap.tsx 的 JSX 结构（仅允许新增 data-density-level 属性）
❌ 不伪造数据：缺字段一律显示「未知」或「—」，禁止用默认值补
❌ 不删现有测试；不改 4 个测试文件的断言
❌ 不以“行数”为目标做格式化；不引入新依赖
```

---

# 一句话

> **加一个只读接口，用 `structuredClone` + 临时 `SafetyDecisionService` 让 P1 真能算；把它和剩下三页一起补完；数据缺就如实标「未知」，不猜、不编。**
