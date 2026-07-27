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
import { ShipmentProgress } from '../components/ShipmentProgress';
import { ShipmentTimeline } from '../components/ShipmentTimeline';
import { StatusTag } from '../components/StatusTag';
import { api, getErrorMessage } from '../lib/api';
import { useCinematicMotion } from '../lib/motion';
import { formatDate, routeLabel } from '../lib/presentation';
import type { LedgerMode } from '../types';

const TRUST_FLOW = [
  '发货方建单',
  '承运方接货',
  '位置自动更新',
  '异常及时处理',
  '收货方确认',
  '全程记录可查',
];

const RECORD_STEPS = [
  {
    label: '发货方建单',
    title: '先把货物和路线说清楚',
    description: '货物、收发地址和温控要求保存后，这趟运输就有了清楚的起点。',
    meta: '起点已经保存',
    icon: DeliveryParcel,
  },
  {
    label: '承运方接货',
    title: '交给谁系统马上记下',
    description: '接单和揽收会同时记下操作人、所属公司、地点和时间，之后不能悄悄覆盖。',
    meta: '责任已经交接',
    icon: Locked,
  },
  {
    label: '运输途中',
    title: '每到一站都多一条记录',
    description: '位置、温度和现场说明按顺序追加；遇到异常，也能看到发生和处理的完整过程。',
    meta: '记录持续更新',
    icon: DataCheck,
  },
  {
    label: '到货签收',
    title: '最后由收货方完成确认',
    description: '一次性签收码完成最后确认，前面的运输记录会连成一条完整、可回看的时间线。',
    meta: '运输已经闭环',
    icon: Blockchain,
  },
] as const;

const PRIVACY_LAYERS = [
  {
    id: 'public',
    label: '过程可以回看',
    title: '每次变化都按顺序保存',
    description: '运输状态、地点、操作时间和记录编号都能查到，货物经过谁、到过哪里一目了然。',
    evidence: '状态 · 地点 · 操作时间 · 记录编号',
    icon: DataCheck,
  },
  {
    id: 'masked',
    label: '隐私默认隐藏',
    title: '联系人只显示必要信息',
    description: '公开页面不会显示完整手机号和个人身份，查物流不等于暴露收发货人的隐私。',
    evidence: '姓名和手机号默认打码',
    icon: Locked,
  },
  {
    id: 'offchain',
    label: '原文件不公开',
    title: '只保存文件核对编号',
    description:
      '图片、证件和完整资料仍由业务方保管，系统只保存一串文件核对编号，用来检查文件有没有被换过。',
    evidence: '原文件留在业务方 · 系统只保存核对编号',
    icon: Blockchain,
  },
];

const ROLE_STORIES = [
  {
    mark: '发',
    role: '发货方',
    title: '建单时把这趟运输说清楚',
    description: '货物、路线、联系人和温控要求一次填好，后面每个人都按同一张运单协作。',
  },
  {
    mark: '承',
    role: '承运方',
    title: '谁接货谁更新都会自动记下',
    description: '接单、揽收、位置更新、异常处理和送达，都能看到是谁在什么时候完成的。',
  },
  {
    mark: '收',
    role: '收货方',
    title: '一次性签收码完成最终确认',
    description: '签收码只使用一次，系统完成确认后立即失效，不会在公开页面展示。',
  },
  {
    mark: '审',
    role: '审计方',
    title: '从结果倒回去看完整过程',
    description: '运输路线、每次状态变化和文件核对编号都能按时间回看，出了问题更容易找到责任环节。',
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

function RecordJourney() {
  return (
    <section className="record-journey" aria-labelledby="record-journey-title" data-motion-pin>
      <div className="record-journey__heading" data-pin-heading>
        <p className="eyebrow">系统怎么记住一趟运输</p>
        <h2 id="record-journey-title">每一步都有记录 来龙去脉一看就懂</h2>
        <p className="record-journey__scrub" aria-label="运输过程中的关键动作都会被系统按顺序保存">
          {[
            '谁建的单，',
            '谁接的货，',
            '车辆到过哪里，',
            '什么时候签收，',
            '系统都会按顺序记下来。',
          ].map((copy) => (
            <span key={copy} data-scrub-word>
              {copy}
            </span>
          ))}
        </p>
      </div>
      <div className="record-journey__cards">
        {RECORD_STEPS.map((step, index) => {
          const Icon = step.icon;
          return (
            <article key={step.label} className="record-step" data-pin-card>
              <div className="record-step__top">
                <span className="record-step__icon">
                  <Icon size={22} aria-hidden="true" />
                </span>
                <span className="record-step__index mono">
                  {String(index + 1).padStart(2, '0')}
                </span>
              </div>
              <p>{step.label}</p>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
              <div className="record-step__status">
                <i aria-hidden="true" />
                <span>{step.meta}</span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
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
              一张运单 从发出到签收都能查
            </p>
            <h1 id="track-title" data-reveal>
              <span className="public-title__lead">每一次交接</span>
              <span className="public-title__tail">系统都会自动记下</span>
            </h1>
            <p data-reveal>
              输入运单号，就能看到货物到过哪里、由谁操作、有没有异常，以及每次变化的准确时间。
            </p>
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
              <Link to="/verify">输入文件核对编号 查看是否一致</Link>
              <span>不用登录，也不会显示完整个人信息</span>
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
          <div className="public-hero__progress" data-reveal>
            <ShipmentProgress shipment={shipment} />
          </div>
          <div className="hero-proof" data-reveal aria-label="系统记录说明">
            <div>
              <Blockchain size={22} aria-hidden="true" />
              <span>操作记录</span>
              <strong>随时可查</strong>
            </div>
            <div>
              <Locked size={22} aria-hidden="true" />
              <span>联系方式</span>
              <strong>默认隐藏</strong>
            </div>
            <div>
              <DataCheck size={22} aria-hidden="true" />
              <span>修改历史</span>
              <strong>完整保留</strong>
            </div>
          </div>
        </section>

        <TrustMarquee />

        {loading ? (
          <section className="public-loading" aria-live="polite" aria-busy="true">
            <div className="public-loading__line" />
            <div className="public-loading__line" />
            <div className="public-loading__line" />
            <span>正在读取这张运单的完整记录</span>
          </section>
        ) : null}

        {shipment ? (
          <section id="track-result" className="public-result" aria-live="polite">
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
                <span>已记录节点</span>
                <strong className="mono">{shipment.events.length}</strong>
              </Tile>
            </div>

            <div className="public-result__layout">
              <section className="public-timeline">
                <div className="section-heading">
                  <p className="eyebrow">运输进度</p>
                  <h2>物流时间线</h2>
                  <p>先看运输进度，需要时再展开每次操作的详细记录。</p>
                </div>
                <ShipmentTimeline events={shipment.events} />
              </section>
              <aside>
                <Tile className="public-audit-card">
                  <DeliveryParcel size={28} aria-hidden="true" />
                  <h2>看看记录有没有缺失</h2>
                  <p>系统会检查每次变化是否首尾相连，也可以检查文件核对编号是否一致。</p>
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
                    核对完整记录
                  </Button>
                </Tile>
              </aside>
            </div>
          </section>
        ) : null}

        {!shipment && !loading && !error ? (
          <>
            <RecordJourney />

            <section className="chain-story" aria-labelledby="chain-story-title">
              <div className="chain-story__intro">
                <div>
                  <p className="eyebrow">过程说得清，隐私也守得住</p>
                  <h2 id="chain-story-title">想查的过程都能看到 隐私默认隐藏</h2>
                  <p className="chain-story__lead" data-scrub-copy>
                    运输过程和核对编号可以查询；完整文件、证件和联系方式仍由业务方保管，不会出现在公开页面。
                  </p>
                </div>
                <dl className="chain-story__scope" aria-label="公开信息范围">
                  <div>
                    <dt>公开可查</dt>
                    <dd>运输状态 · 地点 · 操作时间</dd>
                  </div>
                  <div>
                    <dt>默认隐藏</dt>
                    <dd>完整文件 · 证件 · 联系方式</dd>
                  </div>
                </dl>
              </div>
              <div className="privacy-grid">
                {PRIVACY_LAYERS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <article key={item.id} className="privacy-card">
                      <header className="privacy-card__heading">
                        <Icon size={24} aria-hidden="true" />
                        <span>
                          <small>{item.label}</small>
                          <strong>{item.title}</strong>
                        </span>
                      </header>
                      <div className="privacy-card__body">
                        <p>{item.description}</p>
                        <div className="privacy-card__saved">
                          <span>系统实际保存</span>
                          <strong className="mono">{item.evidence}</strong>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>

            <RoleVoices />

            <section className="public-cta">
              <div>
                <p className="eyebrow">拿一张真实运单试试看</p>
                <h2>用文件核对编号看看文件有没有被换过</h2>
              </div>
              <Button as={Link} to="/verify" size="lg" renderIcon={ArrowRight}>
                开始核对记录
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
