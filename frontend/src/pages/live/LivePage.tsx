import TopBar from '../../components/TopBar';
import type { TimeSegment } from '../../components/TimeSegmentSwitch';
import DutyTable from '../../components/DutyTable';
import OccupancyGrid from '../../components/OccupancyGrid';
import DroneFeed from '../../components/DroneFeed';
import VerdictCard from '../../components/VerdictCard';
import ThresholdCard from '../../components/ThresholdCard';
import NetworkMap from '../command-center/components/NetworkMap';
import { MAP_MIN_ZOOM } from '../command-center/commandCenterUtils';
import safetyApi, { type SafetyScenarioSummary, type SafetyStatus } from '../../services/safetyApi';
import mvpApi, { type MvpDashboard, type StaffMember } from '../../services/mvpApi';
import { useCallback, useEffect, useState } from 'react';
import './LivePage.css';
import '../command-center/CommandCenterPage.css';

const segmentKey = 'skyguard-time-segment';
function readSegment(): TimeSegment {
  const value = localStorage.getItem(segmentKey);
  return value === 'active' || value === 'exit' ? value : 'entry';
}

function StaffContract({ staff, exits, loading }: { staff: StaffMember[]; exits: SafetyStatus['exits']; loading: boolean }) {
  const rows = exits.map(exit => ({
    exit,
    assigned: staff.find(member => member.region_id === exit.region_id),
  }));
  return <section className="live-staff-contract">
    <header><div><span>STAFF CONTRACT</span><h2>值守与指令字段</h2></div><small>{loading ? '正在读取' : `${rows.length} 个入口`}</small></header>
    <p>人员来自 GET /api/v1/mvp/staff；后端未返回 duty、instruction、queue 字段时保持空态。</p>
    <div className="live-staff-grid">
      {rows.map(({ exit, assigned }) => <article key={exit.id} data-state={exit.effective_status}>
        <strong>{exit.name}</strong>
        <span>{assigned?.name ?? '未分配值守人'}</span>
        <small>{assigned?.status ?? '人员状态未知'} · {assigned?.role ?? '角色未知'}</small>
        <div><b>排队</b><em>暂无后端字段</em></div>
        <div><b>系统建议</b><em>{exit.usable && exit.effective_status === 'open' ? '按安全状态运行' : '入口受限，人工复核'}</em></div>
        <div><b>当前指令</b><em>暂无后端字段</em></div>
      </article>)}
      {!rows.length ? <p className="live-empty">暂无入口与值守数据</p> : null}
    </div>
    {/* TODO: 等后端 staff.duty / staff.instruction / queue 字段 */}
    <footer>岗位值守、现场指令和排队数当前未由 API 提供。</footer>
  </section>;
}

function LiveSummary({ count, capacity, restricted }: { count: number | null; capacity: number | null; restricted: number }) {
  const number = (value: number | null) => value === null ? '—' : value.toLocaleString('zh-CN');
  return <section className="live-summary" aria-label="当前场馆指标">
    <div><span>场内观测人数</span><strong>{number(count)}<small>人</small></strong></div>
    <div><span>场景区域容量合计</span><strong>{number(capacity)}<small>人</small></strong></div>
    <div><span>受限入口</span><strong className={restricted ? 'is-warn' : ''}>{restricted}<small>个</small></strong></div>
  </section>;
}

function OfflineMonitor() {
  return <section className="live-monitor">
    <header><div><span>CAMERA MONITOR</span><h2>现场监控</h2></div></header>
    <div className="live-signal-offline"><strong>SIGNAL OFFLINE</strong><span>未接入实时视频源</span></div>
    <p>摄像头列表与健康状态见无人机/摄像头状态；不生成缩略画面。</p>
  </section>;
}

function LiveNotice({ notice }: { notice?: string }) {
  return <footer className="live-notice">
    {notice ?? '场景数据来自后端；场景参数为合成/估算值，未现场标定。'} · 研究原型，不用于真实应急指挥
  </footer>;
}

function LiveDataLegend() {
  const items = [
    ['后端事实', '安全状态、观测、出口和校验结果直接读取 API。'],
    ['字段缺失', '排队、duty、instruction 和无人机媒体不以空值伪造。'],
    ['研究边界', '场景参数为合成 / 估算值，未现场标定。'],
  ];
  return <section className="live-data-legend">
    <header><span>DATA CONTRACT</span><h2>数据边界</h2></header>
    <div>
      {items.map(([title, detail]) => <article key={title}><strong>{title}</strong><p>{detail}</p></article>)}
    </div>
  </section>;
}

export default function LivePage() {
  const [segment, setSegment] = useState<TimeSegment>(readSegment);
  const [status, setStatus] = useState<SafetyStatus | null>(null);
  const [scenario, setScenario] = useState<SafetyScenarioSummary | null>(null);
  const [dashboard, setDashboard] = useState<MvpDashboard | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mapZoom, setMapZoom] = useState(MAP_MIN_ZOOM);
  const [mapCenter, setMapCenter] = useState<{ x: number; y: number } | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const layers = { landmarks: true, regions: true, risks: true, corridors: true, validated: true, candidate: true, incidents: true };
  const refresh = useCallback(async () => {
    try {
      const [nextStatus, nextDashboard, nextScenario, nextStaff] = await Promise.all([safetyApi.status(), mvpApi.dashboard(), safetyApi.scenario(), mvpApi.staff()]);
      setStatus(nextStatus); setDashboard(nextDashboard); setScenario(nextScenario); setStaff(nextStaff); setError(null);
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
      <LiveSummary count={latestCount} capacity={capacity} restricted={status ? restrictedExits : 0} />
      {error ? <p className="live-error" role="alert">当前数据读取失败：{error}；请勿将缓存或空值视为实时状态。</p> : null}
      <div className="live-entry-grid">
        {segment === 'entry' ? <>
          <DutyTable exits={status?.exits ?? []} staff={dashboard?.staff ?? []} loading={!status || !dashboard} />
          <div className="live-center-stack"><OccupancyGrid regions={status?.regions ?? []} risks={status?.risks ?? []} observations={status?.observations ?? []} loading={!status} /><DroneFeed cameras={dashboard?.cameras ?? []} loading={!dashboard} /></div>
          <VerdictCard status={status} cameras={dashboard?.cameras ?? []} segment={segment} loading={!status || !dashboard} />
        </> : segment === 'active' ? <>
          <OccupancyGrid regions={status?.regions ?? []} risks={status?.risks ?? []} observations={status?.observations ?? []} loading={!status} />
          <div className="live-center-stack"><OfflineMonitor /><ThresholdCard risks={status?.risks ?? []} incidents={status?.incidents ?? []} /></div>
          <VerdictCard status={status} cameras={dashboard?.cameras ?? []} segment={segment} loading={!status || !dashboard} />
        </> : <>
          <OccupancyGrid regions={status?.regions ?? []} risks={status?.risks ?? []} observations={status?.observations ?? []} loading={!status} />
          {status ? <section className="live-map-panel"><header><div><span>EVACUATION NETWORK</span><h2>疏散路线图</h2></div><span>{status.state.state}</span></header><NetworkMap map={scenario?.map} status={status} selectedRegion={selectedRegion} onSelectRegion={setSelectedRegion} allowRoutes={!error} zoom={mapZoom} setZoom={setMapZoom} center={mapCenter} setCenter={setMapCenter} showBackdrop={false} layers={layers} /><div className="live-map-validation">{status.validation ? `独立校验：${status.validation.valid ? '通过' : '未通过'}` : '独立校验结果：暂无记录'} · 路线显示遵循后端安全状态</div></section> : <section className="live-map-panel live-signal-offline">正在读取网络状态…</section>}
          <VerdictCard status={status} cameras={dashboard?.cameras ?? []} segment={segment} loading={!status || !dashboard} />
        </>}
      </div>
      <StaffContract staff={staff} exits={status?.exits ?? []} loading={!status || !dashboard} />
      <LiveDataLegend />
      <LiveNotice notice={dashboard?.scenario.notice} />
    </main>
  </div>;
}
