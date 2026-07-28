import { Tag } from '@carbon/react';
import type { ShipmentStatus } from '@jixin/shared';
import { STATUS_LABELS } from '../lib/presentation';

export function StatusTag({ status }: { status: ShipmentStatus }) {
  return (
    <Tag
      type={status === 'EXCEPTION' ? 'red' : 'gray'}
      size="md"
      className="status-tag"
      data-status={status.toLowerCase()}
    >
      {STATUS_LABELS[status]}
    </Tag>
  );
}
