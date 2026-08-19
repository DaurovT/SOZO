import { useState } from 'react';
import { api } from '../api';
import { useFetch } from '../useFetch';
import { formatDateTime } from '../format';
import { downloadCsv } from '../csv';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';
import { auditActionLabel, auditEntityLabel, auditGroupLabel } from '../auditDicts';
import type { AuditRecord } from '../types';

interface Facets {
  actors: string[];
  entities: string[];
  actionGroups: string[];
}

/**
 * Короткая выжимка из payload.
 *
 * Показывать сырой JSON в таблице бессмысленно — он не читается и ломает
 * вёрстку. Но именно там лежит то, ради чего в журнал и заглядывают: номер
 * заявки, причина отмены, сумма. Берём только то, что помещается в строку.
 */
function payloadSummary(payload: unknown): string {
  if (payload === null || typeof payload !== 'object') return '';
  const p = payload as Record<string, unknown>;
  const parts: string[] = [];
  const push = (key: string, label?: string) => {
    const v = p[key];
    if (v === undefined || v === null || v === '') return;
    parts.push(label === undefined ? String(v) : `${label}: ${v}`);
  };
  push('number');
  push('reason', 'причина');
  push('resolution', 'итог');
  push('type', 'тип');
  push('to', 'кому');
  push('master', 'мастер');
  push('variant', 'вариант');
  push('tier', 'вариант');
  push('rating', 'оценка');
  push('provider', 'провайдер');
  if (typeof p.amountTiyin === 'number') parts.push(`${Math.round(p.amountTiyin / 100).toLocaleString('ru-RU')} сум`);
  return parts.join(' · ');
}

export function AuditPage() {
  const [actor, setActor] = useState('');
  const [entity, setEntity] = useState('');
  const [group, setGroup] = useState('');
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState({ actor: '', entity: '', group: '', q: '' });

  const { data: facets } = useFetch<Facets>(() => api.get<Facets>('/admin/audit/facets'), []);
  const { data, loading, error } = useFetch<AuditRecord[]>(() => {
    const params = new URLSearchParams({ limit: '200' });
    if (applied.actor) params.set('actor', applied.actor);
    if (applied.entity) params.set('entity', applied.entity);
    // Группа действий — префикс до точки: «client» находит все действия клиента
    if (applied.group) params.set('action', applied.group === 'order' ? 'order.' : `${applied.group}.`);
    if (applied.q) params.set('q', applied.q);
    return api.get<AuditRecord[]>(`/admin/audit?${params.toString()}`);
  }, [applied]);

  const records = data ?? [];
  const apply = () => setApplied({ actor, entity, group, q: q.trim() });
  const reset = () => {
    setActor('');
    setEntity('');
    setGroup('');
    setQ('');
    setApplied({ actor: '', entity: '', group: '', q: '' });
  };
  const filtered = applied.actor !== '' || applied.entity !== '' || applied.group !== '' || applied.q !== '';

  return (
    <>
      <div className="page-header">
        <h1>Аудит</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s16)' }}>
          <span className="muted">
            {filtered ? `найдено ${records.length}` : `последние ${records.length} записей`}
          </span>
          <button
            type="button"
            className="btn"
            disabled={records.length === 0}
            onClick={() =>
              downloadCsv(
                'audit.csv',
                ['Время', 'Кто', 'Что произошло', 'Код события', 'Объект', 'ID', 'Подробности'],
                records.map((r) => [
                  formatDateTime(r.createdAt),
                  r.actorPhone,
                  auditActionLabel(r.action),
                  r.action,
                  auditEntityLabel(r.entity),
                  r.entityId,
                  payloadSummary(r.payload),
                ]),
              )
            }
          >
            Скачать CSV
          </button>
        </div>
      </div>

      <div className="banner">
        Журнал только дописывается: исправить или удалить запись нельзя (ТЗ 14). Ищите по номеру
        заявки, телефону или сумме — поиск идёт по всем полям сразу
      </div>

      <div className="form-grid">
        <div className="field">
          <label htmlFor="au-q">Поиск</label>
          <input
            id="au-q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') apply();
            }}
            placeholder="Z-2026-000123, +998901234567, причина отмены"
          />
        </div>
        <div className="field">
          <label htmlFor="au-actor">Кто</label>
          <select id="au-actor" value={actor} onChange={(e) => setActor(e.target.value)}>
            <option value="">— любой —</option>
            {(facets?.actors ?? []).map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="au-group">Раздел</label>
          <select id="au-group" value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="">— любой —</option>
            {(facets?.actionGroups ?? []).map((g) => (
              <option key={g} value={g}>
                {auditGroupLabel(g)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="au-entity">Объект</label>
          <select id="au-entity" value={entity} onChange={(e) => setEntity(e.target.value)}>
            <option value="">— любой —</option>
            {(facets?.entities ?? []).map((en) => (
              <option key={en} value={en}>
                {auditEntityLabel(en)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="actions-row">
        <button type="button" className="btn btn--primary" onClick={apply}>
          Показать
        </button>
        {filtered && (
          <button type="button" className="btn" onClick={reset}>
            Сбросить
          </button>
        )}
      </div>

      {error !== null && <ErrorBanner message={error} />}
      {loading && !data && <Loading />}

      {data && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Время</th>
                <th>Кто</th>
                <th>Что произошло</th>
                <th>Объект</th>
                <th>Подробности</th>
              </tr>
            </thead>
            <tbody>
              {records.length === 0 && <EmptyRow colSpan={5} />}
              {records.map((r) => (
                <tr key={r.id}>
                  <td className="num">{formatDateTime(r.createdAt)}</td>
                  <td className="num">{r.actorPhone}</td>
                  <td>
                    {auditActionLabel(r.action)}
                    <div className="muted mono">{r.action}</div>
                  </td>
                  <td>
                    {auditEntityLabel(r.entity)}
                    {r.entityId !== undefined && <div className="muted mono">{r.entityId}</div>}
                  </td>
                  <td className="muted">{payloadSummary(r.payload)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
