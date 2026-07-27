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

export interface ChaincodeShipmentEvent {
  eventName: 'ShipmentEvent';
  action: ShipmentEventType | 'ADD_CHECKPOINT';
  shipmentId: string;
  trackingNumber: string;
  status: ShipmentStatus;
  txId: string;
  timestamp: string;
  mspId: string;
  events: ShipmentEvent[];
}
