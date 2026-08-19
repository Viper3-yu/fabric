import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Shipment } from '@jixin/shared';
import { api } from '../lib/api';
import { PublicTrackPage } from './PublicTrackPage';

vi.mock('../lib/api', () => ({
  api: {
    public: {
      track: vi.fn(),
      history: vi.fn(),
    },
  },
  getErrorMessage: (error: Error) => error.message,
}));

const shipment: Shipment = {
  docType: 'shipment',
  id: 'shipment-1',
  trackingNumber: 'JX202607200001',
  status: 'IN_TRANSIT',
  shipperId: 'shipper-1',
  shipperName: '华南发货中心',
  carrierId: 'carrier-1',
  carrierName: '华东承运中心',
  origin: {
    province: '广东省',
    city: '广州',
    detail: '白云物流园',
    contactName: '陈先生',
    contactPhoneMasked: '138****1024',
  },
  destination: {
    province: '上海市',
    city: '上海',
    detail: '浦东新区',
    contactName: '周女士',
    contactPhoneMasked: '139****2068',
  },
  goods: { name: '医用冷藏箱', category: '医疗物资', quantity: 4, weightKg: 18.6 },
  recipientMasked: '周女士，139****2068',
  expectedDeliveryDate: '2026-07-23',
  temperatureRange: { min: 2, max: 8, unit: 'C' },
  deliveryCodeHash: 'a'.repeat(64),
  events: [
    {
      sequence: 1,
      type: 'CREATED',
      location: '广州白云物流园',
      description: '发货方创建运单',
      actorId: 'shipper-1',
      actorName: '华南发货中心',
      mspId: 'Org1MSP',
      txId: 'tx-demo-001',
      timestamp: '2026-07-20T08:30:00.000Z',
    },
  ],
  anomalyCount: 0,
  lastLocation: '杭州中转站',
  createdAt: '2026-07-20T08:30:00.000Z',
  updatedAt: '2026-07-20T12:00:00.000Z',
};

describe('公开物流查询', () => {
  beforeEach(() => {
    vi.mocked(api.public.track).mockResolvedValue({
      data: shipment,
      meta: { ledgerMode: 'fabric' },
    });
    vi.mocked(api.public.history).mockResolvedValue({
      data: [],
      meta: { ledgerMode: 'fabric' },
    });
  });

  it('查询后显示脱敏轨迹和链上记录标识', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/track']}>
        <PublicTrackPage />
      </MemoryRouter>,
    );

    await user.type(screen.getByRole('searchbox', { name: '物流运单号' }), 'JX202607200001');
    await user.click(screen.getByRole('button', { name: '查询物流' }));

    expect(await screen.findByText('广州 至 上海')).toBeInTheDocument();
    expect(screen.getByText('周女士，139****2068')).toBeInTheDocument();
    expect(screen.getByText('tx-demo-001')).toBeInTheDocument();
  });

  it('直接说明公开、脱敏与内部原件边界', () => {
    render(
      <MemoryRouter initialEntries={['/track']}>
        <PublicTrackPage />
      </MemoryRouter>,
    );

    expect(screen.getByText('每次变化都按顺序保存')).toBeInTheDocument();
    expect(screen.getByText('联系人只显示必要信息')).toBeInTheDocument();
    expect(screen.getByText('只保存文件核对编号')).toBeInTheDocument();
    expect(
      screen.getByText('公开页面不会显示完整手机号和个人身份，查物流不等于暴露收发货人的隐私。'),
    ).toBeInTheDocument();
  });
});
