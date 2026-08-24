import { useState } from 'react';
import { getOrgId } from '../auth';
import { useFetch } from '../useFetch';
import { BuildingPicker, useSelectedBuilding } from '../components/BuildingPicker';
import { Empty, ErrorState, Loading } from '../components/States';
import { UnitImport } from '../components/UnitImport';
import type { Dashboard } from '../types';

/**
 * U-06. Реестр помещений — основа всего: без него не считается зона влияния
 * отключений, не работает адресный матчинг и нечего тарифицировать.
 */

interface Summary {
  unitsTotal: number;
  unitsWithResidents: number;
  residentsTotal: number;
  units: Array<{
    id: string;
    number: string;
    entrance: string | null;
    floor: number | null;
    unitType: string;
    riserIds: string[];
    residentsCount: number;
  }>;
}

const UNIT_TYPE: Record<string, string> = {
  apartment: 'квартира',
  office: 'офис',
  storage: 'кладовая',
  parking: 'паркинг',
};

export function Units() {
  const org = getOrgId();
  const dash = useFetch<Dashboard>(org ? `/operator/${org}/dashboard` : null);
  const buildingId = useSelectedBuilding(dash.data);
  const data = useFetch<Summary>(buildingId ? `/buildings/${buildingId}/residents-summary` : null, [buildingId]);
  const [importing, setImporting] = useState(false);

  if (dash.loading || data.loading) return <Loading />;
  if (dash.error) return <ErrorState error={dash.error} onRetry={dash.reload} />;
  if (data.error) return <ErrorState error={data.error} onRetry={data.reload} />;
  const d = data.data;

  // Стояки — не формальность: без них зона влияния отключения не считается,
  // и жители узнают об отключении воды по факту
  const withoutRiser = (d?.units ?? []).filter((u) => u.riserIds.length === 0).length;

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--s16)' }}>
        <div>
          <h1 className="h1">Помещения и жители</h1>
          <div className="cap" style={{ marginTop: 'var(--s4)' }}>
            {d?.unitsTotal ?? 0} помещений · {d?.residentsTotal ?? 0} жителей в приложении
          </div>
        </div>
        <BuildingPicker dash={dash.data} />
        <button type="button" onClick={() => setImporting((v) => !v)} disabled={!buildingId}>
          {importing ? 'Скрыть импорт' : 'Импорт из файла'}
        </button>
      </div>

      {importing && buildingId && (
        <UnitImport
          buildingId={buildingId}
          onDone={() => {
            data.reload();
            dash.reload();
          }}
        />
      )}

      {withoutRiser > 0 && (
        <div className="card" style={{ padding: 'var(--s16)', background: 'rgba(240,140,30,.06)', border: '1px solid rgba(240,140,30,.3)' }}>
          <div className="dense">
            <b>У {withoutRiser} помещений не указан стояк.</b> Без него зона влияния отключения
            не считается — жители таких помещений не получат предупреждение.
          </div>
        </div>
      )}

      <div className="card" style={{ overflow: 'hidden' }}>
        {(d?.units.length ?? 0) === 0 ? (
          <Empty text="Реестр помещений пуст — объект не сможет быть активирован" />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Помещение</th><th>Подъезд</th><th>Этаж</th><th>Тип</th><th>Стояки</th><th className="num">Жителей</th>
              </tr>
            </thead>
            <tbody>
              {d!.units.map((u) => (
                <tr key={u.id}>
                  <td style={{ fontWeight: 600 }}>№ {u.number}</td>
                  <td>{u.entrance ?? '—'}</td>
                  <td>{u.floor ?? '—'}</td>
                  <td>{UNIT_TYPE[u.unitType] ?? u.unitType}</td>
                  <td className={u.riserIds.length ? undefined : 'cap'} style={{ color: u.riserIds.length ? undefined : 'var(--error)' }}>
                    {u.riserIds.length ? u.riserIds.join(', ') : 'не указан'}
                  </td>
                  <td className="num">{u.residentsCount || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
