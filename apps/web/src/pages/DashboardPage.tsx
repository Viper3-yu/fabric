import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@carbon/react';
import { Add, ArrowRight, DeliveryParcel, Blockchain, WarningAltFilled } from '@carbon/icons-react';
import type { DashboardSummary, Shipment } from '@jixin/shared';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { EmptyState, ErrorState, PageSkeleton } from '../components/PageState';
import { RecordStrip } from '../components/RecordStrip';
import { ShipmentProgress } from '../components/ShipmentProgress';
import { StatusTag } from '../components/StatusTag';
import { api, getErrorMessage } from '../lib/api';
import {
  ACTION_LABELS,
  formatDateTime,
  getAvailableActions,
  routeLabel,
} from '../lib/presentation';
import type { NetworkInfo } from '../types';

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
              <span className="num">{shipment.trackingNumber}</span>
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
                <TableCell className="num">{shipment.trackingNumber}</TableCell>
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
  const navigate = useNavigate();
  const { user, ledgerMode } = useAuth();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [network, setNetwork] = useState<NetworkInfo | null>(null);
  const [checkedAt, setCheckedAt] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
      setCheckedAt(networkResult ? new Date().toISOString() : '');
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
    { label: '运输中', value: summary.inTransit },
    { label: '等待签收', value: summary.pendingReceipt },
    { label: '异常待处理', value: summary.exceptions },
    { label: '已完成', value: summary.completed },
  ];
  const activeShipment =
    summary.recent.find(
      (shipment) => shipment.status !== 'RECEIVED' && shipment.status !== 'CANCELLED',
    ) ??
    summary.recent[0] ??
    null;

  return (
    <div className="page dashboard-page">
      <header className="page-header page-header--with-action dashboard-header">
        <div>
          <h1>工作台</h1>
          <p>
            {greeting}，{user.displayName}。查看当前运输进度、待处理事项和记录服务状态。
          </p>
        </div>
        <div className="dashboard-header__action">
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

      <section className="dashboard-focus" aria-label="当前运输焦点">
        <div className="dashboard-focus__heading">
          <span>当前运输焦点</span>
          {activeShipment ? (
            <>
              <strong>
                {activeShipment.origin.city} → {activeShipment.destination.city}
              </strong>
              <button
                className="dashboard-focus__link"
                type="button"
                onClick={() => navigate(`/app/shipments/${activeShipment.id}`)}
              >
                查看路线地图
                <ArrowRight size={17} aria-hidden="true" />
              </button>
            </>
          ) : (
            <strong>暂无活动运单</strong>
          )}
        </div>
        <ShipmentProgress shipment={activeShipment} compact />
        {activeShipment && activeShipment.events.length > 0 ? (
          <RecordStrip event={activeShipment.events[activeShipment.events.length - 1]!} compact />
        ) : null}
      </section>

      <section className="dashboard-kpis" aria-label="关键运单指标">
        <article>
          <span>全部运单</span>
          <strong className="num">{summary.total}</strong>
        </article>
        <article>
          <span>运输中</span>
          <strong className="num">{summary.inTransit}</strong>
        </article>
        <article data-tone="danger">
          <span>异常待处理</span>
          <strong className="num">{summary.exceptions}</strong>
        </article>
        <article>
          <span>等待签收</span>
          <strong className="num">{summary.pendingReceipt}</strong>
        </article>
      </section>

      <section
        className={`dashboard-operations-grid ${pending.length ? 'has-attention' : ''}`}
        aria-label="运单概览"
      >
        <article className="operations-panel operations-panel--overview">
          <div className="operations-panel__heading">
            <div>
              <span>状态分布</span>
              <h2>运单概览</h2>
            </div>
            <DeliveryParcel size={28} aria-hidden="true" />
          </div>
          <dl className="operations-status-list" aria-label="运单状态分布">
            {statusBreakdown.map((item) => (
              <div key={item.label}>
                <dt>{item.label}</dt>
                <dd className="num">{item.value}</dd>
              </div>
            ))}
          </dl>
          <button
            className="operations-panel__link"
            type="button"
            onClick={() => navigate('/app/shipments')}
          >
            查看完整运单列表
            <ArrowRight size={18} aria-hidden="true" />
          </button>
        </article>

        {pending.length ? (
          <article className="operations-panel operations-panel--attention">
            <div className="operations-panel__heading">
              <div>
                <span>需要推进</span>
                <h2>我的待处理</h2>
              </div>
              <WarningAltFilled size={24} aria-hidden="true" />
            </div>
            <span className="attention-count">{pending.length} 项</span>
            <div className="attention-panel__body">
              <ul className="attention-list">
                {pending.slice(0, 3).map(({ shipment, action }) => (
                  <li key={`${shipment.id}-${action}`}>
                    <button type="button" onClick={() => navigate(`/app/shipments/${shipment.id}`)}>
                      <span>{ACTION_LABELS[action]}</span>
                      <strong className="num">{shipment.trackingNumber}</strong>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </article>
        ) : null}
      </section>

      <section
        className={`dashboard-network-strip ${
          network?.health.status === 'degraded' ? 'is-degraded' : ''
        }`}
        aria-label="系统记录服务状态"
      >
        <div className="dashboard-network-strip__identity">
          <Blockchain size={22} aria-hidden="true" />
          <div>
            <span>记录服务</span>
            <strong>Fabric 协作网络</strong>
          </div>
        </div>
        <p>建单、交接和签收由多个协作方共同确认并保存。</p>
        <dl className="dashboard-network-strip__facts">
          <div>
            <dt>连接</dt>
            <dd>{network?.health.status === 'degraded' ? '需要检查' : '正常'}</dd>
          </div>
          <div>
            <dt>记录方式</dt>
            <dd>多方确认</dd>
          </div>
          <div>
            <dt>检查时间</dt>
            <dd>{checkedAt ? formatDateTime(checkedAt) : '—'}</dd>
          </div>
        </dl>
      </section>

      <section className="dashboard-recent">
        <div className="dashboard-recent__heading">
          <div>
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
