import { api } from '../api';
import { useFetch } from '../useFetch';
import { formatDate } from '../format';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';
import type { Holiday } from '../types';

/** A-28: производственный календарь РУз (ТЗ 14). */
export function HolidaysPage() {
  const { data, loading, error } = useFetch<Holiday[]>(() =>
    api.get<Holiday[]>('/admin/registry/holidays'),
  );

  if (loading) return <Loading />;
  if (error !== null) return <ErrorBanner message={error} />;

  const holidays = data ?? [];

  return (
    <>
      <div className="page-header">
        <h1>Производственный календарь</h1>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Дата</th>
              <th>Праздник</th>
            </tr>
          </thead>
          <tbody>
            {holidays.length === 0 && <EmptyRow colSpan={2} />}
            {holidays.map((h) => (
              <tr key={h.date}>
                <td className="num">{formatDate(h.date)}</td>
                <td>{h.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 12 }}>
        Деловые таймеры замерзают в праздники (ТЗ 14).
      </p>
    </>
  );
}
