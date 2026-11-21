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

function AuditStats({ stats }: { stats: { total: number; success: number; failure: number; rejected: number; actors: number; filtered: number } }) {
  const items = [
    ['总记录', stats.total],
    ['成功', stats.success],
    ['失败', stats.failure],
    ['拒绝', stats.rejected],
    ['操作人', stats.actors],
    ['当前视图', stats.filtered],
  ] as const;
  return <section className="audit-stats">
    {items.map(([label, value]) => <div key={label}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>)}
  </section>;
}

function AuditFilters({ query, result, count, loading, error, onQuery, onResult }: {
  query: string;
  result: string;
  count: number;
  loading: boolean;
  error: string | null;
  onQuery: (value: string) => void;
  onResult: (value: string) => void;
}) {
  return <section className="audit-filters">
    <label>
      关键词
      <input
        value={query}
        onChange={event => onQuery(event.target.value)}
        placeholder="操作者、内容或留痕 ID"
      />
    </label>
    <label>
      结果
      <select value={result} onChange={event => onResult(event.target.value)}>
        <option value="all">全部结果</option>
        <option value="success">成功</option>
        <option value="failure">失败</option>
        <option value="rejected">拒绝</option>
      </select>
    </label>
    <span>
      {error ? `读取失败：${error}` : loading ? '正在读取审计 API…' : `筛选结果 ${count} 条`}
    </span>
  </section>;
}

function AuditPageHeading({ onRefresh, onExport, loading, hasRows }: {
  onRefresh: () => void;
  onExport: () => void;
  loading: boolean;
  hasRows: boolean;
}) {
  return <header className="audit-title">
    <div>
      <span>AUDIT TRAIL · P4</span>
      <h1>审计记录</h1>
      <p>安全决策、人工操作与业务闭环留痕；数据直接来自后端审计 API。</p>
    </div>
    <div className="audit-title-actions">
      <button type="button" onClick={onRefresh} disabled={loading}>刷新</button>
      <button type="button" onClick={onExport} disabled={!hasRows}>导出 CSV</button>
    </div>
  </header>;
}

function AuditTable({ entries, onSelect }: { entries: AuditEntry[]; onSelect: (entry: AuditEntry) => void }) {
  return <section className="audit-table-wrap">
    <table className="audit-table">
      <thead>
        <tr>
          <th>时间</th>
          <th>类型</th>
          <th>内容</th>
          <th>操作人</th>
          <th>结果</th>
          <th>留痕 ID</th>
        </tr>
      </thead>
      <tbody>
        {entries.map(entry => <tr key={entry.id} data-result={entry.result} onClick={() => onSelect(entry)}>
          <td>{new Date(entry.ts).toLocaleString('zh-CN')}</td>
          <td>{entry.action}</td>
          <td>{entry.summary}</td>
          <td>{entry.actor}<small>{entry.role}</small></td>
          <td><span className="audit-result">{entry.result}</span></td>
          <td><code>{entry.id}</code></td>
        </tr>)}
        {!entries.length ? <tr><td colSpan={6} className="audit-empty">暂无匹配审计记录</td></tr> : null}
      </tbody>
    </table>
  </section>;
}

function AuditDetail({ entry, onClose }: { entry: AuditEntry | null; onClose: () => void }) {
  if (!entry) return <aside className="audit-drawer"><div className="audit-drawer-empty">选择主表记录查看详情<br /><small>暂无选择时不展示虚构内容</small></div></aside>;
  return <aside className="audit-drawer">
    <header>
      <div><span>TRACE DETAIL</span><h2>记录详情</h2></div>
      <button type="button" aria-label="关闭详情" onClick={onClose}>×</button>
    </header>
    <dl>
      <dt>上报内容 / 操作摘要</dt><dd>{entry.summary}</dd>
      <dt>系统响应</dt><dd>{entry.reason ?? '后端未提供额外响应说明'}</dd>
      <dt>命中规则</dt><dd>{entry.action} · {entry.result}</dd>
      <dt>操作者</dt><dd>{entry.actor}（{entry.role}）</dd>
      <dt>发生时间</dt><dd>{new Date(entry.ts).toLocaleString('zh-CN')}</dd>
      <dt>留痕 ID</dt><dd><code>{entry.id}</code></dd>
    </dl>
    <section className="audit-detail-checks">
      <h3>记录核对</h3>
      <p><span>时间戳</span><b>{Number.isNaN(Date.parse(entry.ts)) ? '格式异常' : '有效'}</b></p>
      <p><span>操作者与角色</span><b>{entry.actor && entry.role ? '已记录' : '字段缺失'}</b></p>
      <p><span>动作与结果</span><b>{entry.action && entry.result ? '已记录' : '字段缺失'}</b></p>
      <small>只读核对，不修改后端审计状态。</small>
    </section>
  </aside>;
}

export default function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState('all');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = async () => {
    setLoading(true);
    try { setEntries(await safetyApi.audit(200)); setError(null); }
    catch (cause) { setError((cause as Error).message); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);
  const filtered = useMemo(() => entries.filter(entry => {
    const haystack = `${entry.summary} ${entry.actor} ${entry.action} ${entry.id}`.toLowerCase();
    return (!query || haystack.includes(query.toLowerCase())) && (result === 'all' || entry.result === result);
  }), [entries, query, result]);
  const stats = { total: entries.length, success: entries.filter(entry => entry.result === 'success').length, failure: entries.filter(entry => entry.result === 'failure').length, rejected: entries.filter(entry => entry.result === 'rejected').length, actors: new Set(entries.map(entry => entry.actor)).size, filtered: filtered.length };
  return <div className="audit-page"><TopBar /><main className="audit-content">
    <AuditPageHeading
      onRefresh={() => void refresh()}
      onExport={() => downloadCsv(filtered)}
      loading={loading}
      hasRows={Boolean(filtered.length)}
    />
    <AuditFilters
      query={query}
      result={result}
      count={stats.filtered}
      loading={loading}
      error={error}
      onQuery={setQuery}
      onResult={setResult}
    />
    <AuditStats stats={stats} />
    <div className="audit-layout">
      <AuditTable entries={filtered} onSelect={setSelected} />
      <AuditDetail entry={selected} onClose={() => setSelected(null)} />
    </div><footer className="audit-notice">审计记录为后端事实留痕；“标记复核”当前不写入后端。</footer></main></div>;
}
