import {
  CheckmarkFilled,
  ChevronDown,
  DataCheck,
  Location,
  WarningAltFilled,
} from '@carbon/icons-react';
import type { ShipmentEvent } from '@jixin/shared';
import { CopyButton } from './CopyButton';
import { EVENT_LABELS, formatDateTime } from '../lib/presentation';

function EventIcon({ event }: { event: ShipmentEvent }) {
  if (event.type === 'EXCEPTION_REPORTED') {
    return <WarningAltFilled size={20} aria-hidden="true" />;
  }
  if (event.type === 'CHECKPOINT') {
    return <Location size={20} aria-hidden="true" />;
  }
  return <CheckmarkFilled size={20} aria-hidden="true" />;
}

export function ShipmentTimeline({ events }: { events: ShipmentEvent[] }) {
  return (
    <ol className="shipment-timeline" aria-label="物流可信时间线">
      {[...events].reverse().map((event, index) => (
        <li
          key={`${event.sequence}-${event.txId}`}
          className={`shipment-timeline__item ${index === 0 ? 'is-latest' : ''}`}
        >
          <div
            className={`shipment-timeline__marker ${
              event.type === 'EXCEPTION_REPORTED' ? 'is-exception' : ''
            }`}
          >
            <EventIcon event={event} />
          </div>
          <div className="shipment-timeline__content">
            <div className="shipment-timeline__heading">
              <div>
                <h3>{EVENT_LABELS[event.type]}</h3>
                <p>{formatDateTime(event.timestamp)}</p>
              </div>
              <span className="sequence-number">#{String(event.sequence).padStart(2, '0')}</span>
            </div>
            <p className="shipment-timeline__location">{event.location}</p>
            <p>{event.description}</p>
            <details
              className="evidence-disclosure"
              open={index === 0 || event.type === 'EXCEPTION_REPORTED'}
            >
              <summary>
                <span>
                  <DataCheck size={17} aria-hidden="true" />
                  查看这次操作的系统记录
                </span>
                <ChevronDown size={18} aria-hidden="true" />
              </summary>
              <dl className="evidence-grid">
                {event.actorName ? (
                  <div>
                    <dt>操作人</dt>
                    <dd>{event.actorName}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>所属协作方</dt>
                  <dd className="mono">{event.mspId}</dd>
                </div>
                {event.temperature !== undefined ? (
                  <div>
                    <dt>记录温度</dt>
                    <dd className="num">{event.temperature} °C</dd>
                  </div>
                ) : null}
                <div className="evidence-grid__wide">
                  <dt>系统记录编号</dt>
                  <dd className="hash-row">
                    <span className="mono hash-value">{event.txId}</span>
                    <CopyButton value={event.txId} label="复制系统记录编号" />
                  </dd>
                </div>
                {event.evidenceHash ? (
                  <div className="evidence-grid__wide">
                    <dt>文件核对编号</dt>
                    <dd className="hash-row">
                      <span className="mono hash-value">{event.evidenceHash}</span>
                      <CopyButton value={event.evidenceHash} label="复制文件核对编号" />
                    </dd>
                  </div>
                ) : null}
              </dl>
            </details>
          </div>
        </li>
      ))}
    </ol>
  );
}
