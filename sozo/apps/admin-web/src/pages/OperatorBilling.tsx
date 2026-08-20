import { useState } from 'react';
import { api, ApiError } from '../api';
import { useFetch } from '../useFetch';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';
import { useToast } from '../components/Toast';

/**
 * A-42/A-43. Подписки операторов и расчёты с ними.
 *
 * Две модели монетизации взаимоисключающи, и экран должен это показывать
 * прямо: подписчик сервисного сбора не получает, бесплатный оператор
 * получает 5% и не платит нам ничего (ТЗ §19.3 п.2).
 */

interface Building {
  id: string;
  name: string;
  operatorOrgId: string | null;
  connectionStatus: string;
}

interface Settlement {
  subscriptionTiyin: number;
  claimsTiyin: number;
  serviceFeeTiyin: number;
  netTiyin: number;
  direction: 'invoice_to_operator' | 'payout_to_operator';
  rows: Array<{ id: string; kind: string; amountTiyin: number; note: string; at: string }>;
}

interface Subscription {
  plan?: 'free' | 'pro' | 'enterprise';
  tenantKind?: string;
  billingUnit?: string;
  priceTiyin?: number;
  status?: string;
}

const soums = (t: number) => Math.round(t / 100).toLocaleString('ru-RU');

const KIND: Record<string, string> = {
  subscription: 'Подписка',
  claim: 'Претензия / холостой выезд',
  service_fee: 'Сервисный сбор',
};

export function OperatorBillingPage() {
  const toast = useToast();
  const [org, setOrg] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const buildings = useFetch<Building[]>(() => api.get<Building[]>('/buildings'), []);
  const operators = [...new Set((buildings.data ?? []).map((b) => b.operatorOrgId).filter(Boolean))] as string[];
  const current = org || operators[0] || '';

  const sub = useFetch<Subscription>(
    () => (current ? api.get<Subscription>(`/operator/${current}/subscription`) : Promise.resolve({})),
    [current],
  );
  const fin = useFetch<Settlement | null>(
    () => (current ? api.get<Settlement>(`/operator/${current}/finance`) : Promise.resolve(null)),
    [current],
  );

  if (buildings.loading) return <Loading />;
  if (buildings.error !== null) return <ErrorBanner message={buildings.error} />;

  async function charge() {
    setBusy(true);
    try {
      const r = await api.post<{ chargedTiyin: number }>(`/operator/${current}/subscription/charge`, {});
      toast(r.chargedTiyin > 0 ? `Начислено ${soums(r.chargedTiyin)} сум` : 'Тариф Free — начисления нет');
      fin.reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Не удалось');
    } finally {
      setBusy(false);
    }
  }

  const plan = sub.data?.plan ?? 'free';
  const f = fin.data;

  return (
    <>
      <div className="page-header">
        <h1>Подписки и расчёты</h1>
        {operators.length > 0 && (
          <select className="input" value={current} onChange={(e) => setOrg(e.target.value)}>
            {operators.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        )}
      </div>

      {operators.length === 0 ? (
        <div className="table-wrap"><table><tbody><EmptyRow colSpan={1} /></tbody></table></div>
      ) : (
        <>
          <div className="card" style={{ padding: 16, marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
              <h2 style={{ margin: 0 }}>{plan === 'free' ? 'Модель «Доступ»' : 'Модель «Подписка»'}</h2>
              <span className="muted">
                {plan === 'free'
                  ? 'подключение бесплатно, оператор получает 5% с частных заявок жителей'
                  : `${soums(sub.data?.priceTiyin ?? 0)} сум за объект в месяц, сервисный сбор не начисляется`}
              </span>
            </div>
            {plan !== 'free' && (
              <button className="btn" style={{ marginTop: 12 }} disabled={busy} onClick={charge}>
                Начислить за период
              </button>
            )}
          </div>

          {f && (
            <>
              <div className="card" style={{ padding: 16, marginBottom: 16 }}>
                <h3 style={{ marginTop: 0 }}>Нетто-расчёт периода</h3>
                <table style={{ maxWidth: 480 }}>
                  <tbody>
                    <tr><td>Подписка</td><td className="num">{soums(f.subscriptionTiyin)}</td></tr>
                    <tr><td>Претензии и холостые выезды</td><td className="num">{soums(f.claimsTiyin)}</td></tr>
                    <tr><td>Сервисный сбор в пользу оператора</td><td className="num">−{soums(f.serviceFeeTiyin)}</td></tr>
                    <tr>
                      <td><b>{f.direction === 'payout_to_operator' ? 'К выплате оператору' : 'К оплате оператором'}</b></td>
                      <td className="num"><b>{soums(Math.abs(f.netTiyin))} сум</b></td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="table-wrap">
                <table>
                  <thead><tr><th>Тип</th><th>Основание</th><th>Дата</th><th className="num">Сумма</th></tr></thead>
                  <tbody>
                    {f.rows.length === 0 && <EmptyRow colSpan={4} />}
                    {f.rows.map((r) => (
                      <tr key={r.id}>
                        <td>{KIND[r.kind] ?? r.kind}</td>
                        <td className="muted">{r.note}</td>
                        <td>{new Date(r.at).toLocaleDateString('ru-RU')}</td>
                        <td className="num">{r.kind === 'service_fee' ? '−' : ''}{soums(r.amountTiyin)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
