import { api } from '../api';
import { useFetch } from '../useFetch';
import { formatDate, formatSoums } from '../format';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';
import type { ReceivablesData } from '../types';

export function BillingReceivablesPage() {
  const { data, loading, error } = useFetch<ReceivablesData>(() =>
    api.get<ReceivablesData>('/admin/billing/receivables'),
  );

  if (loading) return <Loading />;
  if (error !== null) return <ErrorBanner message={error} />;
  if (!data) return null;

  const { buckets, rows } = data;

  const bucketTiles = [
    { label: '0–30 дней', value: buckets.d0_30, cardClass: undefined as string | undefined },
    { label: '31–60 дней', value: buckets.d31_60, cardClass: undefined as string | undefined },
    { label: '61–90 дней', value: buckets.d61_90, cardClass: buckets.d61_90 > 0 ? 'card--warning' : undefined },
    { label: '90+ дней', value: buckets.d90_plus, cardClass: buckets.d90_plus > 0 ? 'card--error' : undefined },
  ];

  return (
    <>
      <div className="page-header">
        <h1>Дебиторка</h1>
        <span className="muted">неоплаченные счета-фактуры по возрасту</span>
      </div>
      <div className="tiles">
        {bucketTiles.map((t) => (
          <div className={t.cardClass ? `card ${t.cardClass}` : 'card'} key={t.label}>
            <div className="tile__value tile__value--sm">{formatSoums(t.value)}</div>
            <div className="tile__label">{t.label}</div>
          </div>
        ))}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Номер</th>
              <th>Организация</th>
              <th className="num">Сумма</th>
              <th>Выставлена</th>
              <th className="num">Возраст, дней</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <EmptyRow colSpan={5} />}
            {rows.map((row) => (
              <tr key={row.number}>
                <td className="mono">{row.number}</td>
                <td>{row.organizationName}</td>
                <td className="num">{formatSoums(row.amountTiyin)}</td>
                <td className="num">{formatDate(row.issuedAt)}</td>
                <td className={row.ageDays > 60 ? 'num neg' : 'num'}>{row.ageDays}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
