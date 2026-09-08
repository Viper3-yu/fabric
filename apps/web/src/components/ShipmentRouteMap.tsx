import 'leaflet/dist/leaflet.css';
import { Information, Map as MapIcon } from '@carbon/icons-react';
import type { Shipment } from '@jixin/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getDemoRoadRoute } from '../lib/demo-road-routes';
import { formatDateTime } from '../lib/presentation';
import { buildShipmentRoute, routeLineDistanceKm } from '../lib/route-geography';

export function ShipmentRouteMap({ shipment }: { shipment: Shipment }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const businessPoints = useMemo(() => buildShipmentRoute(shipment), [shipment]);
  const roadRoute = useMemo(
    () => getDemoRoadRoute(shipment.trackingNumber),
    [shipment.trackingNumber],
  );
  const mapCoordinates = useMemo(
    () => roadRoute?.points ?? businessPoints.map((point) => point.coordinate),
    [businessPoints, roadRoute],
  );
  const lineDistance = useMemo(
    () => Math.round(routeLineDistanceKm(businessPoints)),
    [businessPoints],
  );
  const [mapError, setMapError] = useState('');

  useEffect(() => {
    if (!containerRef.current || mapCoordinates.length < 2) return;
    setMapError('');
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
        cleanup = () => map.remove();
        L.control.zoom({ position: 'bottomright' }).addTo(map);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors',
          maxZoom: 18,
        }).addTo(map);

        if (roadRoute) {
          L.polyline(roadRoute.points, {
            color: '#aab8ca',
            dashArray: '8 7',
            lineCap: 'round',
            opacity: 0.95,
            weight: 5,
          }).addTo(map);
          L.polyline(roadRoute.points.slice(0, roadRoute.currentPointIndex + 1), {
            color: '#1764c0',
            lineCap: 'round',
            opacity: 1,
            weight: 6,
          }).addTo(map);

          const markers = [
            {
              coordinate: roadRoute.points[0]!,
              kind: 'origin',
              title: shipment.origin.city,
              detail: '发货地',
            },
            {
              coordinate: roadRoute.points[roadRoute.currentPointIndex]!,
              kind: 'current',
              title: shipment.lastLocation,
              detail: `最近一次演示定位 · ${formatDateTime(shipment.updatedAt)}`,
            },
            {
              coordinate: roadRoute.points.at(-1)!,
              kind: 'destination',
              title: shipment.destination.city,
              detail: '目的地',
            },
          ] as const;
          markers.forEach((item, index) => {
            const marker = L.marker(item.coordinate, {
              icon: L.divIcon({
                className: 'shipment-map-marker-wrap',
                html: `<span class="shipment-map-marker is-${item.kind}${item.kind === 'current' ? ' is-live-demo' : ''}">${index + 1}</span>`,
                iconAnchor: [14, 14],
                iconSize: [28, 28],
              }),
            }).addTo(map);
            const tooltip = document.createElement('div');
            const title = document.createElement('strong');
            const detail = document.createElement('span');
            title.textContent = item.title;
            detail.textContent = item.detail;
            tooltip.append(title, detail);
            marker.bindTooltip(tooltip, {
              className: 'shipment-map-tooltip',
              direction: 'top',
              offset: [0, -9],
            });
          });
        } else {
          L.polyline(mapCoordinates, {
            color: '#1764c0',
            dashArray: '8 7',
            lineCap: 'round',
            opacity: 0.95,
            weight: 4,
          }).addTo(map);
          businessPoints.forEach((point, index) => {
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
        }

        map.fitBounds(L.latLngBounds(mapCoordinates), { maxZoom: 9, padding: [48, 48] });
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
  }, [businessPoints, mapCoordinates, roadRoute, shipment]);

  if (mapCoordinates.length < 2) {
    return (
      <section className="shipment-route-map is-unavailable" aria-label="运单定位轨迹">
        <MapIcon size={28} aria-hidden="true" />
        <div>
          <strong>暂时无法定位这条路线</strong>
          <span>当前地址没有匹配到城市坐标，运单记录仍可在下方时间线查看。</span>
        </div>
      </section>
    );
  }

  return (
    <section className="shipment-route-map" aria-label="运单定位轨迹">
      <header className="shipment-route-map__header">
        <div>
          <span>{roadRoute ? '定位轨迹 · 演示数据' : '业务节点地图'}</span>
          <strong>
            {shipment.origin.city} → {shipment.destination.city}
          </strong>
        </div>
        <dl>
          <div>
            <dt>{roadRoute ? '已上报定位点' : '已定位节点'}</dt>
            <dd>{roadRoute ? roadRoute.currentPointIndex + 1 : businessPoints.length}</dd>
          </div>
          <div>
            <dt>{roadRoute ? '参考道路里程' : '节点间直线距离'}</dt>
            <dd>约 {roadRoute?.distanceKm ?? lineDistance} km</dd>
          </div>
          <div>
            <dt>最近上报</dt>
            <dd>{formatDateTime(shipment.updatedAt)}</dd>
          </div>
        </dl>
      </header>
      <div className="shipment-route-map__canvas-wrap">
        <div ref={containerRef} className="shipment-route-map__canvas" />
        {mapError ? <p className="shipment-route-map__error">{mapError}</p> : null}
        <div className="shipment-route-map__legend" aria-label="地图图例">
          <span>
            <i className="is-recorded" /> {roadRoute ? '已上报轨迹' : '已记录节点'}
          </span>
          <span>
            <i className="is-current" /> 最近位置
          </span>
          <span>
            <i className="is-planned" /> {roadRoute ? '计划路线' : '目的地'}
          </span>
        </div>
      </div>
      <footer>
        <Information size={16} aria-hidden="true" />
        {roadRoute ? (
          <span>
            道路样例由{' '}
            <a href={roadRoute.sourceUrl} target="_blank" rel="noreferrer">
              OSRM
            </a>{' '}
            基于{' '}
            <a href={roadRoute.licenseUrl} target="_blank" rel="noreferrer">
              OpenStreetMap
            </a>{' '}
            生成并固化；蓝线是演示定位上报，不是实际车辆数据。
          </span>
        ) : (
          <span>当前只按运单城市和链上业务节点定位；尚未接入车辆定位设备。</span>
        )}
      </footer>
    </section>
  );
}
