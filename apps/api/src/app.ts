import { createHash, randomInt, randomUUID } from 'node:crypto';
import cors from 'cors';
import express, { type Application, type Request, type Response } from 'express';
import type {
  Address,
  AppUser,
  DashboardSummary,
  IntegrityResult,
  Shipment,
  ShipmentEvent,
  ShipmentHistoryEntry,
  UserRole,
} from '@jixin/shared';
import type { ZodType } from 'zod';
import {
  authenticateDemoUser,
  authenticateRequest,
  createToken,
  requireRoles,
  requireUser,
} from './auth.js';
import { loadConfig, type AppConfig } from './config.js';
import { AppError, asyncHandler, errorHandler, notFoundHandler } from './errors.js';
import type { Ledger } from './ledger/index.js';
import {
  acceptActionSchema,
  cancelActionSchema,
  checkpointActionSchema,
  confirmActionSchema,
  createShipmentSchema,
  deliverActionSchema,
  exceptionActionSchema,
  listShipmentsQuerySchema,
  loginSchema,
  pickupActionSchema,
  resolveActionSchema,
  shipmentIdParamsSchema,
  trackingParamsSchema,
  verifySchema,
} from './schemas.js';

interface AppOptions {
  ledger: Ledger;
  config?: AppConfig;
}

const PUBLIC_EVENT_DESCRIPTIONS: Record<ShipmentEvent['type'], string> = {
  CREATED: '运单已创建',
  ACCEPTED: '承运方已接单',
  PICKED_UP: '货物已揽收',
  CHECKPOINT: '运输节点已更新',
  EXCEPTION_REPORTED: '运输异常已记录',
  EXCEPTION_RESOLVED: '运输异常已处理',
  DELIVERED: '货物已送达',
  RECEIVED: '收货方已确认收货',
  CANCELLED: '运单已取消',
};

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function maskPhone(phone: string) {
  const normalized = phone.replace(/[^+\d]/g, '');
  if (normalized.length <= 7) return `${normalized.slice(0, 2)}***${normalized.slice(-2)}`;
  return `${normalized.slice(0, 3)}****${normalized.slice(-4)}`;
}

function maskName(name: string) {
  return name.length <= 1
    ? `${name}*`
    : `${name.slice(0, 1)}${'*'.repeat(Math.min(2, name.length - 1))}`;
}

function maskRecipient(value: string) {
  const [name, ...details] = value.split('·').map((part) => part.trim());
  if (!name) return '**';
  return details.length > 0 ? `${maskName(name)} · ${details.join(' · ')}` : maskName(name);
}

function toAddress(input: {
  province: string;
  city: string;
  district?: string | undefined;
  detail: string;
  contactName: string;
  contactPhone: string;
}): Address {
  return {
    province: input.province,
    city: input.city,
    ...(input.district === undefined ? {} : { district: input.district }),
    detail: input.detail,
    contactName: maskName(input.contactName),
    contactPhoneMasked: maskPhone(input.contactPhone),
  };
}

function trackingNumber() {
  const date = new Date();
  const datePart = [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('');
  return `JX${datePart}${randomInt(0, 1_000_000).toString().padStart(6, '0')}`;
}

function parse<T>(schema: ZodType<T>, value: unknown): T {
  return schema.parse(value);
}

function sendSuccess<T>(
  response: Response,
  request: Request,
  data: T,
  ledgerMode?: 'demo' | 'fabric',
  status = 200,
) {
  response.status(status).json({
    success: true,
    data,
    meta: {
      ...(ledgerMode === undefined ? {} : { ledgerMode }),
      requestId: request.requestId,
    },
  });
}

function canViewShipment(user: AppUser, shipment: Shipment) {
  switch (user.role) {
    case 'shipper':
      return shipment.shipperId === user.id;
    case 'carrier':
      return shipment.status === 'CREATED' || shipment.carrierId === user.id;
    case 'receiver':
      return shipment.status === 'DELIVERED' || shipment.status === 'RECEIVED';
    case 'auditor':
      return true;
  }
}

function requireVisible(user: AppUser, shipment: Shipment) {
  if (!canViewShipment(user, shipment)) {
    throw new AppError(403, 'SHIPMENT_NOT_VISIBLE', 'This shipment is not visible to your account');
  }
}

function publicAddress(address: Address) {
  return {
    province: address.province,
    city: address.city,
    ...(address.district === undefined ? {} : { district: address.district }),
    detail: '详细地址已脱敏',
    contactName: maskName(address.contactName),
    contactPhoneMasked: address.contactPhoneMasked,
  };
}

function publicShipment(shipment: Shipment) {
  return {
    docType: shipment.docType,
    id: shipment.id,
    trackingNumber: shipment.trackingNumber,
    status: shipment.status,
    shipperName: shipment.shipperName,
    ...(shipment.carrierName === undefined ? {} : { carrierName: shipment.carrierName }),
    origin: publicAddress(shipment.origin),
    destination: publicAddress(shipment.destination),
    goods: {
      name: shipment.goods.name,
      category: shipment.goods.category,
      quantity: shipment.goods.quantity,
      weightKg: shipment.goods.weightKg,
    },
    recipientMasked: maskRecipient(shipment.recipientMasked),
    expectedDeliveryDate: shipment.expectedDeliveryDate,
    ...(shipment.temperatureRange === undefined
      ? {}
      : { temperatureRange: shipment.temperatureRange }),
    events: shipment.events.map((event) => ({
      sequence: event.sequence,
      type: event.type,
      location: event.location,
      description: PUBLIC_EVENT_DESCRIPTIONS[event.type],
      mspId: event.mspId,
      txId: event.txId,
      timestamp: event.timestamp,
      ...(event.temperature === undefined ? {} : { temperature: event.temperature }),
      ...(event.evidenceHash === undefined ? {} : { evidenceHash: event.evidenceHash }),
    })),
    anomalyCount: shipment.anomalyCount,
    lastLocation: shipment.lastLocation,
    createdAt: shipment.createdAt,
    updatedAt: shipment.updatedAt,
  };
}

function publicHistory(history: ShipmentHistoryEntry[]) {
  return history.map((entry) => ({
    txId: entry.txId,
    timestamp: entry.timestamp,
    isDelete: entry.isDelete,
    value: entry.value ? publicShipment(entry.value) : null,
  }));
}

function historyIsContinuous(shipment: Shipment, history: ShipmentHistoryEntry[]) {
  if (history.length === 0 || history.some((entry) => entry.isDelete || !entry.value)) return false;
  const timestampsOrdered = history.every(
    (entry, index) => index === 0 || entry.timestamp >= history[index - 1]!.timestamp,
  );
  const valuesConsistent = history.every(
    (entry) =>
      entry.value?.id === shipment.id && entry.value.trackingNumber === shipment.trackingNumber,
  );
  const sequencesContinuous = shipment.events.every((event, index) => event.sequence === index + 1);
  const historyTransactions = new Set(history.map((entry) => entry.txId));
  const eventsCovered = shipment.events.every((event) => historyTransactions.has(event.txId));
  const last = history.at(-1)?.value;
  return (
    timestampsOrdered &&
    valuesConsistent &&
    sequencesContinuous &&
    eventsCovered &&
    last?.updatedAt === shipment.updatedAt &&
    last.status === shipment.status
  );
}

async function findByTracking(ledger: Ledger, number: string) {
  const shipments = await ledger.getAllShipments();
  const shipment = shipments.find((candidate) => candidate.trackingNumber === number);
  if (!shipment)
    throw new AppError(404, 'TRACKING_NOT_FOUND', 'No shipment matches this tracking number');
  return shipment;
}

export function createApp({ ledger, config = loadConfig() }: AppOptions): Application {
  const app = express();
  app.disable('x-powered-by');
  app.use((request, response, next) => {
    request.requestId = request.header('x-request-id')?.slice(0, 100) || randomUUID();
    response.setHeader('x-request-id', request.requestId);
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('referrer-policy', 'no-referrer');
    next();
  });
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || config.corsOrigins.includes('*') || config.corsOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new AppError(403, 'CORS_FORBIDDEN', 'Origin is not allowed'));
      },
      allowedHeaders: ['authorization', 'content-type', 'x-request-id'],
      exposedHeaders: ['x-request-id'],
    }),
  );
  app.use(express.json({ limit: '256kb' }));

  app.get(
    '/api/health',
    asyncHandler(async (request, response) => {
      const health = await ledger.health();
      sendSuccess(
        response,
        request,
        {
          status: health.status,
          service: 'jixin-api',
          timestamp: new Date().toISOString(),
          ledger: health,
        },
        ledger.mode,
        health.status === 'ok' ? 200 : 503,
      );
    }),
  );

  const networkHandler = asyncHandler(async (request, response) => {
    const health = await ledger.health();
    sendSuccess(
      response,
      request,
      {
        mode: ledger.mode,
        isDemo: ledger.mode === 'demo',
        label: ledger.mode === 'demo' ? '演示账本' : 'Hyperledger Fabric',
        health,
      },
      ledger.mode,
    );
  });
  app.get('/api/network', networkHandler);
  app.get('/api/network/mode', networkHandler);

  app.post(
    '/api/auth/login',
    asyncHandler(async (request, response) => {
      const credentials = parse(loginSchema, request.body);
      const user = authenticateDemoUser(credentials.username, credentials.password);
      sendSuccess(
        response,
        request,
        { token: createToken(user, config), user, ledgerMode: ledger.mode },
        ledger.mode,
      );
    }),
  );

  const requireAuth = authenticateRequest(config);
  app.get('/api/auth/me', requireAuth, (request, response) => {
    sendSuccess(
      response,
      request,
      { user: requireUser(request), ledgerMode: ledger.mode },
      ledger.mode,
    );
  });

  app.get(
    '/api/dashboard/summary',
    requireAuth,
    asyncHandler(async (request, response) => {
      const user = requireUser(request);
      const all = await ledger.getAllShipments(user);
      const shipments = all
        .filter((shipment) => canViewShipment(user, shipment))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      const summary: DashboardSummary = {
        total: shipments.length,
        inTransit: shipments.filter((shipment) =>
          ['ACCEPTED', 'PICKED_UP', 'IN_TRANSIT'].includes(shipment.status),
        ).length,
        exceptions: shipments.filter((shipment) => shipment.status === 'EXCEPTION').length,
        pendingReceipt: shipments.filter((shipment) => shipment.status === 'DELIVERED').length,
        completed: shipments.filter((shipment) => shipment.status === 'RECEIVED').length,
        recent: shipments.slice(0, 5),
      };
      sendSuccess(response, request, summary, ledger.mode);
    }),
  );

  app.get(
    '/api/shipments',
    requireAuth,
    asyncHandler(async (request, response) => {
      const user = requireUser(request);
      const query = parse(listShipmentsQuerySchema, request.query);
      const limit = query.limit ?? 20;
      const offset = query.offset ?? 0;
      const normalizedSearch = query.search?.toLocaleLowerCase('zh-CN');
      const visible = (await ledger.getAllShipments(user))
        .filter((shipment) => canViewShipment(user, shipment))
        .filter((shipment) => !query.status || shipment.status === query.status)
        .filter((shipment) => {
          if (!normalizedSearch) return true;
          return [
            shipment.trackingNumber,
            shipment.goods.name,
            shipment.origin.city,
            shipment.destination.city,
            shipment.recipientMasked,
          ].some((value) => value.toLocaleLowerCase('zh-CN').includes(normalizedSearch));
        })
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      sendSuccess(
        response,
        request,
        {
          items: visible.slice(offset, offset + limit),
          total: visible.length,
          limit,
          offset,
        },
        ledger.mode,
      );
    }),
  );

  app.post(
    '/api/shipments',
    requireAuth,
    requireRoles('shipper'),
    asyncHandler(async (request, response) => {
      const user = requireUser(request);
      const body = parse(createShipmentSchema, request.body);
      const deliveryCode = randomInt(100_000, 1_000_000).toString();
      const receipt = await ledger.createShipment(
        {
          id: `shipment-${randomUUID()}`,
          trackingNumber: trackingNumber(),
          origin: toAddress(body.origin),
          destination: toAddress(body.destination),
          goods: {
            name: body.goods.name,
            category: body.goods.category,
            quantity: body.goods.quantity,
            weightKg: body.goods.weightKg,
            ...(body.goods.description === undefined
              ? {}
              : { description: body.goods.description }),
          },
          recipientMasked: `${maskName(body.destination.contactName)} · ${maskPhone(body.destination.contactPhone)}`,
          expectedDeliveryDate: body.expectedDeliveryDate,
          ...(body.temperatureRange === undefined
            ? {}
            : {
                temperatureRange: {
                  min: body.temperatureRange.min,
                  max: body.temperatureRange.max,
                  unit: 'C' as const,
                },
              }),
          deliveryCodeHash: digest(deliveryCode),
          ...(body.documentHash === undefined
            ? {}
            : { documentHash: body.documentHash.toLowerCase() }),
        },
        user,
      );
      sendSuccess(response, request, { ...receipt, deliveryCode }, ledger.mode, 201);
    }),
  );

  app.get(
    '/api/shipments/:id',
    requireAuth,
    asyncHandler(async (request, response) => {
      const { id } = parse(shipmentIdParamsSchema, request.params);
      const user = requireUser(request);
      const shipment = await ledger.readShipment(id, user);
      requireVisible(user, shipment);
      sendSuccess(response, request, shipment, ledger.mode);
    }),
  );

  app.get(
    '/api/shipments/:id/history',
    requireAuth,
    asyncHandler(async (request, response) => {
      const { id } = parse(shipmentIdParamsSchema, request.params);
      const user = requireUser(request);
      const shipment = await ledger.readShipment(id, user);
      requireVisible(user, shipment);
      sendSuccess(response, request, await ledger.getShipmentHistory(id, user), ledger.mode);
    }),
  );

  const action = <T>(
    path: string,
    roles: UserRole[],
    schema: ZodType<T>,
    handler: (id: string, body: T, user: AppUser) => Promise<unknown>,
  ) => {
    app.post(
      path,
      requireAuth,
      requireRoles(...roles),
      asyncHandler(async (request, response) => {
        const { id } = parse(shipmentIdParamsSchema, request.params);
        const body = parse(schema, request.body ?? {});
        const receipt = await handler(id, body, requireUser(request));
        sendSuccess(response, request, receipt, ledger.mode);
      }),
    );
  };

  action('/api/shipments/:id/actions/accept', ['carrier'], acceptActionSchema, (id, body, user) =>
    ledger.acceptShipment(id, body, user),
  );
  action('/api/shipments/:id/actions/pickup', ['carrier'], pickupActionSchema, (id, body, user) =>
    ledger.pickupShipment(id, body, user),
  );
  action(
    '/api/shipments/:id/actions/checkpoint',
    ['carrier'],
    checkpointActionSchema,
    (id, body, user) => ledger.addCheckpoint(id, body, user),
  );
  action(
    '/api/shipments/:id/actions/exception',
    ['carrier'],
    exceptionActionSchema,
    (id, body, user) => ledger.reportException(id, body, user),
  );
  action('/api/shipments/:id/actions/resolve', ['carrier'], resolveActionSchema, (id, body, user) =>
    ledger.resolveException(id, body, user),
  );
  action('/api/shipments/:id/actions/deliver', ['carrier'], deliverActionSchema, (id, body, user) =>
    ledger.markDelivered(id, body, user),
  );
  action(
    '/api/shipments/:id/actions/confirm',
    ['receiver'],
    confirmActionSchema,
    (id, body, user) => ledger.confirmReceipt(id, body, user),
  );
  action('/api/shipments/:id/actions/cancel', ['shipper'], cancelActionSchema, (id, body, user) =>
    ledger.cancelShipment(id, body.reason === undefined ? {} : { description: body.reason }, user),
  );

  app.get(
    '/api/public/track/:trackingNumber',
    asyncHandler(async (request, response) => {
      const { trackingNumber: number } = parse(trackingParamsSchema, request.params);
      const shipment = await findByTracking(ledger, number);
      sendSuccess(response, request, publicShipment(shipment), ledger.mode);
    }),
  );

  app.get(
    '/api/public/track/:trackingNumber/history',
    asyncHandler(async (request, response) => {
      const { trackingNumber: number } = parse(trackingParamsSchema, request.params);
      const shipment = await findByTracking(ledger, number);
      const history = await ledger.getShipmentHistory(shipment.id);
      sendSuccess(response, request, publicHistory(history), ledger.mode);
    }),
  );

  app.post(
    '/api/public/verify',
    asyncHandler(async (request, response) => {
      const body = parse(verifySchema, request.body);
      const shipment = await findByTracking(ledger, body.trackingNumber);
      const history = await ledger.getShipmentHistory(shipment.id);
      const continuous = historyIsContinuous(shipment, history);
      const evidenceMatches =
        body.evidenceHash === undefined ||
        shipment.documentHash?.toLowerCase() === body.evidenceHash.toLowerCase() ||
        shipment.events.some(
          (event) => event.evidenceHash?.toLowerCase() === body.evidenceHash?.toLowerCase(),
        );
      const warnings: string[] = [];
      if (!continuous) warnings.push('账本历史或事件序列不连续');
      if (!evidenceMatches) warnings.push('提交的证据摘要未在运单记录中找到');
      if (ledger.mode === 'demo') warnings.push('演示账本结果仅用于流程预览，不构成真实上链证明');
      const result: IntegrityResult = {
        trackingNumber: shipment.trackingNumber,
        verified: ledger.mode === 'fabric' && continuous && evidenceMatches,
        ledgerMode: ledger.mode,
        status: shipment.status,
        eventCount: shipment.events.length,
        historyContinuous: continuous,
        checkedAt: new Date().toISOString(),
        warnings,
      };
      sendSuccess(response, request, result, ledger.mode);
    }),
  );

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
