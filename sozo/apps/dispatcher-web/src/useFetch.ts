import { useCallback, useEffect, useRef, useState } from 'react';

interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  setData: (updater: (prev: T | null) => T | null) => void;
}

/** Простая загрузка данных с состояниями «Загрузка…» / ошибка / данные. */
export function useFetch<T>(fetcher: () => Promise<T>, deps: unknown[] = []): FetchState<T> {
  const [data, setDataState] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetcherRef
      .current()
      .then((d) => {
        if (!cancelled) setDataState(d);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const setData = useCallback((updater: (prev: T | null) => T | null) => {
    setDataState((prev) => updater(prev));
  }, []);

  return { data, loading, error, reload, setData };
}
