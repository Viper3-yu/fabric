import { useCallback, useEffect, useMemo, useState } from 'react';
import { Accordion, AccordionItem, Button, InlineNotification, Tag, Tile } from '@carbon/react';
import {
  ArrowLeft,
  CheckmarkFilled,
  DeliveryParcel,
  Location,
  Temperature,
  WarningAltFilled,
} from '@carbon/icons-react';
import type { Shipment, ShipmentHistoryEntry } from '@jixin/shared';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ActionDialog } from '../components/ActionDialog';
import { CopyButton } from '../components/CopyButton';
import { ErrorState, PageSkeleton } from '../components/PageState';
import { ShipmentTimeline } from '../components/ShipmentTimeline';
import { StatusTag } from '../components/StatusTag';
import { api, getErrorMessage } from '../lib/api';
import {
  ACTION_LABELS,
  formatDate,
  formatDateTime,
  getAvailableActions,
  getResponsibility,
  routeLabel,
  STATUS_LABELS,
} from '../lib/presentation';
import type { ShipmentAction, ShipmentReceipt, ShipmentRouteState } from '../types';

export function ShipmentDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const routeState = location.state as ShipmentRouteState | null;
  const [shipment, setShipment] = useState<Shipment | null>(routeState?.receipt?.data ?? null);
  const [history, setHistory] = useState<ShipmentHistoryEntry[]>([]);
  const [loading, setLoading] = useState(!routeState?.receipt);
  const [error, setError] = useState('');
  const [activeAction, setActiveAction] = useState<ShipmentAction | null>(null);
  const [latestReceipt, setLatestReceipt] = useState<ShipmentReceipt | null>(
    routeState?.receipt ?? null,
  );

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const [shipmentResult, historyResult] = await Promise.all([
        api.shipments.get(id),
        api.shipments.history(id),
      ]);
      setShipment(shipmentResult.data);
      setHistory(historyResult.data);
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const actions = useMemo(
    () => (shipment && user ? getAvailableActions(user.role, shipment.status) : []),
    [shipment, user],
  );

  const handleActionSuccess = (receipt: ShipmentReceipt) => {
    setShipment(receipt.data);
    setLatestReceipt(receipt);
    setActiveAction(null);
    void api.shipments.history(receipt.data.id).then(({ data }) => setHistory(data));
  };

  if (loading && !shipment) return <PageSkeleton rows={4} />;
  if (error && !shipment) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!shipment || !user) return null;

  const newestHistory = [...history].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  return (
    <div className="page shipment-detail-page">
      <header className="detail-header">
        <Button
          className="page-back-button"
          kind="ghost"
          size="sm"
          onClick={() => navigate('/app/shipments')}
        >
          <ArrowLeft size={16} aria-hidden="true" />
          <span>返回运单列表</span>
        </Button>
        <div className="detail-header__main">
          <div>
            <div className="detail-header__status">
              <StatusTag status={shipment.status} />
            </div>
            <h1 className="mono">{shipment.trackingNumber}</h1>
            <p>
              {routeLabel(shipment)}，{shipment.goods.name}
            </p>
          </div>
          {actions.length ? (
            <div className="detail-actions" aria-label="当前可执行动作">
              {actions.map((action, index) => (
                <Button
                  key={action}
                  kind={
                    action === 'cancel' || action === 'exception'
                      ? 'danger--tertiary'
                      : index
                        ? 'tertiary'
                        : 'primary'
                  }
                  onClick={() => setActiveAction(action)}
                >
                  {ACTION_LABELS[action]}
                </Button>
              ))}
            </div>
          ) : null}
        </div>
      </header>

      {latestReceipt ? (
        <InlineNotification
          className="receipt-notification"
          kind="success"
          lowContrast
          title="交易已提交"
          subtitle={`${latestReceipt.ledgerMode === 'fabric' ? 'Fabric 交易 ID' : '演示交易 ID'}：${latestReceipt.transactionId}`}
          hideCloseButton
        />
      ) : null}

      {routeState?.deliveryCode ? (
        <InlineNotification
          kind="warning"
          lowContrast
          hideCloseButton
          title={`请保存一次性签收码 ${routeState.deliveryCode}`}
          subtitle="该签收码不会再次返回，请通过安全渠道交给收货方。"
        />
      ) : null}

      {shipment.status === 'EXCEPTION' ? (
        <InlineNotification
          kind="error"
          lowContrast
          hideCloseButton
          title="当前运单处于异常状态"
          subtitle="异常证据已保留。承运方完成现场处置后可提交解除异常。"
        />
      ) : null}

      <section className="detail-route" aria-label="运单路线概览">
        <div>
          <span>始发地</span>
          <strong>{shipment.origin.city}</strong>
        </div>
        <div className="detail-route__line" aria-hidden="true">
          <i />
          <span />
          <i className="is-current" />
          <span />
          <i />
        </div>
        <div className="detail-route__current">
          <span>当前位置</span>
          <strong>{shipment.lastLocation}</strong>
        </div>
        <div>
          <span>目的地</span>
          <strong>{shipment.destination.city}</strong>
        </div>
      </section>

      <section className="detail-summary" aria-label="运单当前概览">
        <Tile>
          <span>当前责任</span>
          <strong>{getResponsibility(shipment)}</strong>
        </Tile>
        <Tile>
          <span>当前位置</span>
          <strong>{shipment.lastLocation}</strong>
        </Tile>
        <Tile>
          <span>预计送达</span>
          <strong>{formatDate(shipment.expectedDeliveryDate)}</strong>
        </Tile>
        <Tile>
          <span>异常记录</span>
          <strong className="mono">{shipment.anomalyCount}</strong>
        </Tile>
      </section>

      <div className="detail-layout">
        <div className="detail-primary">
          <section className="content-section">
            <div className="section-heading">
              <p className="eyebrow">链上事件</p>
              <h2>可信物流时间线</h2>
              <p>先查看物流事实，需要时展开提交身份、组织与交易凭据。</p>
            </div>
            {shipment.events.length ? (
              <ShipmentTimeline events={shipment.events} />
            ) : (
              <p>暂无事件记录。</p>
            )}
          </section>

          <section className="content-section">
            <div className="section-heading">
              <p className="eyebrow">世界状态历史</p>
              <h2>账本版本记录</h2>
              <p>用于核对当前状态与历史交易是否连续。</p>
            </div>
            <Accordion align="start">
              {newestHistory.map((entry, index) => (
                <AccordionItem
                  key={`${entry.txId}-${entry.timestamp}`}
                  title={`${entry.value ? STATUS_LABELS[entry.value.status] : '已删除'}，${formatDateTime(entry.timestamp)}`}
                  open={index === 0}
                >
                  <dl className="history-entry">
                    <div>
                      <dt>交易 ID</dt>
                      <dd className="hash-row">
                        <span className="mono hash-value">{entry.txId}</span>
                        <CopyButton value={entry.txId} label="复制历史交易 ID" />
                      </dd>
                    </div>
                    <div>
                      <dt>删除标记</dt>
                      <dd>{entry.isDelete ? '是' : '否'}</dd>
                    </div>
                    <div>
                      <dt>当时状态</dt>
                      <dd>{entry.value ? STATUS_LABELS[entry.value.status] : '无状态快照'}</dd>
                    </div>
                  </dl>
                </AccordionItem>
              ))}
            </Accordion>
          </section>
        </div>

        <aside className="detail-aside">
          <Tile className="detail-card">
            <div className="detail-card__heading">
              <DeliveryParcel size={22} aria-hidden="true" />
              <h2>货物信息</h2>
            </div>
            <dl className="detail-list">
              <div>
                <dt>名称</dt>
                <dd>{shipment.goods.name}</dd>
              </div>
              <div>
                <dt>类别</dt>
                <dd>{shipment.goods.category}</dd>
              </div>
              <div>
                <dt>数量</dt>
                <dd className="mono">{shipment.goods.quantity} 件</dd>
              </div>
              <div>
                <dt>重量</dt>
                <dd className="mono">{shipment.goods.weightKg} kg</dd>
              </div>
              {shipment.goods.description ? (
                <div>
                  <dt>说明</dt>
                  <dd>{shipment.goods.description}</dd>
                </div>
              ) : null}
            </dl>
          </Tile>

          <Tile className="detail-card">
            <div className="detail-card__heading">
              <Location size={22} aria-hidden="true" />
              <h2>收发信息</h2>
            </div>
            <div className="address-pair">
              <div>
                <span>发货地</span>
                <strong>
                  {shipment.origin.province}
                  {shipment.origin.city}
                  {shipment.origin.district}
                  {shipment.origin.detail}
                </strong>
                <p>
                  {shipment.origin.contactName}，{shipment.origin.contactPhoneMasked}
                </p>
              </div>
              <div>
                <span>收货地</span>
                <strong>
                  {shipment.destination.province}
                  {shipment.destination.city}
                  {shipment.destination.district}
                  {shipment.destination.detail}
                </strong>
                <p>{shipment.recipientMasked}</p>
              </div>
            </div>
          </Tile>

          {shipment.temperatureRange ? (
            <Tile className="detail-card">
              <div className="detail-card__heading">
                <Temperature size={22} aria-hidden="true" />
                <h2>温控约束</h2>
              </div>
              <strong className="temperature-reading mono">
                {shipment.temperatureRange.min} °C 至 {shipment.temperatureRange.max} °C
              </strong>
              <p>节点温度超出范围时，链码自动记录异常。</p>
            </Tile>
          ) : null}

          <Tile className="detail-card">
            <div className="detail-card__heading">
              {shipment.documentHash ? (
                <CheckmarkFilled size={22} aria-hidden="true" />
              ) : (
                <WarningAltFilled size={22} aria-hidden="true" />
              )}
              <h2>发货资料摘要</h2>
            </div>
            {shipment.documentHash ? (
              <div className="hash-row">
                <span className="mono hash-value">{shipment.documentHash}</span>
                <CopyButton value={shipment.documentHash} label="复制资料摘要" />
              </div>
            ) : (
              <p>此运单未提交发货资料摘要。</p>
            )}
          </Tile>
        </aside>
      </div>

      <ActionDialog
        shipment={shipment}
        action={activeAction}
        open={Boolean(activeAction)}
        onClose={() => setActiveAction(null)}
        onSuccess={handleActionSuccess}
      />
    </div>
  );
}
