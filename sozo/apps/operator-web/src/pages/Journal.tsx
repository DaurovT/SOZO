import { getOrgId } from '../auth';
import { useFetch } from '../useFetch';
import { BuildingPicker, useSelectedBuilding } from '../components/BuildingPicker';
import { Empty, ErrorState, Loading } from '../components/States';
import { timeShort, zoneName } from '../format';
import type { Dashboard } from '../types';

/**
 * U-10. Журнал доступа: кто, когда и в какую зону заходил.
 * Для бизнес-центра — самостоятельная ценность: доказательство перед
 * арендатором и службой безопасности, а не служебный лог.
 */

interface Row {
  at: string;
  kind: 'zone_opened' | 'zone_closed' | 'pass_issued' | 'pass_revoked';
  permitId?: string;
  zones?: string[];
  masterId?: string | null;
  passType?: string;
  status?: string;
}

const KIND: Record<Row['kind'], { label: string; cls: string }> = {
  zone_opened: { label: 'Зона вскрыта', cls: 'chip--warning' },
  zone_closed: { label: 'Зона закрыта', cls: 'chip--success' },
  pass_issued: { label: 'Пропуск выдан', cls: 'chip--neutral' },
  pass_revoked: { label: 'Пропуск отозван', cls: 'chip--error' },
};

export function Journal() {
  const org = getOrgId();
  const dash = useFetch<Dashboard>(org ? `/operator/${org}/dashboard` : null);
  const buildingId = useSelectedBuilding(dash.data);
  const list = useFetch<Row[]>(buildingId ? `/buildings/${buildingId}/access-journal` : null, [buildingId]);

  if (dash.loading || list.loading) return <Loading />;
  if (dash.error) return <ErrorState error={dash.error} onRetry={dash.reload} />;
  if (list.error) return <ErrorState error={list.error} onRetry={list.reload} />;

  const rows = list.data ?? [];

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--s16)' }}>
        <div>
          <h1 className="h1">Журнал доступа</h1>
          <div className="cap" style={{ marginTop: 'var(--s4)' }}>
            Вскрытия общих зон и выданные пропуска
          </div>
        </div>
        <BuildingPicker dash={dash.data} />
      </div>

      {rows.length === 0 ? (
        <Empty text="Записей пока нет" />
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <table>
            <thead>
              <tr><th>Когда</th><th>Событие</th><th>Зона</th><th>Кто</th></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const k = KIND[r.kind];
                return (
                  <tr key={`${r.at}-${i}`}>
                    <td className="dense">{timeShort(r.at)}</td>
                    <td><span className={`chip ${k.cls}`}>{k.label}</span></td>
                    <td className="dense">{(r.zones ?? []).map(zoneName).join(', ') || '—'}</td>
                    <td className="cap">{r.masterId ? r.masterId.slice(0, 8) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
