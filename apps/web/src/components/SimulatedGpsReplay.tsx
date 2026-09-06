import { useEffect, useMemo, useState } from 'react';
import type { Shipment } from '@jixin/shared';
import { buildSimulatedGps, simulatedGpsCsv } from '../lib/simulated-gps';

export function SimulatedGpsReplay({ shipment }: { shipment: Shipment }) {
  const points = useMemo(() => buildSimulatedGps(shipment), [shipment]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    setIndex(0);
    setPlaying(false);
  }, [points]);
  useEffect(() => {
    if (!playing || points.length < 2) return;
    const timer = window.setInterval(
      () => setIndex((current) => Math.min(current + 1, points.length - 1)),
      250,
    );
    return () => window.clearInterval(timer);
  }, [playing, points.length]);
  useEffect(() => {
    if (index >= points.length - 1) setPlaying(false);
  }, [index, points.length]);
  if (points.length < 2) return <p>地址缺少可识别的城市坐标，暂不能生成模拟路线。</p>;
  const currentIndex = Math.min(index, points.length - 1);
  const current = points[currentIndex]!;
  const minLat = Math.min(...points.map((p) => p.latitude));
  const maxLat = Math.max(...points.map((p) => p.latitude));
  const minLng = Math.min(...points.map((p) => p.longitude));
  const maxLng = Math.max(...points.map((p) => p.longitude));
  const scale = Math.min(
    660 / Math.max(maxLng - minLng, 0.1),
    210 / Math.max(maxLat - minLat, 0.1),
  );
  const xy = (p: typeof current) => [
    400 + (p.longitude - (minLng + maxLng) / 2) * scale,
    145 - (p.latitude - (minLat + maxLat) / 2) * scale,
  ];
  const route = points.map((p) => xy(p).join(',')).join(' ');
  const progress = points
    .slice(0, currentIndex + 1)
    .map((p) => xy(p).join(','))
    .join(' ');
  const [x, y] = xy(current);
  const start = xy(points[0]!);
  const end = xy(points.at(-1)!);
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([simulatedGpsCsv(points)], { type: 'text/csv;charset=utf-8' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `${shipment.trackingNumber}-simulated-gps.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section className="gps-replay" aria-label="模拟 GPS 路线回放">
      <header>
        <h2>模拟 GPS 回放</h2>
        <span>演示数据 · 未上链</span>
      </header>
      <p>按城市途经点生成的虚拟坐标，连线不代表实际道路。回放与运单当前状态无关。</p>
      <svg
        viewBox="0 0 800 290"
        role="img"
        aria-label={`${shipment.origin.city}至${shipment.destination.city}的模拟路线示意，不是导航地图`}
      >
        <polyline points={route} fill="none" stroke="#c7d6ea" strokeWidth="5" />
        <polyline points={progress} fill="none" stroke="#1764c0" strokeWidth="5" />
        <circle cx={start[0]} cy={start[1]} r="6" fill="#1764c0" />
        <text x={start[0]} y={start[1]! + 25} textAnchor="middle">
          {shipment.origin.city}
        </text>
        <circle cx={end[0]} cy={end[1]} r="6" fill="#6d7c90" />
        <text x={end[0]} y={end[1]! - 16} textAnchor="middle">
          {shipment.destination.city}
        </text>
        <circle cx={x} cy={y} r="10" fill="#1764c0" stroke="white" strokeWidth="3" />
        <text x="18" y="24" fill="#5b687c">
          北 ↑　近似经纬度示意
        </text>
      </svg>
      <div className="gps-controls">
        <button
          type="button"
          onClick={() => {
            if (index === points.length - 1) setIndex(0);
            setPlaying(!playing);
          }}
        >
          {playing ? '暂停' : '播放路线'}
        </button>
        <button
          type="button"
          onClick={() => {
            setPlaying(false);
            setIndex(0);
          }}
        >
          重置
        </button>
        <label>
          回放进度
          <input
            type="range"
            min={0}
            max={points.length - 1}
            value={currentIndex}
            onChange={(e) => {
              setPlaying(false);
              setIndex(Number(e.target.value));
            }}
          />
        </label>
        <button type="button" onClick={download}>
          导出模拟 GPS
        </button>
      </div>
      <p className="gps-reading">
        采样点 {currentIndex + 1} / {points.length}　经度 {current.longitude.toFixed(5)}　纬度{' '}
        {current.latitude.toFixed(5)}　模拟经过 {Math.floor(current.elapsedSeconds / 60)} 分钟
      </p>
      <details>
        <summary>地图接入说明</summary>
        <p>
          本示意可离线回放。高德道路规划需申请 Web 服务 Key，地图展示采用 GCJ-02
          坐标，接入时需转换坐标并区分计划路线与实测定位。
        </p>
        <a
          href="https://developer.amap.com/api/webservice/guide/api/newroute"
          target="_blank"
          rel="noreferrer"
        >
          高德路线规划官方文档
        </a>
      </details>
    </section>
  );
}
