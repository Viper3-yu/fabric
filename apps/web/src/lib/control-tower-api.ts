export interface TowerHub {
  code: string;
  name: string;
  city: string;
  longitude: number;
  latitude: number;
  type: string;
}
import { readIntegrationSettings } from './integration-settings';
export interface TowerPoint {
  longitude: number;
  latitude: number;
  at: string;
  speed?: number;
}

export interface TowerSegment {
  id: string;
  sequence: number;
  fromHub: TowerHub;
  toHub: TowerHub;
  carrierOrg: string;
  status: string;
  plannedDeparture: string;
  plannedArrival: string;
  actualDeparture?: string;
  actualArrival?: string;
  polyline: TowerPoint[] | null;
}

export interface TowerEvent {
  id: string;
  type: string;
  hubCode: string;
  hubName: string;
  actorOrg: string;
  actorName: string;
  remark: string;
  severity?: string;
  evidenceHash?: string;
  at: string;
  txId: string;
}

export interface TowerRisk {
  id: string;
  type: string;
  level: string;
  title: string;
  description: string;
  segmentId?: string;
  hubCode?: string;
  relatedEventId?: string;
  status: string;
}

export interface TowerParcel {
  id: string;
  status: string;
  unitId?: string;
}

export interface TemperatureReading {
  at: string;
  value: number;
  humidity: number;
}

export interface ControlTowerData {
  dataSource?: 'demo' | 'mysql';
  shipment: {
    id: string;
    origin: string;
    destination: string;
    status: string;
    ownerOrg: string;
    carrierOrg: string;
    parcels: TowerParcel[];
    events: TowerEvent[];
  };
  hubs: TowerHub[];
  segments: TowerSegment[];
  gps: TowerPoint[];
  risks: TowerRisk[];
  temperature: TemperatureReading[];
  temperatureRange: { min: number; max: number };
}

const ORG2_BASE = import.meta.env.VITE_CONTROL_TOWER_ORG2_API_BASE_URL ?? '/lianyun-org2-api';

export interface HandoverReceipt {
  handoverId: string;
  shipmentId: string;
  fromHub: string;
  toHub: string;
  carrierOrg: string;
  status: 'PENDING' | 'CONFIRMED';
  initiatorOrg: string;
  confirmOrg?: string;
  createdAt: string;
  confirmedAt?: string;
}

async function towerRequest<T>(
  path: string,
  init?: RequestInit,
  base = readIntegrationSettings().telemetryEndpoint,
): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...init?.headers },
  });
  const payload = (await response.json().catch(() => null)) as
    { ok: true; data: T } | { ok: false; message?: string } | null;
  if (!response.ok || !payload || payload.ok !== true) {
    throw new Error(
      payload && 'message' in payload && payload.message ? payload.message : '控制塔服务不可用',
    );
  }
  return payload.data;
}

export const controlTowerApi = {
  get: (shipmentId: string, signal?: AbortSignal) =>
    towerRequest<ControlTowerData>(
      `/shipments/${encodeURIComponent(shipmentId)}/control-tower`,
      signal ? { signal } : undefined,
    ),
  appendEvent: (
    shipmentId: string,
    event: Pick<TowerEvent, 'type' | 'hubCode' | 'actorName' | 'remark'>,
  ) =>
    towerRequest<TowerEvent>(`/shipments/${encodeURIComponent(shipmentId)}/events`, {
      method: 'POST',
      body: JSON.stringify(event),
    }),
  initiateHandover: (
    shipmentId: string,
    input: { handoverId: string; fromHub: string; toHub: string; carrierOrg: string },
  ) =>
    towerRequest<HandoverReceipt>(`/shipments/${encodeURIComponent(shipmentId)}/handovers`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  confirmHandover: (handoverId: string) =>
    towerRequest<HandoverReceipt>(
      `/handovers/${encodeURIComponent(handoverId)}/confirm`,
      { method: 'POST' },
      ORG2_BASE,
    ),
};
