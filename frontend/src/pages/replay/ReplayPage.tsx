import { useEffect, useMemo, useState } from 'react';
import TopBar from '../../components/TopBar';
import PerceptionReplayPanel from '../command-center/PerceptionReplayPanel';
import safetyApi, { type AuditEntry, type SafetyStatus } from '../../services/safetyApi';
import './ReplayPage.css';

export default function ReplayPage() {
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [status, setStatus] = useState<SafetyStatus | null>(null);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    Promise.all([safetyApi.audit(200), safetyApi.status()]).then(([entries, nextStatus]) => { setAudit(entries); setStatus(nextStatus); }).catch(cause => setError((cause as Error).message));
  }, []);
  const events = useMemo(() => audit.slice().reverse().slice(0, 8), [audit]);
  const current = events[selected] ?? null;
  return <div className="replay-page"><TopBar /><main className="replay-content"><header className="replay-title"><div><span>P3 · DECISION REPLAY</span><h1>决策回放</h1><p>审计事件按时间顺序回看；旁路感知回放为独立公开数据派生展示，不与场景拓扑混用。</p></div><span className="replay-demo-tag">审计记录 {events.length} 个节点</span></header>
    <section className="replay-timeline"><div className="replay-timeline-head"><strong>事件时间线</strong><span>{current ? new Date(current.ts).toLocaleString('zh-CN') : '暂无时间点'}</span></div><input aria-label="审计事件时间点" type="range" min={0} max={Math.max(0, events.length - 1)} value={selected} disabled={!events.length} onChange={event => setSelected(Number(event.target.value))} /><div className="replay-event-points">{events.map((entry, index) => <button type="button" key={entry.id} aria-pressed={selected === index} onClick={() => setSelected(index)}><i />{new Date(entry.ts).toLocaleTimeString('zh-CN', { hour12: false })}<small>{entry.action}</small></button>)}{!events.length ? <p>暂无审计事件时间点</p> : null}</div></section>
    {error ? <p className="replay-error" role="alert">回放数据读取失败：{error}</p> : null}
    <div className="replay-layout"><section className="replay-left"><section className="replay-snapshot"><header><h2>态势快照</h2><span>基于当前安全状态 · 不代表历史重建</span></header><div className="replay-kpis"><div><span>安全状态</span><strong>{status?.state.state ?? '—'}</strong></div><div><span>区域观测</span><strong>{status?.observations.length ?? '—'}</strong></div><div><span>最高风险</span><strong>{status?.risk_summary.highest ?? '—'}</strong></div></div><div className="replay-evidence-grid">{[['数据快照', current?.summary ?? '暂无选中事件'], ['无人机帧', '暂无对应历史无人机帧'], ['人工上报', current?.actor ?? '暂无对应人工记录'], ['数据来源', current?.action ?? '审计 API']].map(([title, value]) => <article key={title}><span>{title}</span><strong>{value}</strong></article>)}</div></section><PerceptionReplayPanel /></section>
      <aside className="replay-reasoning"><section><h2>当时决策依据</h2>{current ? <><p>{current.summary}</p><small>{current.actor}（{current.role}） · {current.result}</small></> : <p className="replay-empty">暂无审计事件，不能重建历史决策。</p>}</section><section><h3>安全状态推理链</h3>{status ? <ol className="replay-chain"><li><b>观测</b><span>{status.observations.length ? `${status.observations.length} 条观测` : '暂无观测'}</span></li><li><b>风险</b><span>{status.risk_summary.highest} · {status.state.reasons.map(reason => reason.message).join('；') || '暂无原因'}</span></li><li><b>方案</b><span>{status.plan?.plan_id ?? '暂无方案'}</span></li><li><b>独立校验</b><span>{status.validation ? status.validation.valid ? '通过' : '未通过' : '暂无结果'}</span></li><li><b>四态</b><span>{status.state.state} · {status.state.headline}</span></li></ol> : <p className="replay-empty">正在读取安全决策数据…</p>}</section><section><h3>命中规则</h3>{status?.validation?.violations.length ? status.validation.violations.map((violation, index) => <p className="replay-rule" key={`${violation.code}-${index}`}>{violation.code} · {violation.message}</p>) : <p className="replay-empty">{status?.validation ? '独立校验无违规项' : '暂无校验规则结果'}</p>}</section></aside></div>
    <footer className="replay-notice">感知帧为 CityStreet C3 派生展示数据：非实时、无真值、许可未确认、未标定映射；不映射为 SkyGuard 场景区域。</footer></main></div>;
}
