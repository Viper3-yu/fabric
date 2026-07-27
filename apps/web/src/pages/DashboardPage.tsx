import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
} from '@carbon/react';
import { Add, ArrowRight, DeliveryParcel, Blockchain, WarningAltFilled } from '@carbon/icons-react';
import type { DashboardSummary, Shipment } from '@jixin/shared';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { LedgerBanner } from '../components/LedgerBanner';
import { EmptyState, ErrorState, PageSkeleton } from '../components/PageState';
import { ShipmentProgress } from '../components/ShipmentProgress';
import { StatusTag } from '../components/StatusTag';
import { api, getErrorMessage } from '../lib/api';
import {
  ACTION_LABELS,
  formatDateTime,
  getAvailableActions,
  ROLE_LABELS,
  routeLabel,
} from '../lib/presentation';
import type { NetworkInfo } from '../types';
import { useCinematicMotion } from '../lib/motion';

function RecentShipments({ shipments }: { shipments: Shipment[] }) {
  const navigate = useNavigate();

  if (!shipments.length) {
    return <EmptyState title="还没有运单" description="创建第一张运单后，最近动态会显示在这里。" />;
  }

  return (
    <>
      <div className="recent-shipments-mobile" aria-label="最近运单">
        {shipments.map((shipment) => (
          <article key={shipment.id}>
            <div>
              <span className="mono">{shipment.trackingNumber}</span>
              <StatusTag status={shipment.status} />
            </div>
            <h3>{routeLabel(shipment)}</h3>
            <p>{formatDateTime(shipment.updatedAt)} 更新</p>
            <Button
              kind="ghost"
              size="sm"
              renderIcon={ArrowRight}
              onClick={() => navigate(`/app/shipments/${shipment.id}`)}
            >
              查看详情
            </Button>
          </article>
        ))}
      </div>
      <TableContainer
        className="recent-shipments"
        title="最近运单"
        description="按最近更新时间排列"
      >
        <Table size="lg" useZebraStyles={false}>
          <TableHead>
            <TableRow>
              <TableHeader>运单号</TableHeader>
              <TableHeader>运输路线</TableHeader>
              <TableHeader>状态</TableHeader>
              <TableHeader>最近更新</TableHeader>
              <TableHeader aria-label="查看详情" />
            </TableRow>
          </TableHead>
          <TableBody>
            {shipments.map((shipment) => (
              <TableRow key={shipment.id}>
                <TableCell className="mono">{shipment.trackingNumber}</TableCell>
                <TableCell>{routeLabel(shipment)}</TableCell>
                <TableCell>
                  <StatusTag status={shipment.status} />
                </TableCell>
                <TableCell>{formatDateTime(shipment.updatedAt)}</TableCell>
                <TableCell>
                  <Button
                    kind="ghost"
                    size="sm"
                    renderIcon={ArrowRight}
                    onClick={() => navigate(`/app/shipments/${shipment.id}`)}
                  >
                    查看
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </>
  );
}

export function DashboardPage() {
  const pageRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { user, ledgerMode } = useAuth();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [network, setNetwork] = useState<NetworkInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useCinematicMotion(pageRef, [loading, summary?.total]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [summaryResult, networkResult] = await Promise.all([
        api.dashboard.summary(),
        api.network.info().catch(() => null),
      ]);
      setSummary(summaryResult.data);
      setNetwork(networkResult?.data ?? null);
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pending = useMemo(() => {
    if (!summary || !user) return [];
    return summary.recent.flatMap((shipment) =>
      getAvailableActions(user.role, shipment.status).map((action) => ({ shipment, action })),
    );
  }, [summary, user]);

  if (loading) return <PageSkeleton rows={5} />;
  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!summary || !user || !ledgerMode) return null;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? '上午好' : hour < 18 ? '下午好' : '晚上好';

  const statusBreakdown = [
    { label: '运输中', value: summary.inTransit, tone: 'teal' },
    { label: '等待签收', value: summary.pendingReceipt, tone: 'lime' },
    {
      label: '异常待处理',
      value: summary.exceptions,
      tone: 'red',
    },
    { label: '已完成', value: summary.completed, tone: 'slate' },
  ];

  const percent = (value: number) =>
    summary.total ? Math.round((value / summary.total) * 100) : 0;
  const activeShipment =
    summary.recent.find(
      (shipment) => shipment.status !== 'RECEIVED' && shipment.status !== 'CANCELLED',
    ) ??
    summary.recent[0] ??
    null;

  return (
    <div className="page dashboard-page" ref={pageRef}>
      <header className="dashboard-hero" data-motion="hero">
        <div className="dashboard-hero__copy" data-reveal>
          <p className="eyebrow">{ROLE_LABELS[user.role]} · 今日运输概览</p>
          <h1>
            <span>{greeting}</span>
            <span>{user.displayName}</span>
          </h1>
          <p>从这里看清每张运单走到哪一步、接下来该做什么，以及系统有没有正常保存记录。</p>
        </div>
        <div className="dashboard-hero__visual" data-reveal>
          <ShipmentProgress shipment={activeShipment} compact />
        </div>
        <div className="dashboard-hero__action" data-reveal>
          {user.role === 'shipper' ? (
            <Button renderIcon={Add} onClick={() => navigate('/app/shipments/new')}>
              创建运单
            </Button>
          ) : (
            <Button renderIcon={ArrowRight} onClick={() => navigate('/app/shipments')}>
              查看全部运单
            </Button>
          )}
        </div>
      </header>

      <section className="dashboard-kpis" aria-label="关键运单指标">
        <article>
          <span>全部运单</span>
          <strong className="mono">{summary.total}</strong>
        </article>
        <article>
          <span>运输中</span>
          <strong className="mono">{summary.inTransit}</strong>
        </article>
        <article data-tone="danger">
          <span>异常待处理</span>
          <strong className="mono">{summary.exceptions}</strong>
        </article>
        <article>
          <span>等待签收</span>
          <strong className="mono">{summary.pendingReceipt}</strong>
        </article>
      </section>

      <section
        className={`dashboard-bento ${pending.length ? 'has-attention' : ''}`}
        aria-label="运单概览"
        data-motion="bento"
      >
        <article className="bento-card bento-card--overview" data-bento-card>
          <div className="bento-card__heading">
            <div>
              <span>全部运单</span>
              <strong className="mono">{summary.total}</strong>
            </div>
            <DeliveryParcel size={28} aria-hidden="true" />
          </div>
          <div className="status-distribution" aria-label="运单状态分布">
            {statusBreakdown.map((item) => (
              <div className="status-distribution__row" key={item.label}>
                <div>
                  <span>{item.label}</span>
                  <strong className="mono">{item.value}</strong>
                </div>
                <div className="status-distribution__track" aria-hidden="true">
                  <span
                    className={`tone-${item.tone}`}
                    style={{ width: `${Math.max(item.value ? 8 : 0, percent(item.value))}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <button
            className="bento-card__link"
            type="button"
            onClick={() => navigate('/app/shipments')}
          >
            查看完整运单列表
            <ArrowRight size={18} aria-hidden="true" />
          </button>
        </article>

        {pending.length ? (
          <article className="bento-card bento-card--attention has-alert" data-bento-card>
            <div className="bento-card__heading bento-card__heading--compact">
              <div>
                <span>需要推进</span>
                <h2>我的待处理</h2>
              </div>
              <WarningAltFilled size={24} aria-hidden="true" />
            </div>
            <Tag type="red">{pending.length} 项</Tag>
            <div className="attention-panel__body">
              <ul className="attention-list">
                {pending.slice(0, 3).map(({ shipment, action }) => (
                  <li key={`${shipment.id}-${action}`}>
                    <button type="button" onClick={() => navigate(`/app/shipments/${shipment.id}`)}>
                      <span>{ACTION_LABELS[action]}</span>
                      <strong className="mono">{shipment.trackingNumber}</strong>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </article>
        ) : null}

        <article className="bento-card bento-card--network" data-bento-card>
          <div className="bento-card__heading bento-card__heading--compact">
            <div>
              <span>关键操作会自动保存</span>
              <h2>记录服务在线</h2>
            </div>
            <Blockchain size={24} aria-hidden="true" />
          </div>
          <div className="network-panel__status">
            <span className="network-pulse" aria-hidden="true" />
            <strong>{ledgerMode === 'fabric' ? 'Fabric 协作网络' : '本地演示环境'}</strong>
          </div>
          <p>
            {ledgerMode === 'fabric'
              ? '建单、交接和签收都会由多个协作方共同确认并保存。'
              : '完整流程可以体验，但当前记录只保存在本地演示环境中。'}
          </p>
          <div className="network-record-feed" aria-label="系统记录服务状态">
            <div>
              <span>连接状态</span>
              <strong>{network?.health.status === 'degraded' ? '需要检查' : '正常'}</strong>
            </div>
            <div>
              <span>记录方式</span>
              <strong>{ledgerMode === 'fabric' ? '多方共同确认' : '本地演示保存'}</strong>
            </div>
            <div>
              <span>最近检查</span>
              <strong>刚刚</strong>
            </div>
          </div>
          <LedgerBanner mode={ledgerMode} compact />
        </article>
      </section>

      <section className="dashboard-recent">
        <div className="dashboard-recent__heading">
          <div>
            <p className="eyebrow">刚刚发生</p>
            <h2>最近更新的运单</h2>
          </div>
          <Button kind="ghost" renderIcon={ArrowRight} onClick={() => navigate('/app/shipments')}>
            查看全部
          </Button>
        </div>
        <RecentShipments shipments={summary.recent} />
      </section>
    </div>
  );
}
