import { ErrorBanner, EmptyRow, Loading } from '../components/States';
import { api } from '../api';
import { formatDateTime } from '../format';
import { useFetch } from '../useFetch';

/**
 * D-16. Заблокировано третьей стороной.
 *
 * Работа стоит не по вине мастера: не пустили в квартиру, нет доступа к
 * стояку, клиент не отвечает, объект законсервирован. Экран нужен потому, что
 * такие заявки не двигаются сами и ни в одну очередь не попадают — в kanban
 * они висят в том же статусе, что и работающие, и отличить их нельзя.
 */

interface BlockedRow {
  branchId: string;
  orderId: string;
  number: string | null;
  address: string | null;
  status: string | null;
  masterName: string | null;
  kind: string;
  reasonCode: string | null;
  comment: string | null;
  since: string;
  hoursStuck: number;
}

interface BlockedData {
  total: number;
  stale: number;
  rows: BlockedRow[];
}

const KIND: Record<string, string> = {
  no_access: 'не пустили',
  client_unavailable: 'клиент не отвечает',
  unsafe_abort: 'работать небезопасно',
  cant_go: 'мастер не может выехать',
  conservation: 'объект законсервирован',
};

export function Blocked() {
  const { data, loading, error } = useFetch<BlockedData>(() => api.get('/dispatch/ops/blocked'));

  return (
    <>
      <div className="page-header">
        <h1>Заблокировано</h1>
      </div>

      <div className="banner">
        Работа стоит не по вине мастера. Такие заявки не двигаются сами: в kanban они висят в том
        же статусе, что и работающие, и без этого экрана их не отличить.
      </div>

      {error !== null && <ErrorBanner message={error} />}
      {loading && !data && <Loading />}

      {data && (
        <>
          {data.stale > 0 && (
            <div className="banner banner--warning">
              Больше суток без движения: {data.stale}. Это уже не «ждём клиента», а забытая заявка
            </div>
          )}

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Заявка</th>
                  <th>Почему стоит</th>
                  <th>Мастер</th>
                  <th>Стоит</th>
                  <th>С какого времени</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 && <EmptyRow colSpan={5} />}
                {data.rows.map((r) => (
                  <tr key={r.branchId}>
                    <td>
                      <strong>{r.number ?? r.orderId.slice(0, 8)}</strong>
                      <div className="muted">{r.address ?? '—'}</div>
                    </td>
                    <td>
                      {KIND[r.kind] ?? r.kind}
                      {r.comment && <div className="muted">{r.comment}</div>}
                    </td>
                    <td>{r.masterName ?? '—'}</td>
                    <td className={r.hoursStuck >= 24 ? 'tone--error' : undefined}>{r.hoursStuck} ч</td>
                    <td className="muted">{formatDateTime(r.since)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
