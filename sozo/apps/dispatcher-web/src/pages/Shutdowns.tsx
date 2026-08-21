import { useState } from 'react';
import { api } from '../api';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';
import { formatDateTime } from '../format';
import { useFetch } from '../useFetch';

/**
 * D-22. Отключения ресурсов по всем объектам.
 *
 * У оператора этот экран про его дом, у диспетчера — про все сразу.
 * Отключение воды на стояке означает, что заявки в этих квартирах сегодня не
 * выполнить, и узнать об этом надо до выезда, а не на месте.
 */

interface ShutdownRow {
  id: string;
  buildingName: string;
  address: string;
  resourceType: string;
  scope: string;
  riserId: string | null;
  affectedUnits: number;
  plannedFrom: string;
  plannedTo: string;
  status: string;
  isEmergency: boolean;
  lateNotice: boolean;
  notifiedAt: string | null;
}

interface ShutdownsData {
  horizonDays: number;
  total: number;
  active: number;
  notNotified: number;
  rows: ShutdownRow[];
}

const RESOURCE: Record<string, string> = {
  cold_water: 'холодная вода',
  hot_water: 'горячая вода',
  heating: 'отопление',
  electricity: 'электричество',
  gas: 'газ',
  sewage: 'канализация',
  lift: 'лифт',
  ventilation: 'вентиляция',
};

const STATUS: Record<string, string> = {
  draft: 'черновик',
  scheduled: 'запланировано',
  active: 'идёт сейчас',
  restored: 'восстановлено',
};

export function Shutdowns() {
  const [days, setDays] = useState(14);
  const { data, loading, error } = useFetch<ShutdownsData>(
    () => api.get(`/dispatch/ops/shutdowns?days=${days}`),
    [days],
  );

  return (
    <>
      <div className="page-header">
        <h1>Отключения ресурсов</h1>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>неделя</option>
          <option value={14}>две недели</option>
          <option value={30}>месяц</option>
        </select>
      </div>

      <div className="banner">
        Отключение воды на стояке означает, что заявки в этих квартирах сегодня не выполнить.
        Узнать об этом надо до выезда, а не на месте.
      </div>

      {error !== null && <ErrorBanner message={error} />}
      {loading && !data && <Loading />}

      {data && (
        <>
          <div className="banner">
            {data.total} за {data.horizonDays} дней
            {data.active > 0 ? ` · идёт сейчас: ${data.active}` : ''}
          </div>

          {data.notNotified > 0 && (
            <div className="banner banner--warning">
              Жители не предупреждены по {data.notNotified} отключениям
            </div>
          )}

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Объект</th>
                  <th>Что отключают</th>
                  <th>Зона влияния</th>
                  <th>Когда</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 && <EmptyRow colSpan={5} />}
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.buildingName}</strong>
                      <div className="muted">{r.address}</div>
                    </td>
                    <td>
                      {RESOURCE[r.resourceType] ?? r.resourceType}
                      {r.isEmergency && <div className="tone--error">авария</div>}
                    </td>
                    <td>
                      {r.scope === 'riser' && r.riserId ? `стояк ${r.riserId}` : r.scope}
                      <div className="muted">{r.affectedUnits} помещений</div>
                    </td>
                    <td>
                      {formatDateTime(r.plannedFrom)}
                      <div className="muted">до {formatDateTime(r.plannedTo)}</div>
                    </td>
                    <td>
                      {STATUS[r.status] ?? r.status}
                      {!r.notifiedAt && <div className="tone--error">не предупреждены</div>}
                      {r.lateNotice && <div className="muted">объявлено поздно</div>}
                    </td>
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
