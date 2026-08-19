import { useState } from 'react';
import { api } from '../api';
import { useFetch } from '../useFetch';
import { formatSoums } from '../format';
import { postWithSecondAdmin } from '../secondAdmin';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import type { BillingPeriod } from '../types';

/** A-19: закрытие периода — чек-лист + двойное подтверждение; блокер — красный баланс-чекер. */
export function BillingPeriodsPage() {
  const toast = useToast();
  const { data, loading, error, reload } = useFetch<BillingPeriod[]>(() =>
    api.get<BillingPeriod[]>('/admin/billing/periods'),
  );
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const act = async (month: string, action: 'close' | 'reopen') => {
    setBusy(true);
    setActionError(null);
    try {
      const res = await postWithSecondAdmin(
        `/admin/billing/periods/${action}`,
        { month },
        action === 'close'
          ? `Закрытие периода ${month} требует двойного подтверждения. Подтвердить?`
          : `Переоткрытие периода ${month} требует двойного подтверждения. Подтвердить?`,
      );
      if (res !== null) {
        toast(action === 'close' ? `Период ${month} закрыт` : `Период ${month} переоткрыт`);
        reload();
      }
    } catch (e) {
      // BALANCE_CHECK_FAILED и прочие ошибки — плашкой
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading />;
  if (error !== null) return <ErrorBanner message={error} />;

  const periods = data ?? [];

  return (
    <>
      <div className="page-header">
        <h1>Закрытие периода</h1>
      </div>

      <div className="banner">Закрытый период блокирует любые проводки (PERIOD_LOCKED).</div>

      {actionError !== null && <ErrorBanner message={actionError} />}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Месяц</th>
              <th>Статус</th>
              <th className="num">Проводок</th>
              <th className="num">Выручка</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {periods.length === 0 && <EmptyRow colSpan={5} />}
            {periods.map((p) => (
              <tr key={p.month}>
                <td className="mono">{p.month}</td>
                <td>
                  {p.closed ? (
                    <span className="badge badge--muted">Закрыт</span>
                  ) : (
                    <span className="badge badge--success">Открыт</span>
                  )}
                </td>
                <td className="num">{p.txCount}</td>
                <td className="num">{formatSoums(p.revenueTiyin)}</td>
                <td className="num">
                  {p.closed ? (
                    <button
                      type="button"
                      className="btn btn--link"
                      disabled={busy}
                      onClick={() => void act(p.month, 'reopen')}
                    >
                      Переоткрыть
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn--link"
                      disabled={busy}
                      onClick={() => void act(p.month, 'close')}
                    >
                      Закрыть период
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
