import { useState } from 'react';
import { StatusBadge } from '../components/Badges';
import { OrderModal } from '../components/OrderModal';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';
import { formatDateTime, formatSoums } from '../format';
import { useKanban } from '../useKanban';

export function ArchivePage() {
  const { data, loading, error, reload } = useKanban();
  const [openId, setOpenId] = useState<string | null>(null);

  if (loading) return <Loading />;
  if (error !== null && !data) return <ErrorBanner message={error} />;
  if (!data) return null;

  return (
    <>
      <div className="page-header">
        <h1>Архив</h1>
        <span className="muted">закрытые и отменённые заявки</span>
      </div>
      {error !== null && <ErrorBanner message={error} />}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Номер</th>
              <th>Статус</th>
              <th>Клиент</th>
              <th className="num">Сумма</th>
              <th>Мастер</th>
              <th>Дата</th>
            </tr>
          </thead>
          <tbody>
            {data.archive.length === 0 && <EmptyRow colSpan={6} />}
            {data.archive.map((o) => (
              <tr key={o.id} className="row--clickable" onClick={() => setOpenId(o.id)}>
                <td className="mono">{o.number}</td>
                <td>
                  <StatusBadge status={o.status} />
                </td>
                <td>
                  {o.clientName || '—'} <span className="muted">{o.clientPhone}</span>
                </td>
                <td className="num">
                  {formatSoums(o.totalFromTiyin)} — {formatSoums(o.totalToTiyin)}
                </td>
                <td>{o.masterName ?? '—'}</td>
                <td>{formatDateTime(o.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {openId !== null && (
        <OrderModal orderId={openId} onClose={() => setOpenId(null)} onChanged={reload} />
      )}
    </>
  );
}
