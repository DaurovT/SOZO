import { useEffect, useState } from 'react';
import { ApiError, request } from '../api';
import { getOrgId } from '../auth';
import { useFetch } from '../useFetch';
import { Empty, ErrorState, Loading } from '../components/States';
import { soums, untilText } from '../format';

/**
 * U-04. Экран, который делает предложение неугрожающим для собственной службы:
 * заявка жителя сначала предлагается ей и лишь потом уходит в общий пул.
 */

interface QueueItem {
  id: string;
  number: string;
  description: string;
  address: string;
  totalFromTiyin: number;
  firstRefusalUntil: string;
  expired: boolean;
  releasedReason: string | null;
}

interface Payload {
  queue: QueueItem[];
  stats: { days: number; taken: number; released: number; topReasons: Array<{ reason: string; count: number }> };
}

const RELEASE_REASONS = [
  'Нет свободных мастеров',
  'Нет компетенции по этой работе',
  'Не наш профиль',
  'Вне часов работы службы',
];

/** Таймеры окна должны идти сами, пока диспетчер смотрит на очередь. */
function useTick(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

export function FirstRefusal() {
  const org = getOrgId();
  const now = useTick(1000);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const { data, loading, error, reload } = useFetch<Payload>(org ? `/operator/${org}/first-refusal` : null);

  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return null;

  async function act(item: QueueItem, action: 'claim' | 'release', reason?: string) {
    setBusy(item.id);
    try {
      await request(`/operator/${org}/orders/${item.id}/${action}`, { body: action === 'release' ? { reason } : {} });
      setToast(action === 'claim' ? 'Заявка закреплена за вашей службой' : 'Заявка отпущена в общий пул');
      reload();
    } catch (e) {
      setToast(e instanceof ApiError ? e.message : 'Не удалось');
    } finally {
      setBusy(null);
    }
  }

  const live = data.queue.filter((q) => !q.expired);
  const missed = data.queue.filter((q) => q.expired);

  return (
    <>
      <div>
        <h1 className="h1">Первая рука</h1>
        <div className="cap" style={{ marginTop: 'var(--s4)' }}>
          Заявки жителей в ваших домах. Не возьмёте — уйдут мастерам платформы
        </div>
      </div>

      {live.length === 0 && missed.length === 0 ? (
        <Empty text="Новых заявок в окне первой руки нет" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s16)' }}>
          {live.map((q) => {
            const left = untilText(q.firstRefusalUntil, now);
            return (
              <div key={q.id} className="card" style={{ padding: 'var(--s16)', borderLeft: '3px solid var(--accent)' }}>
                <div style={{ display: 'flex', gap: 'var(--s24)', alignItems: 'flex-start' }}>
                  <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 'var(--s8)' }}>
                    <span
                      className={`chip ${Date.parse(q.firstRefusalUntil) - now < 5 * 60_000 ? 'chip--error' : 'chip--warning'}`}
                      style={{ fontWeight: 600, alignSelf: 'flex-start' }}
                    >
                      {left.text}
                    </span>
                    <div className="h2" style={{ fontSize: 18 }}>{q.description || 'Без описания'}</div>
                    <div className="cap">{q.address} · заявка {q.number}</div>
                    {q.totalFromTiyin > 0 && (
                      <div className="dense" style={{ color: 'var(--text-secondary)' }}>
                        Оценка платформы: от {soums(q.totalFromTiyin)} сум
                      </div>
                    )}
                  </div>

                  <div style={{ width: 260, display: 'flex', flexDirection: 'column', gap: 'var(--s8)' }}>
                    <button className="btn btn--lg" disabled={busy === q.id} onClick={() => act(q, 'claim')}>
                      Взять своей службой
                    </button>
                    <select
                      className="input"
                      disabled={busy === q.id}
                      defaultValue=""
                      onChange={(e) => {
                        if (e.target.value) act(q, 'release', e.target.value);
                      }}
                    >
                      <option value="" disabled>Отпустить — укажите причину</option>
                      {RELEASE_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                    {/* Экономику проговариваем прямо здесь: это предмет договорённости,
                        и прятать её означает, что оператор узнает о ней из расчёта */}
                    <div className="card" style={{ padding: 'var(--s12)', background: 'var(--bg)', border: 'none' }}>
                      <div className="cap">
                        Отпустите — житель получит мастера платформы, а вы <b style={{ color: 'var(--text)' }}>5% с заявки</b>.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {missed.length > 0 && (
            <div className="card" style={{ padding: 'var(--s16)' }}>
              <div className="cap" style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 'var(--s8)' }}>
                Ушли в общий пул за последний час
              </div>
              {missed.map((q) => (
                <div key={q.id} style={{ display: 'flex', gap: 'var(--s12)', padding: 'var(--s4) 0' }}>
                  <div className="dense" style={{ flexGrow: 1 }}>{q.description || q.number}</div>
                  <div className="cap">{q.releasedReason ?? 'окно истекло'}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="card" style={{ padding: 'var(--s16)', background: 'var(--bg)', borderStyle: 'dashed' }}>
        <div className="dense" style={{ fontWeight: 600, marginBottom: 'var(--s4)' }}>
          За последние {data.stats.days} дней
        </div>
        <div className="cap">
          Взято своей службой — {data.stats.taken} · отпущено — {data.stats.released}
          {data.stats.topReasons[0] && ` · чаще всего «${data.stats.topReasons[0].reason}»`}
        </div>
      </div>

      {toast && <div className="toast" onClick={() => setToast(null)}>{toast}</div>}
    </>
  );
}
