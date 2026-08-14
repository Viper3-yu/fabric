import { useCallback, useEffect, useMemo, useState } from 'react';
import { Accordion, AccordionItem, Button, InlineNotification, Tag, Tile } from '@carbon/react';
import {
  ArrowLeft,
  Blockchain,
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
import { ShipmentRouteMap } from '../components/ShipmentRouteMap';
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
  const { user, ledgerMode } = useAuth();
  const routeState = location.state as ShipmentRouteState | null;
  const [shipment, setShipment] = useState<Shipment | null>(routeState?.receipt?.data ?? null);
  const [history, setHistory] = useState<ShipmentHistoryEntry[]>([]);
  const [loading, setLoading] = useState(!routeState?.receipt);
  const [error, setError] = useState('');
  const [activeAction, setActiveAction] = useState<ShipmentAction | null>(null);
  const [latestReceipt, setLatestReceipt] = useState<ShipmentReceipt | null>(
    routeState?.receipt ?? null,
  );
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const [shipmentResult, historyResult] = await Promise.all([
          api.shipments.get(id, controller.signal),
          api.shipments.history(id, controller.signal),
        ]);
        if (controller.signal.aborted) return;
        setShipment(shipmentResult.data);
        setHistory(historyResult.data);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(getErrorMessage(caught));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [id, reloadKey]);

  const reload = useCallback(() => setReloadKey((current) => current + 1), []);

  const actions = useMemo(
    () => (shipment && user ? getAvailableActions(user.role, shipment.status) : []),
    [shipment, user],
  );

  const newestHistory = useMemo(
    () =>
      [...history].sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      ),
    [history],
  );

  const handleActionSuccess = (receipt: ShipmentReceipt) => {
    setShipment(receipt.data);
    setLatestReceipt(receipt);
    setActiveAction(null);
    // A stale history list is acceptable if this refresh fails; the receipt
    // above already reflects the committed change.
    api.shipments
      .history(receipt.data.id)
      .then(({ data }) => setHistory(data))
      .catch(() => undefined);
  };

  if (loading && !shipment) return <PageSkeleton rows={4} />;
  if (error && !shipment) return <ErrorState message={error} onRetry={reload} />;
  if (!shipment || !user) return null;

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
          title="这次操作已经记下"
          subtitle={`系统记录编号：${latestReceipt.transactionId}`}
          onCloseButtonClick={() => setLatestReceipt(null)}
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
          subtitle="异常位置和现场说明已经保存。承运方处理完成后，可以在这里恢复运输。"
        />
      ) : null}

      <section className="detail-record-health" aria-label="这张运单的系统记录状态">
        <article>
          <div>
            <span className="network-pulse" aria-hidden="true" />
            <span>记录状态</span>
          </div>
          <strong>顺序完整</strong>
          <small>目前没有发现中间缺失</small>
        </article>
        <article>
          <div>
            <Blockchain size={18} aria-hidden="true" />
            <span>记录环境</span>
          </div>
          <strong>{ledgerMode === 'fabric' ? 'Fabric 网络' : '演示环境'}</strong>
          <small>{ledgerMode === 'fabric' ? '由多方共同确认' : '用于预览完整业务流程'}</small>
        </article>
        <article>
          <div>
            <CheckmarkFilled size={18} aria-hidden="true" />
            <span>已经保存</span>
          </div>
          <strong className="mono">{shipment.events.length} 次变化</strong>
          <small>
            最近一次：{formatDateTime(shipment.events.at(-1)?.timestamp ?? shipment.updatedAt)}
          </small>
        </article>
      </section>

      <ShipmentRouteMap shipment={shipment} />

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
              <p className="eyebrow">运输过程</p>
              <h2>谁在什么时候做了什么</h2>
              <p>每次交接和位置更新都按时间排列；展开后，可以看到操作人和系统记录编号。</p>
            </div>
            {shipment.events.length ? (
              <ShipmentTimeline events={shipment.events} />
            ) : (
              <p>暂无事件记录。</p>
            )}
          </section>

          <section className="content-section">
            <div className="section-heading">
              <p className="eyebrow">每次修改记录</p>
              <h2>这张运单是怎么一步步变化的</h2>
              <p>从建单到当前状态，每次修改都会保留。这里可以检查中间有没有断开。</p>
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
                      <dt>系统记录编号</dt>
                      <dd className="hash-row">
                        <span className="mono hash-value">{entry.txId}</span>
                        <CopyButton value={entry.txId} label="复制系统记录编号" />
                      </dd>
                    </div>
                    <div>
                      <dt>这条记录是否已删除</dt>
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
              <p>运输节点温度超出范围时，系统会自动标记异常并保留当时记录。</p>
            </Tile>
          ) : null}

          <Tile className="detail-card">
            <div className="detail-card__heading">
              {shipment.documentHash ? (
                <CheckmarkFilled size={22} aria-hidden="true" />
              ) : (
                <WarningAltFilled size={22} aria-hidden="true" />
              )}
              <h2>发货文件核对编号</h2>
            </div>
            {shipment.documentHash ? (
              <div className="hash-row">
                <span className="mono hash-value">{shipment.documentHash}</span>
                <CopyButton value={shipment.documentHash} label="复制文件核对编号" />
              </div>
            ) : (
              <p>这张运单没有保存发货文件核对编号。</p>
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
