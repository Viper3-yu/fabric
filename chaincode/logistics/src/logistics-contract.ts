import { createHash, timingSafeEqual } from 'node:crypto';

import { Context, Contract, Info, Returns, Transaction } from 'fabric-contract-api';

import type {
  Address,
  ChaincodeShipmentEvent,
  GoodsInfo,
  Shipment,
  ShipmentEvent,
  ShipmentEventType,
  ShipmentHistoryEntry,
  ShipmentStatus,
  TemperatureRange,
} from './types';

const SHIPMENT_KEY_PREFIX = 'SHIPMENT:';
const TRACKING_KEY_PREFIX = 'TRACKING:';
const KEY_RANGE_END = `${SHIPMENT_KEY_PREFIX}\uffff`;
const ORG1_MSP = 'Org1MSP';
const ORG2_MSP = 'Org2MSP';
const HASH_PATTERN = /^[a-fA-F0-9]{64}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const MAX_PAYLOAD_BYTES = 64 * 1024;

type JsonObject = Record<string, unknown>;

interface Actor {
  actorId: string;
  actorName: string;
}

interface EventInput extends Actor {
  location: string;
  description: string;
  temperature?: number;
  evidenceHash?: string;
}

interface TimestampLike {
  seconds: unknown;
  nanos: number;
}

interface IteratorResultLike<T> {
  value?: T;
  done: boolean;
}

interface LedgerIterator<T> {
  next(): Promise<IteratorResultLike<T>>;
  close(): Promise<void>;
}

interface StateEntry {
  key: string;
  value: Uint8Array;
}

interface HistoryEntry {
  txId: string;
  timestamp: TimestampLike;
  isDelete: boolean;
  value: Uint8Array;
}

interface CreateShipmentInput {
  id: string;
  trackingNumber: string;
  shipperId: string;
  shipperName: string;
  origin: Address;
  destination: Address;
  goods: GoodsInfo;
  recipientMasked: string;
  expectedDeliveryDate: string;
  deliveryCodeHash: string;
  temperatureRange?: TemperatureRange;
  documentHash?: string;
  location: string;
  description: string;
}

@Info({
  title: 'LogisticsContract',
  description: 'Trusted shipment lifecycle contract for the Jixin logistics system',
})
export class LogisticsContract extends Contract {
  @Transaction()
  @Returns('string')
  public async CreateShipment(ctx: Context, inputJson: string): Promise<string> {
    this.requireMsp(ctx, ORG1_MSP, 'CreateShipment');
    const input = this.parseCreateShipmentInput(inputJson);
    const shipmentKey = this.shipmentKey(input.id);
    const trackingKey = this.trackingKey(input.trackingNumber);

    if (await this.stateExists(ctx, shipmentKey)) {
      throw new Error(`CreateShipment failed: shipment id "${input.id}" already exists`);
    }
    if (await this.stateExists(ctx, trackingKey)) {
      throw new Error(
        `CreateShipment failed: tracking number "${input.trackingNumber}" already exists`,
      );
    }

    const timestamp = this.transactionTimestamp(ctx);
    const actor: Actor = { actorId: input.shipperId, actorName: input.shipperName };
    const createdEvent = this.buildEvent(
      ctx,
      [],
      'CREATED',
      {
        ...actor,
        location: input.location,
        description: input.description,
        ...(input.documentHash === undefined ? {} : { evidenceHash: input.documentHash }),
      },
      timestamp,
    );

    const shipment: Shipment = {
      docType: 'shipment',
      id: input.id,
      trackingNumber: input.trackingNumber,
      status: 'CREATED',
      shipperId: input.shipperId,
      shipperName: input.shipperName,
      origin: input.origin,
      destination: input.destination,
      goods: input.goods,
      recipientMasked: input.recipientMasked,
      expectedDeliveryDate: input.expectedDeliveryDate,
      ...(input.temperatureRange === undefined ? {} : { temperatureRange: input.temperatureRange }),
      deliveryCodeHash: input.deliveryCodeHash,
      ...(input.documentHash === undefined ? {} : { documentHash: input.documentHash }),
      events: [createdEvent],
      anomalyCount: 0,
      lastLocation: input.location,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await ctx.stub.putState(shipmentKey, this.encodeJson(shipment));
    await ctx.stub.putState(trackingKey, Buffer.from(input.id, 'utf8'));
    this.emitShipmentEvent(ctx, shipment, 'CREATED', [createdEvent], timestamp);
    return JSON.stringify(shipment);
  }

  @Transaction()
  @Returns('string')
  public async AcceptShipment(
    ctx: Context,
    shipmentId: string,
    inputJson: string,
  ): Promise<string> {
    this.requireMsp(ctx, ORG2_MSP, 'AcceptShipment');
    const record = this.parsePayload(inputJson, 'AcceptShipment input');
    const carrierId = this.requiredString(record, 'carrierId', 128);
    const carrierName = this.requiredString(record, 'carrierName', 128);
    const actor = this.parseActor(record, { actorId: carrierId, actorName: carrierName });
    const { key, shipment } = await this.loadShipment(ctx, shipmentId);
    this.requireStatus(shipment, ['CREATED'], 'AcceptShipment');

    const timestamp = this.transactionTimestamp(ctx);
    const event = this.buildEvent(
      ctx,
      shipment.events,
      'ACCEPTED',
      {
        ...actor,
        location: this.optionalString(record, 'location', 256) ?? shipment.lastLocation,
        description:
          this.optionalString(record, 'description', 500) ?? 'Carrier accepted the shipment',
      },
      timestamp,
    );
    shipment.carrierId = carrierId;
    shipment.carrierName = carrierName;
    shipment.status = 'ACCEPTED';
    this.appendEvents(shipment, [event], timestamp);
    return this.commitMutation(ctx, key, shipment, 'ACCEPTED', [event], timestamp);
  }

  @Transaction()
  @Returns('string')
  public async PickupShipment(
    ctx: Context,
    shipmentId: string,
    inputJson: string,
  ): Promise<string> {
    this.requireMsp(ctx, ORG2_MSP, 'PickupShipment');
    const record = this.parsePayload(inputJson, 'PickupShipment input');
    const actor = this.parseActor(record);
    const { key, shipment } = await this.loadShipment(ctx, shipmentId);
    this.requireStatus(shipment, ['ACCEPTED'], 'PickupShipment');
    this.requireAssignedCarrier(shipment, actor, 'PickupShipment');
    const timestamp = this.transactionTimestamp(ctx);
    const event = this.buildEvent(
      ctx,
      shipment.events,
      'PICKED_UP',
      {
        ...actor,
        location: this.requiredString(record, 'location', 256),
        description: this.optionalString(record, 'description', 500) ?? 'Shipment picked up',
        ...this.optionalEvidence(record),
      },
      timestamp,
    );
    shipment.status = 'PICKED_UP';
    this.appendEvents(shipment, [event], timestamp);
    return this.commitMutation(ctx, key, shipment, 'PICKED_UP', [event], timestamp);
  }

  @Transaction()
  @Returns('string')
  public async AddCheckpoint(ctx: Context, shipmentId: string, inputJson: string): Promise<string> {
    this.requireMsp(ctx, ORG2_MSP, 'AddCheckpoint');
    const record = this.parsePayload(inputJson, 'AddCheckpoint input');
    const actor = this.parseActor(record);
    const location = this.requiredString(record, 'location', 256);
    const description = this.requiredString(record, 'description', 500);
    const temperature = this.optionalNumber(record, 'temperature', -273.15, 10_000);
    const evidence = this.optionalEvidence(record);
    const { key, shipment } = await this.loadShipment(ctx, shipmentId);
    this.requireStatus(shipment, ['PICKED_UP', 'IN_TRANSIT'], 'AddCheckpoint');
    this.requireAssignedCarrier(shipment, actor, 'AddCheckpoint');

    const timestamp = this.transactionTimestamp(ctx);
    const checkpoint = this.buildEvent(
      ctx,
      shipment.events,
      'CHECKPOINT',
      {
        ...actor,
        location,
        description,
        ...(temperature === undefined ? {} : { temperature }),
        ...evidence,
      },
      timestamp,
    );
    const appendedEvents: ShipmentEvent[] = [checkpoint];
    shipment.status = 'IN_TRANSIT';

    if (
      temperature !== undefined &&
      shipment.temperatureRange !== undefined &&
      (temperature < shipment.temperatureRange.min || temperature > shipment.temperatureRange.max)
    ) {
      const exception = this.buildEvent(
        ctx,
        appendedEvents,
        'EXCEPTION_REPORTED',
        {
          ...actor,
          location,
          description: `Temperature ${temperature} C is outside allowed range ${shipment.temperatureRange.min}..${shipment.temperatureRange.max} C`,
          temperature,
          ...evidence,
        },
        timestamp,
        shipment.events.length,
      );
      appendedEvents.push(exception);
      shipment.status = 'EXCEPTION';
      shipment.anomalyCount += 1;
    }

    this.appendEvents(shipment, appendedEvents, timestamp);
    return this.commitMutation(ctx, key, shipment, 'ADD_CHECKPOINT', appendedEvents, timestamp);
  }

  @Transaction()
  @Returns('string')
  public async ReportException(
    ctx: Context,
    shipmentId: string,
    inputJson: string,
  ): Promise<string> {
    this.requireMsp(ctx, ORG2_MSP, 'ReportException');
    const record = this.parsePayload(inputJson, 'ReportException input');
    const actor = this.parseActor(record);
    const { key, shipment } = await this.loadShipment(ctx, shipmentId);
    this.requireStatus(shipment, ['IN_TRANSIT'], 'ReportException');
    this.requireAssignedCarrier(shipment, actor, 'ReportException');
    const timestamp = this.transactionTimestamp(ctx);
    const event = this.buildEvent(
      ctx,
      shipment.events,
      'EXCEPTION_REPORTED',
      {
        ...actor,
        location: this.requiredString(record, 'location', 256),
        description: this.requiredString(record, 'description', 500),
        ...this.optionalEvidence(record),
      },
      timestamp,
    );
    shipment.status = 'EXCEPTION';
    shipment.anomalyCount += 1;
    this.appendEvents(shipment, [event], timestamp);
    return this.commitMutation(ctx, key, shipment, 'EXCEPTION_REPORTED', [event], timestamp);
  }

  @Transaction()
  @Returns('string')
  public async ResolveException(
    ctx: Context,
    shipmentId: string,
    inputJson: string,
  ): Promise<string> {
    this.requireMsp(ctx, ORG2_MSP, 'ResolveException');
    const record = this.parsePayload(inputJson, 'ResolveException input');
    const actor = this.parseActor(record);
    const { key, shipment } = await this.loadShipment(ctx, shipmentId);
    this.requireStatus(shipment, ['EXCEPTION'], 'ResolveException');
    this.requireAssignedCarrier(shipment, actor, 'ResolveException');
    const timestamp = this.transactionTimestamp(ctx);
    const event = this.buildEvent(
      ctx,
      shipment.events,
      'EXCEPTION_RESOLVED',
      {
        ...actor,
        location: this.requiredString(record, 'location', 256),
        description: this.requiredString(record, 'description', 500),
        ...this.optionalEvidence(record),
      },
      timestamp,
    );
    shipment.status = 'IN_TRANSIT';
    this.appendEvents(shipment, [event], timestamp);
    return this.commitMutation(ctx, key, shipment, 'EXCEPTION_RESOLVED', [event], timestamp);
  }

  @Transaction()
  @Returns('string')
  public async MarkDelivered(ctx: Context, shipmentId: string, inputJson: string): Promise<string> {
    this.requireMsp(ctx, ORG2_MSP, 'MarkDelivered');
    const record = this.parsePayload(inputJson, 'MarkDelivered input');
    const actor = this.parseActor(record);
    const { key, shipment } = await this.loadShipment(ctx, shipmentId);
    this.requireStatus(shipment, ['IN_TRANSIT'], 'MarkDelivered');
    this.requireAssignedCarrier(shipment, actor, 'MarkDelivered');
    const timestamp = this.transactionTimestamp(ctx);
    const event = this.buildEvent(
      ctx,
      shipment.events,
      'DELIVERED',
      {
        ...actor,
        location: this.requiredString(record, 'location', 256),
        description: this.optionalString(record, 'description', 500) ?? 'Shipment delivered',
        evidenceHash: this.requiredHash(record, 'evidenceHash'),
      },
      timestamp,
    );
    shipment.status = 'DELIVERED';
    this.appendEvents(shipment, [event], timestamp);
    return this.commitMutation(ctx, key, shipment, 'DELIVERED', [event], timestamp);
  }

  @Transaction()
  @Returns('string')
  public async ConfirmReceipt(
    ctx: Context,
    shipmentId: string,
    inputJson: string,
  ): Promise<string> {
    this.requireMsp(ctx, ORG1_MSP, 'ConfirmReceipt');
    const record = this.parsePayload(inputJson, 'ConfirmReceipt input');
    const actor = this.parseActor(record);
    const deliveryCode = this.deliveryCode(ctx);
    const { key, shipment } = await this.loadShipment(ctx, shipmentId);
    this.requireStatus(shipment, ['DELIVERED'], 'ConfirmReceipt');

    const actualHash = createHash('sha256').update(deliveryCode, 'utf8').digest();
    const expectedHash = Buffer.from(shipment.deliveryCodeHash, 'hex');
    if (actualHash.length !== expectedHash.length || !timingSafeEqual(actualHash, expectedHash)) {
      throw new Error('ConfirmReceipt failed: delivery code is incorrect');
    }

    const timestamp = this.transactionTimestamp(ctx);
    const event = this.buildEvent(
      ctx,
      shipment.events,
      'RECEIVED',
      {
        ...actor,
        location: this.optionalString(record, 'location', 256) ?? shipment.lastLocation,
        description:
          this.optionalString(record, 'description', 500) ?? 'Recipient confirmed receipt',
      },
      timestamp,
    );
    shipment.status = 'RECEIVED';
    this.appendEvents(shipment, [event], timestamp);
    return this.commitMutation(ctx, key, shipment, 'RECEIVED', [event], timestamp);
  }

  @Transaction()
  @Returns('string')
  public async CancelShipment(
    ctx: Context,
    shipmentId: string,
    inputJson: string,
  ): Promise<string> {
    this.requireMsp(ctx, ORG1_MSP, 'CancelShipment');
    const record = this.parsePayload(inputJson, 'CancelShipment input');
    const actor = this.parseActor(record);
    const { key, shipment } = await this.loadShipment(ctx, shipmentId);
    this.requireStatus(shipment, ['CREATED'], 'CancelShipment');
    if (actor.actorId !== shipment.shipperId) {
      throw new Error(
        `CancelShipment failed: actor "${actor.actorId}" is not authorized; shipment "${shipment.id}" shipper is "${shipment.shipperId}"`,
      );
    }
    const timestamp = this.transactionTimestamp(ctx);
    const event = this.buildEvent(
      ctx,
      shipment.events,
      'CANCELLED',
      {
        ...actor,
        location: this.optionalString(record, 'location', 256) ?? shipment.lastLocation,
        description: this.optionalString(record, 'description', 500) ?? 'Shipment cancelled',
      },
      timestamp,
    );
    shipment.status = 'CANCELLED';
    this.appendEvents(shipment, [event], timestamp);
    return this.commitMutation(ctx, key, shipment, 'CANCELLED', [event], timestamp);
  }

  @Transaction(false)
  @Returns('string')
  public async ReadShipment(ctx: Context, shipmentIdOrTrackingNumber: string): Promise<string> {
    const { shipment } = await this.loadShipment(ctx, shipmentIdOrTrackingNumber);
    return JSON.stringify(shipment);
  }

  @Transaction(false)
  @Returns('string')
  public async GetAllShipments(ctx: Context): Promise<string> {
    const iterator = (await ctx.stub.getStateByRange(
      SHIPMENT_KEY_PREFIX,
      KEY_RANGE_END,
    )) as unknown as LedgerIterator<StateEntry>;
    const shipments: Shipment[] = [];
    try {
      while (true) {
        const result = await iterator.next();
        if (result.done) {
          break;
        }
        if (result.value === undefined) {
          throw new Error('GetAllShipments failed: ledger iterator returned no value');
        }
        shipments.push(this.decodeShipment(result.value.value, result.value.key));
      }
    } finally {
      await iterator.close();
    }
    return JSON.stringify(shipments);
  }

  @Transaction(false)
  @Returns('string')
  public async GetShipmentHistory(
    ctx: Context,
    shipmentIdOrTrackingNumber: string,
  ): Promise<string> {
    const { key } = await this.loadShipment(ctx, shipmentIdOrTrackingNumber);
    const iterator = (await ctx.stub.getHistoryForKey(
      key,
    )) as unknown as LedgerIterator<HistoryEntry>;
    const history: ShipmentHistoryEntry[] = [];
    try {
      while (true) {
        const result = await iterator.next();
        if (result.done) {
          break;
        }
        if (result.value === undefined) {
          throw new Error('GetShipmentHistory failed: ledger iterator returned no value');
        }
        const item = result.value;
        history.push({
          txId: item.txId,
          timestamp: this.timestampToISOString(item.timestamp, 'history timestamp'),
          isDelete: item.isDelete,
          value: item.isDelete ? null : this.decodeShipment(item.value, key),
        });
      }
    } finally {
      await iterator.close();
    }
    return JSON.stringify(history);
  }

  private async commitMutation(
    ctx: Context,
    key: string,
    shipment: Shipment,
    action: ChaincodeShipmentEvent['action'],
    events: ShipmentEvent[],
    timestamp: string,
  ): Promise<string> {
    await ctx.stub.putState(key, this.encodeJson(shipment));
    this.emitShipmentEvent(ctx, shipment, action, events, timestamp);
    return JSON.stringify(shipment);
  }

  private emitShipmentEvent(
    ctx: Context,
    shipment: Shipment,
    action: ChaincodeShipmentEvent['action'],
    events: ShipmentEvent[],
    timestamp: string,
  ): void {
    const payload: ChaincodeShipmentEvent = {
      eventName: 'ShipmentEvent',
      action,
      shipmentId: shipment.id,
      trackingNumber: shipment.trackingNumber,
      status: shipment.status,
      txId: ctx.stub.getTxID(),
      timestamp,
      mspId: this.currentMsp(ctx),
      events,
    };
    ctx.stub.setEvent('ShipmentEvent', this.encodeJson(payload));
  }

  private appendEvents(shipment: Shipment, events: ShipmentEvent[], timestamp: string): void {
    shipment.events.push(...events);
    shipment.lastLocation = events[events.length - 1]?.location ?? shipment.lastLocation;
    shipment.updatedAt = timestamp;
  }

  private buildEvent(
    ctx: Context,
    priorEvents: ShipmentEvent[],
    type: ShipmentEventType,
    input: EventInput,
    timestamp: string,
    sequenceOffset = 0,
  ): ShipmentEvent {
    return {
      sequence: sequenceOffset + priorEvents.length + 1,
      type,
      location: input.location,
      description: input.description,
      actorId: input.actorId,
      actorName: input.actorName,
      mspId: this.currentMsp(ctx),
      txId: ctx.stub.getTxID(),
      timestamp,
      ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
      ...(input.evidenceHash === undefined ? {} : { evidenceHash: input.evidenceHash }),
    };
  }

  private async loadShipment(
    ctx: Context,
    shipmentIdOrTrackingNumber: string,
  ): Promise<{ key: string; shipment: Shipment }> {
    const lookup = this.identifier(shipmentIdOrTrackingNumber, 'shipment id or tracking number');
    const directKey = this.shipmentKey(lookup);
    const directState = await ctx.stub.getState(directKey);
    if (directState.length > 0) {
      return { key: directKey, shipment: this.decodeShipment(directState, directKey) };
    }

    const trackingKey = this.trackingKey(lookup);
    const indexedId = await ctx.stub.getState(trackingKey);
    if (indexedId.length === 0) {
      throw new Error(`Shipment "${lookup}" does not exist`);
    }
    const shipmentId = Buffer.from(indexedId).toString('utf8');
    const resolvedKey = this.shipmentKey(shipmentId);
    const state = await ctx.stub.getState(resolvedKey);
    if (state.length === 0) {
      throw new Error(
        `Ledger integrity error: tracking number "${lookup}" points to missing shipment "${shipmentId}"`,
      );
    }
    return { key: resolvedKey, shipment: this.decodeShipment(state, resolvedKey) };
  }

  private decodeShipment(bytes: Uint8Array, key: string): Shipment {
    let value: unknown;
    try {
      value = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
    } catch {
      throw new Error(`Ledger integrity error: state at "${key}" is not valid JSON`);
    }
    if (!this.isRecord(value) || value.docType !== 'shipment' || typeof value.id !== 'string') {
      throw new Error(`Ledger integrity error: state at "${key}" is not a shipment document`);
    }
    return value as unknown as Shipment;
  }

  private async stateExists(ctx: Context, key: string): Promise<boolean> {
    return (await ctx.stub.getState(key)).length > 0;
  }

  private shipmentKey(id: string): string {
    return `${SHIPMENT_KEY_PREFIX}${id}`;
  }

  private trackingKey(trackingNumber: string): string {
    return `${TRACKING_KEY_PREFIX}${trackingNumber}`;
  }

  private encodeJson(value: unknown): Buffer {
    return Buffer.from(JSON.stringify(value), 'utf8');
  }

  private requireMsp(ctx: Context, expectedMsp: string, operation: string): void {
    const actualMsp = this.currentMsp(ctx);
    if (actualMsp !== expectedMsp) {
      throw new Error(
        `${operation} is restricted to ${expectedMsp}; caller belongs to ${actualMsp || 'an unknown MSP'}`,
      );
    }
  }

  private currentMsp(ctx: Context): string {
    try {
      return ctx.clientIdentity.getMSPID();
    } catch {
      throw new Error('Unable to determine the caller MSP from the Fabric client identity');
    }
  }

  private requireStatus(shipment: Shipment, allowed: ShipmentStatus[], operation: string): void {
    if (!allowed.includes(shipment.status)) {
      throw new Error(
        `${operation} failed: shipment "${shipment.id}" must be in ${allowed.join(' or ')} status; current status is ${shipment.status}`,
      );
    }
  }

  private requireAssignedCarrier(shipment: Shipment, actor: Actor, operation: string): void {
    if (shipment.carrierId === undefined) {
      throw new Error(
        `${operation} failed: shipment "${shipment.id}" does not have an assigned carrier`,
      );
    }
    if (shipment.carrierId !== actor.actorId) {
      throw new Error(
        `${operation} failed: actor "${actor.actorId}" is not authorized; shipment "${shipment.id}" assigned carrier is "${shipment.carrierId}"`,
      );
    }
  }

  private transactionTimestamp(ctx: Context): string {
    return this.timestampToISOString(
      ctx.stub.getTxTimestamp() as unknown as TimestampLike,
      'transaction timestamp',
    );
  }

  private timestampToISOString(timestamp: TimestampLike, label: string): string {
    if (timestamp === undefined || timestamp === null || timestamp.seconds === undefined) {
      throw new Error(`Ledger integrity error: ${label} is missing`);
    }
    let seconds: bigint;
    try {
      if (typeof timestamp.seconds === 'bigint') {
        seconds = timestamp.seconds;
      } else if (typeof timestamp.seconds === 'number') {
        if (!Number.isSafeInteger(timestamp.seconds)) {
          throw new Error('unsafe seconds');
        }
        seconds = BigInt(timestamp.seconds);
      } else {
        seconds = BigInt(String(timestamp.seconds));
      }
    } catch {
      throw new Error(`Ledger integrity error: ${label} has invalid seconds`);
    }
    const nanos = timestamp.nanos ?? 0;
    if (!Number.isInteger(nanos) || nanos < 0 || nanos >= 1_000_000_000) {
      throw new Error(`Ledger integrity error: ${label} has invalid nanoseconds`);
    }
    const milliseconds = seconds * 1_000n + BigInt(Math.floor(nanos / 1_000_000));
    const numericMilliseconds = Number(milliseconds);
    if (!Number.isSafeInteger(numericMilliseconds)) {
      throw new Error(`Ledger integrity error: ${label} is outside the supported date range`);
    }
    try {
      return new Date(numericMilliseconds).toISOString();
    } catch {
      throw new Error(`Ledger integrity error: ${label} is outside the supported date range`);
    }
  }

  private deliveryCode(ctx: Context): string {
    const transientCode = ctx.stub.getTransient().get('deliveryCode');
    if (transientCode !== undefined && transientCode.length > 0) {
      const value = Buffer.from(transientCode).toString('utf8').trim();
      if (value.length < 4 || value.length > 128) {
        throw new Error(
          'Invalid deliveryCode in Fabric transient data: expected 4 to 128 characters',
        );
      }
      return value;
    }
    throw new Error(
      'ConfirmReceipt failed: deliveryCode must be supplied in Fabric transient data',
    );
  }

  private parseCreateShipmentInput(inputJson: string): CreateShipmentInput {
    const record = this.parsePayload(inputJson, 'CreateShipment input');
    const origin = this.parseAddress(record.origin, 'origin');
    const destination = this.parseAddress(record.destination, 'destination');
    const temperatureRange = this.parseTemperatureRange(record.temperatureRange);
    const documentHash = this.optionalHash(record, 'documentHash');
    return {
      id: this.identifier(this.requiredString(record, 'id', 128), 'id'),
      trackingNumber: this.identifier(
        this.requiredString(record, 'trackingNumber', 128),
        'trackingNumber',
      ),
      shipperId: this.requiredString(record, 'shipperId', 128),
      shipperName: this.requiredString(record, 'shipperName', 128),
      origin,
      destination,
      goods: this.parseGoods(record.goods),
      recipientMasked: this.maskedString(record, 'recipientMasked', 256),
      expectedDeliveryDate: this.validDateString(record, 'expectedDeliveryDate'),
      deliveryCodeHash: this.requiredHash(record, 'deliveryCodeHash'),
      ...(temperatureRange === undefined ? {} : { temperatureRange }),
      ...(documentHash === undefined ? {} : { documentHash }),
      location: this.optionalString(record, 'location', 256) ?? this.addressLocation(origin),
      description: this.optionalString(record, 'description', 500) ?? 'Shipment created',
    };
  }

  private parseAddress(value: unknown, field: string): Address {
    const record = this.requiredRecord(value, field);
    const district = this.optionalString(record, 'district', 128, `${field}.district`);
    return {
      province: this.requiredString(record, 'province', 128, `${field}.province`),
      city: this.requiredString(record, 'city', 128, `${field}.city`),
      ...(district === undefined ? {} : { district }),
      detail: this.requiredString(record, 'detail', 256, `${field}.detail`),
      contactName: this.requiredString(record, 'contactName', 128, `${field}.contactName`),
      contactPhoneMasked: this.maskedString(
        record,
        'contactPhoneMasked',
        64,
        `${field}.contactPhoneMasked`,
      ),
    };
  }

  private parseGoods(value: unknown): GoodsInfo {
    const record = this.requiredRecord(value, 'goods');
    const description = this.optionalString(record, 'description', 500, 'goods.description');
    return {
      name: this.requiredString(record, 'name', 128, 'goods.name'),
      category: this.requiredString(record, 'category', 128, 'goods.category'),
      quantity: this.requiredInteger(record, 'quantity', 1, 1_000_000, 'goods.quantity'),
      weightKg: this.requiredNumber(record, 'weightKg', 0.001, 1_000_000, 'goods.weightKg'),
      ...(description === undefined ? {} : { description }),
    };
  }

  private parseTemperatureRange(value: unknown): TemperatureRange | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }
    const record = this.requiredRecord(value, 'temperatureRange');
    const min = this.requiredNumber(record, 'min', -273.15, 10_000, 'temperatureRange.min');
    const max = this.requiredNumber(record, 'max', -273.15, 10_000, 'temperatureRange.max');
    if (min > max) {
      throw new Error('Invalid temperatureRange: min must be less than or equal to max');
    }
    if (record.unit !== 'C') {
      throw new Error('Invalid temperatureRange.unit: only "C" is supported');
    }
    return { min, max, unit: 'C' };
  }

  private parseActor(record: JsonObject, fallback?: Actor): Actor {
    return {
      actorId:
        this.optionalString(record, 'actorId', 128) ??
        fallback?.actorId ??
        this.missingString('actorId'),
      actorName:
        this.optionalString(record, 'actorName', 128) ??
        fallback?.actorName ??
        this.missingString('actorName'),
    };
  }

  private optionalEvidence(record: JsonObject): { evidenceHash?: string } {
    const evidenceHash = this.optionalHash(record, 'evidenceHash');
    return evidenceHash === undefined ? {} : { evidenceHash };
  }

  private parsePayload(inputJson: string, label: string): JsonObject {
    if (typeof inputJson !== 'string' || inputJson.trim().length === 0) {
      throw new Error(`Invalid ${label}: expected a non-empty JSON object string`);
    }
    if (Buffer.byteLength(inputJson, 'utf8') > MAX_PAYLOAD_BYTES) {
      throw new Error(`Invalid ${label}: payload exceeds ${MAX_PAYLOAD_BYTES} bytes`);
    }
    let value: unknown;
    try {
      value = JSON.parse(inputJson) as unknown;
    } catch {
      throw new Error(`Invalid ${label}: malformed JSON`);
    }
    return this.requiredRecord(value, label);
  }

  private requiredRecord(value: unknown, field: string): JsonObject {
    if (!this.isRecord(value)) {
      throw new Error(`Invalid ${field}: expected an object`);
    }
    return value;
  }

  private isRecord(value: unknown): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private requiredString(record: JsonObject, key: string, maxLength: number, field = key): string {
    const value = record[key];
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`Invalid ${field}: expected a non-empty string`);
    }
    const trimmed = value.trim();
    if (trimmed.length > maxLength) {
      throw new Error(`Invalid ${field}: must not exceed ${maxLength} characters`);
    }
    return trimmed;
  }

  private optionalString(
    record: JsonObject,
    key: string,
    maxLength: number,
    field = key,
  ): string | undefined {
    const value = record[key];
    if (value === undefined || value === null) {
      return undefined;
    }
    return this.requiredString(record, key, maxLength, field);
  }

  private maskedString(record: JsonObject, key: string, maxLength: number, field = key): string {
    const value = this.requiredString(record, key, maxLength, field);
    if (!value.includes('*')) {
      throw new Error(`Invalid ${field}: value must be masked and contain "*"`);
    }
    return value;
  }

  private identifier(value: string, field: string): string {
    if (value.length > 128) {
      throw new Error(`Invalid ${field}: must not exceed 128 characters`);
    }
    if (!IDENTIFIER_PATTERN.test(value)) {
      throw new Error(
        `Invalid ${field}: use letters, numbers, dot, underscore, colon, or hyphen without spaces`,
      );
    }
    return value;
  }

  private requiredHash(record: JsonObject, key: string): string {
    const value = this.requiredString(record, key, 64);
    if (!HASH_PATTERN.test(value)) {
      throw new Error(`Invalid ${key}: expected a 64-character SHA-256 hexadecimal digest`);
    }
    return value.toLowerCase();
  }

  private optionalHash(record: JsonObject, key: string): string | undefined {
    if (record[key] === undefined || record[key] === null) {
      return undefined;
    }
    return this.requiredHash(record, key);
  }

  private requiredNumber(
    record: JsonObject,
    key: string,
    min: number,
    max: number,
    field = key,
  ): number {
    const value = record[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`Invalid ${field}: expected a finite number`);
    }
    if (value < min || value > max) {
      throw new Error(`Invalid ${field}: expected a value from ${min} to ${max}`);
    }
    return value;
  }

  private requiredInteger(
    record: JsonObject,
    key: string,
    min: number,
    max: number,
    field = key,
  ): number {
    const value = this.requiredNumber(record, key, min, max, field);
    if (!Number.isInteger(value)) {
      throw new Error(`Invalid ${field}: expected an integer`);
    }
    return value;
  }

  private optionalNumber(
    record: JsonObject,
    key: string,
    min: number,
    max: number,
  ): number | undefined {
    if (record[key] === undefined || record[key] === null) {
      return undefined;
    }
    return this.requiredNumber(record, key, min, max);
  }

  private validDateString(record: JsonObject, key: string): string {
    const value = this.requiredString(record, key, 64);
    const isoDatePattern =
      /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2}))?$/;
    if (!isoDatePattern.test(value) || Number.isNaN(Date.parse(value))) {
      throw new Error(`Invalid ${key}: expected an ISO date or date-time string`);
    }
    return value;
  }

  private addressLocation(address: Address): string {
    return [address.province, address.city, address.district]
      .filter((part): part is string => part !== undefined && part.length > 0)
      .join(' / ');
  }

  private missingString(field: string): never {
    throw new Error(`Invalid ${field}: expected a non-empty string`);
  }
}
