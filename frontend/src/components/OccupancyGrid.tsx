import type { RegionRisk, SafetyObservation, SafetyRegion } from '../services/safetyApi';
import './OccupancyGrid.css';

function densityLevel(density: number | null): number {
  if (density === null || density < 3) return 0;
  if (density < 4) return 1;
  if (density < 5) return 2;
  if (density < 6) return 3;
  return 4;
}

export default function OccupancyGrid({ regions, risks, observations, loading }: { regions: SafetyRegion[]; risks: RegionRisk[]; observations: SafetyObservation[]; loading: boolean }) {
  const latestByRegion = new Map<string, SafetyObservation>();
  for (const observation of observations) {
    const prior = latestByRegion.get(observation.region_id);
    if (!prior || Date.parse(observation.observed_at) > Date.parse(prior.observed_at)) latestByRegion.set(observation.region_id, observation);
  }
  return <section className="occ-panel">
    <header className="occ-heading"><div><span className="occ-kicker">ZONE OCCUPANCY</span><h2>分区占用率</h2></div><span className="occ-legend">人数 / 区域容量 · &gt;75% 标记</span></header>
    {loading ? <p className="occ-empty">正在读取分区数据…</p> : regions.length === 0 ? <p className="occ-empty">暂无区域观测数据</p> : <div className="occ-grid">
      {regions.map(region => {
        const observation = latestByRegion.get(region.id);
        const risk = risks.find(item => item.regionId === region.id);
        const count = observation?.estimated_count ?? risk?.count ?? null;
        const ratio = count === null || region.holding_capacity_persons <= 0 ? null : Math.min(100, count / region.holding_capacity_persons * 100);
        const level = densityLevel(risk?.density ?? observation?.estimated_density ?? null);
        return <article className="occ-cell" key={region.id} data-level={level} data-over={ratio !== null && ratio > 75}>
          <div className="occ-cell-head"><strong>{region.name}</strong><span>{ratio === null ? '暂无数据' : `${Math.round(ratio)}%`}</span></div>
          <div className="occ-meter" aria-label={ratio === null ? '占用率未知' : `占用率 ${Math.round(ratio)}%`}><i style={{ width: `${ratio ?? 0}%` }} /></div>
          <small>{count === null ? '人数未知' : `${count} / ${region.holding_capacity_persons} 人`}</small>
        </article>;
      })}
    </div>}
    <p className="occ-footnote">密度色阶依赖后端观测；估算容量不代表现场标定。</p>
  </section>;
}
