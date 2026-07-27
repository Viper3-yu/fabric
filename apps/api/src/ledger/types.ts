import type {
  Address,
  AppUser,
  GoodsInfo,
  LedgerReceipt,
  Shipment,
  ShipmentHistoryEntry,
  TemperatureRange,
} from '@jixin/shared';

export interface CreateShipmentCommand {
  id: string;
  trackingNumber: string;
  origin: Address;
  destination: Address;
  goods: GoodsInfo;
  recipientMasked: string;
  expectedDeliveryDate: string;
  temperatureRange?: TemperatureRange | undefined;
  deliveryCodeHash: string;
  documentHash?: string | undefined;
}

export interface ActionCommand {
  location?: string | undefined;
  description?: string | undefined;
  evidenceHash?: string | undefined;
}

export interface CheckpointCommand extends ActionCommand {
  location: string;
  description: string;
  temperature?: number | undefined;
}

export interface ConfirmCommand extends ActionCommand {
  deliveryCode: string;
}

export interface LedgerHealth {
  mode: 'demo' | 'fabric';
  status: 'ok' | 'degraded';
  network: string;
  channel?: string | undefined;
  chaincode?: string | undefined;
  details?: string | undefined;
}

export interface Ledger {
  readonly mode: 'demo' | 'fabric';
  health(): Promise<LedgerHealth>;
  getAllShipments(actor?: AppUser): Promise<Shipment[]>;
  readShipment(id: string, actor?: AppUser): Promise<Shipment>;
  getShipmentHistory(id: string, actor?: AppUser): Promise<ShipmentHistoryEntry[]>;
  createShipment(command: CreateShipmentCommand, actor: AppUser): Promise<LedgerReceipt>;
  acceptShipment(id: string, command: ActionCommand, actor: AppUser): Promise<LedgerReceipt>;
  pickupShipment(id: string, command: ActionCommand, actor: AppUser): Promise<LedgerReceipt>;
  addCheckpoint(id: string, command: CheckpointCommand, actor: AppUser): Promise<LedgerReceipt>;
  reportException(id: string, command: ActionCommand, actor: AppUser): Promise<LedgerReceipt>;
  resolveException(id: string, command: ActionCommand, actor: AppUser): Promise<LedgerReceipt>;
  markDelivered(id: string, command: ActionCommand, actor: AppUser): Promise<LedgerReceipt>;
  confirmReceipt(id: string, command: ConfirmCommand, actor: AppUser): Promise<LedgerReceipt>;
  cancelShipment(id: string, command: ActionCommand, actor: AppUser): Promise<LedgerReceipt>;
}
