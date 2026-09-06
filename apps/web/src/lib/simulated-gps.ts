import type { Shipment } from '@jixin/shared';
import { buildShipmentRoute, type MapCoordinate } from './route-geography';

export interface SimulatedGpsPoint {
  latitude: number;
  longitude: number;
  elapsedSeconds: number;
  source: 'simulation';
}

// Approximate WGS84 waypoints for teaching. Not an AMap route or measured road geometry.
const DEMO_WAYPOINTS: Record<string, MapCoordinate[]> = {
  JXSEED0001: [
    [31.2304, 121.4737],
    [31.2989, 120.5853],
    [32.3942, 119.4129],
    [34.2044, 117.2858],
    [36.6512, 117.1201],
    [38.3045, 116.8388],
    [39.9042, 116.4074],
  ],
  JXSEED0002: [
    [23.1291, 113.2644],
    [24.8104, 113.5975],
    [25.7705, 113.0147],
    [28.2282, 112.9388],
    [29.3571, 113.1292],
    [30.5928, 114.3055],
  ],
  JXSEED0004: [
    [30.2741, 120.1551],
    [30.8943, 120.0868],
    [31.36, 119.82],
    [31.7, 119.25],
    [32.0603, 118.7969],
  ],
  JXSEED0006: [
    [22.5431, 114.0579],
    [23.1291, 113.2644],
    [24.8104, 113.5975],
    [25.7705, 113.0147],
    [26.8932, 112.5719],
    [28.2282, 112.9388],
  ],
};

export function buildSimulatedGps(shipment: Shipment): SimulatedGpsPoint[] {
  const route =
    DEMO_WAYPOINTS[shipment.trackingNumber] ??
    buildShipmentRoute(shipment).map((p) => p.coordinate);
  if (route.length < 2) return [];
  const result: SimulatedGpsPoint[] = [];
  // Deterministic playback clock, explicitly unrelated to on-chain timestamps or vehicle speed.
  route.slice(1).forEach((end, segment) => {
    const start = route[segment]!;
    for (let i = 0; i < 20; i++) {
      const ratio = i / 20;
      result.push({
        latitude: start[0] + (end[0] - start[0]) * ratio,
        longitude: start[1] + (end[1] - start[1]) * ratio,
        elapsedSeconds: result.length * 30,
        source: 'simulation',
      });
    }
  });
  const end = route.at(-1)!;
  result.push({
    latitude: end[0],
    longitude: end[1],
    elapsedSeconds: result.length * 30,
    source: 'simulation',
  });
  return result;
}

export function simulatedGpsCsv(points: SimulatedGpsPoint[]): string {
  return [
    'source,coordinateSystem,elapsedSeconds,latitude,longitude',
    ...points.map(
      (p) =>
        `${p.source},WGS84-approximate,${p.elapsedSeconds},${p.latitude.toFixed(6)},${p.longitude.toFixed(6)}`,
    ),
  ].join('\r\n');
}
