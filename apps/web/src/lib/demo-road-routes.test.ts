import { describe, expect, it } from 'vitest';
import { getDemoRoadRoute } from './demo-road-routes';

describe('stored demonstration road routes', () => {
  it('keeps attributed Hangzhou to Nanjing road geometry in the demo data', () => {
    const route = getDemoRoadRoute('JXSEED0004');
    expect(route?.source).toBe('OSRM / OpenStreetMap');
    expect(route?.points.length).toBeGreaterThan(30);
    expect(route?.distanceKm).toBe(272.1);
    expect(route?.currentPointIndex).toBeLessThan(route?.points.length ?? 0);
    expect(route?.licenseUrl).toBe('https://www.openstreetmap.org/copyright');
  });

  it('does not invent road geometry for ordinary shipments', () => {
    expect(getDemoRoadRoute('JX-UNKNOWN')).toBeNull();
  });
});
