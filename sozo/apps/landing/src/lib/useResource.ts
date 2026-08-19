import { useEffect, useRef, useState } from 'react';

export type Resource<T> =
  { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; message: string };

/**
 * Загрузка публичных данных. Ошибка не роняет страницу — вызывающий код
 * решает, как деградировать (PRD-06 §3: плитки без цен).
 */
export function useResource<T>(load: () => Promise<T>, deps: unknown[]): Resource<T> {
  const [state, setState] = useState<Resource<T>>({ status: 'loading' });
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    loadRef
      .current()
      .then((data) => {
        if (alive) setState({ status: 'ready', data });
      })
      .catch((e: unknown) => {
        if (alive) {
          setState({
            status: 'error',
            message: e instanceof Error ? e.message : 'Не удалось загрузить данные',
          });
        }
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
