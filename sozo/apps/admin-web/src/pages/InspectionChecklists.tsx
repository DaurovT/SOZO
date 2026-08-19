import { api } from '../api';
import { useFetch } from '../useFetch';
import { ErrorBanner, Loading } from '../components/States';
import type { InspectionChecklist } from '../types';

/** A-26: чек-листы плановых осмотров по типам объектов (ТЗ 9.3). */
export function InspectionChecklistsPage() {
  const { data, loading, error } = useFetch<InspectionChecklist[]>(() =>
    api.get<InspectionChecklist[]>('/admin/registry/inspection-checklists'),
  );

  if (loading) return <Loading />;
  if (error !== null) return <ErrorBanner message={error} />;

  const checklists = data ?? [];

  return (
    <>
      <div className="page-header">
        <h1>Чек-листы осмотров</h1>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: 'var(--s16)',
        }}
      >
        {checklists.map((c) => (
          <div key={c.objectType} className="card">
            <div className="semibold" style={{ marginBottom: 'var(--s8)' }}>
              {c.objectType}
            </div>
            <ol style={{ margin: 0, paddingLeft: 'var(--s16)' }}>
              {c.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ol>
          </div>
        ))}
        {checklists.length === 0 && <div className="state-text">Пока пусто</div>}
      </div>
    </>
  );
}
