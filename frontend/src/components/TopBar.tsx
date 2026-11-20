import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import mvpApi from '../services/mvpApi';
import TimeSegmentSwitch, { type TimeSegment } from './TimeSegmentSwitch';
import './TopBar.css';

const pages = [['/plan', '预案推演'], ['/live', '现场总览'], ['/replay', '决策回放'], ['/audit', '审计记录']] as const;
const segmentKey = 'skyguard-time-segment';
function savedSegment(): TimeSegment {
  const value = localStorage.getItem(segmentKey);
  return value === 'entry' || value === 'active' || value === 'exit' ? value : 'entry';
}

export default function TopBar({ showSegments = false }: { showSegments?: boolean }) {
  const [segment, setSegment] = useState<TimeSegment>(savedSegment);
  const [demoOpen, setDemoOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const choose = (value: TimeSegment) => { localStorage.setItem(segmentKey, value); setSegment(value); };
  const run = async (scenario: 'A_normal' | 'B_surge' | 'C_untrusted') => {
    setBusy(true); setMessage('');
    try { await mvpApi.runDemo(scenario); setMessage('演示数据已注入'); }
    catch (error) { setMessage(`注入失败：${(error as Error).message}`); }
    finally { setBusy(false); setDemoOpen(false); }
  };
  const reset = async () => {
    setBusy(true);
    try { await mvpApi.reset(); setMessage('演示状态已重置'); }
    catch (error) { setMessage(`重置失败：${(error as Error).message}`); }
    finally { setBusy(false); setDemoOpen(false); }
  };
  return (
    <header className="sg-topbar">
      <Link className="sg-brand" to="/plan"><span className="sg-mark">S</span><span>SKYGUARD<small>研究原型 · 辅助决策</small></span></Link>
      {showSegments ? <TimeSegmentSwitch value={segment} onChange={choose} /> : null}
      <nav aria-label="主导航">{pages.map(([to, label]) => <NavLink key={to} to={to}>{label}</NavLink>)}<NavLink to="/legacy">旧版</NavLink></nav>
      <div className="sg-top-actions"><span className="sg-local-tag"><i />LOCAL DEMO</span><div className="sg-demo-wrap">
        <button type="button" className="sg-demo-button" aria-expanded={demoOpen} onClick={() => setDemoOpen(open => !open)}>注入演示数据⌄</button>
        {demoOpen ? <div className="sg-demo-menu"><button disabled={busy} onClick={() => void run('A_normal')}>推演 A：正常散场</button><button disabled={busy} onClick={() => void run('B_surge')}>推演 B：局部聚集 + 信息缺口</button><button disabled={busy} onClick={() => void run('C_untrusted')}>推演 C：不可信 + 容量不足</button><button disabled={busy} onClick={() => void reset()}>重置</button></div> : null}
      </div><Link className="sg-login" to="/login">登录</Link>{message ? <span className="sg-top-message" role="status">{message}</span> : null}</div>
    </header>
  );
}
