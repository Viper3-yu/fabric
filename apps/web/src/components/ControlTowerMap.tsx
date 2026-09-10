import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ControlTowerData } from '../lib/control-tower-api';
import { addBaseMapLayer } from '../lib/map-tiles';

export function ControlTowerMap({
  data,
  showGps = true,
}: {
  data: ControlTowerData;
  showGps?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const points = useMemo(() => {
    const gps = showGps
      ? data.gps.map((point) => [point.latitude, point.longitude] as [number, number])
      : [];
    return [...gps, ...data.hubs.map((hub) => [hub.latitude, hub.longitude] as [number, number])];
  }, [data, showGps]);

  useEffect(() => {
    if (!container.current || points.length < 2) return;
    setError('');
    let disposed = false;
    let cleanup: () => void = () => undefined;
    void import('leaflet')
      .then((module) => {
        if (disposed || !container.current) return;
        const L = module.default;
        const map = L.map(container.current, { scrollWheelZoom: false, zoomControl: false });
        cleanup = () => map.remove();
        L.control.zoom({ position: 'bottomright' }).addTo(map);
        const removeTiles = addBaseMapLayer(L, map, () => setError('底图加载失败，仅显示路线示意'));
        const disposeMap = () => {
          removeTiles();
          map.remove();
        };
        cleanup = disposeMap;
        data.segments.forEach((segment) => {
          const coordinates = (
            segment.polyline?.length
              ? segment.polyline
              : [
                  {
                    latitude: segment.fromHub.latitude,
                    longitude: segment.fromHub.longitude,
                    at: '',
                  },
                  { latitude: segment.toHub.latitude, longitude: segment.toHub.longitude, at: '' },
                ]
          ).map((point) => [point.latitude, point.longitude] as [number, number]);
          const abnormal =
            ['DELAYED', 'EXCEPTION'].includes(segment.status) ||
            data.risks.some((risk) => risk.segmentId === segment.id && risk.level === 'HIGH');
          L.polyline(coordinates, {
            color: abnormal ? '#da1e28' : '#198038',
            weight: 5,
            opacity: 0.88,
          }).addTo(map);
        });
        data.hubs.forEach((hub) => {
          const label = document.createElement('div');
          const title = document.createElement('strong');
          const detail = document.createElement('span');
          title.textContent = hub.name;
          detail.textContent = `${hub.city} · ${hub.code}`;
          label.append(title, detail);
          L.circleMarker([hub.latitude, hub.longitude], {
            radius: 7,
            weight: 3,
            color: '#ffffff',
            fillColor: '#0f62fe',
            fillOpacity: 1,
          })
            .addTo(map)
            .bindTooltip(label, { direction: 'top' });
        });
        if (showGps && data.gps.length > 1) {
          L.polyline(
            data.gps.map((point) => [point.latitude, point.longitude] as [number, number]),
            { color: '#0f62fe', weight: 3, dashArray: '6 6' },
          ).addTo(map);
        }
        map.fitBounds(L.latLngBounds(points), { padding: [34, 34], maxZoom: 8 });
        requestAnimationFrame(() => map.invalidateSize());
      })
      .catch(() => setError('地图组件加载失败'));
    return () => {
      disposed = true;
      cleanup();
    };
  }, [data, points, showGps]);

  return (
    <section className="tower-map-card">
      <div ref={container} className="tower-map" aria-label="GIS 运输路线与责任段" />
      {points.length < 2 ? <p className="tower-map-error">暂无足够坐标，无法绘制运输路线</p> : null}
      {error ? <p className="tower-map-error">{error}</p> : null}
      <div className="tower-map-legend">
        <span>
          <i className="normal" />
          正常责任段
        </span>
        <span>
          <i className="risk" />
          异常责任段
        </span>
        {showGps ? <span>蓝色虚线：GPS 轨迹</span> : null}
      </div>
    </section>
  );
}
