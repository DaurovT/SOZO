import { useState } from 'react';
import { api } from '../api';
import { useFetch } from '../useFetch';
import { formatDateTime, formatSoums } from '../format';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import type { ClearingState } from '../types';

/** A-21: клиринг Payme/Click — реестр T+1, зачисление минус комиссия провайдера. */
export function ClearingPage() {
  const toast = useToast();
  const { data, loading, error, reload } = useFetch<ClearingState>(() =>
    api.get<ClearingState>('/admin/billing/clearing'),
  );
  const [percent, setPercent] = useState('2');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const settle = async () => {
    setBusy(true);
    setActionError(null);
    try {
      const res = await api.post<{ settledTiyin: number; feeTiyin: number }>(
        '/admin/billing/clearing/settle',
        { commissionPermille: Math.round((Number(percent.replace(',', '.')) || 0) * 10) },
      );
      toast(`Зачислено ${formatSoums(res.settledTiyin)}, комиссия ${formatSoums(res.feeTiyin)}`);
      reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading />;
  if (error !== null) return <ErrorBanner message={error} />;
  if (!data) return null;

  return (
    <>
      <div className="page-header">
        <h1>Клиринг Payme/Click</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s8)' }}>
          <label htmlFor="clr-fee" className="muted">
            Комиссия, %
          </label>
          <input
            id="clr-fee"
            className="cell-input"
            style={{ width: 64 }}
            inputMode="decimal"
            value={percent}
            onChange={(e) => setPercent(e.target.value.replace(/[^\d.,]/g, ''))}
          />
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy || data.pendingTiyin <= 0}
            onClick={() => void settle()}
          >
            Зачислить реестр (T+1)
          </button>
        </div>
      </div>

      {actionError !== null && <ErrorBanner message={actionError} />}

      <div className="tiles">
        <div className="card">
          <div className="tile__value">{formatSoums(data.pendingTiyin)}</div>
          <div className="tile__label">В пути (клиринг)</div>
          <div className="tile__hint">Онлайн-оплаты до перечисления провайдером</div>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Заявка</th>
              <th className="num">Сумма</th>
              <th>Время</th>
            </tr>
          </thead>
          <tbody>
            {data.register.length === 0 && <EmptyRow colSpan={3} />}
            {data.register.map((r, idx) => (
              <tr key={idx}>
                <td className="mono">{r.orderId ?? '—'}</td>
                <td className="num">{formatSoums(r.amountTiyin)}</td>
                <td className="num">{formatDateTime(r.at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
