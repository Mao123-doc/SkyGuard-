import type { CameraHealth } from '../services/mvpApi';
import './DroneFeed.css';

export default function DroneFeed({ cameras, loading }: { cameras: CameraHealth[]; loading: boolean }) {
  const online = cameras.filter(camera => camera.state === 'online').length;
  return <section className="drone-panel">
    <header className="drone-heading"><div><span className="drone-kicker">无人机与摄像头</span><h2>无人机回传</h2></div><span className="drone-state">{loading ? '读取中' : '视频信号离线'}</span></header>
    <div className="drone-layout"><div className="drone-screen" role="img" aria-label="当前没有无人机视频流"><span className="drone-rec">视频信号未接入</span><span>未接入无人机视频帧</span><small>不展示合成画面</small></div>
      <div className="drone-meta"><div><span>摄像头在线</span><strong>{loading ? '—' : `${online} / ${cameras.length}`}</strong></div><div><span>无人机状态</span><strong>后端未提供</strong></div><div><span>图像与电量</span><strong>暂无数据</strong></div></div></div>
    <div className="drone-patrol"><strong>无人机轮巡：未接入调度</strong><span>当前无轮巡目标数据 · 3 分钟轮巡周期为规划口径，非当前实现</span></div>
    <p className="drone-footnote">摄像头状态来自后端；当前 API 未提供无人机位置、视频与电量数据。</p>
  </section>;
}
