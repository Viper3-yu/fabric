import { useState, type FormEvent } from 'react';
import { Button, Tag, TextInput } from '@carbon/react';
import { Renew } from '@carbon/icons-react';
import { ControlTowerMap } from '../components/ControlTowerMap';
import { type ControlTowerData } from '../lib/control-tower-api';
import { useControlTower } from '../lib/use-control-tower';
import { CopyButton } from '../components/CopyButton';
import { readIntegrationSettings } from '../lib/integration-settings';

const EVENT_LABELS: Record<string, string> = {
  CREATED: '创建运单',
  ACCEPTED: '承运接单',
  PARCEL_ADDED: '添加包裹',
  PACKED: '装入物流单元',
  UNPACKED: '拆分物流单元',
  HANDOVER_INITIATED: '发起交接',
  HANDOVER_CONFIRMED: '确认交接',
  IN_TRANSIT: '干线运输',
  ARRIVED_HUB: '到达网点',
  EXCEPTION: '运输异常',
  EXCEPTION_RESOLVED: '异常解除',
};
const LABELS: Record<string, string> = {
  ON_CHAIN: '已登记',
  IN_TRANSIT: '运输中',
  CREATED: '已创建',
  ACCEPTED: '已接单',
  DELIVERED: '已送达',
  PACKED: '已装箱',
  UNPACKED: '已拆箱',
  OPEN: '待核查',
  RESOLVED: '已解除',
  HIGH: '高风险',
  MEDIUM: '需关注',
  LOW: '提示',
};

function TemperatureChart({ data }: { data: ControlTowerData }) {
  if (!data.temperature.length) return <p className="tower-empty">暂无温湿度数据</p>;
  const width = 620;
  const height = 170;
  const values = data.temperature.map((point) => point.value);
  const low = Math.min(data.temperatureRange.min - 1, ...values);
  const high = Math.max(data.temperatureRange.max + 1, ...values);
  const x = (index: number) => 28 + (index * (width - 56)) / Math.max(1, values.length - 1);
  const y = (value: number) => 16 + ((high - value) * (height - 44)) / Math.max(1, high - low);
  const polyline = values.map((value, index) => `${x(index)},${y(value)}`).join(' ');
  return (
    <div className="temperature-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="运输温度曲线">
        <rect
          x="28"
          y={y(data.temperatureRange.max)}
          width={width - 56}
          height={y(data.temperatureRange.min) - y(data.temperatureRange.max)}
          fill="#defbe6"
        />
        <line
          x1="28"
          x2={width - 28}
          y1={y(data.temperatureRange.max)}
          y2={y(data.temperatureRange.max)}
          stroke="#8a3ffc"
          strokeDasharray="5 5"
        />
        <polyline points={polyline} fill="none" stroke="#0f62fe" strokeWidth="3" />
        {values.map((value, index) => (
          <circle
            key={`${index}-${value}`}
            cx={x(index)}
            cy={y(value)}
            r="4"
            fill={
              value > data.temperatureRange.max || value < data.temperatureRange.min
                ? '#da1e28'
                : '#198038'
            }
          />
        ))}
      </svg>
      <div>
        <span>
          允许范围 {data.temperatureRange.min}–{data.temperatureRange.max}℃
        </span>
        <strong>
          最近读数 {values.at(-1)}℃ · 湿度 {data.temperature.at(-1)?.humidity}%
        </strong>
      </div>
    </div>
  );
}

export function ControlTowerPage() {
  const [settings] = useState(readIntegrationSettings);
  const [draft, setDraft] = useState('YT20260001');
  const [shipmentId, setShipmentId] = useState('YT20260001');
  const { data, loading, error, load } = useControlTower(shipmentId);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (draft.trim() === shipmentId) void load();
    else if (draft.trim()) setShipmentId(draft.trim());
  };

  return (
    <div className="page tower-page">
      <header className="page-header page-header--with-action">
        <div>
          <p className="eyebrow">链上链下融合</p>
          <h1>运输控制塔</h1>
          <p>查看运输进度、异常责任段与交接证据。</p>
        </div>
        <Button kind="tertiary" renderIcon={Renew} onClick={() => void load()}>
          刷新证据
        </Button>
      </header>
      <form className="tower-search" onSubmit={submit}>
        <TextInput
          id="tower-shipment"
          labelText="运单号"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button type="submit">查询控制塔</Button>
      </form>
      {loading ? <div className="tower-loading">正在聚合 Fabric 与 MySQL 数据…</div> : null}
      {error ? (
        <div className="tower-error" role="alert">
          <strong>无法读取控制塔</strong>
          <span>{error}</span>
        </div>
      ) : null}
      {data ? (
        <>
          <div className="tower-context">
            <span>链运控制塔 · 独立运单库</span>
            <span>
              {data.dataSource === 'demo'
                ? '示例遥测'
                : data.dataSource === 'mysql'
                  ? '已连接遥测数据库'
                  : '遥测来源未标注'}
            </span>
          </div>
          <section className="tower-summary">
            <article>
              <span>运单</span>
              <strong>{data.shipment.id}</strong>
              <Tag type="blue">{LABELS[data.shipment.status] || data.shipment.status}</Tag>
            </article>
            <article>
              <span>运输路线</span>
              <strong>
                {data.shipment.origin} → {data.shipment.destination}
              </strong>
              <small>{data.segments.length} 个责任段</small>
            </article>
            <article>
              <span>风险提示</span>
              <strong>{data.risks.length}</strong>
              <small>
                {data.risks.filter((risk) => risk.status !== 'RESOLVED').length} 项待核查
              </small>
            </article>
            <article>
              <span>链上事件</span>
              <strong>{data.shipment.events.length}</strong>
              <small>交易 ID 可逐条核验</small>
            </article>
          </section>
          {settings.map ? (
            <ControlTowerMap data={data} showGps={settings.gps} />
          ) : (
            <p className="tower-empty">地图已在「数据源与扩展」中停用</p>
          )}
          <div className="tower-grid">
            <section className="tower-panel">
              <header>
                <span>规则分析</span>
                <h2>风险责任段</h2>
              </header>
              <div className="risk-stack">
                {data.risks.map((risk) => (
                  <article key={risk.id} data-level={risk.level}>
                    <div>
                      <strong>{risk.title}</strong>
                      <Tag
                        type={
                          risk.status === 'RESOLVED'
                            ? 'green'
                            : risk.level === 'HIGH'
                              ? 'red'
                              : 'warm-gray'
                        }
                      >
                        {LABELS[risk.level] || risk.level}
                      </Tag>
                    </div>
                    <p>{risk.description}</p>
                    <small>
                      {risk.segmentId || risk.hubCode || '全程'} ·{' '}
                      {LABELS[risk.status] || risk.status}
                    </small>
                  </article>
                ))}
                {!data.risks.length ? <p className="tower-empty">当前没有风险提示</p> : null}
              </div>
            </section>
            {settings.temperature ? (
              <section className="tower-panel">
                <header>
                  <span>IoT 摘要</span>
                  <h2>温湿度监控</h2>
                </header>
                <TemperatureChart data={data} />
                {data.temperature.length ? (
                  <p className="tower-observed-at">
                    采集于 {new Date(data.temperature.at(-1)!.at).toLocaleString('zh-CN')} ·
                    最后一次采集值
                  </p>
                ) : null}
              </section>
            ) : null}
          </div>
          <div className="tower-grid">
            <section className="tower-panel">
              <header>
                <span>Fabric 证据</span>
                <h2>事件与交易记录</h2>
              </header>
              <ol className="evidence-timeline">
                {[...data.shipment.events]
                  .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
                  .map((item) => (
                    <li key={item.id}>
                      <div>
                        <strong>{EVENT_LABELS[item.type] || item.type}</strong>
                        <time>{new Date(item.at).toLocaleString('zh-CN')}</time>
                      </div>
                      <p>
                        {item.hubName || item.hubCode} · {item.actorOrg} · {item.actorName}
                      </p>
                      <div className="tower-transaction">
                        <code title={item.txId}>{item.txId}</code>
                        <CopyButton value={item.txId} label="复制交易 ID" />
                      </div>
                      {settings.evidenceAnchor && item.evidenceHash ? (
                        <p>
                          证据摘要：<code>{item.evidenceHash}</code>
                        </p>
                      ) : null}
                    </li>
                  ))}
              </ol>
            </section>
            <section className="tower-panel">
              <header>
                <span>聚合与拆分</span>
                <h2>包裹和物流单元</h2>
              </header>
              <div className="unit-table">
                <div className="unit-table__head">
                  <span>包裹号</span>
                  <span>状态</span>
                  <span>物流单元</span>
                </div>
                {data.shipment.parcels.map((parcel) => (
                  <div key={parcel.id}>
                    <strong>{parcel.id}</strong>
                    <span>{LABELS[parcel.status] || parcel.status}</span>
                    <code>{parcel.unitId || '未装箱'}</code>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </>
      ) : null}
    </div>
  );
}
