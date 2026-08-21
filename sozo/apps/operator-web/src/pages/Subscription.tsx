import { getOrgId } from '../auth';
import { useFetch } from '../useFetch';
import { ErrorState, Loading } from '../components/States';

/**
 * U-15. Подписка и расчёт.
 *
 * Нетто-расчёт показан одной суммой со знаком, а не двумя встречными
 * платежами. У платформы и оператора обязательства навстречу друг другу:
 * подписка и взаимозачёт по заявкам с одной стороны, сервисный сбор с
 * другой. Два платежа — это две комиссии банка и два повода не сойтись.
 */

interface SubscriptionData {
  subscription: {
    plan: string;
    tenantKind: string;
    billingUnit: string;
    priceTiyin: number;
    unitsBilled: number;
    periodFrom: string;
    periodTo: string;
    status: string;
  } | null;
  settlement: {
    subscriptionTiyin: number;
    claimsTiyin: number;
    serviceFeeTiyin: number;
    netTiyin: number;
    direction: string;
    rows: Array<{ id: string; kind: string; amountTiyin: number; note: string; at: string }>;
  };
  objectsTotal: number;
}

const PLAN: Record<string, string> = { free: 'Free', pro: 'Pro', enterprise: 'Enterprise' };
const KIND: Record<string, string> = { kind: 'kind', hoa: 'ТСЖ / УК', bc: 'бизнес-центр', fm: 'FM-компания' };
const ROW_KIND: Record<string, string> = {
  subscription: 'подписка',
  claim: 'взаимозачёт по заявкам',
  service_fee: 'сервисный сбор',
};
const sum = (t: number) => `${Math.round(Math.abs(t) / 100).toLocaleString('ru-RU')} сум`;

export function Subscription() {
  const org = getOrgId();
  const { data, loading, error, reload } = useFetch<SubscriptionData>(org ? `/operator/${org}/billing-overview` : null);

  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return null;

  const s = data.subscription;
  const st = data.settlement;
  const toUs = st.direction === 'invoice_to_operator';

  return (
    <>
      <div>
        <h1 className="h1">Подписка и расчёт</h1>
        <div className="cap" style={{ marginTop: 'var(--s4)' }}>
          {data.objectsTotal} {data.objectsTotal === 1 ? 'объект' : 'объектов'} под управлением
        </div>
      </div>

      <div className="card" style={{ padding: 'var(--s16)' }}>
        <h2 className="h2">Тариф</h2>
        {!s ? (
          <div className="dense cap" style={{ marginTop: 'var(--s8)' }}>
            Подписка не оформлена. Доступ к объектам работает, но платные экраны закрыты.
          </div>
        ) : (
          <>
            <div className="dense" style={{ marginTop: 'var(--s8)' }}>
              <b>{PLAN[s.plan] ?? s.plan}</b> · {KIND[s.tenantKind] ?? s.tenantKind} ·{' '}
              {s.status === 'active' ? 'действует' : s.status === 'past_due' ? 'просрочена' : 'отменена'}
            </div>
            <div className="dense" style={{ marginTop: 'var(--s4)' }}>
              {sum(s.priceTiyin)} за {s.billingUnit === 'per_unit' ? 'помещение' : 'объект'} ·
              единиц тарификации: {s.unitsBilled}
            </div>
            <div className="dense cap" style={{ marginTop: 'var(--s4)' }}>
              Период: {new Date(s.periodFrom).toLocaleDateString('ru-RU')} —{' '}
              {new Date(s.periodTo).toLocaleDateString('ru-RU')}
            </div>
          </>
        )}
      </div>

      <div className="card" style={{ padding: 'var(--s16)' }}>
        <h2 className="h2">Нетто-расчёт</h2>
        <div className="h1" style={{ marginTop: 'var(--s8)', color: toUs ? undefined : 'var(--ok, #1a7f4b)' }}>
          {toUs ? 'К оплате: ' : 'К выплате вам: '}{sum(st.netTiyin)}
        </div>
        <div className="dense cap" style={{ marginTop: 'var(--s4)' }}>
          Подписка {sum(st.subscriptionTiyin)} · взаимозачёт {sum(st.claimsTiyin)} ·
          сервисный сбор {sum(st.serviceFeeTiyin)}
        </div>
        <div className="dense cap" style={{ marginTop: 'var(--s8)' }}>
          Одна сумма вместо двух встречных платежей: так меньше комиссий и меньше поводов
          не сойтись.
        </div>
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ padding: 'var(--s16) var(--s16) 0' }}><h2 className="h2">Движения</h2></div>
        {st.rows.length === 0 ? (
          <div style={{ padding: 'var(--s16)' }} className="dense cap">Движений пока нет</div>
        ) : (
          <table>
            <thead>
              <tr><th>Дата</th><th>Что</th><th>Основание</th><th className="num">Сумма</th></tr>
            </thead>
            <tbody>
              {[...st.rows].reverse().map((r) => (
                <tr key={r.id}>
                  <td className="cap">{new Date(r.at).toLocaleDateString('ru-RU')}</td>
                  <td>{ROW_KIND[r.kind] ?? r.kind}</td>
                  <td className="dense">{r.note}</td>
                  <td className="num">{r.amountTiyin < 0 ? '−' : ''}{sum(r.amountTiyin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
