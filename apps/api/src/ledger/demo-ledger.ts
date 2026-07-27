import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import type {
  AppUser,
  LedgerReceipt,
  Shipment,
  ShipmentEvent,
  ShipmentEventType,
  ShipmentHistoryEntry,
  ShipmentStatus,
  UserRole,
} from '@jixin/shared';
import { AppError } from '../errors.js';
import { USERS_BY_USERNAME } from '../users.js';
import type {
  ActionCommand,
  CheckpointCommand,
  ConfirmCommand,
  CreateShipmentCommand,
  Ledger,
  LedgerHealth,
} from './types.js';

interface DemoLedgerState {
  version: 1;
  shipments: Record<string, Shipment>;
  histories: Record<string, ShipmentHistoryEntry[]>;
}

interface EventDraft {
  type: ShipmentEventType;
  location: string;
  description: string;
  temperature?: number | undefined;
  evidenceHash?: string | undefined;
}

const EMPTY_STATE = (): DemoLedgerState => ({ version: 1, shipments: {}, histories: {} });

function clone<T>(value: T): T {
  return structuredClone(value);
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export class DemoLedger implements Ledger {
  readonly mode = 'demo' as const;
  private state: DemoLedgerState = EMPTY_STATE();
  private readonly ready: Promise<void>;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {
    this.ready = this.load();
  }

  private async load() {
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      const stored = JSON.parse(await readFile(this.filePath, 'utf8')) as Partial<DemoLedgerState>;
      if (stored.version !== 1 || !stored.shipments || !stored.histories) {
        throw new Error('Unsupported or incomplete ledger structure');
      }
      this.state = stored as DemoLedgerState;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        throw new AppError(500, 'DEMO_LEDGER_CORRUPT', 'The demo ledger file cannot be read', {
          path: this.filePath,
        });
      }
      await this.persist();
    }
  }

  private async persist() {
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8');
    await rename(temporary, this.filePath);
  }

  private async readBarrier() {
    await this.ready;
    await this.mutationQueue;
  }

  private withMutation<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(async () => {
      await this.ready;
      const before = clone(this.state);
      try {
        const value = await operation();
        await this.persist();
        return value;
      } catch (error) {
        this.state = before;
        throw error;
      }
    });
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private requireShipment(id: string) {
    const shipment = this.state.shipments[id];
    if (!shipment) throw new AppError(404, 'SHIPMENT_NOT_FOUND', 'Shipment was not found');
    return shipment;
  }

  private assertRole(actor: AppUser, ...roles: UserRole[]) {
    if (!roles.includes(actor.role)) {
      throw new AppError(403, 'LEDGER_FORBIDDEN', 'The ledger identity cannot perform this action');
    }
  }

  private assertState(shipment: Shipment, expected: ShipmentStatus[]) {
    if (!expected.includes(shipment.status)) {
      throw new AppError(
        409,
        'INVALID_STATE',
        `Shipment is ${shipment.status}; expected ${expected.join(' or ')}`,
      );
    }
  }

  private assertAssignedCarrier(shipment: Shipment, actor: AppUser) {
    if (shipment.carrierId !== actor.id) {
      throw new AppError(
        403,
        'NOT_ASSIGNED_CARRIER',
        'Only the assigned carrier can update this shipment',
      );
    }
  }

  private appendEvent(
    shipment: Shipment,
    actor: AppUser,
    txId: string,
    timestamp: string,
    draft: EventDraft,
  ) {
    const event: ShipmentEvent = {
      sequence: shipment.events.length + 1,
      type: draft.type,
      location: draft.location,
      description: draft.description,
      actorId: actor.id,
      actorName: actor.displayName,
      mspId: actor.mspId,
      txId,
      timestamp,
      ...(draft.temperature === undefined ? {} : { temperature: draft.temperature }),
      ...(draft.evidenceHash === undefined ? {} : { evidenceHash: draft.evidenceHash }),
    };
    shipment.events.push(event);
    shipment.lastLocation = event.location;
  }

  private addHistory(shipment: Shipment, txId: string, timestamp: string) {
    const entries = (this.state.histories[shipment.id] ??= []);
    entries.push({ txId, timestamp, isDelete: false, value: clone(shipment) });
  }

  private receipt(shipment: Shipment, txId: string, committedAt: string): LedgerReceipt {
    return {
      transactionId: txId,
      committedAt,
      ledgerMode: this.mode,
      data: clone(shipment),
    };
  }

  private async transition(
    id: string,
    actor: AppUser,
    roles: UserRole[],
    expected: ShipmentStatus[],
    update: (shipment: Shipment, txId: string, timestamp: string) => void,
  ) {
    return this.withMutation(() => {
      this.assertRole(actor, ...roles);
      const shipment = this.requireShipment(id);
      this.assertState(shipment, expected);
      const timestamp = new Date().toISOString();
      const txId = `demo-${randomUUID().replaceAll('-', '')}`;
      update(shipment, txId, timestamp);
      shipment.updatedAt = timestamp;
      this.addHistory(shipment, txId, timestamp);
      return this.receipt(shipment, txId, timestamp);
    });
  }

  async health(): Promise<LedgerHealth> {
    try {
      await this.readBarrier();
      return { mode: 'demo', status: 'ok', network: 'durable-demo-ledger' };
    } catch (error) {
      return {
        mode: 'demo',
        status: 'degraded',
        network: 'durable-demo-ledger',
        details: error instanceof Error ? error.message : 'Demo ledger unavailable',
      };
    }
  }

  async getAllShipments(_actor?: AppUser) {
    await this.readBarrier();
    return Object.values(this.state.shipments)
      .map((shipment) => clone(shipment))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async readShipment(id: string, _actor?: AppUser) {
    await this.readBarrier();
    return clone(this.requireShipment(id));
  }

  async getShipmentHistory(id: string, _actor?: AppUser) {
    await this.readBarrier();
    this.requireShipment(id);
    return clone(this.state.histories[id] ?? []);
  }

  async createShipment(command: CreateShipmentCommand, actor: AppUser) {
    return this.withMutation(() => {
      this.assertRole(actor, 'shipper');
      if (this.state.shipments[command.id]) {
        throw new AppError(409, 'SHIPMENT_EXISTS', 'Shipment ID already exists');
      }
      if (
        Object.values(this.state.shipments).some(
          (item) => item.trackingNumber === command.trackingNumber,
        )
      ) {
        throw new AppError(409, 'TRACKING_NUMBER_EXISTS', 'Tracking number already exists');
      }

      const timestamp = new Date().toISOString();
      const txId = `demo-${randomUUID().replaceAll('-', '')}`;
      const shipment: Shipment = {
        docType: 'shipment',
        id: command.id,
        trackingNumber: command.trackingNumber,
        status: 'CREATED',
        shipperId: actor.id,
        shipperName: actor.displayName,
        origin: clone(command.origin),
        destination: clone(command.destination),
        goods: clone(command.goods),
        recipientMasked: command.recipientMasked,
        expectedDeliveryDate: command.expectedDeliveryDate,
        ...(command.temperatureRange === undefined
          ? {}
          : { temperatureRange: clone(command.temperatureRange) }),
        deliveryCodeHash: command.deliveryCodeHash,
        ...(command.documentHash === undefined ? {} : { documentHash: command.documentHash }),
        events: [],
        anomalyCount: 0,
        lastLocation: `${command.origin.city} · ${command.origin.detail}`,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      this.appendEvent(shipment, actor, txId, timestamp, {
        type: 'CREATED',
        location: shipment.lastLocation,
        description: '发货方创建运单',
        ...(command.documentHash === undefined ? {} : { evidenceHash: command.documentHash }),
      });
      this.state.shipments[shipment.id] = shipment;
      this.addHistory(shipment, txId, timestamp);
      return this.receipt(shipment, txId, timestamp);
    });
  }

  async acceptShipment(id: string, command: ActionCommand, actor: AppUser) {
    return this.transition(id, actor, ['carrier'], ['CREATED'], (shipment, txId, timestamp) => {
      shipment.carrierId = actor.id;
      shipment.carrierName = actor.displayName;
      shipment.status = 'ACCEPTED';
      this.appendEvent(shipment, actor, txId, timestamp, {
        type: 'ACCEPTED',
        location: command.location ?? shipment.lastLocation,
        description: command.description ?? '承运方已接单',
      });
    });
  }

  async pickupShipment(id: string, command: ActionCommand, actor: AppUser) {
    return this.transition(id, actor, ['carrier'], ['ACCEPTED'], (shipment, txId, timestamp) => {
      this.assertAssignedCarrier(shipment, actor);
      if (!command.location)
        throw new AppError(400, 'LOCATION_REQUIRED', 'Pickup location is required');
      shipment.status = 'PICKED_UP';
      this.appendEvent(shipment, actor, txId, timestamp, {
        type: 'PICKED_UP',
        location: command.location,
        description: command.description ?? '承运方完成揽收',
        ...(command.evidenceHash === undefined ? {} : { evidenceHash: command.evidenceHash }),
      });
    });
  }

  async addCheckpoint(id: string, command: CheckpointCommand, actor: AppUser) {
    return this.transition(
      id,
      actor,
      ['carrier'],
      ['PICKED_UP', 'IN_TRANSIT'],
      (shipment, txId, timestamp) => {
        this.assertAssignedCarrier(shipment, actor);
        shipment.status = 'IN_TRANSIT';
        this.appendEvent(shipment, actor, txId, timestamp, {
          type: 'CHECKPOINT',
          location: command.location,
          description: command.description,
          ...(command.temperature === undefined ? {} : { temperature: command.temperature }),
          ...(command.evidenceHash === undefined ? {} : { evidenceHash: command.evidenceHash }),
        });

        const range = shipment.temperatureRange;
        const outsideRange =
          range !== undefined &&
          command.temperature !== undefined &&
          (command.temperature < range.min || command.temperature > range.max);
        if (outsideRange) {
          shipment.status = 'EXCEPTION';
          shipment.anomalyCount += 1;
          this.appendEvent(shipment, actor, txId, timestamp, {
            type: 'EXCEPTION_REPORTED',
            location: command.location,
            description: `温度 ${command.temperature}°C 超出 ${range.min}~${range.max}°C 设定范围`,
            temperature: command.temperature,
            ...(command.evidenceHash === undefined ? {} : { evidenceHash: command.evidenceHash }),
          });
        }
      },
    );
  }

  async reportException(id: string, command: ActionCommand, actor: AppUser) {
    return this.transition(id, actor, ['carrier'], ['IN_TRANSIT'], (shipment, txId, timestamp) => {
      this.assertAssignedCarrier(shipment, actor);
      if (!command.location || !command.description) {
        throw new AppError(
          400,
          'EXCEPTION_DETAILS_REQUIRED',
          'Exception location and description are required',
        );
      }
      shipment.status = 'EXCEPTION';
      shipment.anomalyCount += 1;
      this.appendEvent(shipment, actor, txId, timestamp, {
        type: 'EXCEPTION_REPORTED',
        location: command.location,
        description: command.description,
        ...(command.evidenceHash === undefined ? {} : { evidenceHash: command.evidenceHash }),
      });
    });
  }

  async resolveException(id: string, command: ActionCommand, actor: AppUser) {
    return this.transition(id, actor, ['carrier'], ['EXCEPTION'], (shipment, txId, timestamp) => {
      this.assertAssignedCarrier(shipment, actor);
      if (!command.location || !command.description) {
        throw new AppError(
          400,
          'RESOLUTION_DETAILS_REQUIRED',
          'Resolution location and description are required',
        );
      }
      shipment.status = 'IN_TRANSIT';
      this.appendEvent(shipment, actor, txId, timestamp, {
        type: 'EXCEPTION_RESOLVED',
        location: command.location,
        description: command.description,
        ...(command.evidenceHash === undefined ? {} : { evidenceHash: command.evidenceHash }),
      });
    });
  }

  async markDelivered(id: string, command: ActionCommand, actor: AppUser) {
    return this.transition(id, actor, ['carrier'], ['IN_TRANSIT'], (shipment, txId, timestamp) => {
      this.assertAssignedCarrier(shipment, actor);
      if (!command.location || !command.evidenceHash) {
        throw new AppError(
          400,
          'DELIVERY_EVIDENCE_REQUIRED',
          'Delivery location and evidence hash are required',
        );
      }
      shipment.status = 'DELIVERED';
      this.appendEvent(shipment, actor, txId, timestamp, {
        type: 'DELIVERED',
        location: command.location,
        description: command.description ?? '货物已送达，等待收货方确认',
        evidenceHash: command.evidenceHash,
      });
    });
  }

  async confirmReceipt(id: string, command: ConfirmCommand, actor: AppUser) {
    return this.transition(id, actor, ['receiver'], ['DELIVERED'], (shipment, txId, timestamp) => {
      if (hash(command.deliveryCode) !== shipment.deliveryCodeHash) {
        throw new AppError(400, 'INVALID_DELIVERY_CODE', 'Delivery code is incorrect');
      }
      shipment.status = 'RECEIVED';
      this.appendEvent(shipment, actor, txId, timestamp, {
        type: 'RECEIVED',
        location: command.location ?? shipment.lastLocation,
        description: command.description ?? '收货方已确认收货',
      });
    });
  }

  async cancelShipment(id: string, command: ActionCommand, actor: AppUser) {
    return this.transition(id, actor, ['shipper'], ['CREATED'], (shipment, txId, timestamp) => {
      if (shipment.shipperId !== actor.id) {
        throw new AppError(
          403,
          'NOT_SHIPMENT_OWNER',
          'Only the creating shipper can cancel this shipment',
        );
      }
      shipment.status = 'CANCELLED';
      this.appendEvent(shipment, actor, txId, timestamp, {
        type: 'CANCELLED',
        location: command.location ?? shipment.lastLocation,
        description: command.description ?? '发货方取消运单',
      });
    });
  }

  async reset() {
    await this.withMutation(() => {
      this.state = EMPTY_STATE();
    });
  }
}

export async function seedDemoLedger(ledger: DemoLedger, force = false) {
  if (force) await ledger.reset();
  const existing = await ledger.getAllShipments();
  if (existing.length > 0) return { seeded: false, count: existing.length };

  const shipper = USERS_BY_USERNAME.get('shipper')!.user;
  const carrier = USERS_BY_USERNAME.get('carrier')!.user;
  const common = {
    origin: {
      province: '上海市',
      city: '上海市',
      district: '浦东新区',
      detail: '张江物流园 1 号库',
      contactName: '李发货',
      contactPhoneMasked: '138****0001',
    },
    destination: {
      province: '江苏省',
      city: '南京市',
      district: '玄武区',
      detail: '珠江路 88 号',
      contactName: '演示收货人',
      contactPhoneMasked: '139****0002',
    },
    recipientMasked: '演示收货人 · 139****0002',
    expectedDeliveryDate: '2026-07-23',
    temperatureRange: { min: 2, max: 8, unit: 'C' as const },
    documentHash: hash('jixin-demo-document'),
  };

  const first = await ledger.createShipment(
    {
      ...common,
      id: 'shipment-demo-transit',
      trackingNumber: 'JX202607200001',
      goods: { name: '生鲜样品', category: '冷链', quantity: 4, weightKg: 16 },
      deliveryCodeHash: hash('246810'),
    },
    shipper,
  );
  await ledger.acceptShipment(first.data.id, {}, carrier);
  await ledger.pickupShipment(first.data.id, { location: '上海张江物流园' }, carrier);
  await ledger.addCheckpoint(
    first.data.id,
    { location: '昆山中转中心', description: '完成干线中转', temperature: 5.2 },
    carrier,
  );

  const second = await ledger.createShipment(
    {
      ...common,
      id: 'shipment-demo-exception',
      trackingNumber: 'JX202607200002',
      goods: { name: '医药试剂', category: '医药', quantity: 2, weightKg: 3.5 },
      deliveryCodeHash: hash('135790'),
    },
    shipper,
  );
  await ledger.acceptShipment(second.data.id, {}, carrier);
  await ledger.pickupShipment(second.data.id, { location: '上海张江物流园' }, carrier);
  await ledger.addCheckpoint(
    second.data.id,
    { location: '苏州温控仓', description: '温度传感器自动上报', temperature: 10.4 },
    carrier,
  );

  return { seeded: true, count: 2 };
}
