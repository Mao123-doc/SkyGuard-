import type { SafetyExit, SafetyObservation, SafetyRegion } from '../services/safetyApi';
import type { StaffMember } from '../services/mvpApi';
import './DutyTable.css';

export default function DutyTable({ exits, staff, regions, observations, loading }: { exits: SafetyExit[]; staff: StaffMember[]; regions: SafetyRegion[]; observations: SafetyObservation[]; loading: boolean }) {
  const latestByRegion = new Map<string, SafetyObservation>();
  for (const observation of observations) {
    const current = latestByRegion.get(observation.region_id);
    if (!current || Date.parse(observation.observed_at) > Date.parse(current.observed_at)) latestByRegion.set(observation.region_id, observation);
  }
  return <section className="duty-panel">
    <header className="duty-heading"><div><span className="duty-kicker">入口管控</span><h2>入口值守与指令</h2></div><span className="duty-count">{loading ? '读取中' : `${exits.length} 个入口`}</span></header>
    <p className="duty-subtitle">系统建议与当前指令分别展示；数据由安全状态与人员 API 提供。</p>
    <div className="duty-table-wrap"><table className="duty-table"><thead><tr><th>入口</th><th>值守人</th><th>排队（区域在场）</th><th>系统建议</th><th>当前指令</th></tr></thead>
      <tbody>{exits.map(exit => {
        const assigned = staff.find(member => member.region_id === exit.region_id);
        const region = regions.find(item => item.id === exit.region_id);
        const queue = latestByRegion.get(exit.region_id)?.estimated_count ?? null;
        const occupancy = queue === null || !region ? null : queue / region.holding_capacity_persons;
        const restricted = exit.effective_status !== 'open' || !exit.usable;
        const suggestion = restricted ? '停止放行并人工复核' : occupancy === null ? '—' : occupancy > 0.75 ? '限流并增派值守' : '维持当前放行';
        return <tr key={exit.id} data-restricted={restricted}>
          <td><strong>{region?.name ?? exit.name}</strong><small>{exit.id} · {exit.effective_status}</small></td>
          <td>{assigned?.name ?? '未分配'}<small>{assigned ? `${assigned.role} · ${assigned.status}` : '当前区域无关联工作人员'}</small></td>
          <td className="duty-queue">{queue === null ? '—' : queue}<small>{queue === null ? '该区域暂无观测' : `观测 · 占容 ${Math.round((occupancy ?? 0) * 100)}%`}</small></td>
          <td>{suggestion}</td>
          <td><span title="后端未提供 instruction 字段" className={restricted ? 'duty-command is-restricted' : 'duty-command'}>未知</span></td>
        </tr>;
      })}{!loading && exits.length === 0 ? <tr><td colSpan={5} className="duty-empty">暂无入口数据</td></tr> : null}{loading ? <tr><td colSpan={5} className="duty-empty">正在读取入口和值守人员…</td></tr> : null}</tbody>
    </table></div>
    <div className="duty-execution"><strong>数据来源</strong><span>值守人：GET /api/v1/mvp/staff；在场人数：GET /api/v1/safety/observations 最新一条。</span><span>“排队”列以闸口广场的在场人数近似，后端没有独立排队字段。</span><span>当前指令：后端未提供 instruction 字段，统一显示“未知”。</span></div>
  </section>;
}
