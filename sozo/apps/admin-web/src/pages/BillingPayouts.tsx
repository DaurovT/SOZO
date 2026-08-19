import { useState } from 'react';
import { api } from '../api';
import { useFetch } from '../useFetch';
import { formatSoums } from '../format';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import type { PayoutRow } from '../types';

export function BillingPayoutsPage() {
  const toast = useToast();
  const { data, loading, error, reload } = useFetch<PayoutRow[]>(() =>
    api.get<PayoutRow[]>('/admin/billing/payouts'),
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const pay = async (row: PayoutRow) => {
    if (
      !window.confirm(`Выплатить ${formatSoums(row.dueTiyin)} мастеру «${row.masterName}»?`)
    ) {
      return;
    }
    setBusyId(row.masterId);
    setActionError(null);
    try {
      await api.post(`/admin/billing/payouts/${row.masterId}/pay`);
      toast(`Выплачено: ${formatSoums(row.dueTiyin)}`);
      reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <Loading />;
  if (error !== null) return <ErrorBanner message={error} />;

  const rows = data ?? [];

  return (
    <>
      <div className="page-header">
        <h1>Ведомости выплат</h1>
      </div>
      {actionError !== null && <ErrorBanner message={actionError} />}
      <div className="banner">
        К выплате = начисления − удержания − принятые наличные (ТЗ 8.6); выплаты еженедельно
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Мастер</th>
              <th className="num">Начислено</th>
              <th className="num">Выплачено</th>
              <th className="num">К выплате</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <EmptyRow colSpan={5} />}
            {rows.map((row) => (
              <tr key={row.masterId}>
                <td>{row.masterName}</td>
                <td className="num">{formatSoums(row.accruedTiyin)}</td>
                <td className="num">{formatSoums(row.paidTiyin)}</td>
                <td className="num semibold">{formatSoums(row.dueTiyin)}</td>
                <td>
                  <button
                    type="button"
                    className="btn"
                    disabled={row.dueTiyin <= 0 || busyId === row.masterId}
                    onClick={() => void pay(row)}
                  >
                    Выплатить
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
