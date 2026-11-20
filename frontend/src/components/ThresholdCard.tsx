import { useState } from 'react';
import type { RegionRisk, SafetyIncident } from '../services/safetyApi';
import './ThresholdCard.css';

const levels = ['normal', 'watch', 'high', 'critical', 'unknown'];
const labels: Record<string, string> = { normal: '正常', watch: '关注', high: '高风险', critical: '极高风险', unknown: '未知' };
type Disposition = '已执行' | '忽略' | '已上报';

export default function ThresholdCard({ risks, incidents }: { risks: RegionRisk[]; incidents: SafetyIncident[] }) {
  const [marked, setMarked] = useState<Record<string, Disposition>>({});
  const triggered = risks.filter(risk => risk.level === 'high' || risk.level === 'critical');
  return <section className="thr-panel"><header className="thr-heading"><div><span className="thr-kicker">THRESHOLD EVENTS</span><h2>阈值触发</h2></div><span>{triggered.length} 个区域</span></header>
    {triggered.length === 0 && incidents.length === 0 ? <p className="thr-empty">暂无阈值告警</p> : null}
    {triggered.map(risk => <article className="thr-item" key={risk.regionId}><div className="thr-item-title"><strong>{risk.regionId}</strong><span data-level={risk.level}>{labels[risk.level]}</span></div><p>{risk.signals.map(signal => signal.message).join('；') || '后端风险等级已触发'}</p><small>密度 {risk.density ?? '未知'} · 置信度 {risk.confidence ?? '未知'} · {risk.trusted ? '可信观测' : '不可作为可信依据'}</small>
      <div className="thr-actions"><button type="button" aria-pressed={marked[risk.regionId] === '已执行'} onClick={() => setMarked(current => ({ ...current, [risk.regionId]: '已执行' }))}>已执行</button><button type="button" aria-pressed={marked[risk.regionId] === '忽略'} onClick={() => setMarked(current => ({ ...current, [risk.regionId]: '忽略' }))}>忽略</button><button type="button" aria-pressed={marked[risk.regionId] === '已上报'} onClick={() => setMarked(current => ({ ...current, [risk.regionId]: '已上报' }))}>上报</button></div>
      {marked[risk.regionId] ? <small className="thr-local-note">本页临时标记：{marked[risk.regionId]}（未提交后端）</small> : null}</article>)}
    {incidents.map(incident => <article className="thr-item" key={incident.id}><div className="thr-item-title"><strong>{incident.type} · {incident.severity}</strong><span>{incident.status}</span></div><p>{incident.description}</p><small>{incident.reported_by} · {new Date(incident.reported_at).toLocaleString('zh-CN')}</small></article>)}
    {risks.length === 0 && incidents.length === 0 && levels.length > 0 ? <p className="thr-empty">风险评估数据不可用</p> : null}
    <p className="thr-disclaimer">处理标记仅保存在当前页面状态，不是现场执行反馈或审计记录。</p>
  </section>;
}
