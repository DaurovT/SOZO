import { api } from '../api';
import { useFetch } from '../useFetch';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';

export function CancelReasonsPage() {
  const { data, loading, error } = useFetch<string[]>(() =>
    api.get<string[]>('/admin/registry/cancel-reasons'),
  );

  if (loading) return <Loading />;
  if (error !== null) return <ErrorBanner message={error} />;

  const reasons = data ?? [];

  return (
    <>
      <div className="page-header">
        <h1>Причины отмен</h1>
        <span className="muted">справочник, только чтение</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="num">№</th>
              <th>Причина</th>
            </tr>
          </thead>
          <tbody>
            {reasons.length === 0 && <EmptyRow colSpan={2} />}
            {reasons.map((reason, i) => (
              <tr key={reason}>
                <td className="num muted">{i + 1}</td>
                <td>{reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
