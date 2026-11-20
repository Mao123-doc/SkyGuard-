import { useEffect, useMemo, useState } from 'react';
import TopBar from '../../components/TopBar';
import safetyApi, { type AuditEntry } from '../../services/safetyApi';
import './AuditPage.css';

function downloadCsv(entries: AuditEntry[]) {
  const header = ['time', 'type', 'summary', 'actor', 'result', 'trace_id'];
  const rows = entries.map(entry => [entry.ts, entry.action, entry.summary, entry.actor, entry.result, entry.id]);
  const csv = [header, ...rows].map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = 'skyguard-audit.csv'; link.click(); URL.revokeObjectURL(url);
}

export default function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState('all');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { safetyApi.audit(200).then(setEntries).catch(cause => setError((cause as Error).message)); }, []);
  const filtered = useMemo(() => entries.filter(entry => {
    const haystack = `${entry.summary} ${entry.actor} ${entry.action} ${entry.id}`.toLowerCase();
    return (!query || haystack.includes(query.toLowerCase())) && (result === 'all' || entry.result === result);
  }), [entries, query, result]);
  const stats = { total: entries.length, success: entries.filter(entry => entry.result === 'success').length, failure: entries.filter(entry => entry.result === 'failure').length, rejected: entries.filter(entry => entry.result === 'rejected').length, actors: new Set(entries.map(entry => entry.actor)).size, filtered: filtered.length };
  return <div className="audit-page"><TopBar /><main className="audit-content"><header className="audit-title"><div><span>AUDIT TRAIL · P4</span><h1>审计记录</h1><p>安全决策、人工操作与业务闭环留痕；数据直接来自后端审计 API。</p></div><button type="button" onClick={() => downloadCsv(filtered)} disabled={!filtered.length}>导出 CSV</button></header>
    <section className="audit-filters"><label>关键词<input value={query} onChange={event => setQuery(event.target.value)} placeholder="操作人、内容或留痕 ID" /></label><label>结果<select value={result} onChange={event => setResult(event.target.value)}><option value="all">全部结果</option><option value="success">成功</option><option value="failure">失败</option><option value="rejected">拒绝</option></select></label><span>{error ? `读取失败：${error}` : `筛选结果 ${stats.filtered} 条`}</span></section>
    <section className="audit-stats">{[['总记录', stats.total], ['成功', stats.success], ['失败', stats.failure], ['拒绝', stats.rejected], ['操作人', stats.actors], ['当前视图', stats.filtered]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</section>
    <div className="audit-layout"><section className="audit-table-wrap"><table className="audit-table"><thead><tr><th>时间</th><th>类型</th><th>内容</th><th>操作人</th><th>结果</th><th>留痕 ID</th></tr></thead><tbody>{filtered.map(entry => <tr key={entry.id} data-result={entry.result} onClick={() => setSelected(entry)}><td>{new Date(entry.ts).toLocaleString('zh-CN')}</td><td>{entry.action}</td><td>{entry.summary}</td><td>{entry.actor}<small>{entry.role}</small></td><td><span className="audit-result">{entry.result}</span></td><td><code>{entry.id}</code></td></tr>)}{!filtered.length ? <tr><td colSpan={6} className="audit-empty">暂无匹配审计记录</td></tr> : null}</tbody></table></section>
      <aside className="audit-drawer">{selected ? <><header><div><span>TRACE DETAIL</span><h2>记录详情</h2></div><button type="button" aria-label="关闭详情" onClick={() => setSelected(null)}>×</button></header><dl><dt>上报内容 / 操作摘要</dt><dd>{selected.summary}</dd><dt>系统响应</dt><dd>{selected.reason ?? '后端未提供额外响应说明'}</dd><dt>命中规则</dt><dd>{selected.action} · {selected.result}</dd><dt>操作人</dt><dd>{selected.actor}（{selected.role}）</dd><dt>留痕 ID</dt><dd><code>{selected.id}</code></dd></dl><button type="button" className="audit-review">标记复核（本页占位）</button></> : <div className="audit-drawer-empty">选择主表记录查看详情<br /><small>暂无选择时不展示虚构内容</small></div>}</aside>
    </div><footer className="audit-notice">审计记录为后端事实留痕；“标记复核”当前不写入后端。</footer></main></div>;
}
