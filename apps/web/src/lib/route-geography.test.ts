import type { Shipment } from '@jixin/shared';
import { describe, expect, it } from 'vitest';
import { buildShipmentRoute, routeLineDistanceKm } from './route-geography';

const shipment: Shipment = {
  docType: 'shipment',
  id: 'shipment-1',
  trackingNumber: 'JX20260728001234',
  status: 'IN_TRANSIT',
  shipperId: 'shipper-1',
  shipperName: '华东医供',
  carrierId: 'carrier-1',
  carrierName: '宁沪冷运',
  origin: {
    province: '上海市',
    city: '上海市',
    district: '浦东新区',
    detail: '张江路 88 号',
    contactName: '周**',
    contactPhoneMasked: '138****8000',
  },
  destination: {
    province: '江苏省',
    city: '南京市',
    district: '江宁区',
    detail: '秣周东路 12 号',
    contactName: '王**',
    contactPhoneMasked: '139****9000',
  },
  goods: { name: '医用耗材', category: '医疗物资', quantity: 24, weightKg: 186.5 },
  recipientMasked: '王** · 139****9000',
  expectedDeliveryDate: '2026-08-06',
  deliveryCodeHash: 'hash',
  events: [
    {
      sequence: 0,
      type: 'CREATED',
      location: '上海市 · 张江路 88 号',
      description: '运单已创建',
      actorId: 'shipper-1',
      actorName: '华东医供',
      mspId: 'Org1MSP',
      txId: 'tx-1',
      timestamp: '2026-07-28T01:00:00.000Z',
    },
    {
      sequence: 1,
      type: 'CHECKPOINT',
      location: '昆山中转中心',
      description: '完成干线中转',
      actorId: 'carrier-1',
      actorName: '宁沪冷运',
      mspId: 'Org2MSP',
      txId: 'tx-2',
      timestamp: '2026-07-28T04:00:00.000Z',
    },
  ],
  anomalyCount: 0,
  lastLocation: '昆山中转中心',
  createdAt: '2026-07-28T01:00:00.000Z',
  updatedAt: '2026-07-28T04:00:00.000Z',
};

describe('shipment route geography', () => {
  it('uses only address and ledger-recorded locations as map points', () => {
    const points = buildShipmentRoute(shipment);

    expect(points.map((point) => point.title)).toEqual(['上海市', '昆山中转中心', '南京市']);
    expect(points.map((point) => point.kind)).toEqual(['origin', 'current', 'destination']);
  });

  it('reports geographic line distance rather than invented road mileage', () => {
    const distance = routeLineDistanceKm(buildShipmentRoute(shipment));

    expect(distance).toBeGreaterThan(250);
    expect(distance).toBeLessThan(450);
  });
});
