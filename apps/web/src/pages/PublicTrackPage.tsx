import { useRef, useState, type FormEvent } from 'react';
import { Button, Form, InlineNotification, Search, Tile } from '@carbon/react';
import {
  ArrowLeft,
  ArrowRight,
  DataCheck,
  DeliveryParcel,
  Blockchain,
  Locked,
  SearchLocate,
} from '@carbon/icons-react';
import type { Shipment, ShipmentHistoryEntry } from '@jixin/shared';
import { Link, useSearchParams } from 'react-router-dom';
import { LedgerBanner } from '../components/LedgerBanner';
import { PublicHeader } from '../components/PublicHeader';
import { RouteScene } from '../components/RouteScene';
import { ShipmentTimeline } from '../components/ShipmentTimeline';
import { StatusTag } from '../components/StatusTag';
import { api, getErrorMessage } from '../lib/api';
import { useCinematicMotion } from '../lib/motion';
import { formatDate, routeLabel } from '../lib/presentation';
import type { LedgerMode } from '../types';

const TRUST_FLOW = ['创建运单', '承运接单', '节点留痕', '异常闭环', '到货签收', '证据验真'];

const PRIVACY_LAYERS = [
  {
    id: 'public',
    step: '01',
    label: '公开可查',
    title: '物流事实形成连续轨迹',
    description: '状态、地点、账本时间和交易 ID 对外可查，让每次运输交接都能回溯。',
    evidence: 'STATUS · LOCATION · TX ID',
    icon: DataCheck,
  },
  {
    id: 'masked',
    step: '02',
    label: '隐私脱敏',
    title: '联系人只保留必要线索',
    description: '公开端隐藏完整手机号和详细身份，避免业务透明演变为个人信息泄露。',
    evidence: 'MASKED RECIPIENT',
    icon: Locked,
  },
  {
    id: 'offchain',
    step: '03',
    label: '原件链下',
    title: '不可逆摘要完成证据比对',
    description: '图片、证件与完整资料保留在链下，只用 SHA-256 摘要证明内容未被替换。',
    evidence: 'SHA-256 HASH ONLY',
    icon: Blockchain,
  },
];

const ROLE_STORIES = [
  {
    mark: '发',
    role: '发货方',
    title: '一次创建，明确交付边界',
    description: '货物、路线、联系人和温控约束在起运前形成可信业务起点。',
  },
  {
    mark: '承',
    role: '承运方',
    title: '每次操作，都留下责任凭据',
    description: '接单、揽收、节点更新、异常处理和送达都对应明确的提交身份。',
  },
  {
    mark: '收',
    role: '收货方',
    title: '一次性签收码完成最终确认',
    description: '签收凭据不会写入公开账本，以瞬态数据完成校验并防止重复使用。',
  },
  {
    mark: '审',
    role: '审计方',
    title: '从结果回溯到完整交易历史',
    description: '公开轨迹、状态历史与证据摘要共同提供可复核的审计线索。',
  },
];

function TrustMarquee() {
  return (
    <div className="trust-marquee" aria-label="物流闭环阶段">
      <div className="trust-marquee__track">
        {[0, 1].map((copy) => (
          <div key={copy} className="trust-marquee__set" aria-hidden={copy === 1}>
            {TRUST_FLOW.map((item) => (
              <span key={`${copy}-${item}`}>
                <i aria-hidden="true" />
                {item}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function RoleVoices() {
  const [active, setActive] = useState(0);
  const story = ROLE_STORIES[active]!;
  const go = (offset: number) => {
    setActive((current) => (current + offset + ROLE_STORIES.length) % ROLE_STORIES.length);
  };

  return (
    <section className="role-voices" aria-labelledby="role-voices-title">
      <div className="role-voices__portraits" aria-label="参与角色">
        {ROLE_STORIES.map((item, index) => (
          <button
            key={item.role}
            type="button"
            className={index === active ? 'is-active' : ''}
            aria-label={`查看${item.role}说明`}
            aria-pressed={index === active}
            onClick={() => setActive(index)}
          >
            {item.mark}
          </button>
        ))}
      </div>
      <div className="role-voices__quote" aria-live="polite" key={story.role}>
        <span>{story.role}</span>
        <h2 id="role-voices-title">{story.title}</h2>
        <p>{story.description}</p>
      </div>
      <div className="role-voices__controls">
        <button type="button" aria-label="上一个角色" onClick={() => go(-1)}>
          <ArrowLeft size={20} />
        </button>
        <span className="mono">
          {String(active + 1).padStart(2, '0')} / {String(ROLE_STORIES.length).padStart(2, '0')}
        </span>
        <button type="button" aria-label="下一个角色" onClick={() => go(1)}>
          <ArrowRight size={20} />
        </button>
      </div>
    </section>
  );
}

export function PublicTrackPage() {
  const pageRef = useRef<HTMLDivElement>(null);
  const [params, setParams] = useSearchParams();
  const [trackingNumber, setTrackingNumber] = useState(params.get('trackingNumber') ?? '');
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [history, setHistory] = useState<ShipmentHistoryEntry[]>([]);
  const [ledgerMode, setLedgerMode] = useState<LedgerMode | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeLayer, setActiveLayer] = useState(0);

  useCinematicMotion(pageRef, [shipment?.id]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const normalized = trackingNumber.trim().toUpperCase();
    if (!normalized) return;
    setTrackingNumber(normalized);
    setParams({ trackingNumber: normalized });
    setLoading(true);
    setError('');
    setShipment(null);
    try {
      const [trackResult, historyResult] = await Promise.all([
        api.public.track(normalized),
        api.public.history(normalized),
      ]);
      setShipment(trackResult.data);
      setHistory(historyResult.data);
      setLedgerMode(trackResult.meta?.ledgerMode ?? historyResult.meta?.ledgerMode ?? null);
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="public-page" ref={pageRef}>
      <PublicHeader />
      <main id="main-content">
        <section className="public-hero" aria-labelledby="track-title" data-motion="hero">
          <div className="public-hero__content" data-reveal>
            <p className="eyebrow" data-reveal>
              区块链可信物流追踪
            </p>
            <h1 id="track-title" data-reveal>
              每次交接，
              <span className="public-title__tail">都有证据可查</span>
            </h1>
            <p data-reveal>输入运单号，查询脱敏物流轨迹、运输状态与链上交易证据。</p>
            <Form className="public-search" onSubmit={handleSubmit}>
              <Search
                id="public-tracking-number"
                labelText="物流运单号"
                placeholder="输入物流运单号，例如 JX2026…"
                value={trackingNumber}
                onChange={(event) => setTrackingNumber(event.currentTarget.value)}
                closeButtonLabelText="清除搜索"
                size="lg"
              />
              <Button type="submit" size="lg" renderIcon={SearchLocate} disabled={loading}>
                {loading ? '正在查询' : '查询物流'}
              </Button>
            </Form>
            <div className="public-hero__secondary" data-reveal>
              <Link to="/verify">没有运单详情？直接进行证据验真</Link>
              <span>公开查询无需登录</span>
            </div>
            {error ? (
              <InlineNotification
                className="public-search-error"
                kind="error"
                lowContrast
                hideCloseButton
                title="未能查询此运单"
                subtitle={error}
              />
            ) : null}
          </div>
          <figure className="public-hero__visual" data-reveal data-motion-image>
            <img
              src="/logistics-hub.webp"
              alt="自动化物流枢纽中的货运车辆经过交接检查站"
              loading="eager"
              decoding="async"
            />
            <RouteScene />
            <figcaption>
              <span>交接检查站 · 节点 03</span>
              <strong>摘要已写入账本</strong>
              <small>2026-07-20 13:20:08</small>
            </figcaption>
          </figure>
          <div className="hero-proof" data-reveal aria-label="公开查询说明">
            <div>
              <Blockchain size={22} aria-hidden="true" />
              <span>交易回执</span>
              <strong>可核验</strong>
            </div>
            <div>
              <Locked size={22} aria-hidden="true" />
              <span>收货资料</span>
              <strong>已脱敏</strong>
            </div>
            <div>
              <DataCheck size={22} aria-hidden="true" />
              <span>历史连续性</span>
              <strong>可检查</strong>
            </div>
          </div>
        </section>

        <TrustMarquee />

        {loading ? (
          <section className="public-loading" aria-live="polite" aria-busy="true">
            <div className="public-loading__line" />
            <div className="public-loading__line" />
            <div className="public-loading__line" />
            <span>正在从账本读取物流记录</span>
          </section>
        ) : null}

        {shipment ? (
          <section className="public-result" aria-live="polite">
            {ledgerMode ? <LedgerBanner mode={ledgerMode} /> : null}
            <header className="public-result__header">
              <div>
                <span className="mono">{shipment.trackingNumber}</span>
                <h2>{routeLabel(shipment)}</h2>
                <p>
                  {shipment.goods.name}，预计 {formatDate(shipment.expectedDeliveryDate)} 送达
                </p>
              </div>
              <StatusTag status={shipment.status} />
            </header>

            <div className="public-route-band" aria-label="运输路线">
              <div>
                <span>始发地</span>
                <strong>{shipment.origin.city}</strong>
              </div>
              <div className="public-route-band__rail" aria-hidden="true">
                <i />
                <span />
                <i className="is-current" />
                <span />
                <i />
              </div>
              <div className="public-route-band__current">
                <span>当前位置</span>
                <strong>{shipment.lastLocation}</strong>
              </div>
              <div>
                <span>目的地</span>
                <strong>{shipment.destination.city}</strong>
              </div>
            </div>

            <div className="public-summary-grid">
              <Tile>
                <span>当前位置</span>
                <strong>{shipment.lastLocation}</strong>
              </Tile>
              <Tile>
                <span>承运方</span>
                <strong>{shipment.carrierName ?? '等待承运方接单'}</strong>
              </Tile>
              <Tile>
                <span>收货信息</span>
                <strong>{shipment.recipientMasked}</strong>
              </Tile>
              <Tile>
                <span>可信事件</span>
                <strong className="mono">{shipment.events.length}</strong>
              </Tile>
            </div>

            <div className="public-result__layout">
              <section className="public-timeline">
                <div className="section-heading">
                  <p className="eyebrow">运输进度</p>
                  <h2>物流时间线</h2>
                  <p>先查看物流事实，需要时再展开链上凭据。</p>
                </div>
                <ShipmentTimeline events={shipment.events} />
              </section>
              <aside>
                <Tile className="public-audit-card">
                  <DeliveryParcel size={28} aria-hidden="true" />
                  <h2>进一步核验证据</h2>
                  <p>检查历史连续性，也可比对一份 SHA-256 证据摘要。</p>
                  <dl>
                    <div>
                      <dt>历史版本</dt>
                      <dd className="mono">{history.length}</dd>
                    </div>
                    <div>
                      <dt>异常记录</dt>
                      <dd className="mono">{shipment.anomalyCount}</dd>
                    </div>
                  </dl>
                  <Button
                    as={Link}
                    to={`/verify?trackingNumber=${encodeURIComponent(shipment.trackingNumber)}`}
                    kind="tertiary"
                    renderIcon={ArrowRight}
                  >
                    前往证据验真
                  </Button>
                </Tile>
              </aside>
            </div>
          </section>
        ) : null}

        {!shipment && !loading && !error ? (
          <>
            <section className="chain-story" aria-labelledby="chain-story-title">
              <div className="chain-story__intro">
                <div>
                  <p className="eyebrow">可信，不等于暴露全部信息</p>
                  <h2 id="chain-story-title">每次查询都守住公开与隐私的边界</h2>
                </div>
                <p data-scrub-copy>
                  账本只保存业务所需状态与不可逆摘要，敏感原始资料保留在链下。展开三个边界，查看一条记录如何做到既可核验又不过度暴露。
                </p>
              </div>
              <div className="chain-accordion">
                {PRIVACY_LAYERS.map((item, index) => {
                  const Icon = item.icon;
                  const active = index === activeLayer;
                  return (
                    <article
                      key={item.id}
                      className={`chain-accordion__item ${active ? 'is-active' : ''}`}
                    >
                      <button
                        type="button"
                        className="chain-accordion__trigger"
                        aria-expanded={active}
                        aria-controls={`privacy-layer-${item.id}`}
                        onClick={() => setActiveLayer(index)}
                      >
                        <Icon size={24} aria-hidden="true" />
                        <span>
                          <small>
                            {item.step} · {item.label}
                          </small>
                          <strong>{item.title}</strong>
                        </span>
                      </button>
                      {active ? (
                        <div className="chain-accordion__panel" id={`privacy-layer-${item.id}`}>
                          <p>{item.description}</p>
                          <div className="chain-accordion__evidence">
                            <span>账本边界</span>
                            <strong className="mono">{item.evidence}</strong>
                          </div>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </section>

            <RoleVoices />

            <section className="public-cta">
              <div>
                <p className="eyebrow">从一条记录开始验证</p>
                <h2>已有交易摘要，直接检查它是否与账本一致</h2>
              </div>
              <Button as={Link} to="/verify" size="lg" renderIcon={ArrowRight}>
                进入证据验真
              </Button>
            </section>
          </>
        ) : null}
      </main>
      <footer className="public-footer">
        <span>迹信可信物流追踪</span>
        <span>Hyperledger Fabric 应用实践</span>
      </footer>
    </div>
  );
}
