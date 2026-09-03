import { describe, expect, it, vi } from 'vitest';
import {
  integrationDefaults,
  readIntegrationSettings,
  saveIntegrationSettings,
  validTelemetryEndpoint,
} from './integration-settings';
import { controlTowerApi } from './control-tower-api';

describe('integration settings', () => {
  it('uses safe defaults for malformed persisted settings', () => {
    localStorage.setItem('jixin.integration-settings', '{broken');
    expect(readIntegrationSettings()).toEqual(integrationDefaults);
    localStorage.setItem(
      'jixin.integration-settings',
      '{"gps":"false","map":false,"telemetryEndpoint":"https://external.test"}',
    );
    expect(readIntegrationSettings()).toEqual({ ...integrationDefaults, map: false });
  });
  it('persists display switches and a same-origin proxy path', () => {
    saveIntegrationSettings({
      ...integrationDefaults,
      gps: false,
      telemetryEndpoint: '/tower-api',
    });
    expect(readIntegrationSettings().gps).toBe(false);
    expect(readIntegrationSettings().telemetryEndpoint).toBe('/tower-api');
  });
  it('rejects external or ambiguous endpoint values', () => {
    for (const path of ['//external.test', 'https://external.test', '/a/../b', '/a?query=1', '/']) {
      expect(validTelemetryEndpoint(path)).toBe(false);
      expect(() =>
        saveIntegrationSettings({ ...integrationDefaults, telemetryEndpoint: path }),
      ).toThrow();
    }
  });
  it('uses the saved endpoint for control tower requests', async () => {
    saveIntegrationSettings({ ...integrationDefaults, telemetryEndpoint: '/tower-api' });
    const fetchMock = vi
      .spyOn(window, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ ok: true, data: {} })));
    await controlTowerApi.get('TEST/001');
    expect(fetchMock).toHaveBeenCalledWith(
      '/tower-api/shipments/TEST%2F001/control-tower',
      expect.any(Object),
    );
  });
});
