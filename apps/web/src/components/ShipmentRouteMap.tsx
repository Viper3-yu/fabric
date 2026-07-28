import 'leaflet/dist/leaflet.css';
import { Information, Map as MapIcon } from '@carbon/icons-react';
import type { Shipment } from '@jixin/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatDateTime } from '../lib/presentation';
import { buildShipmentRoute, routeLineDistanceKm } from '../lib/route-geography';

interface ShipmentRouteMapProps {
  shipment: Shipment;
}

export function ShipmentRouteMap({ shipment }: ShipmentRouteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const points = useMemo(() => buildShipmentRoute(shipment), [shipment]);
  const lineDistance = useMemo(() => Math.round(routeLineDistanceKm(points)), [points]);
  const [mapError, setMapError] = useState('');

  useEffect(() => {
    if (!containerRef.current || points.length < 2) return;
    let disposed = false;
    let cleanup: () => void = () => undefined;

    void import('leaflet')
      .then((module) => {
        if (disposed || !containerRef.current) return;
        const L = module.default;
        const map = L.map(containerRef.current, {
          attributionControl: true,
          scrollWheelZoom: false,
          zoomControl: false,
        });
        L.control.zoom({ position: 'bottomright' }).addTo(map);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors',
          maxZoom: 18,
        }).addTo(map);

        const coordinates = points.map((point) => point.coordinate);
        L.polyline(coordinates, {
          color: '#ffffff',
          opacity: 0.88,
          weight: 7,
        }).addTo(map);
        L.polyline(coordinates, {
          color: '#1f6d4a',
          dashArray: '8 7',
          lineCap: 'round',
          opacity: 0.95,
          weight: 4,
        }).addTo(map);

        points.forEach((point, index) => {
          const marker = L.marker(point.coordinate, {
            icon: L.divIcon({
              className: 'shipment-map-marker-wrap',
              html: `<span class="shipment-map-marker is-${point.kind}">${index + 1}</span>`,
              iconAnchor: [14, 14],
              iconSize: [28, 28],
            }),
          }).addTo(map);
          const tooltip = document.createElement('div');
          const title = document.createElement('strong');
          const detail = document.createElement('span');
          title.textContent = point.title;
          detail.textContent = `${point.detail}${point.timestamp ? ` · ${formatDateTime(point.timestamp)}` : ''}`;
          tooltip.append(title, detail);
          marker.bindTooltip(tooltip, {
            className: 'shipment-map-tooltip',
            direction: 'top',
            offset: [0, -9],
          });
        });

        map.fitBounds(L.latLngBounds(coordinates), {
          maxZoom: 9,
          padding: [48, 48],
        });
        requestAnimationFrame(() => map.invalidateSize());
        cleanup = () => map.remove();
      })
      .catch(() => {
        if (!disposed) setMapError('地图组件加载失败，请刷新后重试');
      });

    return () => {
      disposed = true;
      cleanup();
    };
  }, [points]);

  if (points.length < 2) {
    return (
      <section className="shipment-route-map is-unavailable" aria-label="运单路线地图">
        <MapIcon size={28} aria-hidden="true" />
        <div>
          <strong>暂时无法定位这条路线</strong>
          <span>当前地址没有匹配到城市坐标，运单记录仍可在下方时间线查看。</span>
        </div>
      </section>
    );
  }

  return (
    <section className="shipment-route-map" aria-label="运单路线地图">
      <header className="shipment-route-map__header">
        <div>
          <span>路线地图与链上节点</span>
          <strong>
            {shipment.origin.city} → {shipment.destination.city}
          </strong>
        </div>
        <dl>
          <div>
            <dt>已定位节点</dt>
            <dd>{points.length}</dd>
          </div>
          <div>
            <dt>节点间直线距离</dt>
            <dd>约 {lineDistance} km</dd>
          </div>
        </dl>
      </header>
      <div className="shipment-route-map__canvas-wrap">
        <div ref={containerRef} className="shipment-route-map__canvas" />
        {mapError ? <p className="shipment-route-map__error">{mapError}</p> : null}
        <div className="shipment-route-map__legend" aria-label="地图图例">
          <span>
            <i className="is-recorded" /> 已记录节点
          </span>
          <span>
            <i className="is-current" /> 最近位置
          </span>
          <span>
            <i className="is-planned" /> 目的地
          </span>
        </div>
      </div>
      <footer>
        <Information size={16} aria-hidden="true" />
        <span>
          地图按运单城市和链上节点定位；虚线表示节点间直线关系，数字不是道路里程。当前尚未接入车辆 GPS。
        </span>
      </footer>
    </section>
  );
}
