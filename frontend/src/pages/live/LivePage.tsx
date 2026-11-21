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

function DecisionPipeline({ status }: { status: SafetyStatus | null }) {
  const stages = [
    ['观测', status ? `${status.observations.length} 条` : '—'],
    ['风险评估', status?.risk_summary.highest ?? '—'],
    ['容量规划', status?.candidate_plan?.status ?? status?.plan?.status ?? '—'],
    ['独立校验', status?.validation ? status.validation.valid ? '通过' : '未通过' : '—'],
    ['四态决策', status?.state.state ?? '—'],
  ];
  return <section className="live-pipeline">
    <header><div><span>SAFETY DECISION ENGINE</span><h2>安全决策引擎</h2></div><small>GET /api/v1/safety/status</small></header>
    <ol>{stages.map(([label, value], index) => <li key={label}><i>{index + 1}</i><span>{label}</span><strong>{value}</strong></li>)}</ol>
    {!status ? <p>暂无安全状态数据</p> : <p>{status.state.headline}</p>}
  </section>;
}

function ExitOperations({ status, dashboard }: { status: SafetyStatus | null; dashboard: MvpDashboard | null }) {
  const plan = status?.plan ?? status?.candidate_plan ?? null;
  const activeOrders = dashboard?.work_orders.filter(order => !['COMPLETED', 'FAILED', 'REJECTED'].includes(order.status)) ?? [];
  return <section className="live-exit-ops">
    <header><div><span>EXIT OPERATIONS</span><h2>疏散任务状态</h2></div><small>安全方案 + MVP 工单</small></header>
    <div className="live-exit-kpis"><div><span>方案状态</span><strong>{plan?.status ?? '—'}</strong></div><div><span>已分配</span><strong>{plan ? `${plan.evacuated_persons}/${plan.total_persons}` : '—'}</strong></div><div><span>活动工单</span><strong>{dashboard ? activeOrders.length : '—'}</strong></div></div>
    <h3>出口分配</h3>
    {plan?.exit_totals.length ? <ul>{plan.exit_totals.map(item => <li key={item.exit_id}><span>{item.exit_id}</span><strong>{item.persons} 人</strong></li>)}</ul> : <p className="live-empty">暂无出口分配数据</p>}
    <h3>审批中心与工单</h3>
    {activeOrders.length ? <ul>{activeOrders.slice(0, 5).map(order => <li key={order.id}><span>{order.title}</span><strong>{order.status}{order.stale ? ' · stale' : ''}</strong></li>)}</ul> : <p className="live-empty">暂无活动工单</p>}
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
  const liveStatus = dashboard?.safety ?? status;
  const restrictedExits = liveStatus?.exits.filter(exit => !exit.usable || exit.effective_status !== 'open').length ?? 0;
  const latestCount = liveStatus?.observations.reduce((sum, observation) => sum + observation.estimated_count, 0) ?? null;
  const capacity = scenario?.regions.reduce((sum, region) => sum + region.holding_capacity_persons, 0) ?? null;
  return <div className="live-page">
    <TopBar showSegments onSegmentChange={setSegment} />
    <main className="live-content">
      <LiveSummary count={latestCount} capacity={capacity} restricted={status ? restrictedExits : 0} />
      {error ? <p className="live-error" role="alert">当前数据读取失败：{error}；请勿将缓存或空值视为实时状态。</p> : null}
      <div className="live-entry-grid">
        {segment === 'entry' ? <>
          {/* TODO: 等后端 staff.instruction 字段；DutyTable 当前明确显示“未知”。 */}
          <DutyTable exits={liveStatus?.exits ?? []} staff={staff} regions={scenario?.regions ?? liveStatus?.regions ?? []} observations={dashboard?.safety.observations ?? []} loading={!liveStatus || !dashboard} />
          <div className="live-center-stack"><OccupancyGrid regions={scenario?.regions ?? liveStatus?.regions ?? []} risks={dashboard?.safety.risks ?? []} observations={dashboard?.safety.observations ?? []} loading={!dashboard} /><DroneFeed cameras={dashboard?.cameras ?? []} loading={!dashboard} /></div>
          <div className="live-right-stack"><VerdictCard status={liveStatus} cameras={dashboard?.cameras ?? []} segment={segment} loading={!liveStatus || !dashboard} /><DecisionPipeline status={liveStatus} /></div>
        </> : segment === 'active' ? <>
          <OccupancyGrid regions={scenario?.regions ?? liveStatus?.regions ?? []} risks={dashboard?.safety.risks ?? []} observations={dashboard?.safety.observations ?? []} loading={!dashboard} />
          <div className="live-center-stack"><OfflineMonitor /><ThresholdCard risks={liveStatus?.risks ?? []} incidents={liveStatus?.incidents ?? []} /></div>
          <div className="live-right-stack"><VerdictCard status={liveStatus} cameras={dashboard?.cameras ?? []} segment={segment} loading={!liveStatus || !dashboard} /><DecisionPipeline status={liveStatus} /></div>
        </> : <>
          <OccupancyGrid regions={scenario?.regions ?? liveStatus?.regions ?? []} risks={dashboard?.safety.risks ?? []} observations={dashboard?.safety.observations ?? []} loading={!dashboard} />
          {liveStatus ? <section className="live-map-panel"><header><div><span>EVACUATION NETWORK</span><h2>疏散路线图</h2></div><span>{liveStatus.state.state}</span></header><NetworkMap map={scenario?.map} status={liveStatus} selectedRegion={selectedRegion} onSelectRegion={setSelectedRegion} allowRoutes={!error} zoom={mapZoom} setZoom={setMapZoom} center={mapCenter} setCenter={setMapCenter} showBackdrop={false} layers={layers} /><div className="live-map-validation">{liveStatus.validation ? `独立校验：${liveStatus.validation.valid ? '通过' : '未通过'}` : '独立校验结果：暂无记录'} · 路线显示遵循后端安全状态</div></section> : <section className="live-map-panel live-signal-offline">正在读取网络状态…</section>}
          <div className="live-right-stack"><VerdictCard status={liveStatus} cameras={dashboard?.cameras ?? []} segment={segment} loading={!liveStatus || !dashboard} /><ExitOperations status={liveStatus} dashboard={dashboard} /></div>
        </>}
      </div>
      <StaffContract staff={staff} exits={status?.exits ?? []} loading={!status || !dashboard} />
      <LiveDataLegend />
      <LiveNotice notice={dashboard?.scenario.notice} />
    </main>
  </div>;
}
