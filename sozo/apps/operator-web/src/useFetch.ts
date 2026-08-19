import { useCallback, useEffect, useState } from 'react';
import { request } from './api';

interface State<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/** Загрузка с ручным повтором: у экранов кабинета всегда есть кнопка «Повторить». */
export function useFetch<T>(path: string | null, deps: unknown[] = []): State<T> & { reload: () => void } {
  const [state, setState] = useState<State<T>>({ data: null, loading: Boolean(path), error: null });
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    request<T>(path)
      .then((data) => !cancelled && setState({ data, loading: false, error: null }))
      .catch((e: Error) => !cancelled && setState({ data: null, loading: false, error: e.message }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick, ...deps]);

  return { ...state, reload };
}
