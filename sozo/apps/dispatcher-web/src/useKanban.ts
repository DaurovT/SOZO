import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { KanbanData } from './types';

interface KanbanState {
  data: KanbanData | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Загрузка kanban с фоновым автообновлением (без мигания «Загрузка…»).
 * pollMs = 0 — без опроса, только начальная загрузка + ручной reload.
 */
export function useKanban(pollMs = 0): KanbanState {
  const [data, setData] = useState<KanbanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const aliveRef = useRef(true);

  const load = useCallback(() => {
    api
      .get<KanbanData>('/dispatch/kanban')
      .then((d) => {
        if (!aliveRef.current) return;
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!aliveRef.current) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (aliveRef.current) setLoading(false);
      });
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    load();
    let timer: number | undefined;
    if (pollMs > 0) {
      timer = window.setInterval(load, pollMs);
    }
    return () => {
      aliveRef.current = false;
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [load, pollMs]);

  return { data, loading, error, reload: load };
}
