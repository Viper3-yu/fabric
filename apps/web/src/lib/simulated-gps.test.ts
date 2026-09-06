import { describe, it, expect } from 'vitest';
import type { Shipment } from '@jixin/shared';
import { buildSimulatedGps, simulatedGpsCsv } from './simulated-gps';

describe('simulated GPS', () => {
  it('produces deterministic marked coordinates without modifying business events', () => {
    const shipment = { trackingNumber: 'JXSEED0004', events: [] } as unknown as Shipment;
    const points = buildSimulatedGps(shipment);
    expect(points).toHaveLength(81);
    expect(points).toEqual(buildSimulatedGps(shipment));
    expect(points[0]?.latitude).toBe(30.2741);
    expect(points.at(-1)?.longitude).toBe(118.7969);
    expect(points.every((p) => p.source === 'simulation' && Number.isFinite(p.latitude))).toBe(
      true,
    );
    expect(shipment.events).toEqual([]);
    expect(simulatedGpsCsv(points)).toContain(
      'simulation,WGS84-approximate,0,30.274100,120.155100',
    );
  });
});
