import type { SafetyExit } from '../services/safetyApi';
import type { StaffMember } from '../services/mvpApi';
import './DutyTable.css';

export default function DutyTable({ exits, staff, loading }: { exits: SafetyExit[]; staff: StaffMember[]; loading: boolean }) {
  return <section className="duty-panel">
    <header className="duty-heading"><div><span className="duty-kicker">ENTRY CONTROL</span><h2>入口值守与指令</h2></div><span className="duty-count">{loading ? '读取中' : `${exits.length} 个入口`}</span></header>
    <p className="duty-subtitle">系统建议与当前指令分别展示；数据由安全状态与人员 API 提供。</p>
    <div className="duty-table-wrap"><table className="duty-table"><thead><tr><th>入口</th><th>值守人</th><th>排队</th><th>系统建议</th><th>当前指令</th></tr></thead>
      <tbody>{exits.map(exit => {
        const assigned = staff.find(member => member.region_id === exit.region_id);
        const restricted = exit.effective_status !== 'open' || !exit.usable;
        return <tr key={exit.id} data-restricted={restricted}>
          <td><strong>{exit.name}</strong><small>{exit.id} · {exit.effective_status}</small></td>
          <td>{assigned?.name ?? '未分配'}<small>{assigned ? `${assigned.role} · ${assigned.status}` : '当前区域无关联工作人员'}</small></td>
          <td className="duty-queue">—<small>后端未提供</small></td>
          <td>{restricted ? '入口受限' : '按安全状态运行'}</td>
          <td><span className={restricted ? 'duty-command is-restricted' : 'duty-command'}>{exit.effective_status === 'open' && exit.usable ? '未提供' : exit.effective_status}</span></td>
        </tr>;
      })}{!loading && exits.length === 0 ? <tr><td colSpan={5} className="duty-empty">暂无入口数据</td></tr> : null}{loading ? <tr><td colSpan={5} className="duty-empty">正在读取入口和值守人员…</td></tr> : null}</tbody>
    </table></div>
    <div className="duty-execution"><strong>指令执行闭环</strong><span>系统建议与入口状态来自安全 API。</span><span>值守排班与操作指令尚未由后端提供。</span></div>
  </section>;
}
