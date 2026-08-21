import { useState } from 'react';
import { api, ApiError } from '../api';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import { formatDateTime } from '../format';
import { useFetch } from '../useFetch';

/**
 * D-09. Очередь «Позвонить».
 *
 * Все голосовые контакты в одном месте: лид с лендинга, заявка B2B, кандидат
 * в мастера. Экрана не было, а задачи копились — человек оставлял телефон и
 * не получал звонка.
 *
 * Просроченные сверху и красным: лид остывает за часы, и «перезвоним завтра»
 * означает, что звонить уже незачем.
 */

interface CallTaskRow {
  id: string;
  kind: string;
  title: string;
  phone: string;
  source: string;
  dueAt: string;
  overdue: boolean;
  minutesLeft: number;
  createdAt: string;
}

interface CallQueue {
  total: number;
  overdue: number;
  byKind: Record<string, number>;
  rows: CallTaskRow[];
}

const KIND: Record<string, string> = {
  b2c_lead: 'заявка с сайта',
  b2b_lead: 'организация',
  master_candidate: 'кандидат в мастера',
};

function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
}

export function CallQueue() {
  const toast = useToast();
  const { data, loading, error, reload } = useFetch<CallQueue>(() => api.get('/dispatch/ops/call-queue'));
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  if (loading) return <Loading />;
  if (error) return <ErrorBanner message={error} />;

  const close = async (row: CallTaskRow) => {
    // Итог обязателен и на сервере: «обзвонили» без результата неотличимо от
    // «закрыли, чтобы не мозолило»
    const result = window.prompt(`Итог звонка — ${row.title}:`);
    if (!result?.trim()) return;
    setBusy(row.id);
    setFailed(null);
    try {
      await api.post(`/dispatch/ops/call-queue/${row.id}/done`, { result });
      toast('Звонок закрыт');
      reload();
    } catch (e) {
      setFailed(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const rows = [...(data?.rows ?? [])].sort(
    (a, b) => Number(b.overdue) - Number(a.overdue) || a.dueAt.localeCompare(b.dueAt),
  );

  return (
    <>
      <div className="page-header">
        <h1>Позвонить</h1>
      </div>

      <div className="banner">
        Все голосовые контакты в одном месте: заявка с сайта, организация, кандидат в мастера.
        Лид остывает за часы — «перезвоним завтра» означает, что звонить уже незачем.
      </div>

      <div className="banner">
        {data?.total ?? 0} в очереди
        {Object.keys(data?.byKind ?? {}).length > 0 && (
          <>
            {' · '}
            {Object.entries(data?.byKind ?? {})
              .map(([k, n]) => `${KIND[k] ?? k}: ${n}`)
              .join(' · ')}
          </>
        )}
      </div>

      {(data?.overdue ?? 0) > 0 && (
        <div className="banner banner--warning">Просрочено: {data!.overdue}. Сначала звоним по ним</div>
      )}

      {failed && <ErrorBanner message={failed} />}

      <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Кто</th>
            <th>Телефон</th>
            <th>Откуда</th>
            <th>Срок</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <EmptyRow colSpan={5} />}
          {rows.map((r) => (
            <tr key={r.id} >
              <td>
                <strong>{r.title}</strong>
                <div className="muted">{KIND[r.kind] ?? r.kind}</div>
              </td>
              <td>{r.phone}</td>
              <td className="muted">{r.source}</td>
              <td>
                {r.overdue ? (
                  <span className="tone--error">просрочено на {Math.abs(r.minutesLeft)} мин</span>
                ) : (
                  <span>через {r.minutesLeft} мин</span>
                )}
                <div className="muted">{formatDateTime(r.dueAt)}</div>
              </td>
              <td>
                <button type="button" onClick={() => void close(r)} disabled={busy !== null}>
                  Дозвонился
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </>
  );
}
