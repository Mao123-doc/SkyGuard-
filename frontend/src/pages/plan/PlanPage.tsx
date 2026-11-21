import { useEffect, useState } from 'react';
import TopBar from '../../components/TopBar';
import NetworkMap from '../command-center/components/NetworkMap';
import { MAP_MIN_ZOOM } from '../command-center/commandCenterUtils';
import safetyApi, { type PlanSimulationResult, type SafetyScenarioSummary, type SafetyStatus } from '../../services/safetyApi';
import mvpApi, { type MultiRegionAnalysis } from '../../services/mvpApi';
import { exitGroups, exitsForGroup } from '../../constants/exitGroups';
import './PlanPage.css';
import '../command-center/CommandCenterPage.css';

const priorityRules = [
  ['P0', '数据可信度不足', 'DEGRADED', '拒绝', true], ['P0', '容量未知或通道不可用', '硬约束', '拒绝', true],
  ['P0', '独立校验存在硬违规', 'REJECT', '拒绝', true], ['P1', '已确认事件影响当前路线', 'REROUTE', '重规划', false],
  ['P1', '出口状态或容量变化', '约束更新', '重规划', false], ['P1', '观测超过有效期', 'DEGRADED', '降级', false],
  ['P2', '区域密度达到关注阈值', '风险告警', '人工复核', false], ['P2', '预测区间不可靠', '证据门禁', '不用于决策', false],
  ['P3', '无变化且校验通过', 'NORMAL', '保持当前方案', false],
] as const;

type MatrixScenario = { name: string; disabled_exits: string[]; closed_regions: string[] };

// 不用 `as const`：`simulatePlan` 契约要求可变数组（string[]），
// 只读元组（readonly []）无法赋值，会导致 TS2345。
const matrixScenarios: MatrixScenario[] = [
  { name: '全部正常', disabled_exits: [], closed_regions: [] },
  { name: 'GATE_02_G02 失效', disabled_exits: ['GATE_02_G02'], closed_regions: [] },
  { name: 'GATE_09_G09 失效', disabled_exits: ['GATE_09_G09'], closed_regions: [] },
  { name: 'GATE_02+G09 同时失效', disabled_exits: ['GATE_02_G02', 'GATE_09_G09'], closed_regions: [] },
  { name: '北段全失效', disabled_exits: ['GATE_01_G01', 'GATE_02_G02', 'GATE_03_G03'], closed_regions: [] },
  { name: '中段全失效', disabled_exits: ['GATE_04_G04', 'GATE_05_G05', 'GATE_06_G06'], closed_regions: [] },
  { name: 'G02 失效 + 门区封控', disabled_exits: ['GATE_02_G02'], closed_regions: ['R_GATE_01_PLAZA'] },
  { name: 'GATE_01_G01 失效', disabled_exits: ['GATE_01_G01'], closed_regions: [] },
];

type MatrixCell = { result: PlanSimulationResult | null; error: string | null };

function errorMessage(cause: unknown): string {
  const value = cause as { response?: { data?: { error?: { message?: string; detail?: string } } }; message?: string };
  return value.response?.data?.error?.detail ?? value.response?.data?.error?.message ?? value.message ?? '未知错误';
}

async function runWithLimit<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<Array<T | Error>> {
  const output: Array<T | Error> = new Array(tasks.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < tasks.length) {
      const index = cursor++;
      try { output[index] = await tasks[index](); }
      catch (cause) { output[index] = cause instanceof Error ? cause : new Error(errorMessage(cause)); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return output;
}

function PriorityTable() {
  return <section className="plan-panel"><header><div><span>POLICY PRIORITY</span><h2>优先级规则表</h2></div><small>安全优先级高于效率</small></header><div className="plan-rules-wrap"><table className="plan-rules"><thead><tr><th>级别</th><th>触发条件</th><th>状态 / 判断</th><th>处理</th></tr></thead><tbody>{priorityRules.map(([level, condition, state, action, reject]) => <tr key={condition} data-reject={reject}><td>{level}</td><td>{condition}</td><td>{state}</td><td>{action}</td></tr>)}</tbody></table></div><p className="plan-footnote">未知数据不可用；规划结果须经独立 Validator 校验，页面不自行认证方案。</p></section>;
}

function ScenarioMatrix({ cells, running, totalMs, onRun }: { cells: MatrixCell[]; running: boolean; totalMs: number; onRun: () => void }) {
  return <section className="plan-panel plan-matrix"><header><div><span>SCENARIO MATRIX</span><h2>8 个情景 · 后端实时推演（POST /plan/simulate）</h2></div><button type="button" onClick={onRun} disabled={running}>{running ? '求解中…' : '重新运行'}</button></header><div className="plan-matrix-wrap"><table><thead><tr><th>情景</th><th>四态</th><th>方案</th><th>独立校验</th><th>耗时</th></tr></thead><tbody>{matrixScenarios.map((scenario, index) => { const cell = cells[index]; return <tr key={scenario.name}><td>{scenario.name}</td><td data-state={cell?.result?.state.state}>{cell?.result?.state.state ?? '—'}</td><td>{cell?.result?.plan ? `${cell.result.plan.evacuated_persons}/${cell.result.plan.total_persons}` : '—'}</td><td>{cell?.result?.validation ? cell.result.validation.valid ? '通过' : `未通过（${cell.result.validation.violations.length}）` : '—'}</td><td>{cell?.result ? `${cell.result.solve_ms} ms` : '—'}{cell?.error ? <small className="plan-cell-error">⚠ 求解失败：{cell.error}</small> : null}</td></tr>; })}</tbody></table></div><p className="plan-footnote">{running ? '最多 3 个情景并发求解…' : cells.length ? `全部完成 · solve_ms 合计 ${totalMs} ms` : '尚未运行情景矩阵'}</p></section>;
}

export default function PlanPage() {
  const [scenario, setScenario] = useState<SafetyScenarioSummary | null>(null);
  const [status, setStatus] = useState<SafetyStatus | null>(null);
  const [simulation, setSimulation] = useState<PlanSimulationResult | null>(null);
  const [matrixCells, setMatrixCells] = useState<MatrixCell[]>([]);
  const [multiRegion, setMultiRegion] = useState<MultiRegionAnalysis | null>(null);
  const [selectedExits, setSelectedExits] = useState<string[]>([]);
  const [selectedRegions, setSelectedRegions] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<'gate' | 'region' | null>('gate');
  const [eventName, setEventName] = useState('');
  const [horizon, setHorizon] = useState(30);
  const [busy, setBusy] = useState(false);
  const [matrixRunning, setMatrixRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mapZoom, setMapZoom] = useState(MAP_MIN_ZOOM);
  const [mapCenter, setMapCenter] = useState<{ x: number; y: number } | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const layers = { landmarks: true, regions: true, risks: true, corridors: true, validated: true, candidate: true, incidents: true };

  const runMatrix = async () => {
    setMatrixRunning(true);
    setMatrixCells([]);
    const values = await runWithLimit(matrixScenarios.map(item => () => safetyApi.simulatePlan({ ...item, scenario_name: item.name })), 3);
    setMatrixCells(values.map(value => value instanceof Error ? { result: null, error: value.message } : { result: value, error: null }));
    setMatrixRunning(false);
  };

  useEffect(() => {
    Promise.all([safetyApi.scenario(), safetyApi.status(), mvpApi.multiRegion()])
      .then(([nextScenario, nextStatus, analysis]) => { setScenario(nextScenario); setStatus(nextStatus); setMultiRegion(analysis); setHorizon(nextScenario.config.horizon_minutes); setError(''); void runMatrix(); })
      .catch(cause => setError(errorMessage(cause)))
      .finally(() => setLoading(false));
  }, []);

  const exits = scenario?.exits ?? [];
  const regions = scenario?.regions ?? [];
  const toggle = (values: string[], value: string, update: (next: string[]) => void) => update(values.includes(value) ? values.filter(item => item !== value) : [...values, value]);
  const runSelected = async () => {
    setBusy(true);
    try {
      setSimulation(await safetyApi.simulatePlan({ disabled_exits: selectedExits, closed_regions: selectedRegions, horizon_minutes: horizon, scenario_name: eventName.trim() || '当前勾选情景' }));
      setError('');
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  };
  const mapStatus = status && simulation ? { ...status, state: simulation.state, plan: simulation.state.publishable ? simulation.plan : null, candidate_plan: simulation.state.publishable ? null : simulation.plan, validation: simulation.validation } : status;
  const resultPlan = simulation?.plan ?? null;
  const counts = matrixCells.reduce((acc, cell) => { if (cell.result?.state.state === 'REJECT') acc.rejected++; else if (cell.result?.state.state === 'DEGRADED') acc.degraded++; else if (cell.result) acc.feasible++; return acc; }, { feasible: 0, degraded: 0, rejected: 0 });
  const notFound = simulation?.exclusions.filter(item => item.reason === 'not_found') ?? [];
  const totalMs = matrixCells.reduce((sum, cell) => sum + (cell.result?.solve_ms ?? 0), 0);

  return <div className="plan-page"><TopBar /><main className="plan-content"><header className="plan-heading"><div><span>P1 / PLAN WORKBENCH</span><h1>预案推演</h1><p>{scenario?.name ?? '正在读取场景配置'} · 只读推演，不发布方案</p></div><strong data-state={simulation?.state.state ?? status?.state.state ?? 'unknown'}>{simulation?.state.state ?? status?.state.state ?? '数据未就绪'}</strong></header>{error ? <p className="plan-error" role="alert">读取或求解失败：{error}</p> : null}<div className="plan-columns">
    <section className="plan-panel plan-inputs"><header><div><span>INPUT</span><h2>活动参数与情景</h2></div><small>{selectedExits.length} 个出口 · {selectedRegions.length} 个区域</small></header><label className="plan-field">情景名称<input value={eventName} onChange={event => setEventName(event.target.value)} placeholder="当前勾选情景" /></label><label className="plan-field">推演时限（分钟）<input type="number" min="1" value={horizon} onChange={event => setHorizon(Number(event.target.value))} /></label><p className="plan-data-note">人数需求取自后端最新观测；horizon_minutes 当前仅回显，响应会标记为未应用。</p>
      <section className="plan-scenario"><label className="plan-check"><input type="checkbox" checked disabled /><span><b>正常散场基线</b><small>未选择故障时使用当前场景约束</small></span></label></section>
      <section className="plan-scenario"><label className="plan-check"><input type="checkbox" checked={selectedExits.length > 0} readOnly /><span><b>闸口失效</b><small>选择具体出口，状态点来自当前场景</small></span></label><button className="plan-expand" type="button" onClick={() => setExpanded(expanded === 'gate' ? null : 'gate')}>已选 {selectedExits.length} 个 · {expanded === 'gate' ? '收起' : '展开'}</button>{expanded === 'gate' ? <div className="plan-options"><div className="plan-shortcuts">{exitGroups.map(group => <button type="button" key={group.id} onClick={() => setSelectedExits([...new Set([...selectedExits, ...exitsForGroup(group.id, exits.map(exit => exit.id))])])}>{group.name}</button>)}</div><div className="plan-option-grid">{exits.map(exit => <label className="plan-option" key={exit.id}><input type="checkbox" checked={selectedExits.includes(exit.id)} onChange={() => toggle(selectedExits, exit.id, setSelectedExits)} /><span>{exit.name}<small>{exit.id}</small></span><i data-gate-state={exit.status}>{exit.status}</i></label>)}</div><div className="plan-shortcuts"><button type="button" onClick={() => setSelectedExits(exits.map(exit => exit.id))}>全选</button><button type="button" onClick={() => setSelectedExits([])}>清空</button></div></div> : null}</section>
      <section className="plan-scenario"><label className="plan-check"><input type="checkbox" checked={selectedRegions.length > 0} readOnly /><span><b>局部区域封控</b><small>只禁用选择区域，不修改原场景</small></span></label><button className="plan-expand" type="button" onClick={() => setExpanded(expanded === 'region' ? null : 'region')}>已选 {selectedRegions.length} 个 · {expanded === 'region' ? '收起' : '展开'}</button>{expanded === 'region' ? <div className="plan-option-grid plan-region-options">{regions.map(region => <label className="plan-option" key={region.id}><input type="checkbox" checked={selectedRegions.includes(region.id)} onChange={() => toggle(selectedRegions, region.id, setSelectedRegions)} /><span>{region.name}<small>{region.id}</small></span></label>)}</div> : null}</section>
      <section className="plan-scenario"><label className="plan-check"><input type="checkbox" disabled /><span><b>逆流管制</b><small>当前接口未接受通道方向覆盖，显示为未提供</small></span></label></section><button className="plan-run" type="button" disabled={busy || loading || !status} onClick={() => void runSelected()}>{busy ? '正在推演…' : '生成预案'}</button>
    </section>
    <div className="plan-middle"><PriorityTable />{mapStatus ? <section className="plan-panel plan-map"><header><div><span>SIMULATED PLAN</span><h2>当前情景方案</h2></div><small>{simulation ? simulation.simulation_id : '尚未运行当前选择'}</small></header><NetworkMap map={scenario?.map} status={mapStatus} selectedRegion={selectedRegion} onSelectRegion={setSelectedRegion} allowRoutes zoom={mapZoom} setZoom={setMapZoom} center={mapCenter} setCenter={setMapCenter} showBackdrop={false} layers={layers} /></section> : <section className="plan-panel plan-empty">暂无场景网络数据</section>}<ScenarioMatrix cells={matrixCells} running={matrixRunning} totalMs={totalMs} onRun={() => void runMatrix()} /></div>
    <aside className="plan-panel plan-conclusion"><header><div><span>RESULT</span><h2>推演结论</h2></div><small>{simulation ? `${simulation.solve_ms} ms` : '等待生成'}</small></header><div className="plan-counts"><div data-kind="feasible"><span>可行</span><strong>{counts.feasible}</strong></div><div data-kind="degraded"><span>降级</span><strong>{counts.degraded}</strong></div><div data-kind="rejected"><span>拒绝</span><strong>{counts.rejected}</strong></div></div><section className="plan-result"><span>当前勾选结果</span><strong>{simulation?.state.headline ?? '尚未生成预案'}</strong><p>{resultPlan ? `${resultPlan.evacuated_persons}/${resultPlan.total_persons} 人完成分配，未疏散 ${resultPlan.unresolved_persons} 人` : '暂无后端方案结果'}</p><small>{simulation?.validation ? `独立校验：${simulation.validation.valid ? '通过' : '未通过'}` : '暂无独立校验结果'}</small></section><section className="plan-findings"><h3>命中规则</h3>{simulation?.validation?.violations.length ? <ul>{simulation.validation.violations.map((item, index) => <li key={`${item.code}-${index}`}>{item.code} · {item.message}</li>)}</ul> : <p className="plan-empty">{simulation ? '无校验违规项' : '暂无结果'}</p>}</section><section className="plan-findings"><h3>关键发现</h3>{simulation?.state.reasons.length ? <ul>{simulation.state.reasons.map((item, index) => <li key={`${item.code}-${index}`}>{item.message}</li>)}</ul> : <p className="plan-empty">暂无状态原因</p>}{notFound.length ? <p>未找到的 ID：{notFound.map(item => item.id).join('、')}</p> : null}</section><section className="plan-findings"><h3>出口分配</h3>{resultPlan?.exit_totals.length ? <ul>{resultPlan.exit_totals.map(item => <li key={item.exit_id}>{item.exit_id}：{item.persons} 人</li>)}</ul> : <p className="plan-empty">暂无出口分配</p>}</section>
    </aside>
  </div><section className="plan-research"><article><span>COMPETITION BASELINE</span><h2>竞赛基准结果</h2><p>当前页面未接收独立的竞赛基准 API；请以 evaluation 中已提交的可复现实验为准，不把页面推演耗时表述为性能基准。</p></article><article><span>MULTI-REGION VOI</span><h2>多区域协同调查</h2>{multiRegion?.available ? <><strong>{multiRegion.decision?.recommended_action_id ?? '当前建议停止调查'}</strong><p>覆盖 {multiRegion.decision?.covered_region_count ?? 0} 个区域 · {multiRegion.decision?.stop_reason ?? multiRegion.note ?? '后端未提供说明'}</p></> : <p>{multiRegion?.reason ?? '暂无多区域协同调查结果'}</p>}</article><article><span>LIMITATIONS</span><h2>已知限制</h2><p>情景接口只接受闸口失效与区域封控；不接受自定义人数，且 horizon_minutes 暂不参与求解。</p></article></section><footer className="plan-disclaimer">所有结果来自只读后端推演，不写入当前运行状态，不代表方案已审批或可自动执行。</footer></main></div>;
}
