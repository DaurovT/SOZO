import { api } from '../api';
import { useFetch } from '../useFetch';
import { formatDateTime, formatSoums } from '../format';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';

/**
 * Коды закупки (ТЗ 8.4).
 *
 * Код — разрешение мастеру потратить деньги компании в партнёрском магазине.
 * Выдаётся под конкретную заявку и с потолком суммы; после покупки мастер
 * прикладывает накладную.
 *
 * Главное на экране — не список выданных кодов, а те, по которым накладной
 * нет дольше суток: это либо забытая покупка, либо потраченные не туда деньги.
 */

interface CodeRow {
  id: string;
  code: string;
  orderNumber: string;
  masterName: string;
  limitTiyin: number;
  status: 'active' | 'used' | 'expired';
  hasInvoice: boolean;
  invoiceTotalTiyin: number;
  createdAt: string;
  expiresAt: string;
  ageHours: number;
  unconfirmed: boolean;
}

const STATUS: Record<string, { label: string; cls: string }> = {
  active: { label: 'Действует', cls: 'badge badge--warning' },
  used: { label: 'Использован', cls: 'badge badge--success' },
  expired: { label: 'Истёк', cls: 'badge badge--muted' },
};

export function PurchaseCodesPage() {
  const { data, loading, error } = useFetch<{
    codes: CodeRow[];
    active: number;
    unconfirmed: number;
    limitTotalTiyin: number;
  }>(() => api.get('/admin/master-ops/purchase-codes'), []);

  if (loading) return <Loading />;
  if (error !== null) return <ErrorBanner message={error} />;
  if (!data) return null;

  return (
    <>
      <div className="page-header">
        <h1>Коды закупки</h1>
      </div>

      <div className="banner">
        Код разрешает мастеру потратить деньги компании в партнёрском магазине в пределах лимита.
        После покупки к коду прикладывается накладная — без неё расход ничем не подтверждён
      </div>

      <div className="tiles">
        <div className="card">
          <div className="tile__value">{data.active}</div>
          <div className="tile__label">действующих кодов</div>
          <div className="tile__hint">лимит на {formatSoums(data.limitTotalTiyin)}</div>
        </div>
        <div className={data.unconfirmed > 0 ? 'card card--warning' : 'card'}>
          <div className="tile__value">{data.unconfirmed}</div>
          <div className="tile__label">без накладной больше суток</div>
          <div className="tile__hint">расход не подтверждён</div>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Код</th>
              <th>Заявка</th>
              <th>Мастер</th>
              <th className="num">Лимит</th>
              <th className="num">По накладной</th>
              <th>Статус</th>
              <th>Выдан</th>
            </tr>
          </thead>
          <tbody>
            {data.codes.length === 0 && <EmptyRow colSpan={7} />}
            {data.codes.map((c) => (
              <tr key={c.id} className={c.unconfirmed ? 'row--warning' : undefined}>
                <td className="mono">{c.code}</td>
                <td className="mono">{c.orderNumber}</td>
                <td>{c.masterName}</td>
                <td className="num">{formatSoums(c.limitTiyin)}</td>
                <td className="num">
                  {c.hasInvoice ? (
                    formatSoums(c.invoiceTotalTiyin)
                  ) : (
                    <span className="muted">{c.unconfirmed ? 'нет уже сутки' : 'ещё не приложена'}</span>
                  )}
                </td>
                <td>
                  <span className={STATUS[c.status]?.cls ?? 'badge'}>{STATUS[c.status]?.label ?? c.status}</span>
                </td>
                <td className="muted">{formatDateTime(c.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
