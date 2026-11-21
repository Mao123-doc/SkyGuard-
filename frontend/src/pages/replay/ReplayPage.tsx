import { useEffect, useMemo, useState } from 'react';
import TopBar from '../../components/TopBar';
import NetworkMap from '../command-center/components/NetworkMap';
import PerceptionReplayPanel from '../command-center/PerceptionReplayPanel';
import { MAP_MIN_ZOOM } from '../command-center/commandCenterUtils';
import safetyApi, { type AuditEntry, type SafetyIncident, type SafetyScenarioSummary, type SafetyStatus } from '../../services/safetyApi';
import './ReplayPage.css';
import '../command-center/CommandCenterPage.css';

interface DecisionTrace {
  trace_id: string;
  started_at: string;
  finished_at?: string;
  actor: string;
  trigger: string;
  constraint_version: number;
  observation_version: number;
  stages: Array<{ stage: string; status: 'ok' | 'warning' | 'failed' | 'skipped'; duration_ms: number; detail?: Record<string, unknown> }>;
  outcome?: { state?: string; plan_id?: string; validation_valid?: boolean; violation_codes?: string[] };
}

async function getJson<T>(path: string): Promise<T> {
  const token = localStorage.getItem('admin_token');
  const response = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!response.ok) throw new Error(`${path} 返回 ${response.status}`);
  return response.json() as Promise<T>;
}

/** 证据窗口：只有与播放头事件相差 5 分钟内的记录才视为"该时刻证据"，否则只提示最近一条。 */
const EVIDENCE_WINDOW_MS = 5 * 60 * 1000;

function nearestByTime<T>(items: T[], time: string, getTime: (item: T) => string): { item: T; deltaMs: number } | null {
  const target = Date.parse(time);
  let best: { item: T; deltaMs: number } | null = null;
  for (const item of items) {
    const value = Date.parse(getTime(item));
    if (!Number.isFinite(value)) continue;
    const deltaMs = Math.abs(value - target);
    if (!best || deltaMs < best.deltaMs) best = { item, deltaMs };
  }
  return best;
}

function formatDelta(deltaMs: number): string {
  if (deltaMs < 60_000) return `${Math.round(deltaMs / 1000)} 秒`;
  return `${Math.round(deltaMs / 60_000)} 分钟`;
}

function outsideWindowText(nearest: { deltaMs: number } | null, what: string): string {
  return nearest ? `该时刻无${what}（最近一条相差 ${formatDelta(nearest.deltaMs)}，超出 ±5 分钟证据窗口）` : `该时刻无${what}`;
}

export default function ReplayPage() {
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [incidents, setIncidents] = useState<SafetyIncident[]>([]);
  const [status, setStatus] = useState<SafetyStatus | null>(null);
  const [scenario, setScenario] = useState<SafetyScenarioSummary | null>(null);
  const [trace, setTrace] = useState<DecisionTrace | null>(null);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mapZoom, setMapZoom] = useState(MAP_MIN_ZOOM);
  const [mapCenter, setMapCenter] = useState<{ x: number; y: number } | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const layers = { landmarks: true, regions: true, risks: true, corridors: true, validated: true, candidate: true, incidents: true };

  const refresh = async () => {
    setLoading(true);
    try {
      const [entries, nextStatus, nextScenario, incidentPayload] = await Promise.all([
        safetyApi.audit(200), safetyApi.status(), safetyApi.scenario(),
        getJson<{ incidents: SafetyIncident[] }>('/api/v1/safety/incidents'),
      ]);
      setAudit(entries.slice().sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts)));
      setStatus(nextStatus); setScenario(nextScenario); setIncidents(incidentPayload.incidents); setError(null);
    } catch (cause) { setError((cause as Error).message); }
    finally { setLoading(false); }
  };

  useEffect(() => { void refresh(); }, []);
  const events = useMemo(() => audit.slice(-30), [audit]);
  const current = events[selected] ?? null;

  useEffect(() => {
    if (!current?.trace_id) { setTrace(null); return; }
    getJson<DecisionTrace>(`/api/v1/safety/trace/${encodeURIComponent(current.trace_id)}`)
      .then(setTrace)
      .catch(cause => { setTrace(null); setError((cause as Error).message); });
  }, [current?.trace_id]);

  const nearestObservations = current && status
    ? status.observations
      .map(item => ({ item, deltaMs: Math.abs(Date.parse(item.observed_at) - Date.parse(current.ts)) }))
      .filter(entry => Number.isFinite(entry.deltaMs))
      .sort((a, b) => a.deltaMs - b.deltaMs)
      .slice(0, 2)
    : [];
  const nearestUav = current ? nearestByTime(audit.filter(entry => /uav|drone|perception/i.test(`${entry.action} ${entry.summary}`)), current.ts, item => item.ts) : null;
  const nearestIncident = current ? nearestByTime(incidents, current.ts, item => item.reported_at) : null;

  return <div className="replay-page"><TopBar /><main className="replay-content">
    <header className="replay-title"><div><span>P3 / DECISION REPLAY</span><h1>决策回放</h1><p>时间轴来自审计 API；Trace 只按真实 trace_id 关联，不推测历史结果。</p></div><div className="replay-title-actions"><span className="replay-demo-tag">{events.length} 个事件</span><button type="button" onClick={() => void refresh()} disabled={loading}>刷新</button></div></header>
    {error ? <p className="replay-error" role="alert">回放数据读取失败：{error}</p> : null}
    <section className="replay-timeline"><div className="replay-timeline-head"><strong>事件时间线 · GET /safety/audit</strong><span>{current ? new Date(current.ts).toLocaleString('zh-CN') : loading ? '正在读取…' : '暂无时间点'}</span></div><input aria-label="审计事件时间点" type="range" min={0} max={Math.max(0, events.length - 1)} value={Math.min(selected, Math.max(0, events.length - 1))} disabled={!events.length} onChange={event => setSelected(Number(event.target.value))} /><div className="replay-event-points">{events.map((entry, index) => <button type="button" key={entry.id} aria-pressed={selected === index} onClick={() => setSelected(index)}><i />{new Date(entry.ts).toLocaleTimeString('zh-CN', { hour12: false })}<small>{entry.action}</small><small>{entry.result}</small></button>)}{!events.length ? <p className="replay-empty">暂无审计事件</p> : null}</div></section>
    <div className="replay-layout"><section className="replay-left">
      <section className="replay-snapshot"><header><h2>态势快照</h2><span>当前状态参照 · 后端未提供历史状态快照</span></header>{status ? <NetworkMap map={scenario?.map} status={status} selectedRegion={selectedRegion} onSelectRegion={setSelectedRegion} allowRoutes zoom={mapZoom} setZoom={setMapZoom} center={mapCenter} setCenter={setMapCenter} showBackdrop={false} layers={layers} /> : <p className="replay-empty">暂无安全状态，无法显示网络图</p>}<div className="replay-kpis"><article><span>当前四态</span><strong>{status?.state.state ?? '—'}</strong></article><article><span>播放头事件</span><strong>{current?.action ?? '—'}</strong></article><article><span>关联 Trace</span><strong>{current?.trace_id ?? '未提供'}</strong></article><article><span>当前方案</span><strong>{status?.plan?.plan_id ?? status?.candidate_plan?.plan_id ?? '—'}</strong></article></div></section>
      <section className="replay-evidence"><header><h2>证据四卡</h2><span>只有与播放头相差 ±5 分钟内的记录才作为该时刻证据</span></header><div className="replay-evidence-grid">{[0, 1].map(index => { const entry = nearestObservations[index]; return <article key={`observation-${index}`} data-empty={!(entry && entry.deltaMs <= EVIDENCE_WINDOW_MS)}><span>数据快照 {index + 1}</span><strong>{entry && entry.deltaMs <= EVIDENCE_WINDOW_MS ? `${entry.item.region_id} · ${entry.item.estimated_count} 人` : outsideWindowText(entry ?? null, '观测快照')}</strong><small>{entry && entry.deltaMs <= EVIDENCE_WINDOW_MS ? `${new Date(entry.item.observed_at).toLocaleString('zh-CN')} · 置信度 ${entry.item.confidence} · 与事件相差 ${formatDelta(entry.deltaMs)}` : '观测接口只保存最新一条，无法还原历史瞬时快照'}</small></article>; })}<article data-empty={!(nearestUav && nearestUav.deltaMs <= EVIDENCE_WINDOW_MS)}><span>无人机帧</span><strong>{nearestUav && nearestUav.deltaMs <= EVIDENCE_WINDOW_MS ? nearestUav.item.summary : '该时刻未拍摄'}</strong><small>{nearestUav && nearestUav.deltaMs <= EVIDENCE_WINDOW_MS ? new Date(nearestUav.item.ts).toLocaleString('zh-CN') : outsideWindowText(nearestUav, '无人机记录')}</small></article><article data-empty={!(nearestIncident && nearestIncident.deltaMs <= EVIDENCE_WINDOW_MS)}><span>人工上报</span><strong>{nearestIncident && nearestIncident.deltaMs <= EVIDENCE_WINDOW_MS ? nearestIncident.item.description : '该时刻无人工上报'}</strong><small>{nearestIncident && nearestIncident.deltaMs <= EVIDENCE_WINDOW_MS ? `${nearestIncident.item.reported_by} · ${nearestIncident.item.status} · 相差 ${formatDelta(nearestIncident.deltaMs)}` : outsideWindowText(nearestIncident, '人工上报')}</small></article></div></section>
      <PerceptionReplayPanel />
    </section><aside className="replay-reasoning"><section><h2>当前事件</h2>{current ? <><p>{current.summary}</p><small>{current.actor}（{current.role}） · {current.result}</small></> : <p className="replay-empty">暂无审计事件</p>}</section><section><h3>逐秒推理链 · GET /safety/trace/:id</h3>{trace ? <><div className="replay-chain-meta"><span>{trace.trigger}</span><span>观测 v{trace.observation_version} / 约束 v{trace.constraint_version}</span></div><ol className="replay-chain">{trace.stages.map((stage, index) => <li key={`${stage.stage}-${index}`} data-status={stage.status}><b>{stage.stage}</b><span>+{stage.duration_ms} ms · {stage.status}</span><small>{stage.detail ? JSON.stringify(stage.detail) : '无额外详情'}</small></li>)}</ol><p>结果：{trace.outcome?.state ?? '—'} · 方案 {trace.outcome?.plan_id ?? '—'} · 校验 {trace.outcome?.validation_valid === undefined ? '—' : trace.outcome.validation_valid ? '通过' : '未通过'}</p></> : <p className="replay-empty">{current?.trace_id ? 'Trace 读取中或不可用' : '该审计记录未提供 trace_id'}</p>}</section><section><h3>独立校验结果</h3>{trace?.outcome?.violation_codes?.length ? trace.outcome.violation_codes.map(code => <p className="replay-rule" key={code}>{code}</p>) : <p className="replay-empty">{trace?.outcome?.validation_valid === true ? 'Trace 记录校验通过' : '暂无关联校验规则'}</p>}</section></aside></div>
    <footer className="replay-notice">竞赛基准结果不由回放接口提供；请以 evaluation 中可复现实验为准。CityStreet 感知回放为派生展示数据，非实时、无真值且不映射为本场景区域。</footer>
  </main></div>;
}
