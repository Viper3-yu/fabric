import { Tag } from '@carbon/react';
import type { ShipmentStatus } from '@jixin/shared';
import { STATUS_LABELS, statusTone } from '../lib/presentation';

export function StatusTag({ status }: { status: ShipmentStatus }) {
  return (
    <Tag type={statusTone(status)} size="md" className="status-tag">
      {STATUS_LABELS[status]}
    </Tag>
  );
}
