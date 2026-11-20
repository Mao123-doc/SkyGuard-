import type { CameraHealth } from '../services/mvpApi';
import type { SafetyStatus } from '../services/safetyApi';
import type { TimeSegment } from './TimeSegmentSwitch';
import './VerdictCard.css';

const stateNames: Record<string, string> = { NORMAL: '常态运行', REROUTE: '重规划', DEGRADED: '感知降级', REJECT: '安全拒绝' };
export default function VerdictCard({ status, cameras, segment, loading }: { status: SafetyStatus | null; cameras: CameraHealth[]; segment: TimeSegment; loading: boolean }) {
  const restricted = status?.exits.filter(exit => !exit.usable || exit.effective_status !== 'open') ?? [];
  const staleCameras = cameras.filter(camera => camera.state !== 'online');
  return <aside className="verdict-panel">
    <header className="verdict-heading"><div><span className="verdict-kicker">DECISION BASIS</span><h2>判断依据</h2></div><span className="verdict-segment">{segment === 'entry' ? '进场模式' : segment === 'active' ? '活动模式' : '散场模式'}</span></header>
    {loading || !status ? <p className="verdict-empty">正在读取安全决策…</p> : <>
      <section className={`verdict-main state-${status.state.state.toLowerCase()}`}><small>安全决策引擎</small><strong>{stateNames[status.state.state]}</strong><span>{status.state.headline}</span></section>
      <section className="verdict-block"><h3>系统状态与校验</h3><p>数据版本 {status.versions.observation} · 场景 {status.versions.scenario}</p><p>{status.validation ? `独立校验：${status.validation.valid ? '通过' : '未通过'}` : '独立校验结果：暂无记录'}</p>{status.validation?.violations.map((item, index) => <p className="verdict-risk" key={`${item.code}-${index}`}>{item.code} · {item.message}</p>)}</section>
      <section className="verdict-block"><h3>入口与数据新鲜度</h3>{restricted.length ? restricted.map(exit => <p className="verdict-risk" key={exit.id}>{exit.name}：{exit.status_reason}</p>) : <p>当前没有受限出口。</p>}{staleCameras.length ? <p className="verdict-risk">{staleCameras.length} 路摄像头非在线；数据不能视为实时。</p> : <p>摄像头状态由后端报告。</p>}</section>
      <section className="verdict-block"><h3>建议动作</h3>{status.state.requires_operator_action ? <p className="verdict-risk">需要现场安全操作员复核；不得将未校验方案视为可用。</p> : <p>遵循后端安全状态与人工审批流程。</p>}</section>
    </>}
  </aside>;
}
