import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { controlTowerApi, type ControlTowerData } from './control-tower-api';
import { useControlTower } from './use-control-tower';

it('ignores an older response after switching shipments', async () => {
  let resolveOld!: (value: ControlTowerData) => void;
  const old = new Promise<ControlTowerData>((resolve) => {
    resolveOld = resolve;
  });
  const fresh = { shipment: { id: 'B' } } as ControlTowerData;
  vi.spyOn(controlTowerApi, 'get').mockImplementation((id) =>
    id === 'A' ? old : Promise.resolve(fresh),
  );
  const { result, rerender } = renderHook(({ id }) => useControlTower(id), {
    initialProps: { id: 'A' },
  });
  rerender({ id: 'B' });
  await waitFor(() => expect(result.current.data).toBe(fresh));
  await act(async () => {
    resolveOld({ shipment: { id: 'A' } } as ControlTowerData);
    await old;
  });
  expect(result.current.data).toBe(fresh);
});

it('clears old data when the next request fails', async () => {
  vi.spyOn(controlTowerApi, 'get')
    .mockResolvedValueOnce({ shipment: { id: 'A' } } as ControlTowerData)
    .mockRejectedValueOnce(new Error('运单不存在'));
  const { result, rerender } = renderHook(({ id }) => useControlTower(id), {
    initialProps: { id: 'A' },
  });
  await waitFor(() => expect(result.current.data).not.toBeNull());
  rerender({ id: 'missing' });
  await waitFor(() => expect(result.current.error).toBe('运单不存在'));
  expect(result.current.data).toBeNull();
});
