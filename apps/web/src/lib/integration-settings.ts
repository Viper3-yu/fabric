export interface IntegrationSettings {
  gps: boolean;
  temperature: boolean;
  map: boolean;
  evidenceAnchor: boolean;
  telemetryEndpoint: string;
}

export const integrationDefaults: IntegrationSettings = {
  gps: true,
  temperature: true,
  map: true,
  evidenceAnchor: true,
  telemetryEndpoint: '/lianyun-api',
};
const key = 'jixin.integration-settings';

// Keep browser requests on the configured same-origin reverse proxy.
export function validTelemetryEndpoint(value: string): boolean {
  return /^\/(?!\/)[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(value);
}

export function readIntegrationSettings(): IntegrationSettings {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (!value || typeof value !== 'object') return { ...integrationDefaults };
    const stored = value as Record<string, unknown>;
    return {
      ...integrationDefaults,
      ...Object.fromEntries(
        ['gps', 'temperature', 'map', 'evidenceAnchor']
          .filter((name) => typeof stored[name] === 'boolean')
          .map((name) => [name, stored[name]]),
      ),
      telemetryEndpoint:
        typeof stored.telemetryEndpoint === 'string' &&
        validTelemetryEndpoint(stored.telemetryEndpoint)
          ? stored.telemetryEndpoint
          : integrationDefaults.telemetryEndpoint,
    };
  } catch {
    return { ...integrationDefaults };
  }
}

export function saveIntegrationSettings(settings: IntegrationSettings): void {
  if (!validTelemetryEndpoint(settings.telemetryEndpoint))
    throw new Error('请输入同源代理路径，例如 /lianyun-api');
  localStorage.setItem(key, JSON.stringify(settings));
}
