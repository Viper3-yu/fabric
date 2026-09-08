import { useCallback, useEffect, useRef, useState } from 'react';
import { controlTowerApi, type ControlTowerData } from './control-tower-api';

export function useControlTower(shipmentId: string) {
  const [data, setData] = useState<ControlTowerData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const active = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setData(null);
    setError('');
    if (!shipmentId.trim()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await controlTowerApi.get(shipmentId.trim(), controller.signal);
      if (!controller.signal.aborted) setData(result);
    } catch (caught) {
      if (!controller.signal.aborted)
        setError(caught instanceof Error ? caught.message : '读取失败');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [shipmentId]);
  useEffect(() => {
    void load();
    return () => active.current?.abort();
  }, [load]);
  return { data, loading, error, load };
}
