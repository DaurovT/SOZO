import { Link } from 'react-router-dom';
import { api } from '../api';
import { useFetch } from '../useFetch';
import { formatDate, formatSoums } from '../format';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';

/**
 * Дунинг — работа с просроченной оплатой.
 *
 * Ступени ставит планировщик, а не этот экран: T+3 предупреждение,
 * T+7 приостановка обслуживания, кроме аварийных заявок (ТЗ 8.9). Здесь
 * видно, у кого что просрочено и на какой ступени он сейчас — чтобы звонить
 * до приостановки, а не после.
 */

interface DunningInvoice {
  id: string;
  number: string;
  amountTiyin: number;
  issuedAt: string;
  days: number;
}

interface DunningRow {
  organizationId: string;
  organizationName: string;
  status: string;
  unpaidCount: number;
  unpaidTiyin: number;
  oldestDays: number;
  stage: string;
  suspended: boolean;
  invoices: DunningInvoice[];
}

interface DunningData {
  organizations: DunningRow[];
  warned: number;
  suspended: number;
  totalTiyin: number;
  note: string;
}

export function DunningPage() {
  const { data, loading, error } = useFetch<DunningData>(() => api.get<DunningData>('/admin/billing/dunning'), []);

  if (loading) return <Loading />;
  if (error !== null) return <ErrorBanner message={error} />;
  if (!data) return null;

  const rows = data.organizations;

  return (
    <>
      <div className="page-header">
        <h1>Дунинг</h1>
        <span className="num total">{formatSoums(data.totalTiyin)}</span>
      </div>

      <div className="banner">{data.note}</div>

      <div className="tiles">
        <div className={data.warned > 0 ? 'card card--warning' : 'card'}>
          <div className="tile__value">{data.warned}</div>
          <div className="tile__label">получили предупреждение</div>
          <div className="tile__hint">просрочка 3–6 дней — время звонить</div>
        </div>
        <div className={data.suspended > 0 ? 'card card--outline-error' : 'card'}>
          <div className="tile__value">{data.suspended}</div>
          <div className="tile__label">обслуживание остановлено</div>
          <div className="tile__hint">доступны только аварийные заявки</div>
        </div>
        <div className="card">
          <div className="tile__value tile__value--sm">{formatSoums(data.totalTiyin)}</div>
          <div className="tile__label">просрочено всего</div>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Организация</th>
              <th className="num">Счетов</th>
              <th className="num">Сумма</th>
              <th className="num">Старший счёт</th>
              <th>Ступень</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <EmptyRow colSpan={5} />}
            {rows.map((r) => (
              <tr key={r.organizationId} className={r.oldestDays >= 7 ? 'row--warning' : undefined}>
                <td>
                  <Link to={`/organizations/${r.organizationId}`}>{r.organizationName}</Link>
                  {r.suspended && <div className="muted">договор приостановлен</div>}
                </td>
                <td className="num">{r.unpaidCount}</td>
                <td className="num">{formatSoums(r.unpaidTiyin)}</td>
                <td className="num">{r.oldestDays} дн.</td>
                <td>
                  <span
                    className={
                      r.oldestDays >= 7 ? 'badge badge--error' : r.oldestDays >= 3 ? 'badge badge--warning' : 'badge'
                    }
                  >
                    {r.stage}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length > 0 && (
        <>
          <div className="section-title">Просроченные счета</div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Счёт</th>
                  <th>Организация</th>
                  <th className="num">Сумма</th>
                  <th>Выставлен</th>
                  <th className="num">Просрочка</th>
                </tr>
              </thead>
              <tbody>
                {rows.flatMap((r) =>
                  r.invoices.map((i) => (
                    <tr key={i.id} className={i.days >= 7 ? 'row--warning' : undefined}>
                      <td className="mono">{i.number}</td>
                      <td>{r.organizationName}</td>
                      <td className="num">{formatSoums(i.amountTiyin)}</td>
                      <td className="num">{formatDate(i.issuedAt)}</td>
                      <td className="num">{i.days} дн.</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
