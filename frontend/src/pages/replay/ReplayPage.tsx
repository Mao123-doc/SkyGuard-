import { useEffect, useMemo, useState } from 'react';
import TopBar from '../../components/TopBar';
import PerceptionReplayPanel from '../command-center/PerceptionReplayPanel';
import safetyApi, { type AuditEntry, type SafetyStatus } from '../../services/safetyApi';
import './ReplayPage.css';

interface DecisionTrace {
  trace_id: string;
  started_at: string;
  finished_at?: string;
  actor: string;
  trigger: string;
  constraint_version: number;
  observation_version: number;
  stages: Array<{
    stage: string;
    status: 'ok' | 'warning' | 'failed' | 'skipped';
    duration_ms: number;
    detail?: Record<string, unknown>;
  }>;
  outcome?: {
    state?: string;
    plan_id?: string;
    validation_valid?: boolean;
    violation_codes?: string[];
  };
}

async function fetchTraces(): Promise<DecisionTrace[]> {
  const token = localStorage.getItem('admin_token');
  const response = await fetch('/api/v1/safety/traces', {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) throw new Error(`Trace API ${response.status}`);
  const payload = await response.json() as { traces?: DecisionTrace[] };
  return payload.traces ?? [];
}

export default function ReplayPage() {
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [traces, setTraces] = useState<DecisionTrace[]>([]);
  const [status, setStatus] = useState<SafetyStatus | null>(null);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    try {
      const [entries, nextStatus, nextTraces] = await Promise.all([
        safetyApi.audit(200),
        safetyApi.status(),
        fetchTraces(),
      ]);
      setAudit(entries);
      setStatus(nextStatus);
      setTraces(nextTraces);
      setError(null);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const events = useMemo(() => audit.slice().reverse().slice(0, 20), [audit]);
  const current = events[selected] ?? null;
  const matchingTrace = traces.find(trace => trace.actor === current?.actor || trace.trigger === current?.action) ?? traces[0] ?? null;

  return <div className="replay-page">
    <TopBar />
    <main className="replay-content">
      <header className="replay-title">
        <div>
          <span>P3 / DECISION REPLAY</span>
          <h1>决策回放</h1>
          <p>审计事件和安全 Trace 按时间顺序展示；当前状态快照不代表历史重建。</p>
        </div>
        <div className="replay-title-actions">
          <span className="replay-demo-tag">{events.length} 个事件 · {traces.length} 个 Trace</span>
          <button type="button" onClick={() => void refresh()} disabled={loading}>刷新</button>
        </div>
      </header>
      {error ? <p className="replay-error" role="alert">回放数据读取失败：{error}</p> : null}
      <section className="replay-timeline">
        <div className="replay-timeline-head">
          <strong>审计事件时间线</strong>
          <span>{current ? new Date(current.ts).toLocaleString('zh-CN') : loading ? '正在读取…' : '暂无时间点'}</span>
        </div>
        <input aria-label="审计事件时间点" type="range" min={0} max={Math.max(0, events.length - 1)} value={selected} disabled={!events.length} onChange={event => setSelected(Number(event.target.value))} />
        <div className="replay-event-points">
          {events.map((entry, index) => <button type="button" key={entry.id} aria-pressed={selected === index} onClick={() => setSelected(index)}>
            <i />
            {new Date(entry.ts).toLocaleTimeString('zh-CN', { hour12: false })}
            <small>{entry.action}</small>
            <small>{entry.result}</small>
          </button>)}
          {!events.length ? <p className="replay-empty">暂无审计事件时间点</p> : null}
        </div>
      </section>
      <section className="replay-snapshot">
        <header><h2>态势快照</h2><span>当前 API 状态 · 非历史还原</span></header>
        <div className="replay-kpis">
          <article><span>安全状态</span><strong>{status?.state.state ?? '暂无数据'}</strong></article>
          <article><span>观测数量</span><strong>{status ? `${status.observations.length} 条` : '暂无数据'}</strong></article>
          <article><span>最高风险</span><strong>{status?.risk_summary.highest ?? '暂无数据'}</strong></article>
          <article><span>数据版本</span><strong>{status ? `观测 ${status.versions.observation} / 约束 ${status.versions.constraint}` : '暂无数据'}</strong></article>
        </div>
      </section>
      <div className="replay-layout">
        <section className="replay-left">
          <section className="replay-evidence">
            <header><h2>回放证据</h2><span>无接口记录时明确显示空态</span></header>
            <div className="replay-evidence-grid">
              <article><span>事件记录</span><strong>{current?.summary ?? '暂无对应审计事件'}</strong><small>{current?.actor ?? '暂无操作者'}</small></article>
              <article><span>无人机 / 摄像头帧</span><strong>暂无历史帧数据</strong><small>当前 API 未返回关联媒体</small></article>
              <article><span>现场人员反馈</span><strong>暂无关联反馈记录</strong><small>人员反馈需从工单历史核对</small></article>
              <article><span>决策 Trace</span><strong>{matchingTrace?.trace_id ?? '暂无关联 Trace'}</strong><small>{matchingTrace?.trigger ?? '暂无触发来源'}</small></article>
            </div>
          </section>
          <PerceptionReplayPanel />
        </section>
        <aside className="replay-reasoning">
          <section>
            <h2>当时决策依据</h2>
            {current ? <><p>{current.summary}</p><small>{current.actor}（{current.role}） · {current.result} · {new Date(current.ts).toLocaleString('zh-CN')}</small></> : <p className="replay-empty">暂无审计事件，不能重建历史决策。</p>}
          </section>
          <section>
            <h3>逐阶段推理链</h3>
            {matchingTrace ? <>
              <div className="replay-chain-meta"><span>触发：{matchingTrace.trigger}</span><span>版本：观测 {matchingTrace.observation_version} / 约束 {matchingTrace.constraint_version}</span></div>
              <ol className="replay-chain">
                {matchingTrace.stages.map((stage, index) => <li key={`${stage.stage}-${index}`} data-status={stage.status}><b>{stage.stage}</b><span>{stage.status}</span><small>{stage.duration_ms} ms {stage.detail ? `· ${JSON.stringify(stage.detail)}` : ''}</small></li>)}
              </ol>
              <p>结果：{matchingTrace.outcome?.state ?? '暂无'} · 方案 {matchingTrace.outcome?.plan_id ?? '暂无'} · 独立校验 {matchingTrace.outcome?.validation_valid === undefined ? '暂无结果' : matchingTrace.outcome.validation_valid ? '通过' : '未通过'}</p>
            </> : <p className="replay-empty">暂无 Trace；不会用当前状态伪造历史链路。</p>}
          </section>
          <section>
            <h3>当前校验信息</h3>
            {status?.validation ? <>
              <p>校验 {status.validation.valid ? '通过' : '未通过'} · {status.validation.checks_run.length} 项检查</p>
              {status.validation.violations.length ? status.validation.violations.map((violation, index) => <p className="replay-rule" key={`${violation.code}-${index}`}>{violation.code} · {violation.message}</p>) : <p className="replay-empty">独立校验无违规项</p>}
            </> : <p className="replay-empty">暂无当前校验记录</p>}
          </section>
        </aside>
      </div>
      <footer className="replay-notice">感知帧为 CityStreet C3 派生展示数据：非实时、无真值、许可未确认、未标定映射；不映射为 SkyGuard 场景区域。</footer>
    </main>
  </div>;
}
