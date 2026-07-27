import type {
  Address,
  AppUser,
  GoodsInfo,
  LedgerReceipt,
  Shipment,
  ShipmentHistoryEntry,
  ShipmentStatus,
  TemperatureRange,
} from '@jixin/shared';

export type LedgerMode = 'fabric' | 'demo';

export interface ApiMeta {
  ledgerMode?: LedgerMode;
  requestId?: string;
}

export interface ApiEnvelope<T> {
  data: T;
  meta?: ApiMeta;
}

export interface LoginResult {
  token: string;
  user: AppUser;
  ledgerMode: LedgerMode;
}

export interface AuthSession {
  token: string;
  user: AppUser;
  ledgerMode: LedgerMode;
}

export interface NetworkInfo {
  mode: LedgerMode;
  isDemo: boolean;
  label: '演示账本' | 'Hyperledger Fabric';
  health: {
    mode: string;
    status: 'ok' | 'degraded';
    network: string;
    channel?: string;
    chaincode?: string;
    details?: string;
  };
}

export interface ShipmentListResult {
  items: Shipment[];
  total: number;
  limit: number;
  offset: number;
}

export interface CreateShipmentInput {
  origin: Omit<Address, 'contactPhoneMasked'> & { contactPhone: string };
  destination: Omit<Address, 'contactPhoneMasked'> & { contactPhone: string };
  goods: GoodsInfo;
  expectedDeliveryDate: string;
  temperatureRange?: TemperatureRange;
  documentHash?: string;
}

export type ShipmentReceipt = LedgerReceipt<Shipment> & {
  deliveryCode?: string;
};

export type ShipmentAction =
  'accept' | 'pickup' | 'checkpoint' | 'exception' | 'resolve' | 'deliver' | 'confirm' | 'cancel';

export type ShipmentActionPayload = Record<string, string | number | undefined>;

export interface ShipmentRouteState {
  receipt?: ShipmentReceipt;
  deliveryCode?: string;
}

export interface ShipmentDetailResult {
  shipment: Shipment;
  history: ShipmentHistoryEntry[];
}

export interface ShipmentFilters {
  search?: string;
  status?: ShipmentStatus;
  limit?: number;
  offset?: number;
}
