export const SHIPMENT_STATUSES = [
  'CREATED',
  'ACCEPTED',
  'PICKED_UP',
  'IN_TRANSIT',
  'EXCEPTION',
  'DELIVERED',
  'RECEIVED',
  'CANCELLED',
] as const;

export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export const USER_ROLES = ['shipper', 'carrier', 'receiver', 'auditor'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const SHIPMENT_EVENT_TYPES = [
  'CREATED',
  'ACCEPTED',
  'PICKED_UP',
  'CHECKPOINT',
  'EXCEPTION_REPORTED',
  'EXCEPTION_RESOLVED',
  'DELIVERED',
  'RECEIVED',
  'CANCELLED',
] as const;

export type ShipmentEventType = (typeof SHIPMENT_EVENT_TYPES)[number];

export interface AppUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  mspId: 'Org1MSP' | 'Org2MSP' | 'ReadOnly';
}

export interface Address {
  province: string;
  city: string;
  district?: string;
  detail: string;
  contactName: string;
  contactPhoneMasked: string;
}

export interface GoodsInfo {
  name: string;
  category: string;
  quantity: number;
  weightKg: number;
  description?: string;
}

export interface TemperatureRange {
  min: number;
  max: number;
  unit: 'C';
}

export interface ShipmentEvent {
  sequence: number;
  type: ShipmentEventType;
  location: string;
  description: string;
  actorId: string;
  actorName: string;
  mspId: string;
  txId: string;
  timestamp: string;
  temperature?: number;
  evidenceHash?: string;
}

export interface Shipment {
  docType: 'shipment';
  id: string;
  trackingNumber: string;
  status: ShipmentStatus;
  shipperId: string;
  shipperName: string;
  carrierId?: string;
  carrierName?: string;
  /** 负责签收的收货账户；旧数据（未绑定前）可能为空。 */
  recipientId?: string;
  origin: Address;
  destination: Address;
  goods: GoodsInfo;
  recipientMasked: string;
  expectedDeliveryDate: string;
  temperatureRange?: TemperatureRange;
  deliveryCodeHash: string;
  documentHash?: string;
  events: ShipmentEvent[];
  anomalyCount: number;
  lastLocation: string;
  createdAt: string;
  updatedAt: string;
}

export interface ShipmentHistoryEntry {
  txId: string;
  timestamp: string;
  isDelete: boolean;
  value: Shipment | null;
}

export interface LedgerReceipt<T = Shipment> {
  transactionId: string;
  committedAt: string;
  ledgerMode: 'fabric';
  data: T;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: {
    ledgerMode?: 'fabric';
    requestId?: string;
  };
}

export interface ApiFailure {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export interface DashboardSummary {
  total: number;
  inTransit: number;
  exceptions: number;
  pendingReceipt: number;
  completed: number;
  recent: Shipment[];
}

export interface IntegrityResult {
  trackingNumber: string;
  verified: boolean;
  ledgerMode: 'fabric';
  status: ShipmentStatus;
  eventCount: number;
  historyContinuous: boolean;
  checkedAt: string;
  warnings: string[];
}

export const STATUS_LABELS: Record<ShipmentStatus, string> = {
  CREATED: '待接单',
  ACCEPTED: '已接单',
  PICKED_UP: '已揽收',
  IN_TRANSIT: '运输中',
  EXCEPTION: '运输异常',
  DELIVERED: '待签收',
  RECEIVED: '已签收',
  CANCELLED: '已取消',
};

export const ROLE_LABELS: Record<UserRole, string> = {
  shipper: '发货方',
  carrier: '承运方',
  receiver: '收货方',
  auditor: '审计访客',
};
