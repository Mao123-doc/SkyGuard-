import TopBar from '../../components/TopBar';
import type { TimeSegment } from '../../components/TimeSegmentSwitch';
import DutyTable from '../../components/DutyTable';
import OccupancyGrid from '../../components/OccupancyGrid';
import DroneFeed from '../../components/DroneFeed';
import VerdictCard from '../../components/VerdictCard';
import safetyApi, { type SafetyStatus } from '../../services/safetyApi';
import mvpApi, { type MvpDashboard } from '../../services/mvpApi';
import { useCallback, useEffect, useState } from 'react';
import './LivePage.css';

const segmentKey = 'skyguard-time-segment';
function readSegment(): TimeSegment {
  const value = localStorage.getItem(segmentKey);
  return value === 'active' || value === 'exit' ? value : 'entry';
}
export default function LivePage() {
  const [segment, setSegment] = useState<TimeSegment>(readSegment);
  const [status, setStatus] = useState<SafetyStatus | null>(null);
  const [dashboard, setDashboard] = useState<MvpDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const [nextStatus, nextDashboard] = await Promise.all([safetyApi.status(), mvpApi.dashboard()]);
      setStatus(nextStatus); setDashboard(nextDashboard); setError(null);
    } catch (cause) { setError((cause as Error).message); }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  const restrictedExits = status?.exits.filter(exit => !exit.usable || exit.effective_status !== 'open').length ?? 0;
  const latestCount = status?.observations.reduce((sum, observation) => sum + observation.estimated_count, 0) ?? null;
  const capacity = status?.regions.reduce((sum, region) => sum + region.holding_capacity_persons, 0) ?? null;
  return <div className="live-page">
    <TopBar showSegments onSegmentChange={setSegment} />
    <main className="live-content">
      <section className="live-summary" aria-label="当前场馆指标">
        <div><span>场内观测人数</span><strong>{latestCount === null ? '—' : latestCount.toLocaleString('zh-CN')}<small>人</small></strong></div>
        <div><span>场景区域容量合计</span><strong>{capacity === null ? '—' : capacity.toLocaleString('zh-CN')}<small>人</small></strong></div>
        <div><span>受限入口</span><strong className={restrictedExits ? 'is-warn' : ''}>{status ? restrictedExits : '—'}<small>个</small></strong></div>
      </section>
      {error ? <p className="live-error" role="alert">当前数据读取失败：{error}；请勿将缓存或空值视为实时状态。</p> : null}
      <div className="live-entry-grid">
        <DutyTable exits={status?.exits ?? []} staff={dashboard?.staff ?? []} loading={!status || !dashboard} />
        <div className="live-center-stack">
          <OccupancyGrid regions={status?.regions ?? []} risks={status?.risks ?? []} observations={status?.observations ?? []} loading={!status} />
          <DroneFeed cameras={dashboard?.cameras ?? []} loading={!dashboard} />
        </div>
        <VerdictCard status={status} cameras={dashboard?.cameras ?? []} segment={segment} loading={!status || !dashboard} />
      </div>
      <footer className="live-notice">{dashboard?.scenario.notice ?? '场景数据来自后端；场景参数为合成/估算值，未现场标定。'} · 研究原型，不用于真实应急指挥</footer>
    </main>
  </div>;
}
