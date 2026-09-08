import type { MapCoordinate } from './route-geography';

export interface DemoRoadRoute {
  trackingNumber: string;
  source: 'OSRM / OpenStreetMap';
  sourceUrl: string;
  licenseUrl: string;
  generatedAt: string;
  distanceKm: number;
  estimatedMinutes: number;
  currentPointIndex: number;
  points: MapCoordinate[];
}

// A real road geometry sampled from the OSRM route service and stored locally for
// a reliable classroom demonstration. It is not live vehicle telemetry.
const HANGZHOU_NANJING: DemoRoadRoute = {
  trackingNumber: 'JXSEED0004',
  source: 'OSRM / OpenStreetMap',
  sourceUrl:
    'https://router.project-osrm.org/route/v1/driving/120.1551,30.2741;118.7969,32.0603?overview=full&geometries=geojson',
  licenseUrl: 'https://www.openstreetmap.org/copyright',
  generatedAt: '2026-09-06T04:50:00Z',
  distanceKm: 272.1,
  estimatedMinutes: 186,
  currentPointIndex: 16,
  points: [
    [30.274271, 120.155098],
    [30.28601, 120.163434],
    [30.340875, 120.139069],
    [30.383743, 120.115303],
    [30.449327, 120.091705],
    [30.49225, 120.024414],
    [30.557839, 120.026995],
    [30.61625, 120.054698],
    [30.67548, 120.048191],
    [30.76051, 120.073676],
    [30.840911, 120.055526],
    [30.925106, 119.995661],
    [31.006158, 119.950342],
    [31.099796, 119.944265],
    [31.205193, 119.902913],
    [31.284913, 119.865068],
    [31.32329, 119.786724],
    [31.35918, 119.688188],
    [31.375224, 119.574699],
    [31.385834, 119.471111],
    [31.422278, 119.417017],
    [31.495418, 119.348941],
    [31.540245, 119.267124],
    [31.59853, 119.176683],
    [31.646567, 119.097742],
    [31.70707, 119.041215],
    [31.796813, 119.00672],
    [31.861592, 118.959559],
    [31.930498, 118.904136],
    [31.99378, 118.845737],
    [32.008605, 118.811867],
    [32.014226, 118.792333],
    [32.059515, 118.797274],
  ],
};

const ROUTES = new Map([[HANGZHOU_NANJING.trackingNumber, HANGZHOU_NANJING]]);

export function getDemoRoadRoute(trackingNumber: string): DemoRoadRoute | null {
  return ROUTES.get(trackingNumber) ?? null;
}
