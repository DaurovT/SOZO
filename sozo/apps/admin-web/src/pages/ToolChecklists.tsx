import { api } from '../api';
import { useFetch } from '../useFetch';
import { ErrorBanner, Loading } from '../components/States';
import type { ToolChecklist } from '../types';

/** A-27: обязательный набор инструмента по skill-тегам (ТЗ 8.4.1). */
export function ToolChecklistsPage() {
  const { data, loading, error } = useFetch<ToolChecklist[]>(() =>
    api.get<ToolChecklist[]>('/admin/registry/tool-checklists'),
  );

  if (loading) return <Loading />;
  if (error !== null) return <ErrorBanner message={error} />;

  const checklists = data ?? [];

  return (
    <>
      <div className="page-header">
        <h1>Инструмент по навыкам</h1>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: 'var(--s16)',
        }}
      >
        {checklists.map((c) => (
          <div key={c.skill} className="card">
            <div className="semibold" style={{ marginBottom: 'var(--s8)' }}>
              <span className="chip">{c.skill}</span>
            </div>
            <ul style={{ margin: 0, paddingLeft: 'var(--s16)' }}>
              {c.tools.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
        ))}
        {checklists.length === 0 && <div className="state-text">Пока пусто</div>}
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 'var(--s16)' }}>
        Неполный набор = временное снятие skill-тега.
      </p>
    </>
  );
}
