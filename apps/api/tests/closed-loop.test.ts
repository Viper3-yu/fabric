import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { DemoLedger, seedDemoLedger } from '../src/ledger/demo-ledger.js';

describe('logistics API closed loop', () => {
  let directory: string;
  let ledgerPath: string;
  let ledger: DemoLedger;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'jixin-api-test-'));
    ledgerPath = join(directory, 'ledger.json');
    const config = loadConfig({
      NODE_ENV: 'test',
      LEDGER_MODE: 'demo',
      JWT_SECRET: 'closed-loop-test-secret-long-enough',
      DEMO_LEDGER_PATH: ledgerPath,
      DEMO_AUTO_SEED: 'false',
      CORS_ORIGIN: 'http://localhost:5173',
    });
    ledger = new DemoLedger(ledgerPath);
    app = createApp({ ledger, config });
    await ledger.health();
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function login(username: 'shipper' | 'carrier' | 'receiver' | 'auditor') {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ username, password: `${username}123` })
      .expect(200);
    expect(response.body.success).toBe(true);
    return response.body.data.token as string;
  }

  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  it('runs create → accept → pickup → checkpoint → exception → resolve → deliver → receive', async () => {
    const [shipperToken, carrierToken, receiverToken] = await Promise.all([
      login('shipper'),
      login('carrier'),
      login('receiver'),
    ]);

    const health = await request(app).get('/api/health').expect(200);
    expect(health.body.data.ledger).toMatchObject({ mode: 'demo', status: 'ok' });

    const createResponse = await request(app)
      .post('/api/shipments')
      .set(bearer(shipperToken))
      .send({
        origin: {
          province: '上海市',
          city: '上海市',
          district: '浦东新区',
          detail: '张江物流园 8 号仓',
          contactName: '张发货',
          contactPhone: '13800001234',
        },
        destination: {
          province: '江苏省',
          city: '南京市',
          district: '玄武区',
          detail: '珠江路 100 号',
          contactName: '李收货',
          contactPhone: '13900005678',
        },
        goods: { name: '冷链试剂', category: '医药', quantity: 2, weightKg: 3.6 },
        expectedDeliveryDate: '2026-07-25',
        temperatureRange: { min: 2, max: 8, unit: 'C' },
        documentHash: 'a'.repeat(64),
      })
      .expect(201);

    expect(createResponse.body.meta.ledgerMode).toBe('demo');
    expect(createResponse.body.data.transactionId).toMatch(/^demo-/);
    expect(createResponse.body.data.deliveryCode).toMatch(/^\d{6}$/);
    expect(createResponse.body.data.data.deliveryCodeHash).not.toBe(
      createResponse.body.data.deliveryCode,
    );
    const shipmentId = createResponse.body.data.data.id as string;
    const trackingNumber = createResponse.body.data.data.trackingNumber as string;
    const deliveryCode = createResponse.body.data.deliveryCode as string;

    await request(app)
      .post(`/api/shipments/${shipmentId}/actions/accept`)
      .set(bearer(carrierToken))
      .send({ location: '上海运营中心' })
      .expect(200)
      .expect((response) => expect(response.body.data.data.status).toBe('ACCEPTED'));

    await request(app)
      .post(`/api/shipments/${shipmentId}/actions/pickup`)
      .set(bearer(carrierToken))
      .send({ location: '上海张江物流园' })
      .expect(200)
      .expect((response) => expect(response.body.data.data.status).toBe('PICKED_UP'));

    await request(app)
      .post(`/api/shipments/${shipmentId}/actions/checkpoint`)
      .set(bearer(carrierToken))
      .send({ location: '昆山中转站', description: '冷链运输正常', temperature: 5.1 })
      .expect(200)
      .expect((response) => expect(response.body.data.data.status).toBe('IN_TRANSIT'));

    await request(app)
      .post(`/api/shipments/${shipmentId}/actions/exception`)
      .set(bearer(carrierToken))
      .send({ location: '昆山中转站', description: '车辆临时检修', evidenceHash: 'b'.repeat(64) })
      .expect(200)
      .expect((response) => {
        expect(response.body.data.data.status).toBe('EXCEPTION');
        expect(response.body.data.data.anomalyCount).toBe(1);
      });

    await request(app)
      .post(`/api/shipments/${shipmentId}/actions/resolve`)
      .set(bearer(carrierToken))
      .send({ location: '昆山中转站', description: '备用车辆完成换装' })
      .expect(200)
      .expect((response) => expect(response.body.data.data.status).toBe('IN_TRANSIT'));

    await request(app)
      .post(`/api/shipments/${shipmentId}/actions/checkpoint`)
      .set(bearer(carrierToken))
      .send({ location: '南京配送中心', description: '进入末端配送', temperature: 4.8 })
      .expect(200);

    const deliveryEvidence = 'c'.repeat(64);
    await request(app)
      .post(`/api/shipments/${shipmentId}/actions/deliver`)
      .set(bearer(carrierToken))
      .send({
        location: '南京市玄武区',
        description: '已送达指定地点',
        evidenceHash: deliveryEvidence,
      })
      .expect(200)
      .expect((response) => expect(response.body.data.data.status).toBe('DELIVERED'));

    await request(app)
      .post(`/api/shipments/${shipmentId}/actions/confirm`)
      .set(bearer(receiverToken))
      .send({ deliveryCode: '000000' })
      .expect(400)
      .expect((response) => expect(response.body.error.code).toBe('INVALID_DELIVERY_CODE'));

    await request(app)
      .post(`/api/shipments/${shipmentId}/actions/confirm`)
      .set(bearer(receiverToken))
      .send({ deliveryCode, location: '南京市玄武区' })
      .expect(200)
      .expect((response) => expect(response.body.data.data.status).toBe('RECEIVED'));

    await request(app)
      .post(`/api/shipments/${shipmentId}/actions/confirm`)
      .set(bearer(receiverToken))
      .send({ deliveryCode })
      .expect(409)
      .expect((response) => expect(response.body.error.code).toBe('INVALID_STATE'));

    const publicTracking = await request(app)
      .get(`/api/public/track/${trackingNumber}`)
      .expect(200);
    expect(publicTracking.body.meta.ledgerMode).toBe('demo');
    expect(publicTracking.body.data.status).toBe('RECEIVED');
    expect(publicTracking.body.data).not.toHaveProperty('deliveryCodeHash');
    expect(publicTracking.body.data.events[0]).not.toHaveProperty('actorId');
    expect(publicTracking.body.data.destination.detail).toBe('详细地址已脱敏');

    const publicHistory = await request(app)
      .get(`/api/public/track/${trackingNumber}/history`)
      .expect(200);
    expect(publicHistory.body.data.length).toBe(9);
    expect(publicHistory.body.data.at(-1).value.status).toBe('RECEIVED');

    const verification = await request(app)
      .post('/api/public/verify')
      .send({ trackingNumber, evidenceHash: deliveryEvidence })
      .expect(200);
    expect(verification.body.data).toMatchObject({
      verified: false,
      ledgerMode: 'demo',
      historyContinuous: true,
      status: 'RECEIVED',
    });
    expect(verification.body.data.warnings).toContain(
      '演示账本结果仅用于流程预览，不构成真实上链证明',
    );

    const reloaded = new DemoLedger(ledgerPath);
    const persisted = await reloaded.readShipment(shipmentId);
    expect(persisted.status).toBe('RECEIVED');
    expect(persisted.events).toHaveLength(9);
  });

  it('rejects unauthenticated, invalid, forbidden, and out-of-order requests', async () => {
    const [shipperToken, carrierToken, auditorToken] = await Promise.all([
      login('shipper'),
      login('carrier'),
      login('auditor'),
    ]);

    await request(app).post('/api/shipments').send({}).expect(401);
    await request(app)
      .post('/api/shipments')
      .set(bearer(auditorToken))
      .send({})
      .expect(403)
      .expect((response) => expect(response.body.error.code).toBe('FORBIDDEN'));
    await request(app)
      .post('/api/shipments')
      .set(bearer(shipperToken))
      .send({ origin: {} })
      .expect(400)
      .expect((response) => expect(response.body.error.code).toBe('VALIDATION_ERROR'));

    const created = await request(app)
      .post('/api/shipments')
      .set(bearer(shipperToken))
      .send({
        origin: {
          province: '广东省',
          city: '深圳市',
          detail: '南山仓',
          contactName: '发货人',
          contactPhone: '13800001234',
        },
        destination: {
          province: '广东省',
          city: '广州市',
          detail: '天河收货点',
          contactName: '收货人',
          contactPhone: '13900005678',
        },
        goods: { name: '电子配件', category: '普货', quantity: 1, weightKg: 1.2 },
        expectedDeliveryDate: '2026-07-26',
      })
      .expect(201);
    const id = created.body.data.data.id as string;

    await request(app)
      .post(`/api/shipments/${id}/actions/pickup`)
      .set(bearer(carrierToken))
      .send({ location: '深圳南山仓' })
      .expect(409)
      .expect((response) => expect(response.body.error.code).toBe('INVALID_STATE'));

    await request(app)
      .post(`/api/shipments/${id}/actions/accept`)
      .set(bearer(shipperToken))
      .send({})
      .expect(403);

    await request(app)
      .post(`/api/shipments/${id}/actions/accept`)
      .set(bearer(carrierToken))
      .send({})
      .expect(200);
    await request(app)
      .post(`/api/shipments/${id}/actions/accept`)
      .set(bearer(carrierToken))
      .send({})
      .expect(409);

    await request(app)
      .post(`/api/shipments/${id}/actions/cancel`)
      .set(bearer(shipperToken))
      .send({ reason: '已接单后不可取消' })
      .expect(409);
  });

  it('seeds durable demo data and applies automatic temperature exceptions', async () => {
    const seededLedger = new DemoLedger(join(directory, 'seed-ledger.json'));
    await expect(seedDemoLedger(seededLedger)).resolves.toEqual({ seeded: true, count: 2 });
    const shipments = await seededLedger.getAllShipments();
    expect(shipments).toHaveLength(2);
    expect(shipments.find((shipment) => shipment.status === 'EXCEPTION')).toMatchObject({
      anomalyCount: 1,
      lastLocation: '苏州温控仓',
    });
    await expect(seedDemoLedger(seededLedger)).resolves.toEqual({ seeded: false, count: 2 });

    const reloaded = new DemoLedger(join(directory, 'seed-ledger.json'));
    await expect(reloaded.getAllShipments()).resolves.toHaveLength(2);
  });
});
