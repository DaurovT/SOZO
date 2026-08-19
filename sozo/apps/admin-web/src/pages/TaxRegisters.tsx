import { useState } from 'react';
import { api } from '../api';
import { useFetch } from '../useFetch';
import { downloadCsv } from '../csv';
import { formatDateTime, formatSoums } from '../format';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';
import type { Master, TaxRegisters } from '../types';

const CHANNEL_LABELS: Record<string, string> = {
  cash_masters: 'наличные (ОФД)',
  clearing: 'онлайн',
};

/** Сумы для CSV — числом, без « сум». */
const csvSoums = (tiyin: number) => Math.round(tiyin / 100);

/** A-31: налоговые регистры — реестры СФ / чеков / выплат, CSV на клиенте. */
export function TaxRegistersPage() {
  const [month, setMonth] = useState('');
  const { data, loading, error } = useFetch<TaxRegisters>(
    () => api.get<TaxRegisters>(`/admin/billing/tax-registers${month ? `?month=${month}` : ''}`),
    [month],
  );
  const { data: masters } = useFetch<Master[]>(() => api.get<Master[]>('/admin/masters'));

  const masterName = (id?: string) =>
    (id && masters?.find((m) => m.id === id)?.fullName) || id || '—';

  const suffix = month || 'all';

  return (
    <>
      <div className="page-header">
        <h1>Налоговые регистры</h1>
        <div className="field" style={{ minWidth: 180 }}>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            aria-label="Месяц"
          />
        </div>
      </div>

      {loading && <Loading />}
      {error !== null && <ErrorBanner message={error} />}

      {data && (
        <>
          <div className="page-header" style={{ marginTop: 'var(--s24)' }}>
            <h1 style={{ fontSize: 16 }}>Реестр счетов-фактур</h1>
            <button
              type="button"
              className="btn"
              onClick={() =>
                downloadCsv(
                  `invoices-${suffix}.csv`,
                  ['Номер', 'Организация', 'Сумма, сум', 'НДС изнутри, сум', 'Статус', 'Дата'],
                  data.invoicesRegister.map((i) => [
                    i.number,
                    i.organization,
                    csvSoums(i.amountTiyin),
                    csvSoums(i.vatTiyin),
                    i.status,
                    i.issuedAt,
                  ]),
                )
              }
            >
              Скачать CSV
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Номер</th>
                  <th>Организация</th>
                  <th className="num">Сумма</th>
                  <th className="num">НДС изнутри</th>
                  <th>Статус</th>
                  <th>Дата</th>
                </tr>
              </thead>
              <tbody>
                {data.invoicesRegister.length === 0 && <EmptyRow colSpan={6} />}
                {data.invoicesRegister.map((i) => (
                  <tr key={i.number}>
                    <td className="mono">{i.number}</td>
                    <td>{i.organization}</td>
                    <td className="num">{formatSoums(i.amountTiyin)}</td>
                    <td className="num">{formatSoums(i.vatTiyin)}</td>
                    <td>
                      {i.status === 'paid' ? (
                        <span className="badge badge--success">Оплачена</span>
                      ) : (
                        <span className="badge badge--warning">Выставлена</span>
                      )}
                    </td>
                    <td className="num">{formatDateTime(i.issuedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="page-header" style={{ marginTop: 'var(--s24)' }}>
            <h1 style={{ fontSize: 16 }}>Реестр чеков</h1>
            <button
              type="button"
              className="btn"
              onClick={() =>
                downloadCsv(
                  `receipts-${suffix}.csv`,
                  ['Заявка', 'Канал', 'Сумма, сум', 'Дата'],
                  data.receiptsRegister.map((r) => [
                    r.orderId ?? '',
                    CHANNEL_LABELS[r.channel] ?? r.channel,
                    csvSoums(r.amountTiyin),
                    r.at,
                  ]),
                )
              }
            >
              Скачать CSV
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Заявка</th>
                  <th>Канал</th>
                  <th className="num">Сумма</th>
                  <th>Дата</th>
                </tr>
              </thead>
              <tbody>
                {data.receiptsRegister.length === 0 && <EmptyRow colSpan={4} />}
                {data.receiptsRegister.map((r, idx) => (
                  <tr key={idx}>
                    <td className="mono">{r.orderId ?? '—'}</td>
                    <td>{CHANNEL_LABELS[r.channel] ?? r.channel}</td>
                    <td className="num">{formatSoums(r.amountTiyin)}</td>
                    <td className="num">{formatDateTime(r.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="page-header" style={{ marginTop: 'var(--s24)' }}>
            <h1 style={{ fontSize: 16 }}>Реестр выплат</h1>
            <button
              type="button"
              className="btn"
              onClick={() =>
                downloadCsv(
                  `payouts-${suffix}.csv`,
                  ['Мастер', 'Сумма, сум', 'Дата', 'Примечание'],
                  data.payoutsRegister.map((p) => [
                    masterName(p.masterId),
                    csvSoums(p.amountTiyin),
                    p.at,
                    p.note,
                  ]),
                )
              }
            >
              Скачать CSV
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Мастер</th>
                  <th className="num">Сумма</th>
                  <th>Дата</th>
                  <th>Примечание</th>
                </tr>
              </thead>
              <tbody>
                {data.payoutsRegister.length === 0 && <EmptyRow colSpan={4} />}
                {data.payoutsRegister.map((p, idx) => (
                  <tr key={idx}>
                    <td>{masterName(p.masterId)}</td>
                    <td className="num">{formatSoums(p.amountTiyin)}</td>
                    <td className="num">{formatDateTime(p.at)}</td>
                    <td className="muted">{p.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
