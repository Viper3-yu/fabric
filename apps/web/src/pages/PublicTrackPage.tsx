import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, Form, InlineNotification, Search, Tile } from '@carbon/react';
import type { Shipment, ShipmentHistoryEntry } from '@jixin/shared';
import { Link, useSearchParams } from 'react-router-dom';
import { PublicHeader } from '../components/PublicHeader';
import { ShipmentTimeline } from '../components/ShipmentTimeline';
import { StatusTag } from '../components/StatusTag';
import { api, getErrorMessage } from '../lib/api';
import { formatDate, routeLabel } from '../lib/presentation';

export function PublicTrackPage() {
  const [params, setParams] = useSearchParams();
  const urlTracking = params.get('trackingNumber') ?? '';
  const [trackingNumber, setTrackingNumber] = useState(urlTracking);
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [history, setHistory] = useState<ShipmentHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const searchController = useRef<AbortController | null>(null);
  const lastSearched = useRef<string | null>(null);
  const runSearch = useCallback(async (normalized: string) => {
    searchController.current?.abort();
    const controller = new AbortController();
    searchController.current = controller;
    setLoading(true);
    setError('');
    setShipment(null);
    setHistory([]);
    try {
      const [result, versions] = await Promise.all([
        api.public.track(normalized, controller.signal),
        api.public.history(normalized, controller.signal),
      ]);
      if (controller.signal.aborted) return;
      setShipment(result.data);
      setHistory(versions.data);
    } catch (caught) {
      if (!controller.signal.aborted) setError(getErrorMessage(caught));
    } finally {
      if (!controller.signal.aborted) {
        lastSearched.current = normalized;
        setLoading(false);
      }
    }
  }, []);
  useEffect(() => {
    const normalized = urlTracking.trim().toUpperCase();
    if (!normalized) {
      searchController.current?.abort();
      lastSearched.current = null;
      setTrackingNumber('');
      setShipment(null);
      setHistory([]);
      setError('');
      setLoading(false);
      return;
    }
    if (normalized === lastSearched.current) return;
    setTrackingNumber(normalized);
    void runSearch(normalized);
  }, [urlTracking, runSearch]);
  useEffect(() => () => searchController.current?.abort(), []);
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const normalized = trackingNumber.trim().toUpperCase();
    if (!normalized || loading) return;
    if (normalized === urlTracking) void runSearch(normalized);
    else setParams({ trackingNumber: normalized });
  };
  return (
    <div className="public-page business-track">
      <PublicHeader />
      <main id="main-content">
        <section className="tracking-search-panel" aria-labelledby="track-title">
          <h1 id="track-title">物流查询</h1>
          <p>查询运单状态、运输节点及签收记录。</p>
          <Form className="public-search" onSubmit={handleSubmit}>
            <Search
              id="public-tracking-number"
              labelText="物流运单号"
              placeholder="请输入运单号"
              value={trackingNumber}
              onChange={(event) => setTrackingNumber(event.currentTarget.value)}
              closeButtonLabelText="清除搜索"
              size="lg"
            />
            <Button type="submit" disabled={loading || !trackingNumber.trim()}>
              {loading ? '正在查询' : '查询物流'}
            </Button>
          </Form>
          <div className="demo-queries" aria-label="演示运单快捷查询">
            <span>演示运单</span>
            <div>
              <Link to="/track?trackingNumber=JXSEED0001">正常签收</Link>
              <Link to="/track?trackingNumber=JXSEED0002">异常处理</Link>
              <Link to="/track?trackingNumber=JXSEED0004">运输途中</Link>
              <Link to="/track?trackingNumber=JXSEED0006">温控异常</Link>
            </div>
            <small>虚构业务样例，结果来自本机 Fabric 账本。</small>
          </div>
          {error && (
            <InlineNotification
              kind="error"
              lowContrast
              hideCloseButton
              title="查询失败"
              subtitle={error}
            />
          )}
        </section>
        {loading && <p role="status">正在读取运单记录…</p>}
        {shipment && (
          <section className="public-result" aria-label="查询结果" aria-live="polite">
            <header className="public-result__header">
              <div>
                <span className="num">{shipment.trackingNumber}</span>
                <h2>{routeLabel(shipment)}</h2>
                <p>
                  {shipment.goods.name}，预计 {formatDate(shipment.expectedDeliveryDate)} 送达
                </p>
              </div>
              <StatusTag status={shipment.status} />
            </header>
            <div className="public-summary-grid">
              <Tile>
                <span>最近位置</span>
                <strong>{shipment.lastLocation}</strong>
              </Tile>
              <Tile>
                <span>承运方</span>
                <strong>{shipment.carrierName ?? '待接单'}</strong>
              </Tile>
              <Tile>
                <span>收货信息</span>
                <strong>{shipment.recipientMasked}</strong>
              </Tile>
              <Tile>
                <span>历史版本</span>
                <strong>{history.length}</strong>
              </Tile>
            </div>
            <section className="public-timeline">
              <h2>运输事件</h2>
              <ShipmentTimeline events={shipment.events} />
            </section>
            <Button
              as={Link}
              to={`/verify?trackingNumber=${encodeURIComponent(shipment.trackingNumber)}`}
              kind="tertiary"
            >
              核验链上记录
            </Button>
          </section>
        )}
        <details className="tracking-help">
          <summary>查询范围与隐私说明</summary>
          <h3>每次变化都按顺序保存</h3>
          <p>业务事件记录包含操作时间、组织和交易编号。</p>
          <h3>联系人只显示必要信息</h3>
          <p>公开页面不会显示完整手机号和个人身份，查物流不等于暴露收发货人的隐私。</p>
          <h3>只保存文件核对编号</h3>
          <p>原始附件由业务方保管，系统以摘要进行一致性核对。</p>
        </details>
      </main>
      <footer className="public-footer">
        <span>迹信物流管理系统</span>
        <Link to="/login">业务登录</Link>
      </footer>
    </div>
  );
}
