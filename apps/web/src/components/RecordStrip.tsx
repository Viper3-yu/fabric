import type { ShipmentEvent } from '@jixin/shared';
import { CopyButton } from './CopyButton';
import { EVENT_LABELS, formatDateTime } from '../lib/presentation';

// 统一的“记录带”：一条系统记录的标准形态——状态点、事件、地点、时间、
// 可复制的记录编号。详情健康卡、工作台焦点与时间线共用同一证据语言。
export function RecordStrip({
  event,
  compact = false,
}: {
  event: ShipmentEvent;
  compact?: boolean;
}) {
  const exception = event.type === 'EXCEPTION_REPORTED';
  return (
    <p
      className={`record-strip${compact ? ' record-strip--compact' : ''}${
        exception ? ' is-exception' : ''
      }`}
    >
      <i aria-hidden="true" />
      <span className="record-strip__event">{EVENT_LABELS[event.type]}</span>
      <span className="record-strip__location">{event.location}</span>
      <time className="record-strip__time" dateTime={event.timestamp}>
        {formatDateTime(event.timestamp)}
      </time>
      <span className="record-strip__tx">
        <span className="mono record-strip__tx-value">{event.txId}</span>
        <CopyButton value={event.txId} label="复制系统记录编号" />
      </span>
    </p>
  );
}
