import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ShipmentEvent } from '@jixin/shared';
import { ShipmentTimeline } from './ShipmentTimeline';

const events = [
  {
    sequence: 1,
    type: 'CREATED',
    location: '广州',
    description: '运单已创建',
    actorId: 'shipper-1',
    actorName: '发货方',
    mspId: 'Org1MSP',
    txId: 'tx-older',
    timestamp: '2026-07-20T08:30:00.000Z',
  },
  {
    sequence: 2,
    type: 'PICKED_UP',
    location: '广州白云物流园',
    description: '货物已揽收',
    actorId: 'carrier-1',
    actorName: '承运方',
    mspId: 'Org2MSP',
    txId: 'tx-latest',
    timestamp: '2026-07-20T09:30:00.000Z',
  },
] satisfies ShipmentEvent[];

describe('ShipmentTimeline', () => {
  it('默认展开最新记录，并在折叠的旧事件中保留系统编号与复制按钮语义', () => {
    render(<ShipmentTimeline events={events} />);

    const latestEvidence = screen.getByText('tx-latest').closest('details');
    const olderEvidence = screen.getByText('tx-older').closest('details');

    expect(latestEvidence).toHaveAttribute('open');
    expect(olderEvidence).not.toHaveAttribute('open');
    expect(within(olderEvidence!).getByText('tx-older')).toBeInTheDocument();

    const copyButton = olderEvidence!.querySelector('button');
    expect(copyButton).toHaveAccessibleName('复制系统记录编号');
  });
});
