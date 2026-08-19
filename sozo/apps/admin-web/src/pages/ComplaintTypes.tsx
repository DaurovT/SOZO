import { api } from '../api';
import { useFetch } from '../useFetch';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';
import type { ComplaintType } from '../types';

/** A-30: типы жалоб + SLA (ТЗ 17.10). */
export function ComplaintTypesPage() {
  const { data, loading, error } = useFetch<ComplaintType[]>(() =>
    api.get<ComplaintType[]>('/admin/registry/complaint-types'),
  );

  if (loading) return <Loading />;
  if (error !== null) return <ErrorBanner message={error} />;

  const types = data ?? [];

  return (
    <>
      <div className="page-header">
        <h1>Типы жалоб</h1>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Тип</th>
              <th className="num">SLA первый ответ, ч</th>
              <th className="num">SLA резолюция, ч</th>
            </tr>
          </thead>
          <tbody>
            {types.length === 0 && <EmptyRow colSpan={3} />}
            {types.map((t) => (
              <tr key={t.type}>
                <td>{t.type}</td>
                <td className="num">{t.slaFirstResponseH}</td>
                <td className="num">{t.slaResolutionH}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
