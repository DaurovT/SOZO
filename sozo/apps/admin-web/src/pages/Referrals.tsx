import { useState } from 'react';
import { api } from '../api';
import { useFetch } from '../useFetch';
import { formatDate, formatSoums } from '../format';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';
import { useToast } from '../components/Toast';

interface ReferralRow {
  referrerCode: string;
  referrerName: string;
  invitedMasterId: string;
  invitedName: string;
  invitedPhone: string;
  invitedStatus: string;
  closedOrders: number;
  target: number;
  bonusTiyin: number;
  earned: boolean;
  paidAt: string | null;
}

interface ReferralsResponse {
  rows: ReferralRow[];
  target: number;
  bonusTiyin: number;
  rule: string;
  totals: { pairs: number; earned: number; paid: number; payableTiyin: number };
  empty: string;
}

/**
 * A-13: реферальная программа мастеров (ТЗ 18 п.11).
 *
 * Связка «кто кого привёл» ставится при создании карточки из анкеты кандидата:
 * код пригласившего мастер вводит в приложении. Закрытые заявки считаются по
 * журналу заявок, поэтому счётчик не расходится с кошельком.
 */
export function ReferralsPage() {
  const toast = useToast();
  const { data, loading, error, reload } = useFetch<ReferralsResponse>(() =>
    api.get<ReferralsResponse>('/admin/referrals'),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const markPaid = async (row: ReferralRow) => {
    setBusy(row.invitedMasterId);
    setActionError(null);
    try {
      await api.post('/admin/referrals/paid', { invitedMasterId: row.invitedMasterId });
      toast(`Бонус за ${row.invitedName} отмечен выплаченным`);
      reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <Loading />;
  if (error !== null) return <ErrorBanner message={error} />;

  const d = data;
  const rows = d?.rows ?? [];

  return (
    <>
      <div className="page-header">
        <h1>Реферальная программа мастеров</h1>
        <span className="muted">бонус за приведённого мастера (ТЗ 18 п.11)</span>
      </div>

      {actionError !== null && <ErrorBanner message={actionError} />}

      <div className="banner">{d?.rule}</div>

      <div className="cards">
        <div className="card">
          <div className="card__label">Пар</div>
          <div className="card__value">{d?.totals.pairs ?? 0}</div>
        </div>
        <div className="card">
          <div className="card__label">Заработано, ждёт выплаты</div>
          <div className="card__value">{d?.totals.earned ?? 0}</div>
        </div>
        <div className="card">
          <div className="card__label">К выплате</div>
          <div className="card__value">{formatSoums(d?.totals.payableTiyin ?? 0)}</div>
        </div>
        <div className="card">
          <div className="card__label">Выплачено</div>
          <div className="card__value">{d?.totals.paid ?? 0}</div>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Кто привёл</th>
              <th>Кого привёл</th>
              <th>Телефон</th>
              <th className="num">Закрыто заявок</th>
              <th className="num">Бонус</th>
              <th>Статус</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <EmptyRow colSpan={7} />}
            {rows.map((r) => (
              <tr key={r.invitedMasterId}>
                <td>{r.referrerName}</td>
                <td>{r.invitedName}</td>
                <td className="mono">{r.invitedPhone}</td>
                <td className="num">
                  {r.closedOrders} / {r.target}
                </td>
                <td className="num">{formatSoums(r.bonusTiyin)}</td>
                <td>
                  {r.paidAt !== null ? (
                    <span className="badge badge--muted" title={formatDate(r.paidAt)}>
                      Выплачен
                    </span>
                  ) : r.earned ? (
                    <span className="badge badge--success">Заработан</span>
                  ) : (
                    <span className="badge badge--warning">Накапливается</span>
                  )}
                </td>
                <td>
                  {r.earned && r.paidAt === null && (
                    <button
                      type="button"
                      className="btn btn--link"
                      disabled={busy !== null}
                      onClick={() => void markPaid(r)}
                    >
                      Отметить выплаченным
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length === 0 && <div className="banner">{d?.empty}</div>}
    </>
  );
}
