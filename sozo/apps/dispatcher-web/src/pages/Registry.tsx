import { api } from '../api';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';
import { useFetch } from '../useFetch';

/**
 * D-23. Реестр объектов и операторов.
 *
 * Диспетчеру он нужен ради одного вопроса: можно ли вообще отправлять работу
 * на этот адрес. Неподключённый объект означает, что общего имущества как
 * контура нет; деградированный — что оператор не тянет согласования, и заявку
 * придётся вести иначе.
 */

interface RegistryRow {
  id: string;
  name: string;
  address: string;
  connectionStatus: string;
  operatorOrgId: string | null;
  emergencyPhone: string | null;
  permitsOverdue30d: number;
  permitsTotal30d: number;
  overduePercent: number;
  readinessGaps: string[];
}

interface RegistryData {
  total: number;
  active: number;
  degraded: number;
  operators: Array<{ orgId: string; plan: string | null; buildings: number; degraded: number }>;
  rows: RegistryRow[];
}

const STATUS: Record<string, string> = {
  unmanaged: 'не подключён',
  claimed: 'заявка на подключение',
  verified: 'проверен',
  active: 'подключён',
  degraded: 'деградирован',
};

export function Registry() {
  const { data, loading, error } = useFetch<RegistryData>(() => api.get('/dispatch/ops/registry'));

  return (
    <>
      <div className="page-header">
        <h1>Объекты и операторы</h1>
      </div>

      <div className="banner">
        Один вопрос: можно ли отправлять работу на этот адрес. Неподключённый объект — общего
        имущества как контура нет; деградированный — оператор не тянет согласования.
      </div>

      {error !== null && <ErrorBanner message={error} />}
      {loading && !data && <Loading />}

      {data && (
        <>
          <div className="banner">
            {data.active} подключено из {data.total}
            {data.degraded > 0 ? ` · деградировано: ${data.degraded}` : ''}
          </div>

          <h2 className="section-title">Операторы</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Оператор</th>
                  <th>Тариф</th>
                  <th>Объектов</th>
                  <th>Из них деградировано</th>
                </tr>
              </thead>
              <tbody>
                {data.operators.length === 0 && <EmptyRow colSpan={4} />}
                {data.operators.map((o) => (
                  <tr key={o.orgId}>
                    <td>{o.orgId}</td>
                    <td>{o.plan ?? 'без подписки'}</td>
                    <td>{o.buildings}</td>
                    <td className={o.degraded > 0 ? 'tone--error' : undefined}>{o.degraded || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="section-title">Объекты</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Объект</th>
                  <th>Статус</th>
                  <th>Оператор</th>
                  <th>Просрочка согласований</th>
                  <th>Чего не хватает</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 && <EmptyRow colSpan={5} />}
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.name}</strong>
                      <div className="muted">{r.address}</div>
                    </td>
                    <td className={r.connectionStatus === 'degraded' ? 'tone--error' : undefined}>
                      {STATUS[r.connectionStatus] ?? r.connectionStatus}
                    </td>
                    <td>{r.operatorOrgId ?? '—'}</td>
                    <td>
                      {r.permitsTotal30d === 0 ? (
                        <span className="muted">нарядов не было</span>
                      ) : (
                        <span className={r.overduePercent > 20 ? 'tone--error' : undefined}>
                          {r.overduePercent}% ({r.permitsOverdue30d} из {r.permitsTotal30d})
                        </span>
                      )}
                    </td>
                    <td className="muted">
                      {r.readinessGaps.length === 0 ? '—' : r.readinessGaps.join(', ')}
                    </td>
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
