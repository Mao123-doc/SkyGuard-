import { useEffect, useMemo, useState } from 'react';
import TopBar from '../../components/TopBar';
import safetyApi, { type AuditEntry, type SafetyIncident } from '../../services/safetyApi';
import './AuditPage.css';

interface DecisionTrace {
  trace_id: string;
  trigger: string;
  actor: string;
  started_at: string;
  finished_at?: string;
  stages: Array<{ stage: string; status: string; duration_ms: number; detail?: Record<string, unknown> }>;
  outcome?: { state?: string; plan_id?: string; validation_valid?: boolean; violation_codes?: string[] };
}

async function fetchTraces(): Promise<DecisionTrace[]> {
  const token = localStorage.getItem('admin_token');
  const response = await fetch('/api/v1/safety/traces', { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!response.ok) throw new Error(`Trace API ${response.status}`);
  const payload = await response.json() as { traces?: DecisionTrace[] };
  return payload.traces ?? [];
}

/** 上报与实际确认时延只能从 incidents 的 reported_at → confirmed_at 得出，审计条目里没有耗时字段。 */
async function fetchIncidents(): Promise<SafetyIncident[]> {
  const token = localStorage.getItem('admin_token');
  const response = await fetch('/api/v1/safety/incidents', { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!response.ok) throw new Error(`Incidents API ${response.status}`);
  const payload = await response.json() as { incidents?: SafetyIncident[] };
  return payload.incidents ?? [];
}

function downloadCsv(entries: AuditEntry[]) {
  const header = ['time', 'type', 'summary', 'actor', 'role', 'result', 'audit_id', 'trace_id'];
  const rows = entries.map(entry => [entry.ts, entry.action, entry.summary, entry.actor, entry.role, entry.result, entry.id, entry.trace_id ?? '']);
  const csv = [header, ...rows].map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = 'skyguard-audit.csv'; link.click(); URL.revokeObjectURL(url);
}

function durationLabel(value: number | null): string {
  if (value === null) return '—';
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}

export default function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [traces, setTraces] = useState<DecisionTrace[]>([]);
  const [incidents, setIncidents] = useState<SafetyIncident[]>([]);
  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [action, setAction] = useState('all');
  const [actor, setActor] = useState('all');
  const [result, setResult] = useState('all');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    try {
      const [nextEntries, nextTraces, nextIncidents] = await Promise.all([safetyApi.audit(500), fetchTraces(), fetchIncidents()]);
      setEntries(nextEntries); setTraces(nextTraces); setIncidents(nextIncidents); setError(null);
    }
    catch (cause) { setError((cause as Error).message); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);

  const sorted = useMemo(() => entries.slice().sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts)), [entries]);
  const actions = useMemo(() => [...new Set(entries.map(entry => entry.action))].sort(), [entries]);
  const actors = useMemo(() => [...new Set(entries.map(entry => entry.actor))].sort(), [entries]);
  const filtered = useMemo(() => sorted.filter(entry => {
    const timestamp = Date.parse(entry.ts);
    return (!from || timestamp >= Date.parse(from)) && (!to || timestamp <= Date.parse(to) + 86_399_999) && (action === 'all' || entry.action === action) && (actor === 'all' || entry.actor === actor) && (result === 'all' || entry.result === result);
  }), [sorted, from, to, action, actor, result]);

  const ascendingTimes = entries.map(entry => Date.parse(entry.ts)).filter(Number.isFinite).sort((a, b) => a - b);
  const gaps = ascendingTimes.slice(1).map((time, index) => time - ascendingTimes[index]);
  const responseTimes = incidents
    .map(incident => (incident.confirmed_at ? Date.parse(incident.confirmed_at) - Date.parse(incident.reported_at) : Number.NaN))
    .filter(value => Number.isFinite(value) && value >= 0);
  const stats = [
    ['总条数', entries.length],
    ['拒绝次数', entries.filter(entry => entry.result === 'rejected').length],
    ['上报次数', incidents.length],
    ['无人机记录', entries.filter(entry => /uav|drone/i.test(`${entry.action} ${entry.summary}`)).length],
    ['平均响应', durationLabel(responseTimes.length ? responseTimes.reduce((sum, value) => sum + value, 0) / responseTimes.length : null)],
    ['最长间隔', durationLabel(gaps.length ? Math.max(...gaps) : null)],
  ] as const;
  const selectedTrace = selected?.trace_id ? traces.find(item => item.trace_id === selected.trace_id) ?? null : null;

  return <div className="audit-page"><TopBar /><main className="audit-content">
    <header className="audit-title"><div><span>P4 · 审计轨迹</span><h1>审计记录</h1><p>数据来源：GET /api/v1/safety/audit；上报次数与平均响应来自 GET /api/v1/safety/incidents（reported_at → confirmed_at）。</p></div><div className="audit-title-actions"><button type="button" onClick={() => void refresh()} disabled={loading}>刷新</button><button type="button" onClick={() => downloadCsv(filtered)} disabled={!filtered.length}>导出 CSV</button></div></header>
    <section className="audit-filters"><label>开始日期<input type="date" value={from} onChange={event => setFrom(event.target.value)} /></label><label>结束日期<input type="date" value={to} onChange={event => setTo(event.target.value)} /></label><label>类型<select value={action} onChange={event => setAction(event.target.value)}><option value="all">全部类型</option>{actions.map(value => <option key={value} value={value}>{value}</option>)}</select></label><label>操作者<select value={actor} onChange={event => setActor(event.target.value)}><option value="all">全部操作者</option>{actors.map(value => <option key={value} value={value}>{value}</option>)}</select></label><label>结果<select value={result} onChange={event => setResult(event.target.value)}><option value="all">全部结果</option><option value="success">成功</option><option value="failure">失败</option><option value="rejected">拒绝</option></select></label><span>{error ? `读取失败：${error}` : loading ? '正在读取…' : `${filtered.length} 条`}</span></section>
    <section className="audit-stats">{stats.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</section>
    <div className="audit-layout"><section className="audit-table-wrap"><table className="audit-table"><thead><tr><th>时间</th><th>类型</th><th>内容</th><th>操作人</th><th>结果</th><th>留痕 ID</th></tr></thead><tbody>{filtered.map(entry => <tr key={entry.id} data-result={entry.result} aria-selected={selected?.id === entry.id} onClick={() => setSelected(entry)}><td>{new Date(entry.ts).toLocaleString('zh-CN')}</td><td>{entry.action}</td><td>{entry.summary}</td><td>{entry.actor}<small>{entry.role}</small></td><td><span className="audit-result">{entry.result}</span></td><td><code>{entry.id}</code>{entry.trace_id ? <small>{entry.trace_id}</small> : null}</td></tr>)}{!filtered.length ? <tr><td colSpan={6} className="audit-empty">暂无审计记录</td></tr> : null}</tbody></table></section>
      <aside className="audit-drawer">{selected ? <><header><div><span>TRACE DETAIL</span><h2>记录详情</h2></div><button type="button" aria-label="关闭详情" onClick={() => setSelected(null)}>×</button></header><dl><dt>关联规则</dt><dd>{selected.action} · {selected.result}{selected.reason ? ` · ${selected.reason}` : ''}</dd><dt>关联 Trace</dt><dd>{selected.trace_id ?? '该记录未提供 trace_id'}</dd><dt>Trace 结果</dt><dd>{selectedTrace ? `${selectedTrace.outcome?.state ?? '—'} · 校验 ${selectedTrace.outcome?.validation_valid === undefined ? '—' : selectedTrace.outcome.validation_valid ? '通过' : '未通过'}` : '暂无关联 Trace 数据'}</dd></dl>{selectedTrace ? <section className="audit-trace-stages"><h3>Trace 阶段</h3>{selectedTrace.stages.map((stage, index) => <p key={`${stage.stage}-${index}`}><span>{stage.stage}</span><b>{stage.status} · {stage.duration_ms} ms</b></p>)}</section> : null}<section className="audit-json"><h3>完整 JSON</h3><pre>{JSON.stringify(selected, null, 2)}</pre></section></> : <div className="audit-drawer-empty">选择主表记录查看详情<br /><small>暂无选择时不展示虚构内容</small></div>}</aside>
    </div><footer className="audit-notice">审计页为只读视图；审批中心与活动工单状态在现场总览中读取 MVP dashboard，不在此处伪造关联。</footer>
  </main></div>;
}
