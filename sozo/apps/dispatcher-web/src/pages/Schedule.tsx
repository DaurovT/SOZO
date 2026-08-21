import { useState } from 'react';
import { api, ApiError } from '../api';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import { useFetch } from '../useFetch';

/**
 * D-14. Расписание мастеров.
 *
 * Смены, отпуска и больничные вместе, потому что вопрос один: кто завтра
 * выйдет. Отпуск, о котором знает только кадровик, — это смена, поставленная
 * на человека, которого не будет, и заявка, которую некому выполнить.
 */

interface ScheduleData {
  date: string;
  mastersTotal: number;
  withShift: number;
  away: Array<{ masterId: string; masterName: string | null; kind: string; from: string; to: string }>;
  conflicts: Array<{ masterId: string; masterName: string }>;
  withoutShift: Array<{ masterId: string; fullName: string }>;
  pendingTimeOff: Array<{
    id: string;
    masterId: string;
    from: string;
    to: string;
    kind: string;
    comment?: string;
  }>;
}

const KIND: Record<string, string> = { vacation: 'отпуск', sick: 'больничный' };

function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
}

export function Schedule() {
  const toast = useToast();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const { data, loading, error, reload } = useFetch<ScheduleData>(
    () => api.get(`/dispatch/ops/schedule?date=${date}`),
    [date],
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const decide = async (id: string, approve: boolean) => {
    // Отказ объясняется: без причины мастер не знает, подавать ли заново
    const reason = approve ? undefined : window.prompt('Причина отказа:');
    if (!approve && !reason?.trim()) return;
    setBusy(id);
    setFailed(null);
    try {
      await api.post(`/dispatch/ops/time-off/${id}/decide`, { approve, reason });
      toast(approve ? 'Отпуск согласован' : 'Отказано');
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
        <h1>Расписание мастеров</h1>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      <div className="banner">
        Смены, отпуска и больничные вместе: отпуск, о котором знает только кадровик, — это смена,
        поставленная на человека, которого не будет.
      </div>

      {error !== null && <ErrorBanner message={error} />}
      {failed !== null && <ErrorBanner message={failed} />}
      {loading && !data && <Loading />}

      {data && (
        <>
          <div className="banner">
            На смене {data.withShift} из {data.mastersTotal} активных
            {data.away.length > 0 ? ` · отсутствуют: ${data.away.length}` : ''}
          </div>

          {data.conflicts.length > 0 && (
            <div className="banner banner--error">
              Смена поставлена на отсутствующих: {data.conflicts.map((c) => c.masterName ?? c.masterId).join(', ')}.
              Заявка встанет на человека, которого в этот день нет.
            </div>
          )}

          {data.withoutShift.length > 0 && (
            <div className="banner banner--warning">
              Без смены: {data.withoutShift.map((m) => m.fullName).join(', ')} — планировщик их не увидит
            </div>
          )}

          <h2 className="section-title">Заявки на отпуск</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Мастер</th>
                  <th>Что</th>
                  <th>Период</th>
                  <th>Комментарий</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.pendingTimeOff.length === 0 && <EmptyRow colSpan={5} />}
                {data.pendingTimeOff.map((r) => (
                  <tr key={r.id}>
                    <td>{r.masterId}</td>
                    <td>{KIND[r.kind] ?? r.kind}</td>
                    <td>
                      {r.from} — {r.to}
                    </td>
                    <td className="muted">{r.comment ?? '—'}</td>
                    <td>
                      <button type="button" onClick={() => void decide(r.id, true)} disabled={busy !== null}>
                        Согласовать
                      </button>{' '}
                      <button type="button" onClick={() => void decide(r.id, false)} disabled={busy !== null}>
                        Отказать
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="section-title">Отсутствуют в этот день</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Мастер</th>
                  <th>Что</th>
                  <th>Период</th>
                </tr>
              </thead>
              <tbody>
                {data.away.length === 0 && <EmptyRow colSpan={3} />}
                {data.away.map((a) => (
                  <tr key={`${a.masterId}-${a.from}`}>
                    <td>{a.masterName ?? a.masterId}</td>
                    <td>{KIND[a.kind] ?? a.kind}</td>
                    <td>
                      {a.from} — {a.to}
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
