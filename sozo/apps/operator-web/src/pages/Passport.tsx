import { getOrgId } from '../auth';
import { useFetch } from '../useFetch';
import { BuildingPicker, useSelectedBuilding } from '../components/BuildingPicker';
import { Empty, ErrorState, Loading } from '../components/States';
import type { Dashboard } from '../types';

/**
 * U-08. Паспорт здания.
 *
 * Справочная страница: её открывают целиком и читают глазами. Поэтому один
 * запрос, а не четыре — четыре повода получить несогласованный снимок, где
 * зоны уже новые, а оборудование ещё старое.
 *
 * Критичные и лицензируемые зоны выделены не для красоты: от них зависит,
 * кого вообще пустят на работу. Мастеру платформы лицензируемая зона
 * запрещена (ТЗ 17.8), и человек, который заводит зону, должен видеть
 * последствие сразу.
 */

interface PassportData {
  building: {
    id: string;
    name: string;
    address: string;
    connectionStatus: string;
    workFrom: string | null;
    workTo: string | null;
    noiseFrom: string | null;
    noiseTo: string | null;
    emergencyPhone: string | null;
    dispatchPhone: string | null;
  };
  zones: Array<{
    id: string;
    zoneType: string;
    label: string;
    riserId: string | null;
    isCritical: boolean;
    isLicensed: boolean;
  }>;
  risers: string[];
  unitsTotal: number;
  equipment: Array<{
    id: string;
    name: string;
    equipmentType: string;
    location?: string | null;
    nextMaintenanceAt?: string | null;
  }>;
  maintenance: Array<{
    equipmentId: string;
    name: string;
    dueAt: string | null;
    overdue: boolean;
  }>;
}

export function Passport() {
  const org = getOrgId();
  const dash = useFetch<Dashboard>(org ? `/operator/${org}/dashboard` : null);
  const buildingId = useSelectedBuilding(dash.data);
  const data = useFetch<PassportData>(
    org && buildingId ? `/operator/${org}/buildings/${buildingId}/passport` : null,
    [org, buildingId],
  );

  if (dash.loading || data.loading) return <Loading />;
  if (dash.error) return <ErrorState error={dash.error} onRetry={dash.reload} />;
  if (data.error) return <ErrorState error={data.error} onRetry={data.reload} />;
  const d = data.data;
  if (!d) return null;

  const overdue = (d.maintenance ?? []).filter((m) => m.overdue);
  const hours = d.building.workFrom && d.building.workTo ? `${d.building.workFrom}–${d.building.workTo}` : null;
  const noise = d.building.noiseFrom && d.building.noiseTo ? `${d.building.noiseFrom}–${d.building.noiseTo}` : null;

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--s16)' }}>
        <div>
          <h1 className="h1">Паспорт здания</h1>
          <div className="cap" style={{ marginTop: 'var(--s4)' }}>{d.building.address}</div>
        </div>
        <BuildingPicker dash={dash.data} />
      </div>

      {!hours && (
        <div className="card" style={{ padding: 'var(--s16)', background: 'rgba(240,140,30,.06)', border: '1px solid rgba(240,140,30,.3)' }}>
          <div className="dense">
            <b>Часы работы службы не заданы.</b> Без них наряд-допуск не проверить на попадание
            в рабочее окно, и согласование уходит человеку в любое время суток.
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 'var(--s16)' }}>
        <Tile title="Помещений" value={String(d.unitsTotal)} />
        <Tile title="Стояков" value={String(d.risers.length)} />
        <Tile title="Зон" value={String(d.zones.length)} />
        <Tile title="Оборудования" value={String(d.equipment.length)} />
      </div>

      <div className="card" style={{ padding: 'var(--s16)' }}>
        <h2 className="h2">Режим объекта</h2>
        <div className="dense" style={{ marginTop: 'var(--s8)' }}>
          Служба на месте: <b>{hours ?? 'не задано'}</b> · шумные работы: <b>{noise ?? 'не задано'}</b>
        </div>
        <div className="dense cap" style={{ marginTop: 'var(--s4)' }}>
          Это разные вещи: консьерж может быть на месте с 8 до 20, а сверлить разрешено с 10 до 18.
          Наряд вне окна шумных работ не согласуется.
        </div>
        <div className="dense" style={{ marginTop: 'var(--s8)' }}>
          Аварийный телефон: <b>{d.building.emergencyPhone ?? '—'}</b>
          {d.building.dispatchPhone ? ` · диспетчер: ${d.building.dispatchPhone}` : ''}
        </div>
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ padding: 'var(--s16) var(--s16) 0' }}><h2 className="h2">Зоны и стояки</h2></div>
        {d.zones.length === 0 ? (
          <Empty text="Зоны не заведены — наряд-допуск выписать не на что" />
        ) : (
          <table>
            <thead>
              <tr><th>Зона</th><th>Стояк</th><th>Доступ</th></tr>
            </thead>
            <tbody>
              {d.zones.map((z) => (
                <tr key={z.id}>
                  <td style={{ fontWeight: 600 }}>{z.label}</td>
                  <td>{z.riserId ?? '—'}</td>
                  <td>
                    {z.isLicensed && (
                      <span style={{ color: 'var(--error)' }}>только со своим мастером</span>
                    )}
                    {!z.isLicensed && z.isCritical && <span>критичная</span>}
                    {!z.isLicensed && !z.isCritical && <span className="cap">обычная</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ padding: 'var(--s16) var(--s16) 0' }}>
          <h2 className="h2">Оборудование и регламенты</h2>
          {overdue.length > 0 && (
            <div className="dense" style={{ marginTop: 'var(--s4)', color: 'var(--error)' }}>
              Просрочено ТО: {overdue.length}
            </div>
          )}
        </div>
        {d.equipment.length === 0 ? (
          <Empty text="Оборудование не заведено — плановое ТО не построить" />
        ) : (
          <table>
            <thead>
              <tr><th>Оборудование</th><th>Тип</th><th>Следующее ТО</th></tr>
            </thead>
            <tbody>
              {d.equipment.map((e) => {
                const m = (d.maintenance ?? []).find((x) => x.equipmentId === e.id);
                return (
                  <tr key={e.id}>
                    <td style={{ fontWeight: 600 }}>{e.name}</td>
                    <td>{e.equipmentType}</td>
                    <td style={{ color: m?.overdue ? 'var(--error)' : undefined }}>
                      {m?.dueAt ? new Date(m.dueAt).toLocaleDateString('ru-RU') : '—'}
                      {m?.overdue ? ' · просрочено' : ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function Tile({ title, value }: { title: string; value: string }) {
  return (
    <div className="card" style={{ padding: 'var(--s16)' }}>
      <div className="cap">{title}</div>
      <div className="h1" style={{ marginTop: 'var(--s4)' }}>{value}</div>
    </div>
  );
}
