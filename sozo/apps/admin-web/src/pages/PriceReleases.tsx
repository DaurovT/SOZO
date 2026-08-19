import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useFetch } from '../useFetch';
import { formatDateTime } from '../format';
import { StatusBadge } from '../components/Badge';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';
import type { PriceRelease } from '../types';

export function PriceReleasesPage() {
  const navigate = useNavigate();
  const { data, loading, error, reload } = useFetch<PriceRelease[]>(() =>
    api.get<PriceRelease[]>('/admin/price-releases'),
  );
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const hasDraft = (data ?? []).some((r) => r.status === 'draft');

  const createDraft = async () => {
    setBusy(true);
    setActionError(null);
    try {
      const draft = await api.post<PriceRelease>('/admin/price-releases');
      reload();
      navigate(`/price-releases/${draft.id}`);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading />;
  if (error !== null) return <ErrorBanner message={error} />;

  const releases = data ?? [];

  return (
    <>
      <div className="page-header">
        <h1>Релизы прайса</h1>
        <button
          type="button"
          className="btn btn--primary"
          disabled={hasDraft || busy}
          title={hasDraft ? 'Черновик уже существует' : undefined}
          onClick={createDraft}
        >
          Создать черновик
        </button>
      </div>
      {actionError !== null && <ErrorBanner message={actionError} />}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>№</th>
              <th>Статус</th>
              <th className="num">Позиций</th>
              <th>Создан</th>
              <th>Активирован</th>
            </tr>
          </thead>
          <tbody>
            {releases.length === 0 && <EmptyRow colSpan={5} />}
            {releases.map((r) => (
              <tr
                key={r.id}
                className="row--clickable"
                onClick={() => navigate(`/price-releases/${r.id}`)}
              >
                <td className="num">№{r.number}</td>
                <td>
                  <StatusBadge status={r.status} />
                </td>
                <td className="num">{r.itemsCount}</td>
                <td>{formatDateTime(r.createdAt)}</td>
                <td>{formatDateTime(r.activatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
