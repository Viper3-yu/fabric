import { describe, expect, it } from 'vitest';
import { isNavItemActive } from './AppShell';

describe('isNavItemActive', () => {
  it('keeps create shipment separate from shipment management', () => {
    expect(isNavItemActive('/app/shipments/new', '/app/shipments/new')).toBe(true);
    expect(isNavItemActive('/app/shipments/new', '/app/shipments')).toBe(false);
  });

  it('keeps shipment management active on detail pages', () => {
    expect(isNavItemActive('/app/shipments', '/app/shipments')).toBe(true);
    expect(isNavItemActive('/app/shipments/shipment-1', '/app/shipments')).toBe(true);
  });

  it('matches the dashboard exactly', () => {
    expect(isNavItemActive('/app', '/app')).toBe(true);
    expect(isNavItemActive('/app/shipments', '/app')).toBe(false);
  });
});
