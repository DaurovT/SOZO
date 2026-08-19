import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useFetch } from '../useFetch';
import { formatSoums } from '../format';
import { downloadCsv } from '../csv';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';

/**
 * Кто имеет доступ к B2B-контуру приложения.
 *
 * Сквозной реестр по всем организациям: до него найти человека по телефону
 * можно было, только зная его организацию — открыть карточку, найти точку,
 * развернуть список. При звонке «мне закрыли доступ» это несколько переходов
 * вслепую, и половина заканчивалась «перезвоните позже».
 *
 * Права меняются в карточке организации: здесь поиск и обзор, а не редактор.
 * Один список на две задачи — искать и править — обычно ломает обе.
 */

interface RepRow {
  id: string;
  organizationId: string;
  organizationName: string;
  organizationStatus: string;
  locationId: string;
  locationName: string;
  address: string;
  fullName: string;
  phone: string;
  role: string;
  approvalLimitTiyin: number | null;
  primary: boolean;
  contour: 'staff' | 'site_manager' | 'org_manager';
}

const CONTOUR: Record<string, { label: string; cls: string }> = {
  staff: { label: 'Сотрудник', cls: 'badge badge--muted' },
  site_manager: { label: 'Руководитель точки', cls: 'badge badge--accent' },
  org_manager: { label: 'Руководитель организации', cls: 'badge badge--success' },
};

export function RepresentativesPage() {
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState('');

  const { data, loading, error } = useFetch<{ representatives: RepRow[]; total: number }>(
    () => api.get(`/admin/organizations/representatives${applied ? `?q=${encodeURIComponent(applied)}` : ''}`),
    [applied],
  );

  const rows = data?.representatives ?? [];

  return (
    <>
      <div className="page-header">
        <h1>Доступ к приложению B2B</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s16)' }}>
          <span className="muted">{rows.length} человек</span>
          <button
            type="button"
            className="btn"
            disabled={rows.length === 0}
            onClick={() =>
              downloadCsv(
                'representatives.csv',
                ['ФИО', 'Телефон', 'Организация', 'Точка', 'Роль', 'Потолок утверждения'],
                rows.map((r) => [
                  r.fullName,
                  r.phone,
                  r.organizationName,
                  r.locationName,
                  r.role,
                  r.approvalLimitTiyin === null ? 'без потолка' : String(Math.round(r.approvalLimitTiyin / 100)),
                ]),
              )
            }
          >
            Скачать CSV
          </button>
        </div>
      </div>

      <div className="banner">
        Вписанный сюда телефон открывает человеку контур точки в приложении «Клиент», снятый —
        закрывает. Права меняются в карточке организации
      </div>

      <div className="form-grid">
        <div className="field">
          <label htmlFor="rep-q">Поиск</label>
          <input
            id="rep-q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setApplied(q.trim());
            }}
            placeholder="+998901234567, фамилия, название точки"
          />
        </div>
      </div>
      <div className="actions-row">
        <button type="button" className="btn btn--primary" onClick={() => setApplied(q.trim())}>
          Найти
        </button>
        {applied !== '' && (
          <button
            type="button"
            className="btn"
            onClick={() => {
              setQ('');
              setApplied('');
            }}
          >
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
                <th>Кто</th>
                <th>Телефон</th>
                <th>Организация</th>
                <th>Точка</th>
                <th>Роль в приложении</th>
                <th className="num">Потолок утверждения</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <EmptyRow colSpan={6} />}
              {rows.map((r) => (
                <tr key={r.id} className={r.organizationStatus !== 'active' ? 'row--warning' : undefined}>
                  <td>
                    {r.fullName}
                    {r.primary && <div className="muted">главный на точке</div>}
                  </td>
                  <td className="mono">{r.phone}</td>
                  <td>
                    <Link to={`/organizations/${r.organizationId}`}>{r.organizationName}</Link>
                    {r.organizationStatus !== 'active' && (
                      <div className="muted">договор: {r.organizationStatus}</div>
                    )}
                  </td>
                  <td>
                    {r.locationName}
                    <div className="muted">{r.address}</div>
                  </td>
                  <td>
                    <span className={CONTOUR[r.contour]?.cls ?? 'badge'}>
                      {CONTOUR[r.contour]?.label ?? r.contour}
                    </span>
                    <div className="muted">{r.role}</div>
                  </td>
                  <td className="num">
                    {r.approvalLimitTiyin === null ? 'без потолка' : formatSoums(r.approvalLimitTiyin)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
