import { useState } from 'react';
import { api } from '../api';
import { useFetch } from '../useFetch';
import { formatSoums } from '../format';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import type { Organization } from '../types';

/**
 * Пени за просрочку оплаты.
 *
 * Начисляются сами по себе каждый день, но счёт выставляется только по
 * решению человека: пени — всегда переговорный вопрос, и счёт, появившийся
 * автоматически, ссорит с клиентом надёжнее самой просрочки. Поэтому здесь
 * сначала расчёт, и только потом кнопка.
 *
 * Организации без условия о пенях в договоре в списке не показываются:
 * предлагать начислить то, чего нет в договоре, — приглашение к ошибке.
 */

interface PenaltyRow {
  invoiceId: string;
  number: string;
  amountTiyin: number;
  overdueDays: number;
  penaltyTiyin: number;
  capped: boolean;
}

interface Penalty {
  enabled: boolean;
  amountTiyin: number;
  ratePercentPerDay: number;
  capPercent: number;
  graceDays: number;
  rows: PenaltyRow[];
}

function OrgPenalty({ org, onIssued }: { org: Organization; onIssued: () => void }) {
  const toast = useToast();
  const { data, reload } = useFetch<Penalty>(
    () => api.get<Penalty>(`/admin/billing/penalties/${org.id}`),
    [org.id],
  );
  const [busy, setBusy] = useState(false);

  if (!data || !data.enabled) return null;

  const issue = async () => {
    setBusy(true);
    try {
      const inv = await api.post<{ number: string }>(`/admin/billing/penalties/${org.id}/issue`, {});
      toast(`Счёт на пени ${inv.number} выставлен`);
      reload();
      onIssued();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={data.amountTiyin > 0 ? 'card card--warning' : 'card'}>
      <div className="page-header" style={{ marginTop: 0 }}>
        <h1 style={{ fontSize: 16 }}>{org.name}</h1>
        <span className="num total">{formatSoums(data.amountTiyin)}</span>
      </div>
      <div className="muted">
        {data.ratePercentPerDay}% в день после {data.graceDays} дней, не больше {data.capPercent}% от суммы счёта
      </div>

      {data.rows.length === 0 ? (
        <div className="muted">Просроченных счетов нет</div>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Счёт</th>
                  <th className="num">Сумма счёта</th>
                  <th className="num">Просрочка</th>
                  <th className="num">Пени</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.invoiceId}>
                    <td className="mono">{r.number}</td>
                    <td className="num">{formatSoums(r.amountTiyin)}</td>
                    <td className="num">{r.overdueDays} дн.</td>
                    <td className="num">
                      {formatSoums(r.penaltyTiyin)}
                      {r.capped && <div className="muted">упёрлось в потолок</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void issue()}>
            Выставить счёт на пени
          </button>
        </>
      )}
    </div>
  );
}

export function BillingPenaltiesPage() {
  const { data, loading, error, reload } = useFetch<Organization[]>(
    () => api.get<Organization[]>('/admin/organizations'),
    [],
  );

  if (loading) return <Loading />;
  if (error !== null) return <ErrorBanner message={error} />;

  const orgs = (data ?? []).filter((o) => o.status !== 'terminated');

  return (
    <>
      <div className="page-header">
        <h1>Пени за просрочку</h1>
      </div>
      <div className="banner">
        Пени начисляются только тем организациям, у которых это записано в договоре. Счёт
        выставляется вручную: сумма растёт каждый день, а предъявлять её или нет — решение
        человека, а не системы
      </div>

      {orgs.length === 0 ? (
        <div className="table-wrap">
          <table>
            <tbody>
              <EmptyRow colSpan={1} />
            </tbody>
          </table>
        </div>
      ) : (
        orgs.map((o) => <OrgPenalty key={o.id} org={o} onIssued={reload} />)
      )}
    </>
  );
}
