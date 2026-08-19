import { Link } from 'react-router-dom';
import { api } from '../api';
import { useFetch } from '../useFetch';
import { formatDateTime, formatSoums } from '../format';
import {
  disputeResolutionLabel,
  disputeRoleLabel,
  disputeStatusLabel,
  disputeStatusVariant,
} from '../qualityDicts';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';
import type { DisputesResponse } from '../types';

/**
 * Споры (ТЗ 4.2, D-11) — read-only срез для владельца платформы.
 * Спор открывается в окне 72 ч после «Выполнена» и блокирует долю мастера
 * до резолюции; возвраты идут через refund-API сторнирующей проводкой.
 */
export function DisputesPage() {
  const { data, loading, error } = useFetch<DisputesResponse>(() =>
    api.get<DisputesResponse>('/admin/quality/disputes'),
  );

  if (loading) return <Loading />;
  if (error !== null) return <ErrorBanner message={error} />;
  if (!data) return null;

  const { items, stats } = data;
  const byResolution = (r: string) =>
    stats.byResolution.find((x) => x.resolution === r)?.count ?? 0;

  const tiles: { value: number | string; label: string; small?: boolean }[] = [
    { value: stats.total, label: 'Споров всего' },
    { value: stats.open, label: 'Открытых' },
    {
      value: formatSoums(stats.refundTotalTiyin),
      label: 'Возвращено клиентам',
      small: true,
    },
    { value: byResolution('for_client'), label: 'В пользу клиента' },
    { value: byResolution('for_master'), label: 'В пользу мастера' },
    { value: byResolution('compromise'), label: 'Компромисс' },
  ];

  return (
    <>
      <div className="page-header">
        <h1>Споры</h1>
        <span className="muted">окно спора — 72 ч после «Выполнена»</span>
      </div>

      <div className="tiles">
        {tiles.map((t) => (
          <div className="card" key={t.label}>
            <div className={t.small === true ? 'tile__value tile__value--sm' : 'tile__value'}>
              {t.value}
            </div>
            <div className="tile__label">{t.label}</div>
          </div>
        ))}
      </div>

      <div className="section-title">Реестр споров</div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Заявка</th>
              <th>Инициатор</th>
              <th>Причина</th>
              <th className="num">Сумма</th>
              <th>Статус</th>
              <th className="num">Возврат</th>
              <th>Комментарий резолюции</th>
              <th>Создан</th>
              <th>Решён</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <EmptyRow colSpan={9} />
            ) : (
              items.map((d) => (
                <tr key={d.id}>
                  <td className="mono">{d.orderNumber}</td>
                  <td>
                    {d.openedByPhone}
                    <span className="chip chip--gap">{disputeRoleLabel(d.openedByRole)}</span>
                  </td>
                  <td>{d.reason}</td>
                  <td className="num">{formatSoums(d.amountTiyin)}</td>
                  <td>
                    <span className={`badge badge--${disputeStatusVariant(d.status)}`}>
                      {disputeStatusLabel(d.status)}
                    </span>
                    {d.masterShareBlocked && (
                      <span className="badge badge--warning">доля заблокирована</span>
                    )}
                  </td>
                  <td className="num">
                    {d.refundTiyin !== undefined ? formatSoums(d.refundTiyin) : '—'}
                  </td>
                  <td>
                    {d.resolution !== undefined && (
                      <span className="semibold">{disputeResolutionLabel(d.resolution)}. </span>
                    )}
                    {d.comment ?? '—'}
                  </td>
                  <td className="muted">{formatDateTime(d.createdAt)}</td>
                  <td className="muted">{formatDateTime(d.resolvedAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="banner banner--actions" style={{ marginTop: 'var(--s24)' }}>
        <span>
          Возвраты проводятся через refund-API сторнирующей проводкой — видны в журнале проводок
          (A-15)
        </span>
        <Link className="btn" to="/billing/accounts">
          Журнал проводок
        </Link>
      </div>
    </>
  );
}
