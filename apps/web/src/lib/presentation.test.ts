import { describe, expect, it } from 'vitest';
import { getAvailableActions } from './presentation';

describe('角色与状态动作矩阵', () => {
  it('承运方可以按状态推进运输闭环', () => {
    expect(getAvailableActions('carrier', 'CREATED')).toEqual(['accept']);
    expect(getAvailableActions('carrier', 'ACCEPTED')).toEqual(['pickup']);
    expect(getAvailableActions('carrier', 'IN_TRANSIT')).toEqual([
      'checkpoint',
      'exception',
      'deliver',
    ]);
    expect(getAvailableActions('carrier', 'EXCEPTION')).toEqual(['resolve']);
  });

  it('发货方和收货方只能执行各自的关键动作', () => {
    expect(getAvailableActions('shipper', 'CREATED')).toEqual(['cancel']);
    expect(getAvailableActions('shipper', 'ACCEPTED')).toEqual([]);
    expect(getAvailableActions('receiver', 'DELIVERED')).toEqual(['confirm']);
    expect(getAvailableActions('auditor', 'IN_TRANSIT')).toEqual([]);
  });
});
