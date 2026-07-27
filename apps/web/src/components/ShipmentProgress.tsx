import { DeliveryParcel } from '@carbon/icons-react';
import type { Shipment, ShipmentStatus } from '@jixin/shared';
import type { CSSProperties } from 'react';
import { formatDateTime, STATUS_LABELS } from '../lib/presentation';
import { StatusTag } from './StatusTag';

const PROGRESS_STAGES = ['建单', '接单', '揽收', '运输', '送达', '签收'] as const;

const STATUS_STAGE: Record<ShipmentStatus, number> = {
  CREATED: 0,
  ACCEPTED: 1,
  PICKED_UP: 2,
  IN_TRANSIT: 3,
  EXCEPTION: 3,
  DELIVERED: 4,
  RECEIVED: 5,
  CANCELLED: 0,
};

interface ShipmentProgressProps {
  shipment: Shipment | null;
  compact?: boolean;
}

export function ShipmentProgress({ shipment, compact = false }: ShipmentProgressProps) {
  if (!shipment) {
    return (
      <section
        className={`shipment-progress is-empty ${compact ? 'is-compact' : ''}`}
        aria-label="运单进度等待查询"
      >
        <header className="shipment-progress__header">
          <div>
            <span>运单实时进度</span>
            <strong>等待输入运单号</strong>
          </div>
          <span className="shipment-progress__waiting">等待查询</span>
        </header>
        <ol
          className="shipment-progress__stages is-placeholder"
          aria-label="查询后将显示的运单处理阶段"
        >
          {PROGRESS_STAGES.map((stage) => (
            <li key={stage}>
              <i aria-hidden="true" />
              <span>{stage}</span>
            </li>
          ))}
        </ol>
        <div className="shipment-progress__empty">
          <DeliveryParcel size={compact ? 28 : 36} aria-hidden="true" />
          <div>
            <strong>输入运单号后显示真实进度</strong>
            <span>查询后会显示当前阶段、最后位置和最近更新时间，不展示模拟路线。</span>
          </div>
        </div>
      </section>
    );
  }

  const currentStage = STATUS_STAGE[shipment.status];
  const progress =
    Math.round(
      (currentStage / (PROGRESS_STAGES.length - 1)) * (100 - 100 / PROGRESS_STAGES.length) * 100,
    ) / 100;
  const lastEvent = shipment.events.reduce(
    (latest, event) => (event.sequence > (latest?.sequence ?? -1) ? event : latest),
    shipment.events[0],
  );
  const isCancelled = shipment.status === 'CANCELLED';

  return (
    <section
      className={`shipment-progress ${compact ? 'is-compact' : ''} ${
        isCancelled ? 'is-cancelled' : ''
      }`}
      aria-label={`${shipment.trackingNumber} 当前进度 ${STATUS_LABELS[shipment.status]}`}
      style={{ '--shipment-progress': `${isCancelled ? 0 : progress}%` } as CSSProperties}
    >
      <header className="shipment-progress__header">
        <div>
          <span>当前运单进度</span>
          <strong className="mono">{shipment.trackingNumber}</strong>
        </div>
        <StatusTag status={shipment.status} />
      </header>

      <div className="shipment-progress__route" aria-label="运输路线">
        <div>
          <span>发出</span>
          <strong>{shipment.origin.city}</strong>
        </div>
        <i aria-hidden="true" />
        <div>
          <span>送往</span>
          <strong>{shipment.destination.city}</strong>
        </div>
      </div>

      <ol className="shipment-progress__stages" aria-label="运单处理阶段">
        {PROGRESS_STAGES.map((stage, index) => {
          const isComplete = !isCancelled && index < currentStage;
          const isCurrent = !isCancelled && index === currentStage;

          return (
            <li
              key={stage}
              className={`${isComplete ? 'is-complete' : ''} ${isCurrent ? 'is-current' : ''}`}
              aria-current={isCurrent ? 'step' : undefined}
            >
              <i aria-hidden="true" />
              <span>{stage}</span>
            </li>
          );
        })}
      </ol>

      <div className="shipment-progress__details">
        <div>
          <span>最后位置</span>
          <strong>{shipment.lastLocation || shipment.origin.city}</strong>
        </div>
        <div>
          <span>最近更新</span>
          <strong>{lastEvent?.description ?? STATUS_LABELS[shipment.status]}</strong>
          <small>{formatDateTime(shipment.updatedAt)}</small>
        </div>
      </div>
    </section>
  );
}
