import { useState } from 'react';
import { ApiError, request } from '../api';
import { getOrgId } from '../auth';
import { useFetch } from '../useFetch';
import { BuildingPicker, useSelectedBuilding } from '../components/BuildingPicker';
import { Empty, ErrorState, Loading } from '../components/States';
import { timeShort } from '../format';
import type { Dashboard, Observation, ObservationCategory } from '../types';

/**
 * U-16. Всё, что «не заявка»: грязь во дворе, разбитый плафон, подтёк в подвале.
 * Источники разные — обход, житель, мастер, жалоба, — а очередь одна.
 */

const SEVERITY: Record<string, { label: string; cls: string }> = {
  emergency: { label: 'Аварийное', cls: 'chip--error' },
  work_required: { label: 'Нужны работы', cls: 'chip--warning' },
  housekeeping: { label: 'Содержание', cls: 'chip--neutral' },
  info: { label: 'К сведению', cls: 'chip--neutral' },
};

const SOURCE: Record<string, string> = {
  walkthrough: 'обход',
  resident: 'житель',
  master: 'мастер',
  complaint: 'жалоба',
};

const ROUTES: Array<{ value: string; label: string }> = [
  { value: 'task', label: 'Задача сотруднику' },
  { value: 'defect', label: 'В техдолг' },
  { value: 'order', label: 'Заявка на выезд' },
  { value: 'contractor', label: 'Претензия подрядчику' },
  { value: 'journal', label: 'Только в журнал' },
];

export function Observations() {
  const org = getOrgId();
  const [tab, setTab] = useState<'open' | 'routed' | 'resolved'>('open');
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const dash = useFetch<Dashboard>(org ? `/operator/${org}/dashboard` : null);
  const buildingId = useSelectedBuilding(dash.data);
  const list = useFetch<Observation[]>(
    buildingId ? `/buildings/${buildingId}/observations?status=${tab}` : null,
    [buildingId, tab],
  );
  // Подписи категорий берём с сервера: свой список здесь означал бы, что
  // мастер на обходе нажимает одно, а в кабинете написано другое
  const cats = useFetch<ObservationCategory[]>('/buildings/observation-categories');
  const categoryLabel = (id: string) =>
    cats.data?.find((c) => c.id === id)?.label ?? id;

  if (dash.loading || list.loading) return <Loading />;
  if (dash.error) return <ErrorState error={dash.error} onRetry={dash.reload} />;
  if (list.error) return <ErrorState error={list.error} onRetry={list.reload} />;

  async function route(o: Observation, routedTo: string) {
    setBusy(o.id);
    try {
      await request(`/buildings/observations/${o.id}/route`, { body: { routedTo } });
      setToast('Замечание направлено');
      list.reload();
    } catch (e) {
      setToast(e instanceof ApiError ? e.message : 'Не удалось');
    } finally {
      setBusy(null);
    }
  }

  /**
   * Закрыть можно только фотографией устранения — это перенос продуктового
   * принципа №2 ТЗ с заявок на содержание объекта. Поле здесь, а не «галочка»,
   * именно поэтому.
   */
  async function resolve(o: Observation) {
    const photo = window.prompt('Идентификатор фото устранения');
    if (!photo) return;
    setBusy(o.id);
    try {
      await request(`/buildings/observations/${o.id}/resolve`, { body: { resolvedPhotoId: photo } });
      setToast('Замечание закрыто');
      list.reload();
    } catch (e) {
      setToast(e instanceof ApiError ? e.message : 'Не удалось');
    } finally {
      setBusy(null);
    }
  }

  const items = list.data ?? [];

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--s16)' }}>
        <div>
          <h1 className="h1">Замечания и обходы</h1>
          <div className="cap" style={{ marginTop: 'var(--s4)' }}>
            Всё, что не заявка: содержание, освещение, мусорные площадки, вандализм
          </div>
        </div>
        <BuildingPicker dash={dash.data} />
      </div>

      <div style={{ display: 'flex', gap: 'var(--s8)' }}>
        {(['open', 'routed', 'resolved'] as const).map((s) => (
          <button
            key={s}
            className="btn btn--secondary"
            onClick={() => setTab(s)}
            style={{ borderColor: tab === s ? 'var(--accent)' : 'var(--border)', fontWeight: tab === s ? 600 : 400 }}
          >
            {s === 'open' ? 'Открытые' : s === 'routed' ? 'В работе' : 'Устранённые'}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <Empty text="Замечаний в этой вкладке нет" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s12)' }}>
          {items.map((o) => {
            const sev = SEVERITY[o.severity] ?? SEVERITY.housekeeping;
            return (
              <div
                key={o.id}
                className="card"
                style={{
                  padding: 'var(--s16)',
                  borderLeft: o.severity === 'emergency' ? '3px solid var(--error)' : undefined,
                }}
              >
                <div style={{ display: 'flex', gap: 'var(--s16)', alignItems: 'flex-start' }}>
                  <div style={{ flexGrow: 1 }}>
                    <div style={{ display: 'flex', gap: 'var(--s8)', alignItems: 'center', marginBottom: 'var(--s8)' }}>
                      <span className={`chip ${sev.cls}`} style={{ fontWeight: 600 }}>{sev.label}</span>
                      <span className="chip chip--neutral">{o.zoneKey}</span>
                      <span className="cap">источник: {SOURCE[o.source] ?? o.source}</span>
                    </div>
                    <div className="dense">{categoryLabel(o.categoryId)}</div>
                    {o.comment && <div className="cap" style={{ marginTop: 'var(--s4)' }}>{o.comment}</div>}
                    <div className="cap" style={{ marginTop: 'var(--s4)' }}>
                      {timeShort(o.createdAt)} · фото: {o.photoIds.length}
                      {o.routedEntityId && ' · заявка создана автоматически'}
                    </div>
                  </div>

                  <div style={{ width: 240, display: 'flex', flexDirection: 'column', gap: 'var(--s8)' }}>
                    {o.status === 'open' && (
                      <select
                        className="input"
                        defaultValue=""
                        disabled={busy === o.id}
                        onChange={(e) => e.target.value && route(o, e.target.value)}
                      >
                        <option value="" disabled>Направить…</option>
                        {ROUTES.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}{r.value === o.suggestedRoute ? ' — обычно так' : ''}
                          </option>
                        ))}
                      </select>
                    )}
                    {o.status !== 'resolved' && (
                      <button className="btn" disabled={busy === o.id} onClick={() => resolve(o)}>
                        Закрыть с фото
                      </button>
                    )}
                    {o.status === 'resolved' && <span className="chip chip--success">Устранено</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {toast && <div className="toast" onClick={() => setToast(null)}>{toast}</div>}
    </>
  );
}
