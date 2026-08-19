import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { ErrorBanner, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import { formatDateTime } from '../format';
import { useFetch } from '../useFetch';

/** D-21. Контроль того, как эксплуатирующие организации согласуют доступ мастерам. */

interface Permit {
  id: string;
  orderId: string;
  buildingId: string;
  status: string;
  zoneTypes: string[];
  hasCriticalZone: boolean;
  requiresShutdown: boolean;
  affectedUnitIds: string[];
  windowFrom: string | null;
  windowTo: string | null;
  slaDeadline: string | null;
  isEmergency: boolean;
  masterIsPlatform: boolean;
}

interface BuildingRow {
  id: string;
  name: string;
  address: string;
  connectionStatus: string;
  operatorOrgId: string | null;
  emergencyPhone: string | null;
  permitsTotal30d: number;
  permitsOverdue30d: number;
  emergencyOverdue30d: number;
}

const ZONE: Record<string, string> = {
  electrical_panel: 'Электрощитовая', water_riser: 'Стояк ХВС', sewage_riser: 'Канализационный стояк',
  basement: 'Подвал', roof: 'Кровля', technical_floor: 'Техэтаж', lift_machine_room: 'Лифтовая',
  ventilation_chamber: 'Вентиляционная камера', heat_point: 'ИТП', gas_equipment: 'Газовое оборудование',
  fire_system: 'Пожарные системы', yard: 'Двор',
};

function useTick(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

function slaText(iso: string | null, now: number): { text: string; overdue: boolean } {
  if (!iso) return { text: 'без срока', overdue: false };
  const diff = Date.parse(iso) - now;
  const abs = Math.abs(diff);
  const h = Math.floor(abs / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  const body = h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
  return diff < 0 ? { text: `просрочено на ${body}`, overdue: true } : { text: body, overdue: false };
}

export function PermitsPage() {
  const now = useTick(30_000);
  const toast = useToast();
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const buildings = useFetch<BuildingRow[]>(() => api.get<BuildingRow[]>('/buildings'), []);
  const ids = (buildings.data ?? []).map((b) => b.id).join(',');
  const permits = useFetch<Permit[]>(
    () => (ids ? api.get<Permit[]>(`/operator/permits?buildingIds=${ids}`) : Promise.resolve([])),
    [ids],
  );

  if (buildings.loading || permits.loading) return <Loading />;
  if (buildings.error) return <ErrorBanner message={buildings.error} />;
  if (permits.error) return <ErrorBanner message={permits.error} />;

  const byId = new Map((buildings.data ?? []).map((b) => [b.id, b]));
  const list = (permits.data ?? [])
    .filter((p) => !onlyOverdue || slaText(p.slaDeadline, now).overdue)
    .sort((a, b) => Date.parse(a.slaDeadline ?? '') - Date.parse(b.slaDeadline ?? ''));

  /**
   * Санкция диспетчера на вскрытие вне согласованного окна — исключение, а не приём.
   * Причина обязательна: она уходит в аудит и объясняет, почему правило обошли.
   */
  async function override(p: Permit) {
    const reason = window.prompt('Причина санкции на вскрытие вне окна');
    if (!reason) return;
    setBusy(p.id);
    try {
      await api.post(`/permits/${p.id}/transitions`, {
        action: 'open',
        clientOpUuid: crypto.randomUUID(),
        reason,
      });
      toast('Вскрытие санкционировано');
      permits.reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Не удалось');
    } finally {
      setBusy(null);
    }
  }

  const overdueCount = (permits.data ?? []).filter((p) => slaText(p.slaDeadline, now).overdue).length;

  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h1 className="page__title">Наряды-допуски</h1>
          <p className="page__sub">
            Согласования на подключённых объектах. Очередь должна стремиться к нулю —
            рост означает, что подключение объекта не работает.
          </p>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
          <input type="checkbox" checked={onlyOverdue} onChange={(e) => setOnlyOverdue(e.target.checked)} />
          Только просроченные · {overdueCount}
        </label>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>Объект</th><th>Зона</th><th>Окно</th><th>SLA</th><th>Оператор</th><th></th>
          </tr>
        </thead>
        <tbody>
          {list.length === 0 && (
            <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 24 }}>Нет нарядов на согласовании</td></tr>
          )}
          {list.map((p) => {
            const sla = slaText(p.slaDeadline, now);
            const b = byId.get(p.buildingId);
            return (
              <tr key={p.id}>
                <td>
                  <div>{b?.name ?? p.buildingId.slice(0, 8)}</div>
                  <div className="muted">{b?.address ?? ''}</div>
                </td>
                <td>
                  {p.zoneTypes.map((z) => ZONE[z] ?? z).join(', ')}
                  {p.hasCriticalZone && (
                    <div className="muted" style={{ color: 'var(--error)' }}>критичная — авто-согласия не будет</div>
                  )}
                  {p.requiresShutdown && (
                    <div className="muted">отключение, {p.affectedUnitIds.length} помещ.</div>
                  )}
                </td>
                <td>{p.windowFrom ? formatDateTime(p.windowFrom) : '—'}</td>
                <td style={{ color: sla.overdue ? 'var(--error)' : undefined, fontWeight: sla.overdue ? 600 : 400 }}>
                  {sla.text}
                </td>
                <td>{p.masterIsPlatform ? 'мастер платформы' : 'служба оператора'}</td>
                <td>
                  {p.status === 'scheduled' && (
                    <button className="btn btn--secondary" disabled={busy === p.id} onClick={() => override(p)}>
                      Санкция на вскрытие
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
