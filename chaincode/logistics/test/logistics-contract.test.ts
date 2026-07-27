import { createHash } from 'node:crypto';

import type { Context } from 'fabric-contract-api';
import { beforeEach, describe, expect, it } from 'vitest';

import { LogisticsContract } from '../src/logistics-contract';
import type { ChaincodeShipmentEvent, Shipment, ShipmentHistoryEntry } from '../src/types';

interface MockTimestamp {
  seconds: bigint;
  nanos: number;
}

interface MockHistoryValue {
  txId: string;
  timestamp: MockTimestamp;
  isDelete: boolean;
  value: Uint8Array;
}

class MockIterator<T> {
  public closed = false;
  private index = 0;

  public constructor(private readonly values: T[]) {}

  public async next(): Promise<{ value?: T; done: boolean }> {
    if (this.index >= this.values.length) {
      return { done: true };
    }
    const value = this.values[this.index];
    this.index += 1;
    return value === undefined ? { done: true } : { value, done: false };
  }

  public async close(): Promise<void> {
    this.closed = true;
  }
}

class MockStub {
  public readonly state = new Map<string, Uint8Array>();
  public readonly history = new Map<string, MockHistoryValue[]>();
  public readonly events: Array<{ name: string; payload: Uint8Array }> = [];
  public readonly iterators: MockIterator<unknown>[] = [];
  public readonly transient = new Map<string, Uint8Array>();
  private txId = 'tx-000';
  private timestamp: MockTimestamp = { seconds: 0n, nanos: 0 };

  public setTransaction(txId: string, isoTimestamp: string, extraNanos = 0): void {
    const milliseconds = Date.parse(isoTimestamp);
    if (Number.isNaN(milliseconds)) {
      throw new Error(`Invalid test timestamp: ${isoTimestamp}`);
    }
    this.txId = txId;
    this.timestamp = {
      seconds: BigInt(Math.floor(milliseconds / 1_000)),
      nanos: (milliseconds % 1_000) * 1_000_000 + extraNanos,
    };
  }

  public getTxID(): string {
    return this.txId;
  }

  public getTxTimestamp(): MockTimestamp {
    return { ...this.timestamp };
  }

  public getTransient(): Map<string, Uint8Array> {
    return this.transient;
  }

  public async getState(key: string): Promise<Uint8Array> {
    return this.clone(this.state.get(key) ?? new Uint8Array());
  }

  public async putState(key: string, value: Uint8Array): Promise<void> {
    const copy = this.clone(value);
    this.state.set(key, copy);
    const rows = this.history.get(key) ?? [];
    rows.push({
      txId: this.txId,
      timestamp: { ...this.timestamp },
      isDelete: false,
      value: copy,
    });
    this.history.set(key, rows);
  }

  public setEvent(name: string, payload: Uint8Array): void {
    this.events.push({ name, payload: this.clone(payload) });
  }

  public async getStateByRange(
    startKey: string,
    endKey: string,
  ): Promise<MockIterator<{ key: string; value: Uint8Array }>> {
    const values = [...this.state.entries()]
      .filter(([key]) => key >= startKey && key < endKey)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => ({ key, value: this.clone(value) }));
    const iterator = new MockIterator(values);
    this.iterators.push(iterator as MockIterator<unknown>);
    return iterator;
  }

  public async getHistoryForKey(key: string): Promise<MockIterator<MockHistoryValue>> {
    const values = (this.history.get(key) ?? []).map((entry) => ({
      ...entry,
      timestamp: { ...entry.timestamp },
      value: this.clone(entry.value),
    }));
    const iterator = new MockIterator(values);
    this.iterators.push(iterator as MockIterator<unknown>);
    return iterator;
  }

  private clone(value: Uint8Array): Uint8Array {
    return Uint8Array.from(value);
  }
}

interface TestHarness {
  contract: LogisticsContract;
  stub: MockStub;
  ctx: Context;
  setInvoker(mspId: string, txId: string, timestamp: string, extraNanos?: number): void;
}

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

const json = (value: unknown): string => JSON.stringify(value);

const parse = <T>(value: string): T => JSON.parse(value) as T;

const createInput = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'shipment-001',
  trackingNumber: 'JX202607200001',
  shipperId: 'shipper-001',
  shipperName: '华东食品有限公司',
  origin: {
    province: '上海市',
    city: '上海市',
    district: '浦东新区',
    detail: '世纪大道 100 号',
    contactName: '张先生',
    contactPhoneMasked: '138****1000',
  },
  destination: {
    province: '江苏省',
    city: '南京市',
    district: '玄武区',
    detail: '中山路 20 号',
    contactName: '李女士',
    contactPhoneMasked: '139****2000',
  },
  goods: {
    name: '冷藏疫苗',
    category: '医药冷链',
    quantity: 10,
    weightKg: 25.5,
    description: '全程保持冷藏',
  },
  recipientMasked: '李** / 139****2000',
  expectedDeliveryDate: '2026-07-22',
  temperatureRange: { min: 2, max: 8, unit: 'C' },
  deliveryCodeHash: sha256('864209'),
  documentHash: sha256('shipping-document'),
  ...overrides,
});

const carrierActor = {
  actorId: 'carrier-001',
  actorName: '承运员王师傅',
};

const receiverActor = {
  actorId: 'receiver-001',
  actorName: '李女士',
};

const createHarness = (): TestHarness => {
  const stub = new MockStub();
  const identity: { mspId: string } = { mspId: 'Org1MSP' };
  const ctx = {
    stub,
    clientIdentity: {
      getMSPID: () => identity.mspId,
    },
  } as unknown as Context;
  return {
    contract: new LogisticsContract(),
    stub,
    ctx,
    setInvoker(mspId, txId, timestamp, extraNanos = 0) {
      identity.mspId = mspId;
      stub.setTransaction(txId, timestamp, extraNanos);
      stub.transient.clear();
    },
  };
};

describe('LogisticsContract', () => {
  let harness: TestHarness;

  beforeEach(() => {
    harness = createHarness();
  });

  it('creates a shipment with deterministic Fabric metadata and a unified chaincode event', async () => {
    harness.setInvoker('Org1MSP', 'tx-create', '2026-07-20T04:00:00.123Z', 456_789);
    const input = createInput({ deliveryCodeHash: sha256('864209').toUpperCase() });

    const shipment = parse<Shipment>(
      await harness.contract.CreateShipment(harness.ctx, json(input)),
    );

    expect(shipment).toMatchObject({
      id: 'shipment-001',
      trackingNumber: 'JX202607200001',
      status: 'CREATED',
      anomalyCount: 0,
      createdAt: '2026-07-20T04:00:00.123Z',
      updatedAt: '2026-07-20T04:00:00.123Z',
      deliveryCodeHash: sha256('864209'),
    });
    expect(shipment.events).toEqual([
      expect.objectContaining({
        sequence: 1,
        type: 'CREATED',
        actorId: 'shipper-001',
        actorName: '华东食品有限公司',
        mspId: 'Org1MSP',
        txId: 'tx-create',
        timestamp: '2026-07-20T04:00:00.123Z',
      }),
    ]);
    expect(Buffer.from(await harness.stub.getState('TRACKING:JX202607200001')).toString()).toBe(
      'shipment-001',
    );
    expect(harness.stub.events).toHaveLength(1);
    expect(harness.stub.events[0]?.name).toBe('ShipmentEvent');
    const emitted = parse<ChaincodeShipmentEvent>(
      Buffer.from(harness.stub.events[0]?.payload ?? []).toString('utf8'),
    );
    expect(emitted).toMatchObject({
      eventName: 'ShipmentEvent',
      action: 'CREATED',
      shipmentId: 'shipment-001',
      status: 'CREATED',
      txId: 'tx-create',
      mspId: 'Org1MSP',
    });
    expect(emitted.events).toHaveLength(1);
  });

  it('enforces MSP authorization before writing state', async () => {
    harness.setInvoker('Org2MSP', 'tx-denied', '2026-07-20T04:00:00.000Z');
    await expect(harness.contract.CreateShipment(harness.ctx, json(createInput()))).rejects.toThrow(
      'CreateShipment is restricted to Org1MSP; caller belongs to Org2MSP',
    );
    expect(harness.stub.state.size).toBe(0);

    harness.setInvoker('Org1MSP', 'tx-create', '2026-07-20T04:01:00.000Z');
    await harness.contract.CreateShipment(harness.ctx, json(createInput()));
    await expect(
      harness.contract.AcceptShipment(
        harness.ctx,
        'shipment-001',
        json({ carrierId: 'carrier-001', carrierName: '迅达物流' }),
      ),
    ).rejects.toThrow('AcceptShipment is restricted to Org2MSP');
    expect(
      parse<Shipment>(await harness.contract.ReadShipment(harness.ctx, 'shipment-001')).status,
    ).toBe('CREATED');
  });

  it('rejects duplicate shipment ids and duplicate public tracking numbers', async () => {
    harness.setInvoker('Org1MSP', 'tx-create-1', '2026-07-20T04:00:00.000Z');
    await harness.contract.CreateShipment(harness.ctx, json(createInput()));

    harness.setInvoker('Org1MSP', 'tx-create-2', '2026-07-20T04:01:00.000Z');
    await expect(
      harness.contract.CreateShipment(
        harness.ctx,
        json(createInput({ trackingNumber: 'JX-OTHER' })),
      ),
    ).rejects.toThrow('shipment id "shipment-001" already exists');
    await expect(
      harness.contract.CreateShipment(harness.ctx, json(createInput({ id: 'shipment-002' }))),
    ).rejects.toThrow('tracking number "JX202607200001" already exists');
  });

  it('completes the full lifecycle, preserves exception evidence, and blocks replayed receipt', async () => {
    harness.setInvoker('Org1MSP', 'tx-01-create', '2026-07-20T04:00:00.000Z');
    await harness.contract.CreateShipment(harness.ctx, json(createInput()));

    harness.setInvoker('Org2MSP', 'tx-02-accept', '2026-07-20T04:01:00.000Z');
    await harness.contract.AcceptShipment(
      harness.ctx,
      'shipment-001',
      json({ carrierId: 'carrier-001', carrierName: '迅达物流', ...carrierActor }),
    );

    harness.setInvoker('Org2MSP', 'tx-03-pickup', '2026-07-20T04:02:00.000Z');
    await harness.contract.PickupShipment(
      harness.ctx,
      'shipment-001',
      json({ ...carrierActor, location: '上海转运中心', evidenceHash: sha256('pickup-photo') }),
    );

    harness.setInvoker('Org2MSP', 'tx-04-checkpoint', '2026-07-20T04:03:00.000Z');
    let shipment = parse<Shipment>(
      await harness.contract.AddCheckpoint(
        harness.ctx,
        'shipment-001',
        json({
          ...carrierActor,
          location: '苏州服务区',
          description: '车辆正常通行',
          temperature: 5.2,
        }),
      ),
    );
    expect(shipment.status).toBe('IN_TRANSIT');

    harness.setInvoker('Org2MSP', 'tx-05-report', '2026-07-20T04:04:00.000Z');
    shipment = parse<Shipment>(
      await harness.contract.ReportException(
        harness.ctx,
        'shipment-001',
        json({
          ...carrierActor,
          location: '苏州服务区',
          description: '高速临时封闭',
          evidenceHash: sha256('road-closure'),
        }),
      ),
    );
    expect(shipment).toMatchObject({ status: 'EXCEPTION', anomalyCount: 1 });

    harness.setInvoker('Org2MSP', 'tx-06-resolve', '2026-07-20T04:05:00.000Z');
    await harness.contract.ResolveException(
      harness.ctx,
      'shipment-001',
      json({ ...carrierActor, location: '苏州服务区', description: '道路恢复通行' }),
    );

    harness.setInvoker('Org2MSP', 'tx-07-auto-exception', '2026-07-20T04:06:00.000Z');
    shipment = parse<Shipment>(
      await harness.contract.AddCheckpoint(
        harness.ctx,
        'shipment-001',
        json({
          ...carrierActor,
          location: '镇江冷链中转站',
          description: '到站温度采集',
          temperature: 9.1,
          evidenceHash: sha256('sensor-reading'),
        }),
      ),
    );
    expect(shipment).toMatchObject({ status: 'EXCEPTION', anomalyCount: 2 });
    expect(shipment.events.slice(-2)).toEqual([
      expect.objectContaining({ sequence: 7, type: 'CHECKPOINT', temperature: 9.1 }),
      expect.objectContaining({
        sequence: 8,
        type: 'EXCEPTION_REPORTED',
        temperature: 9.1,
        evidenceHash: sha256('sensor-reading'),
      }),
    ]);
    const automaticEvent = parse<ChaincodeShipmentEvent>(
      Buffer.from(harness.stub.events.at(-1)?.payload ?? []).toString('utf8'),
    );
    expect(automaticEvent.action).toBe('ADD_CHECKPOINT');
    expect(automaticEvent.events.map((event) => event.type)).toEqual([
      'CHECKPOINT',
      'EXCEPTION_REPORTED',
    ]);

    harness.setInvoker('Org2MSP', 'tx-08-resolve', '2026-07-20T04:07:00.000Z');
    await harness.contract.ResolveException(
      harness.ctx,
      'shipment-001',
      json({ ...carrierActor, location: '镇江冷链中转站', description: '更换冰盒，温度恢复' }),
    );

    harness.setInvoker('Org2MSP', 'tx-09-deliver', '2026-07-20T04:08:00.000Z');
    shipment = parse<Shipment>(
      await harness.contract.MarkDelivered(
        harness.ctx,
        'shipment-001',
        json({
          ...carrierActor,
          location: '南京收货点',
          evidenceHash: sha256('delivery-proof'),
        }),
      ),
    );
    expect(shipment.status).toBe('DELIVERED');

    harness.setInvoker('Org1MSP', 'tx-10-wrong-code', '2026-07-20T04:09:00.000Z');
    harness.stub.transient.set('deliveryCode', Buffer.from('000000', 'utf8'));
    await expect(
      harness.contract.ConfirmReceipt(
        harness.ctx,
        'shipment-001',
        json({ ...receiverActor, location: '南京收货点' }),
      ),
    ).rejects.toThrow('delivery code is incorrect');
    expect(harness.stub.events).toHaveLength(9);

    harness.setInvoker('Org1MSP', 'tx-11-receive', '2026-07-20T04:10:00.000Z');
    harness.stub.transient.set('deliveryCode', Buffer.from('864209', 'utf8'));
    shipment = parse<Shipment>(
      await harness.contract.ConfirmReceipt(
        harness.ctx,
        'shipment-001',
        json({ ...receiverActor, location: '南京收货点' }),
      ),
    );
    expect(shipment).toMatchObject({
      status: 'RECEIVED',
      anomalyCount: 2,
      updatedAt: '2026-07-20T04:10:00.000Z',
    });
    expect(shipment.events.map((event) => event.sequence)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
    expect(shipment.events.map((event) => event.type)).toEqual([
      'CREATED',
      'ACCEPTED',
      'PICKED_UP',
      'CHECKPOINT',
      'EXCEPTION_REPORTED',
      'EXCEPTION_RESOLVED',
      'CHECKPOINT',
      'EXCEPTION_REPORTED',
      'EXCEPTION_RESOLVED',
      'DELIVERED',
      'RECEIVED',
    ]);
    expect(harness.stub.events).toHaveLength(10);

    harness.setInvoker('Org1MSP', 'tx-12-replay', '2026-07-20T04:11:00.000Z');
    harness.stub.transient.set('deliveryCode', Buffer.from('864209', 'utf8'));
    await expect(
      harness.contract.ConfirmReceipt(harness.ctx, 'shipment-001', json(receiverActor)),
    ).rejects.toThrow('current status is RECEIVED');
    expect(harness.stub.events).toHaveLength(10);
  });

  it('supports the terminal cancellation branch and rejects later carrier actions', async () => {
    harness.setInvoker('Org1MSP', 'tx-create', '2026-07-20T04:00:00.000Z');
    await harness.contract.CreateShipment(harness.ctx, json(createInput()));
    harness.setInvoker('Org1MSP', 'tx-cancel', '2026-07-20T04:01:00.000Z');
    const cancelled = parse<Shipment>(
      await harness.contract.CancelShipment(
        harness.ctx,
        'shipment-001',
        json({ actorId: 'shipper-001', actorName: '华东食品有限公司', description: '客户撤单' }),
      ),
    );
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.events.at(-1)?.type).toBe('CANCELLED');

    harness.setInvoker('Org2MSP', 'tx-accept', '2026-07-20T04:02:00.000Z');
    await expect(
      harness.contract.AcceptShipment(
        harness.ctx,
        'shipment-001',
        json({ carrierId: 'carrier-001', carrierName: '迅达物流' }),
      ),
    ).rejects.toThrow('current status is CANCELLED');
  });

  it('enforces the accepted carrier and original shipper ownership within their MSPs', async () => {
    harness.setInvoker('Org1MSP', 'tx-create', '2026-07-20T04:00:00.000Z');
    await harness.contract.CreateShipment(harness.ctx, json(createInput()));
    await expect(
      harness.contract.CancelShipment(
        harness.ctx,
        'shipment-001',
        json({ actorId: 'another-shipper', actorName: '其他发货方' }),
      ),
    ).rejects.toThrow('is not authorized; shipment "shipment-001" shipper is "shipper-001"');

    harness.setInvoker('Org2MSP', 'tx-accept', '2026-07-20T04:01:00.000Z');
    await harness.contract.AcceptShipment(
      harness.ctx,
      'shipment-001',
      json({ carrierId: 'carrier-001', carrierName: '迅达物流' }),
    );
    harness.setInvoker('Org2MSP', 'tx-intruder', '2026-07-20T04:02:00.000Z');
    await expect(
      harness.contract.PickupShipment(
        harness.ctx,
        'shipment-001',
        json({ actorId: 'carrier-002', actorName: '其他承运员', location: '上海' }),
      ),
    ).rejects.toThrow(
      'is not authorized; shipment "shipment-001" assigned carrier is "carrier-001"',
    );
    expect(
      parse<Shipment>(await harness.contract.ReadShipment(harness.ctx, 'shipment-001')).status,
    ).toBe('ACCEPTED');
  });

  it('requires a delivery code from Fabric transient data so plaintext never enters transaction args', async () => {
    harness.setInvoker('Org1MSP', 'tx-create', '2026-07-20T04:00:00.000Z');
    await harness.contract.CreateShipment(harness.ctx, json(createInput()));
    harness.setInvoker('Org2MSP', 'tx-accept', '2026-07-20T04:01:00.000Z');
    await harness.contract.AcceptShipment(
      harness.ctx,
      'shipment-001',
      json({ carrierId: 'carrier-001', carrierName: '迅达物流' }),
    );
    harness.setInvoker('Org2MSP', 'tx-pickup', '2026-07-20T04:02:00.000Z');
    await harness.contract.PickupShipment(
      harness.ctx,
      'shipment-001',
      json({ ...carrierActor, location: '上海转运中心' }),
    );
    harness.setInvoker('Org2MSP', 'tx-checkpoint', '2026-07-20T04:03:00.000Z');
    await harness.contract.AddCheckpoint(
      harness.ctx,
      'shipment-001',
      json({ ...carrierActor, location: '南京', description: '到达南京' }),
    );
    harness.setInvoker('Org2MSP', 'tx-deliver', '2026-07-20T04:04:00.000Z');
    await harness.contract.MarkDelivered(
      harness.ctx,
      'shipment-001',
      json({ ...carrierActor, location: '南京收货点', evidenceHash: sha256('proof') }),
    );

    harness.setInvoker('Org1MSP', 'tx-receive', '2026-07-20T04:05:00.000Z');
    harness.stub.transient.set('deliveryCode', Buffer.from('864209', 'utf8'));
    const shipment = parse<Shipment>(
      await harness.contract.ConfirmReceipt(harness.ctx, 'shipment-001', json(receiverActor)),
    );
    expect(shipment.status).toBe('RECEIVED');
  });

  it('queries by id or tracking number, lists only shipment documents, and returns closed history', async () => {
    harness.setInvoker('Org1MSP', 'tx-create-b', '2026-07-20T04:00:00.000Z');
    await harness.contract.CreateShipment(
      harness.ctx,
      json(createInput({ id: 'shipment-b', trackingNumber: 'JX-B' })),
    );
    harness.setInvoker('Org1MSP', 'tx-create-a', '2026-07-20T04:01:00.000Z');
    await harness.contract.CreateShipment(
      harness.ctx,
      json(createInput({ id: 'shipment-a', trackingNumber: 'JX-A' })),
    );
    harness.setInvoker('Org2MSP', 'tx-accept-a', '2026-07-20T04:02:00.000Z');
    await harness.contract.AcceptShipment(
      harness.ctx,
      'shipment-a',
      json({ carrierId: 'carrier-001', carrierName: '迅达物流' }),
    );

    harness.setInvoker('ReadOnlyMSP', 'tx-query', '2026-07-20T04:03:00.000Z');
    expect(parse<Shipment>(await harness.contract.ReadShipment(harness.ctx, 'JX-A')).id).toBe(
      'shipment-a',
    );
    const all = parse<Shipment[]>(await harness.contract.GetAllShipments(harness.ctx));
    expect(all.map((shipment) => shipment.id)).toEqual(['shipment-a', 'shipment-b']);
    const history = parse<ShipmentHistoryEntry[]>(
      await harness.contract.GetShipmentHistory(harness.ctx, 'JX-A'),
    );
    expect(history).toHaveLength(2);
    expect(history.map((entry) => entry.txId)).toEqual(['tx-create-a', 'tx-accept-a']);
    expect(history[0]?.value?.status).toBe('CREATED');
    expect(history[1]?.value?.status).toBe('ACCEPTED');
    expect(harness.stub.iterators.every((iterator) => iterator.closed)).toBe(true);
  });

  it('rejects malformed and privacy-unsafe create payloads with useful errors', async () => {
    harness.setInvoker('Org1MSP', 'tx-validation', '2026-07-20T04:00:00.000Z');
    await expect(harness.contract.CreateShipment(harness.ctx, '{oops')).rejects.toThrow(
      'Invalid CreateShipment input: malformed JSON',
    );
    await expect(
      harness.contract.CreateShipment(
        harness.ctx,
        json(createInput({ recipientMasked: '李女士 / 13900002000' })),
      ),
    ).rejects.toThrow('recipientMasked: value must be masked');
    await expect(
      harness.contract.CreateShipment(
        harness.ctx,
        json(createInput({ deliveryCodeHash: 'not-a-hash' })),
      ),
    ).rejects.toThrow('expected a 64-character SHA-256 hexadecimal digest');
    await expect(
      harness.contract.CreateShipment(
        harness.ctx,
        json(createInput({ temperatureRange: { min: 10, max: 2, unit: 'C' } })),
      ),
    ).rejects.toThrow('temperatureRange: min must be less than or equal to max');
    expect(harness.stub.state.size).toBe(0);
  });

  it('rejects missing delivery evidence and illegal duplicate transitions without mutating state', async () => {
    harness.setInvoker('Org1MSP', 'tx-create', '2026-07-20T04:00:00.000Z');
    await harness.contract.CreateShipment(harness.ctx, json(createInput()));
    harness.setInvoker('Org2MSP', 'tx-accept', '2026-07-20T04:01:00.000Z');
    await harness.contract.AcceptShipment(
      harness.ctx,
      'shipment-001',
      json({ carrierId: 'carrier-001', carrierName: '迅达物流' }),
    );
    await expect(
      harness.contract.AcceptShipment(
        harness.ctx,
        'shipment-001',
        json({ carrierId: 'carrier-001', carrierName: '迅达物流' }),
      ),
    ).rejects.toThrow('current status is ACCEPTED');
    harness.setInvoker('Org2MSP', 'tx-pickup', '2026-07-20T04:02:00.000Z');
    await harness.contract.PickupShipment(
      harness.ctx,
      'shipment-001',
      json({ ...carrierActor, location: '上海转运中心' }),
    );
    harness.setInvoker('Org2MSP', 'tx-checkpoint', '2026-07-20T04:03:00.000Z');
    await harness.contract.AddCheckpoint(
      harness.ctx,
      'shipment-001',
      json({ ...carrierActor, location: '南京', description: '正常运输' }),
    );
    const eventCount = harness.stub.events.length;
    await expect(
      harness.contract.MarkDelivered(
        harness.ctx,
        'shipment-001',
        json({ ...carrierActor, location: '南京收货点' }),
      ),
    ).rejects.toThrow('Invalid evidenceHash');
    expect(harness.stub.events).toHaveLength(eventCount);
    expect(
      parse<Shipment>(await harness.contract.ReadShipment(harness.ctx, 'shipment-001')).status,
    ).toBe('IN_TRANSIT');
  });

  it('reports missing shipments and corrupted tracking indexes clearly', async () => {
    harness.setInvoker('ReadOnlyMSP', 'tx-query', '2026-07-20T04:00:00.000Z');
    await expect(harness.contract.ReadShipment(harness.ctx, 'missing-001')).rejects.toThrow(
      'Shipment "missing-001" does not exist',
    );
    harness.stub.state.set('TRACKING:JX-BROKEN', Buffer.from('shipment-missing'));
    await expect(harness.contract.ReadShipment(harness.ctx, 'JX-BROKEN')).rejects.toThrow(
      'Ledger integrity error: tracking number "JX-BROKEN" points to missing shipment',
    );
  });
});
