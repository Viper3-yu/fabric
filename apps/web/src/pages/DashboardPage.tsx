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
import {
  Add,
  ArrowRight,
  CheckmarkFilled,
  DeliveryParcel,
  Blockchain,
  WarningAltFilled,
} from '@carbon/icons-react';
import type { DashboardSummary, Shipment } from '@jixin/shared';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { LedgerBanner } from '../components/LedgerBanner';
import { EmptyState, ErrorState, PageSkeleton } from '../components/PageState';
import { RouteScene } from '../components/RouteScene';
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

  return (
    <div className="page dashboard-page" ref={pageRef}>
      <header className="dashboard-hero" data-motion="hero">
        <div className="dashboard-hero__copy" data-reveal>
          <p className="eyebrow">{ROLE_LABELS[user.role]}工作台</p>
          <h1>
            {greeting}，{user.displayName}
          </h1>
          <p>从一处掌握运输进度、待处理动作与可信账本状态。</p>
        </div>
        <div className="dashboard-hero__visual" data-reveal>
          <RouteScene compact />
          <span>今日责任链</span>
          <strong>{summary.total} 张活跃运单</strong>
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

      <section className="dashboard-bento" aria-label="运单概览" data-motion="bento">
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

        <article
          className={`bento-card bento-card--attention ${pending.length ? 'has-alert' : ''}`}
          data-bento-card
        >
          <div className="bento-card__heading bento-card__heading--compact">
            <div>
              <span>需要推进</span>
              <h2>我的待处理</h2>
            </div>
            {pending.length ? (
              <WarningAltFilled size={24} aria-hidden="true" />
            ) : (
              <CheckmarkFilled size={24} aria-hidden="true" />
            )}
          </div>
          <Tag type={pending.length ? 'red' : 'green'}>{pending.length} 项</Tag>
          <div className="attention-panel__body">
            {pending.length ? (
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
            ) : (
              <div className="compact-empty">
                <CheckmarkFilled size={24} aria-hidden="true" />
                <p>当前没有需要你处理的运单。</p>
              </div>
            )}
          </div>
        </article>

        <article className="bento-card bento-card--network" data-bento-card>
          <div className="bento-card__heading bento-card__heading--compact">
            <div>
              <span>可信基础设施</span>
              <h2>账本连接</h2>
            </div>
            <Blockchain size={24} aria-hidden="true" />
          </div>
          <div className="network-panel__status">
            <span className="network-pulse" aria-hidden="true" />
            <strong>
              {network?.label ?? (ledgerMode === 'fabric' ? 'Hyperledger Fabric' : '本地演示账本')}
            </strong>
          </div>
          <p>
            {network?.health.details ??
              (ledgerMode === 'fabric'
                ? '业务写操作通过 Fabric Gateway 提交。'
                : '用于功能预览，不构成真实上链证明。')}
          </p>
          <LedgerBanner mode={ledgerMode} compact />
        </article>
      </section>

      <section className="dashboard-recent">
        <div className="dashboard-recent__heading">
          <div>
            <p className="eyebrow">实时业务动态</p>
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
