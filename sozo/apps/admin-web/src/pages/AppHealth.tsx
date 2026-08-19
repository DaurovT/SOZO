import { useState } from 'react';
import { api } from '../api';
import { useFetch } from '../useFetch';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';
import { formatDateTime } from '../format';

/**
 * Живые показатели приложений: офлайн-очередь мастеров и воронка создания
 * заявки у клиента.
 *
 * Отдельно от макета «Мониторинг системы»: там аптайм и вебхуки, которые
 * появятся с инфраструктурой. Здесь — то, что платформа умеет считать уже
 * сейчас, и что до этого экрана никто не видел.
 */

interface OfflineQueue {
  totalDepth: number;
  mastersWithQueue: number;
  reportedMasters: number;
  rows: Array<{
    masterId: string;
    masterName: string;
    depth: number;
    oldestAt: string | null;
    reportedAt: string | null;
    stale: boolean;
  }>;
  note: string;
}

interface Funnel {
  days: number;
  steps: Array<{ event: string; title: string; count: number; dropFromPrev: number }>;
  conversionPercent: number;
  otherEvents: string[];
}

export function AppHealthPage() {
  const [days, setDays] = useState(7);
  const queue = useFetch<OfflineQueue>(() => api.get<OfflineQueue>('/admin/monitoring/offline-queue'), []);
  const funnel = useFetch<Funnel>(() => api.get<Funnel>(`/admin/monitoring/funnel?days=${days}`), [days]);

  return (
    <>
      <div className="page-header">
        <h1>Приложения: очередь и воронка</h1>
      </div>

      <div className="section-title" style={{ marginTop: 0 }}>
        Офлайн-очередь приложения мастера
      </div>
      {queue.error !== null && <ErrorBanner message={queue.error} />}
      {queue.loading && !queue.data && <Loading />}
      {queue.data && (
        <>
          <div className="tiles">
            <div className={queue.data.totalDepth > 0 ? 'card card--warning' : 'card'}>
              <div className="tile__value">{queue.data.totalDepth}</div>
              <div className="tile__label">действий ждёт отправки</div>
            </div>
            <div className="card">
              <div className="tile__value">{queue.data.mastersWithQueue}</div>
              <div className="tile__label">мастеров с очередью</div>
            </div>
            <div className="card">
              <div className="tile__value">{queue.data.reportedMasters}</div>
              <div className="tile__label">выходили на связь за сутки</div>
            </div>
          </div>
          <div className="banner">{queue.data.note}</div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Мастер</th>
                  <th className="num">В очереди</th>
                  <th>Самая старая операция</th>
                  <th>Последняя связь</th>
                </tr>
              </thead>
              <tbody>
                {queue.data.rows.length === 0 && <EmptyRow colSpan={4} />}
                {queue.data.rows.map((r) => (
                  <tr key={r.masterId} className={r.depth > 0 && !r.stale ? 'row--warning' : undefined}>
                    <td>
                      {r.masterName}
                      {r.stale && <span className="badge badge--muted">нет связи сутки</span>}
                    </td>
                    <td className="num">{r.depth}</td>
                    <td className="muted">{r.oldestAt === null ? '—' : formatDateTime(r.oldestAt)}</td>
                    <td className="muted">{r.reportedAt === null ? 'не отчитывался' : formatDateTime(r.reportedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="page-header" style={{ marginTop: 'var(--s24)' }}>
        <h1 style={{ fontSize: 16 }}>Воронка создания заявки в приложении клиента</h1>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={1}>За сутки</option>
          <option value={7}>За неделю</option>
          <option value={30}>За месяц</option>
        </select>
      </div>
      {funnel.error !== null && <ErrorBanner message={funnel.error} />}
      {funnel.loading && !funnel.data && <Loading />}
      {funnel.data && (
        <>
          <div className="tiles">
            <div className="card">
              <div className="tile__value">{funnel.data.conversionPercent}%</div>
              <div className="tile__label">дошли от открытия до отправки</div>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Шаг</th>
                  <th className="num">Человек</th>
                  <th className="num">Отвал от предыдущего</th>
                </tr>
              </thead>
              <tbody>
                {funnel.data.steps.map((s) => (
                  <tr key={s.event} className={s.dropFromPrev >= 30 ? 'row--warning' : undefined}>
                    <td>{s.title}</td>
                    <td className="num">{s.count}</td>
                    <td className="num">{s.dropFromPrev === 0 ? '—' : `${s.dropFromPrev}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {funnel.data.otherEvents.length > 0 && (
            <div className="muted">
              Другие события приложения за период: {funnel.data.otherEvents.join(', ')}
            </div>
          )}
        </>
      )}
    </>
  );
}
