import { useEffect, useState } from 'react';
import TopBar from '../../components/TopBar';
import safetyApi, { type SafetyScenarioSummary, type SafetyStatus } from '../../services/safetyApi';
import { exitGroups, exitsForGroup } from '../../constants/exitGroups';
import './PlanPage.css';

const scenarioKinds = [
  ['normal', '正常散场', '按当前有效观测与开放网络重算'],
  ['gate', '闸口失效', '选择需纳入假设的出口'],
  ['closure', '局部区域封控', '选择受影响区域'],
  ['counterflow', '逆流管制', '选择需要复核的通道'],
] as const;
const priorityRules = [
  ['P0', '数据可信度不足', 'DEGRADED', '拒绝', true], ['P0', '容量未知或通道不可用', '硬约束', '拒绝', true],
  ['P0', '独立校验存在硬违规', 'REJECT', '拒绝', true], ['P1', '已确认事件影响当前路线', 'REROUTE', '重规划', false],
  ['P1', '出口状态或容量变化', '约束更新', '重规划', false], ['P1', '观测超过有效期', 'DEGRADED', '降级', false],
  ['P2', '区域密度达到关注阈值', '风险告警', '人工复核', false], ['P2', '预测区间不可靠', '证据门禁', '不用于决策', false],
  ['P3', '无变化且校验通过', 'NORMAL', '保持当前方案', false],
] as const;
const matrixRows = [
  { label: '正常散场', kind: 'normal' },
  { label: '北段闸口失效', kind: 'gate', group: 'north' },
  { label: '中段闸口失效', kind: 'gate', group: 'middle' },
  { label: '南段闸口失效', kind: 'gate', group: 'south' },
  { label: '两端闸口失效', kind: 'gate', group: 'ends' },
  { label: '局部区域封控', kind: 'closure' },
  { label: '逆流管制', kind: 'counterflow' },
  { label: '低置信度观测', kind: 'untrusted' },
];

function PriorityTable() {
  return <section className="plan-panel">
    <header>
      <div><span>POLICY PRIORITY</span><h2>优先级规则表</h2></div>
      <small>安全优先级高于效率</small>
    </header>
    <div className="plan-rules-wrap">
      <table className="plan-rules">
        <thead><tr><th>级别</th><th>触发条件</th><th>状态 / 判断</th><th>处理</th></tr></thead>
        <tbody>{priorityRules.map(([level, condition, state, action, reject]) => <tr key={condition} data-reject={reject}>
          <td>{level}</td><td>{condition}</td><td>{state}</td><td>{action}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <p className="plan-footnote">未知数据不可用；规划结果须经独立 Validator 校验，页面不自行认证方案。</p>
  </section>;
}

function ScenarioMatrix({ rows, selected, plan }: { rows: typeof matrixRows; selected: (row: typeof matrixRows[number]) => boolean; plan: SafetyStatus['plan'] }) {
  return <section className="plan-panel plan-matrix">
    <header>
      <div><span>SCENARIO MATRIX</span><h2>8 情景结果矩阵</h2></div>
      <small>未执行情景不会显示推演结论</small>
    </header>
    <div className="plan-matrix-wrap">
      <table>
        <thead><tr><th>情景</th><th>草稿选择</th><th>结果</th><th>数据来源</th></tr></thead>
        <tbody>{rows.map((row, index) => <tr key={row.label}>
          <td>{row.label}</td>
          <td>{selected(row) ? '已纳入草稿' : '未选择'}</td>
          <td>{index === 0 && plan ? plan.status : '尚未由后端执行'}</td>
          <td>{index === 0 && plan ? '当前方案 API' : '等待 scenario_templates'}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </section>;
}

function ConclusionCounts({ counts }: { counts: { feasible: number; degraded: number; rejected: number } }) {
  return <div className="plan-counts">
    <div data-kind="feasible"><span>可行</span><strong>{counts.feasible}</strong></div>
    <div data-kind="degraded"><span>降级</span><strong>{counts.degraded}</strong></div>
    <div data-kind="rejected"><span>拒绝</span><strong>{counts.rejected}</strong></div>
  </div>;
}

function PlanDisclaimer() {
  return <footer className="plan-disclaimer">
    场景参数与观测依赖后端；所选情景当前不会影响 recompute。
    此研究原型用于辅助决策，不构成现场指挥结论。
  </footer>;
}

export default function PlanPage() {
  const [scenario, setScenario] = useState<SafetyScenarioSummary | null>(null);
  const [status, setStatus] = useState<SafetyStatus | null>(null);
  const [selectedKinds, setSelectedKinds] = useState<string[]>(['normal']);
  const [selectedExits, setSelectedExits] = useState<string[]>([]);
  const [selectedRegions, setSelectedRegions] = useState<string[]>([]);
  const [selectedCorridors, setSelectedCorridors] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string[]>(['gate']);
  const [eventName, setEventName] = useState('');
  const [expectedPeople, setExpectedPeople] = useState('');
  const [horizon, setHorizon] = useState(30);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const refresh = async () => {
    setLoading(true);
    try { const [nextScenario, nextStatus] = await Promise.all([safetyApi.scenario(), safetyApi.status()]); setScenario(nextScenario); setStatus(nextStatus); setError(''); }
    catch (cause) { setError((cause as Error).message); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);
  const exits = scenario?.exits ?? status?.exits.map(({ id, name, region_id, capacity_per_min, effective_status }) => ({ id, name, region_id, capacity_per_min, status: effective_status })) ?? [];
  const regions = scenario?.regions ?? status?.regions ?? [];
  const corridors = scenario?.corridors ?? status?.corridors.map(({ id, name, from_region_id, to_region_id, capacity_per_min, traversal_seconds, effective_status }) => ({ id, name, from_region_id, to_region_id, capacity_per_min, traversal_seconds, status: effective_status })) ?? [];
  const plan = status?.candidate_plan ?? status?.plan ?? null;
  const toggle = (values: string[], value: string, update: (next: string[]) => void) => update(values.includes(value) ? values.filter(item => item !== value) : [...values, value]);
  const recompute = async () => {
    setBusy(true); setNotice('');
    try { await safetyApi.recompute(); setStatus(await safetyApi.status()); setNotice('已读取后端当前方案。左侧情景选择尚未由后端模板接口执行。'); setError(''); }
    catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };
  const stateCounts = { feasible: plan?.status === 'feasible' ? 1 : 0, degraded: status?.state.state === 'DEGRADED' || plan?.status === 'partial' ? 1 : 0, rejected: status?.state.state === 'REJECT' || plan?.status === 'infeasible' ? 1 : 0 };
  const exitState = (id: string) => { const item = status?.exits.find(exit => exit.id === id); return !item ? 'unknown' : item.usable && item.effective_status === 'open' ? 'open' : item.usable ? 'restricted' : 'closed'; };
  const matrixSelected = (row: typeof matrixRows[number]) => {
    if (!selectedKinds.includes(row.kind)) return false;
    if (row.kind !== 'gate' || !row.group) return true;
    return exitsForGroup(row.group, exits.map(exit => exit.id)).some(id => selectedExits.includes(id));
  };
  return <div className="plan-page"><TopBar /><main className="plan-content">
    <header className="plan-heading"><div><span>P1 / PLAN WORKBENCH</span><h1>预案推演</h1><p>{scenario?.name ?? '正在读取场景配置'} · 场景版本 {status?.versions.scenario ?? '—'}</p></div><strong data-state={status?.state.state ?? 'unknown'}>{status?.state.state ?? '数据未就绪'}</strong></header>
    {error ? <p className="plan-error" role="alert">场景或方案读取失败：{error}</p> : null}
    <div className="plan-columns">
      <section className="plan-panel plan-inputs"><header><div><span>INPUT</span><h2>活动参数与情景</h2></div><small>{selectedKinds.length} 类情景 · {selectedExits.length} 个出口</small></header>
        <div className="plan-field-row"><label className="plan-field">活动名称<input value={eventName} onChange={event => setEventName(event.target.value)} placeholder="输入活动名称" /></label><label className="plan-field">预计人数<input type="number" min="0" value={expectedPeople} onChange={event => setExpectedPeople(event.target.value)} placeholder="未提供" /></label></div>
        <label className="plan-field">推演时限（分钟）<input type="number" min="1" value={horizon} onChange={event => setHorizon(Number(event.target.value))} /></label>
        <p className="plan-data-note">参数保存在本页草稿；当前后端 recompute 不接收活动参数或情景模板。</p>
        <div className="plan-scenario-list">{scenarioKinds.map(([id, label, detail]) => <section className="plan-scenario" key={id}>
          <label className="plan-check"><input type="checkbox" checked={selectedKinds.includes(id)} onChange={() => toggle(selectedKinds, id, setSelectedKinds)} /><span><b>{label}</b><small>{detail}</small></span></label>
          {id !== 'normal' ? <button className="plan-expand" type="button" onClick={() => toggle(expanded, id, setExpanded)}>{id === 'gate' ? `已选 ${selectedExits.length} 个` : id === 'closure' ? `已选 ${selectedRegions.length} 个` : `已选 ${selectedCorridors.length} 条`} · {expanded.includes(id) ? '收起' : '展开'}</button> : null}
          {id === 'gate' && expanded.includes(id) ? <div className="plan-options"><div className="plan-shortcuts">{exitGroups.map(group => <button type="button" key={group.id} onClick={() => setSelectedExits([...new Set([...selectedExits, ...exitsForGroup(group.id, exits.map(exit => exit.id))])])}>{group.name}</button>)}</div><div className="plan-option-grid">{exits.map(exit => <label className="plan-option" key={exit.id}><input type="checkbox" checked={selectedExits.includes(exit.id)} onChange={() => toggle(selectedExits, exit.id, setSelectedExits)} /><span>{exit.name}<small>{exit.id}</small></span><i data-gate-state={exitState(exit.id)}>{exitState(exit.id)}</i></label>)}</div><div className="plan-shortcuts"><button type="button" onClick={() => setSelectedExits(exits.map(exit => exit.id))}>全选</button><button type="button" onClick={() => setSelectedExits([])}>清空</button></div></div> : null}
          {id === 'closure' && expanded.includes(id) ? <div className="plan-option-grid">{regions.map(region => <label className="plan-option" key={region.id}><input type="checkbox" checked={selectedRegions.includes(region.id)} onChange={() => toggle(selectedRegions, region.id, setSelectedRegions)} /><span>{region.name}<small>{region.id}</small></span></label>)}</div> : null}
          {id === 'counterflow' && expanded.includes(id) ? <div className="plan-option-grid">{corridors.map(corridor => <label className="plan-option" key={corridor.id}><input type="checkbox" checked={selectedCorridors.includes(corridor.id)} onChange={() => toggle(selectedCorridors, corridor.id, setSelectedCorridors)} /><span>{corridor.name}<small>{corridor.from_region_id} → {corridor.to_region_id}</small></span></label>)}</div> : null}
        </section>)}</div>
        <button className="plan-run" type="button" disabled={busy || loading || !status} onClick={() => void recompute()}>{busy ? '正在重算…' : '生成 / 刷新当前方案'}</button>{notice ? <p className="plan-notice" role="status">{notice}</p> : null}
      </section>
      <div className="plan-middle"><PriorityTable /><ScenarioMatrix rows={matrixRows} selected={matrixSelected} plan={plan} /></div>
      <aside className="plan-panel plan-conclusion"><header><div><span>RESULT</span><h2>推演结论</h2></div><button type="button" onClick={() => void refresh()} disabled={loading}>刷新</button></header>
        <ConclusionCounts counts={stateCounts} />
        <section className="plan-result"><span>后端当前结论</span><strong>{status?.state.headline ?? (loading ? '正在读取…' : '暂无结果')}</strong><p>{plan ? `${plan.evacuated_persons} / ${plan.total_persons} 人纳入当前方案，未疏散 ${plan.unresolved_persons} 人` : '当前没有可展示的方案'}</p><small>{status?.validation ? `独立校验：${status.validation.valid ? '通过' : '未通过'} · ${status.validation.violations.length} 项违规` : '暂无独立校验记录'}</small></section>
        <section className="plan-findings"><h3>关键发现</h3>{status?.state.reasons.length ? <ul>{status.state.reasons.map((item, index) => <li key={`${item.code}-${index}`}>{item.message}</li>)}</ul> : <p className="plan-empty">暂无后端风险发现</p>}</section>
        <section className="plan-findings"><h3>建议调整</h3><p>{status?.state.requires_operator_action ? '需由安全操作员复核当前数据、约束与方案；不要将未校验方案用于发布。' : '保持人工监督。左侧情景目前仅为本地草稿，不能替代后端约束变更。'}</p></section>
        <section className="plan-findings"><h3>当前方案出口分配</h3>{plan?.exit_totals.length ? <ul>{plan.exit_totals.map(item => <li key={item.exit_id}>{item.exit_id}：{item.persons} 人</li>)}</ul> : <p className="plan-empty">暂无出口分配数据</p>}</section>
      </aside>
    </div><PlanDisclaimer />
  </main></div>;
}
