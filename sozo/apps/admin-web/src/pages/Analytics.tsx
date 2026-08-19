import { useEffect } from 'react';
import { api } from '../api';
import { useFetch } from '../useFetch';
import { formatSoums, plural } from '../format';
import { demandMissReasonLabel } from '../qualityDicts';
import { Bar, BarRow } from '../components/Bars';
import { PnlCard } from '../components/PnlCard';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';
import type { AdminAnalytics } from '../types';

const REFRESH_MS = 60000;
const CHART_HEIGHT = 120;

/** Подпись колонки «дд.мм» из YYYY-MM-DD — без Date, чтобы часовой пояс не сдвигал день. */
function dayLabel(date: string): string {
  return `${date.slice(8, 10)}.${date.slice(5, 7)}`;
}

/**
 * Аналитика бизнеса (PRD-04 A-01, F-003…F-008): P&L, NPS, упущенный спрос,
 * follow-up и парные заявки. Всё считается на бэкенде по проводкам и заявкам —
 * админка только показывает срез, автообновление раз в минуту.
 */
export function AnalyticsPage() {
  const { data, loading, error, setData } = useFetch<AdminAnalytics>(() =>
    api.get<AdminAnalytics>('/admin/analytics'),
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      api
        .get<AdminAnalytics>('/admin/analytics')
        .then((d) => setData(() => d))
        .catch(() => undefined);
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [setData]);

  if (loading) return <Loading />;
  if (error !== null) return <ErrorBanner message={error} />;
  if (!data) return null;

  const { pnl, nps, demandMiss, followUp, pairs } = data;

  const npsBase = Math.max(nps.ratedCount, 1);
  const npsBars: { label: string; count: number; variant: 'success' | 'warning' | 'error' }[] = [
    { label: 'Промоутеры (9–10)', count: nps.promoters, variant: 'success' },
    { label: 'Нейтралы (7–8)', count: nps.passives, variant: 'warning' },
    { label: 'Критики (0–6)', count: nps.detractors, variant: 'error' },
  ];

  const categoryMax = Math.max(1, ...demandMiss.byCategory.map((c) => c.count));
  const dateMax = Math.max(1, ...demandMiss.byDate.map((d) => d.count));

  const followUpTiles: { value: string; label: string; hint?: string; small?: boolean }[] = [
    { value: String(followUp.clientsTotal), label: 'Клиентов всего' },
    {
      value: String(followUp.repeatClients),
      label: 'Повторных клиентов',
      hint: `${followUp.repeatSharePercent} % от базы`,
    },
    { value: String(followUp.repeatOrders), label: 'Повторных заявок' },
    {
      value: formatSoums(followUp.repeatRevenueTiyin),
      label: 'Выручка повторных',
      small: true,
    },
    { value: String(followUp.warrantyOrders), label: 'Гарантийных обращений' },
  ];

  return (
    <>
      <div className="page-header">
        <h1>Аналитика</h1>
        <span className="muted">обновляется каждые 60 сек</span>
      </div>

      <div className="section-title">P&amp;L — прибыль и рентабельность (F-007)</div>
      <PnlCard pnl={pnl} large />

      <div className="section-title">NPS — удовлетворённость клиентов (F-008)</div>
      <div className="card">
        <div className="metric">{nps.nps ?? 'нет оценок'}</div>
        <div className="muted">
          оценок {nps.ratedCount} из {nps.closedCount} закрытых ({nps.coveragePercent} %)
        </div>
        <div className="bars">
          {npsBars.map((b) => (
            <BarRow
              key={b.label}
              label={b.label}
              percent={(b.count / npsBase) * 100}
              value={String(b.count)}
              variant={b.variant}
            />
          ))}
        </div>
        {nps.note !== undefined && <div className="card-note">{nps.note}</div>}
      </div>

      <div className="section-title">Упущенный спрос (F-003)</div>
      <div className="card">
        <div className="metric">{demandMiss.total}</div>
        <div className="muted">{demandMiss.hint}</div>
      </div>

      <div className="section-title">По категориям</div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Категория</th>
              <th className="num">Кликов</th>
              <th>Доля</th>
            </tr>
          </thead>
          <tbody>
            {demandMiss.byCategory.length === 0 ? (
              <EmptyRow colSpan={3} />
            ) : (
              demandMiss.byCategory.map((c) => (
                <tr key={c.category}>
                  <td>{c.category}</td>
                  <td className="num">{c.count}</td>
                  <td>
                    <div className="bar-cell">
                      <Bar percent={(c.count / categoryMax) * 100} />
                      <span className="num">
                        {demandMiss.total > 0 ? Math.round((c.count / demandMiss.total) * 100) : 0}{' '}
                        %
                      </span>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="section-title">По дням</div>
      <div className="card">
        {demandMiss.byDate.length === 0 ? (
          <span className="muted">Пока пусто</span>
        ) : (
          <div className="columns">
            {demandMiss.byDate.map((d) => (
              <div className="column" key={d.date}>
                <span className="column__value">{d.count}</span>
                <span
                  className="column__bar"
                  style={{ height: `${Math.max(2, (d.count / dateMax) * CHART_HEIGHT)}px` }}
                />
                <span className="column__label">{dayLabel(d.date)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="section-title">По причинам</div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Причина</th>
              <th className="num">Кликов</th>
            </tr>
          </thead>
          <tbody>
            {demandMiss.byReason.length === 0 ? (
              <EmptyRow colSpan={2} />
            ) : (
              demandMiss.byReason.map((r) => (
                <tr key={r.reason}>
                  <td>{demandMissReasonLabel(r.reason)}</td>
                  <td className="num">{r.count}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="section-title">Follow-up и повторные клиенты (F-005)</div>
      <div className="tiles">
        {followUpTiles.map((t) => (
          <div className="card" key={t.label}>
            <div className={t.small === true ? 'tile__value tile__value--sm' : 'tile__value'}>
              {t.value}
            </div>
            <div className="tile__label">{t.label}</div>
            {t.hint !== undefined && <div className="tile__hint">{t.hint}</div>}
          </div>
        ))}
      </div>

      <div className="section-title">Парные заявки (F-004)</div>
      <div className="card">
        <div className="metric">
          {pairs.pairedSharePercent} <span className="metric__unit">%</span>
        </div>
        <div className="muted">
          {plural(pairs.pairedOrders, 'парная заявка', 'парные заявки', 'парных заявок')} из{' '}
          {pairs.ordersTotal}
        </div>
        <div className="card-note">{pairs.hint}</div>
      </div>
    </>
  );
}
