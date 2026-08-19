import { getOrgId } from '../auth';
import { useFetch } from '../useFetch';
import { ErrorState, Loading } from '../components/States';
import { soums, timeShort } from '../format';
import type { Settlement } from '../types';

const KIND: Record<string, string> = {
  subscription: 'Подписка',
  claim: 'Претензия',
  service_fee: 'Сервисный сбор',
};

/**
 * U-11. Одна нетто-сумма вместо двух встречных платежей (DEV-15 §11.5).
 * Знак определяет направление: отрицательный нетто — выплата оператору.
 */
export function Finance() {
  const org = getOrgId();
  const { data, loading, error, reload } = useFetch<Settlement>(org ? `/operator/${org}/finance` : null);

  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return null;

  const payout = data.direction === 'payout_to_operator';

  return (
    <>
      <div>
        <h1 className="h1">Финансы</h1>
        <div className="cap" style={{ marginTop: 'var(--s4)' }}>Расчёт за текущий период</div>
      </div>

      <div className="card" style={{ padding: 'var(--s24)' }}>
        <div className="cap">{payout ? 'К выплате вам' : 'К оплате'}</div>
        <div style={{ fontSize: 34, fontWeight: 600, marginTop: 'var(--s8)', fontVariantNumeric: 'tabular-nums' }}>
          {soums(Math.abs(data.netTiyin))} <span style={{ fontSize: 20, color: 'var(--text-secondary)' }}>сум</span>
        </div>

        <div style={{ marginTop: 'var(--s24)', display: 'flex', flexDirection: 'column', gap: 'var(--s8)' }}>
          <Row label="Подписка" value={data.subscriptionTiyin} />
          <Row label="Претензии и холостые выезды" value={data.claimsTiyin} />
          <Row label="Сервисный сбор в вашу пользу" value={-data.serviceFeeTiyin} />
          <div style={{ height: 1, background: 'var(--divider)', margin: 'var(--s8) 0' }} />
          <Row label="Итого" value={data.netTiyin} bold />
        </div>
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ padding: 'var(--s16)', borderBottom: '1px solid var(--border)' }}>
          <h2 className="h2">Детализация</h2>
        </div>
        <table>
          <thead>
            <tr><th>Тип</th><th>Основание</th><th>Дата</th><th className="num">Сумма</th></tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.id}>
                <td>{KIND[r.kind] ?? r.kind}</td>
                <td className="dense">{r.note}</td>
                <td className="cap">{timeShort(r.at)}</td>
                <td className="num" style={{ color: r.kind === 'service_fee' ? 'var(--success)' : undefined }}>
                  {r.kind === 'service_fee' ? '−' : ''}{soums(r.amountTiyin)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Row({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div style={{ display: 'flex', fontWeight: bold ? 600 : 400 }}>
      <div className={bold ? undefined : 'dense'}>{label}</div>
      <div className="num" style={{ marginLeft: 'auto', fontSize: bold ? 16 : 14 }}>
        {value < 0 ? '−' : ''}{soums(Math.abs(value))} сум
      </div>
    </div>
  );
}
