import { getOrgId } from '../auth';
import { useFetch } from '../useFetch';
import { BuildingPicker, useSelectedBuilding } from '../components/BuildingPicker';
import { Empty, ErrorState, Loading } from '../components/States';
import type { Dashboard } from '../types';

/**
 * U-03. Заявки по общему имуществу.
 *
 * Здесь только общее имущество — и это не фильтр по умолчанию, а граница
 * видимости. Частные заявки жителей оператор не видит никогда: чужая работа
 * в чужой квартире (ТЗ §19.3). Поэтому экран не предлагает «показать все»:
 * такого режима не существует.
 */

interface OrdersData {
  total: number;
  byStatus: Record<string, number>;
  rows: Array<{
    id: string;
    number: string;
    buildingId: string | null;
    status: string;
    urgency: string;
    description: string;
    address: string;
    masterName: string | null;
    laborSettlement: string | null;
    createdAt: string;
  }>;
}

const STATUS: Record<string, string> = {
  new: 'новая',
  assigned: 'назначена',
  en_route: 'в пути',
  in_progress: 'в работе',
  awaiting_parts: 'ждёт запчасть',
  done: 'выполнена',
  closed: 'закрыта',
  cancelled: 'отменена',
};

const URGENCY: Record<string, string> = { normal: 'обычная', urgent: 'срочная', emergency: 'авария' };

export function CommonOrders() {
  const org = getOrgId();
  const dash = useFetch<Dashboard>(org ? `/operator/${org}/dashboard` : null);
  const buildingId = useSelectedBuilding(dash.data);
  const data = useFetch<OrdersData>(
    org ? `/operator/${org}/orders${buildingId ? `?buildingId=${buildingId}` : ''}` : null,
    [org, buildingId],
  );

  if (dash.loading || data.loading) return <Loading />;
  if (dash.error) return <ErrorState error={dash.error} onRetry={dash.reload} />;
  if (data.error) return <ErrorState error={data.error} onRetry={data.reload} />;
  const d = data.data;

  // Аварийные наверх: они не ждут очереди и не должны теряться в списке
  const rows = [...(d?.rows ?? [])].sort((a, b) => {
    const rank = (x: typeof a) => (x.urgency === 'emergency' ? 0 : x.urgency === 'urgent' ? 1 : 2);
    return rank(a) - rank(b) || b.createdAt.localeCompare(a.createdAt);
  });
  const live = rows.filter((r) => !['closed', 'cancelled', 'done'].includes(r.status));

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--s16)' }}>
        <div>
          <h1 className="h1">Общее имущество</h1>
          <div className="cap" style={{ marginTop: 'var(--s4)' }}>
            {live.length} в работе из {d?.total ?? 0} за всё время
          </div>
        </div>
        <BuildingPicker dash={dash.data} />
      </div>

      <div className="card" style={{ padding: 'var(--s16)' }}>
        <div className="dense cap">
          Заявки жителей по их квартирам сюда не попадают — это работа платформы, а не ваша.
          Здесь то, за что отвечает служба объекта: подъезды, стояки, кровля, оборудование.
        </div>
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        {rows.length === 0 ? (
          <Empty text="Заявок по общему имуществу пока нет" />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Заявка</th><th>Что</th><th>Срочность</th><th>Статус</th><th>Мастер</th><th>Заведена</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600 }}>{r.number}</td>
                  <td>{r.description}</td>
                  <td style={{ color: r.urgency === 'emergency' ? 'var(--error)' : undefined }}>
                    {URGENCY[r.urgency] ?? r.urgency}
                  </td>
                  <td>{STATUS[r.status] ?? r.status}</td>
                  <td>
                    {r.masterName ?? '—'}
                    {r.laborSettlement === 'salary' && (
                      <span className="cap" style={{ marginLeft: 'var(--s4)' }}>ваш</span>
                    )}
                  </td>
                  <td className="cap">{new Date(r.createdAt).toLocaleDateString('ru-RU')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
