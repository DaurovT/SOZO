import { useState } from 'react';
import { ApiError, request } from '../api';
import { getOrgId } from '../auth';
import { useFetch } from '../useFetch';
import { BuildingPicker, useSelectedBuilding } from '../components/BuildingPicker';
import { Empty, ErrorState, Loading } from '../components/States';
import { resourceName, timeShort } from '../format';
import type { Dashboard } from '../types';

/**
 * U-07. Заменяет бумажное объявление на подъезде — и делает приложение жителя
 * нужным самому оператору.
 */

interface Shutdown {
  id: string;
  resourceType: string;
  scope: string;
  riserId: string | null;
  affectedUnitIds: string[];
  plannedFrom: string;
  plannedTo: string;
  actualFrom: string | null;
  actualTo: string | null;
  reason: string;
  status: string;
  lateNotice: boolean;
  isEmergency: boolean;
}

const RESOURCES = ['cold_water', 'hot_water', 'heating', 'electricity', 'gas', 'sewage', 'lift', 'ventilation'];

const STATUS: Record<string, { label: string; cls: string }> = {
  scheduled: { label: 'Запланировано', cls: 'chip--warning' },
  active: { label: 'Идёт', cls: 'chip--error' },
  restored: { label: 'Восстановлено', cls: 'chip--success' },
  cancelled: { label: 'Отменено', cls: 'chip--neutral' },
};

export function Shutdowns() {
  const org = getOrgId();
  const [form, setForm] = useState({ resourceType: 'cold_water', riserId: '', from: '', hours: '4', reason: '' });
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const dash = useFetch<Dashboard>(org ? `/operator/${org}/dashboard` : null);
  const buildingId = useSelectedBuilding(dash.data);
  const list = useFetch<Shutdown[]>(buildingId ? `/buildings/${buildingId}/shutdowns` : null, [buildingId]);

  if (dash.loading || list.loading) return <Loading />;
  if (dash.error) return <ErrorState error={dash.error} onRetry={dash.reload} />;
  if (list.error) return <ErrorState error={list.error} onRetry={list.reload} />;

  async function create() {
    if (!buildingId || !form.from || !form.reason) {
      setToast('Заполните время и причину');
      return;
    }
    setBusy(true);
    const from = new Date(form.from);
    const to = new Date(from.getTime() + Number(form.hours) * 3_600_000);
    try {
      const r = await request<{ notifiedUnits: number; lateNotice: boolean }>(
        `/buildings/${buildingId}/shutdowns`,
        {
          body: {
            resourceType: form.resourceType,
            riserId: form.riserId || undefined,
            plannedFrom: from.toISOString(),
            plannedTo: to.toISOString(),
            reason: form.reason,
          },
        },
      );
      setToast(
        `Оповещено помещений: ${r.notifiedUnits}` +
          (r.lateNotice ? ' · опубликовано позже срока в 24 ч' : ''),
      );
      setForm({ ...form, riserId: '', from: '', reason: '' });
      list.reload();
    } catch (e) {
      // Конфликт стояка — не ошибка ввода, а защита от двух бригад на одном стояке
      setToast(e instanceof ApiError ? e.message : 'Не удалось создать');
    } finally {
      setBusy(false);
    }
  }

  const items = list.data ?? [];

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--s16)' }}>
        <div>
          <h1 className="h1">Отключения и работы</h1>
          <div className="cap" style={{ marginTop: 'var(--s4)' }}>
            Жителей затронутых помещений предупредим автоматически
          </div>
        </div>
        <BuildingPicker dash={dash.data} />
      </div>

      <div className="card" style={{ padding: 'var(--s16)' }}>
        <h2 className="h2" style={{ fontSize: 17, marginBottom: 'var(--s16)' }}>Запланировать отключение</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0,1fr))', gap: 'var(--s12)' }}>
          <label>
            <div className="cap" style={{ marginBottom: 'var(--s4)' }}>Ресурс</div>
            <select className="input" value={form.resourceType} onChange={(e) => setForm({ ...form, resourceType: e.target.value })}>
              {RESOURCES.map((r) => <option key={r} value={r}>{resourceName(r)}</option>)}
            </select>
          </label>
          <label>
            <div className="cap" style={{ marginBottom: 'var(--s4)' }}>Стояк</div>
            <input className="input" placeholder="R1 · пусто = весь дом" value={form.riserId}
              onChange={(e) => setForm({ ...form, riserId: e.target.value })} />
          </label>
          <label>
            <div className="cap" style={{ marginBottom: 'var(--s4)' }}>Начало</div>
            <input className="input" type="datetime-local" value={form.from}
              onChange={(e) => setForm({ ...form, from: e.target.value })} />
          </label>
          <label>
            <div className="cap" style={{ marginBottom: 'var(--s4)' }}>Длительность</div>
            <select className="input" value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })}>
              <option value="2">2 часа</option><option value="4">4 часа</option>
              <option value="8">8 часов</option><option value="24">сутки</option>
            </select>
          </label>
          <label>
            <div className="cap" style={{ marginBottom: 'var(--s4)' }}>Причина</div>
            <input className="input" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </label>
        </div>
        <button className="btn" style={{ marginTop: 'var(--s16)' }} disabled={busy} onClick={create}>
          Запланировать
        </button>
        <div className="cap" style={{ marginTop: 'var(--s8)' }}>
          Публикуйте не позже чем за 24 часа — позднее создание помечается и попадает в показатели объекта.
        </div>
      </div>

      {items.length === 0 ? (
        <Empty text="Отключений не запланировано" />
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <table>
            <thead>
              <tr><th>Ресурс</th><th>Зона</th><th>Окно</th><th className="num">Помещений</th><th>Статус</th><th>Причина</th></tr>
            </thead>
            <tbody>
              {items.map((s) => {
                const st = STATUS[s.status] ?? STATUS.scheduled;
                return (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 600 }}>{resourceName(s.resourceType)}</td>
                    <td>{s.riserId ? `стояк ${s.riserId}` : 'весь дом'}</td>
                    <td className="dense">{timeShort(s.plannedFrom)} — {timeShort(s.plannedTo).slice(-5)}</td>
                    <td className="num">{s.affectedUnitIds.length}</td>
                    <td>
                      <span className={`chip ${st.cls}`}>{st.label}</span>
                      {s.lateNotice && <div className="cap" style={{ color: 'var(--error)' }}>поздняя публикация</div>}
                    </td>
                    <td className="dense">{s.reason}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {toast && <div className="toast" onClick={() => setToast(null)}>{toast}</div>}
    </>
  );
}
