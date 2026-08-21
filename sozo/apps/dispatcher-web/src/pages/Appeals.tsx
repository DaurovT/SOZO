import { useState } from 'react';
import { api, ApiError } from '../api';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import { formatDateTime } from '../format';
import { useFetch } from '../useFetch';

/**
 * D-20. Апелляции мастеров.
 *
 * Мастер оспаривает оценку, удержание или санкцию. Экран нужен не ради
 * вежливости: удержание — это деньги человека, и решение по нему обязано
 * приниматься кем-то, а не истекать по умолчанию. До сих пор апелляции
 * копились в базе и не показывались никому.
 */

interface AppealRow {
  id: string;
  masterId: string;
  masterName: string | null;
  subject: string;
  reference: string;
  text: string;
  status: string;
  resolution?: string;
  createdAt: string;
  resolvedAt?: string;
  daysOpen: number;
}

interface AppealsData {
  total: number;
  open: number;
  rows: AppealRow[];
}

const SUBJECT: Record<string, string> = {
  rating: 'оценка',
  deduction: 'удержание',
  sanction: 'санкция',
  complaint: 'жалоба',
};

const STATUS: Record<string, string> = { open: 'открыта', accepted: 'принята', rejected: 'отклонена' };

function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
}

export function Appeals() {
  const toast = useToast();
  const { data, loading, error, reload } = useFetch<AppealsData>(() => api.get('/dispatch/ops/appeals'));
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const decide = async (row: AppealRow, accept: boolean) => {
    // Решение читает человек, которого оно касается, — поэтому объяснение
    // обязательно и на сервере
    const resolution = window.prompt(accept ? 'Что решили и почему приняли:' : 'Почему отклонили:');
    if (!resolution?.trim()) return;
    setBusy(row.id);
    setFailed(null);
    try {
      await api.post(`/dispatch/ops/appeals/${row.id}/decide`, { accept, resolution });
      toast(accept ? 'Апелляция принята' : 'Апелляция отклонена');
      reload();
    } catch (e) {
      setFailed(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="page-header">
        <h1>Апелляции мастеров</h1>
      </div>

      <div className="banner">
        Удержание — это деньги человека. Решение по апелляции обязано приниматься кем-то, а не
        истекать по умолчанию.
      </div>

      {error !== null && <ErrorBanner message={error} />}
      {failed !== null && <ErrorBanner message={failed} />}
      {loading && !data && <Loading />}

      {data && (
        <>
          <div className="banner">
            {data.open} открытых из {data.total}
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Мастер</th>
                  <th>Что оспаривает</th>
                  <th>Текст</th>
                  <th>Статус</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 && <EmptyRow colSpan={5} />}
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.masterName ?? r.masterId.slice(0, 8)}</strong>
                      <div className="muted">{formatDateTime(r.createdAt)}</div>
                    </td>
                    <td>
                      {SUBJECT[r.subject] ?? r.subject}
                      <div className="muted">{r.reference}</div>
                    </td>
                    <td>{r.text}</td>
                    <td>
                      {STATUS[r.status] ?? r.status}
                      {r.status === 'open' && r.daysOpen >= 3 && (
                        <div className="tone--error">ждёт {r.daysOpen} дн.</div>
                      )}
                      {r.resolution && <div className="muted">{r.resolution}</div>}
                    </td>
                    <td>
                      {r.status === 'open' && (
                        <>
                          <button type="button" onClick={() => void decide(r, true)} disabled={busy !== null}>
                            Принять
                          </button>{' '}
                          <button type="button" onClick={() => void decide(r, false)} disabled={busy !== null}>
                            Отклонить
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
