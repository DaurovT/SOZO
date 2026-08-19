import { api } from '../api';
import { useFetch } from '../useFetch';
import { formatDateTime, plural } from '../format';
import { DISPATCHER_URL } from '../orderDicts';
import {
  complaintStatusLabel,
  complaintStatusVariant,
  complaintTypeLabel,
  playbookLabel,
} from '../qualityDicts';
import { BarRow } from '../components/Bars';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';
import type { Complaint, ComplaintsResponse } from '../types';

/** Просрочен ли SLA у незакрытой жалобы: нет первого ответа в срок или вышел срок резолюции. */
function isOverdue(c: Complaint, now: number): boolean {
  if (c.status === 'resolved' || c.status === 'rejected') return false;
  const firstResponseLate =
    c.firstResponseAt === undefined && new Date(c.slaFirstResponseAt).getTime() < now;
  return firstResponseLate || new Date(c.slaResolutionAt).getTime() < now;
}

function openDispatcher() {
  window.open(DISPATCHER_URL, '_blank');
}

/**
 * Жалобы (ТЗ 17.10) — read-only дашборд качества для владельца платформы.
 * SLA: первый ответ ≤2 ч, резолюция ≤24 ч (деньги и приложение — ≤72 ч).
 * Регистрация, первый ответ и резолюция по плейбуку — в диспетчерской (D-10).
 */
export function ComplaintsPage() {
  const { data, loading, error } = useFetch<ComplaintsResponse>(() =>
    api.get<ComplaintsResponse>('/admin/quality/complaints'),
  );

  if (loading) return <Loading />;
  if (error !== null) return <ErrorBanner message={error} />;
  if (!data) return null;

  const { items, stats } = data;
  const now = Date.now();
  const typeMax = Math.max(1, ...stats.byType.map((t) => t.count));

  const tiles: { value: number | string; label: string; cardClass?: string }[] = [
    { value: stats.total, label: 'Жалоб всего' },
    { value: stats.open, label: 'Открытых' },
    {
      value: stats.overdueFirstResponse,
      label: 'Просрочен первый ответ',
      cardClass: stats.overdueFirstResponse > 0 ? 'card--outline-error' : undefined,
    },
    { value: stats.overdueResolution, label: 'Просрочена резолюция' },
    { value: `${stats.confirmedShare} %`, label: 'Доля подтверждённых' },
  ];

  return (
    <>
      <div className="page-header">
        <h1>Жалобы</h1>
        <span className="muted">SLA: первый ответ 2 ч, резолюция 24 ч (деньги и приложение 72 ч)</span>
      </div>

      <div className="tiles">
        {tiles.map((t) => (
          <div className={t.cardClass !== undefined ? `card ${t.cardClass}` : 'card'} key={t.label}>
            <div className="tile__value">{t.value}</div>
            <div className="tile__label">{t.label}</div>
          </div>
        ))}
      </div>

      {stats.patterns.length > 0 && (
        <>
          <div className="section-title">Паттерны</div>
          <div className="card card--error">
            <div className="semibold">
              {plural(
                stats.patterns.length,
                'мастер с повторяющимися жалобами',
                'мастера с повторяющимися жалобами',
                'мастеров с повторяющимися жалобами',
              )}
            </div>
            <ul className="plain-list">
              {stats.patterns.map((p) => (
                <li key={p.masterId}>
                  <span className="semibold">{p.masterName || p.masterId}</span> —{' '}
                  {plural(p.count, 'жалоба', 'жалобы', 'жалоб')} за 30 дней
                  <span className="muted">
                    {' '}
                    ({p.types.map((t) => complaintTypeLabel(t)).join(', ')})
                  </span>
                </li>
              ))}
            </ul>
            <div className="card-note">повод для разбора (ТЗ 17.10)</div>
          </div>
        </>
      )}

      <div className="section-title">По типам</div>
      <div className="card">
        {stats.byType.length === 0 ? (
          <span className="muted">Пока пусто</span>
        ) : (
          <div className="bars">
            {stats.byType.map((t) => (
              <BarRow
                key={t.type}
                label={complaintTypeLabel(t.type)}
                percent={(t.count / typeMax) * 100}
                value={String(t.count)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="section-title">Реестр жалоб</div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Заявка</th>
              <th>Заявитель</th>
              <th>Тип</th>
              <th>Статус</th>
              <th>Мастер</th>
              <th>Метод плейбука</th>
              <th>Подтверждена</th>
              <th>Создана</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <EmptyRow colSpan={8} />
            ) : (
              items.map((c) => (
                <tr key={c.id} className={isOverdue(c, now) ? 'row--warning' : undefined}>
                  <td className="mono">{c.orderNumber ?? '—'}</td>
                  <td>
                    {c.complainantName ?? c.complainantPhone}
                    {c.isOrgManager && <span className="chip chip--gap">руководитель B2B</span>}
                  </td>
                  <td>{complaintTypeLabel(c.type)}</td>
                  <td>
                    <span className={`badge badge--${complaintStatusVariant(c.status)}`}>
                      {complaintStatusLabel(c.status)}
                    </span>
                  </td>
                  <td>{c.masterName ?? '—'}</td>
                  <td>{c.playbookCode !== undefined ? playbookLabel(c.playbookCode) : '—'}</td>
                  <td>{c.confirmed === undefined ? '—' : c.confirmed ? 'Да' : 'Нет'}</td>
                  <td className="muted">{formatDateTime(c.createdAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="banner banner--warning banner--actions" style={{ marginTop: 'var(--s24)' }}>
        <span>Регистрация и резолюция жалоб — в диспетчерской (D-10)</span>
        <button type="button" className="btn btn--primary" onClick={openDispatcher}>
          Открыть диспетчерскую
        </button>
      </div>
    </>
  );
}
