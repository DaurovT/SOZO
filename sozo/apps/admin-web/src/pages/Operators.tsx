import { api } from '../api';
import { useFetch } from '../useFetch';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';

/**
 * A-40. Реестр эксплуатирующих организаций: тариф, объекты, здоровье SLA.
 * Здесь видно то, чего не видно оператору: систематические просрочки
 * согласований и деградации объектов.
 */

interface Building {
  id: string;
  name: string;
  address: string;
  operatorOrgId: string | null;
  connectionStatus: string;
  serviceFeeBps: number;
  permitsTotal30d: number;
  permitsOverdue30d: number;
  emergencyOverdue30d: number;
}

const STATUS_LABEL: Record<string, string> = {
  unmanaged: 'не подключён',
  claimed: 'заявлен',
  verified: 'проверен',
  active: 'активен',
  degraded: 'ограничен',
};

export function OperatorsPage() {
  const { data, loading, error } = useFetch<Building[]>(() => api.get<Building[]>('/buildings'), []);

  if (loading) return <Loading />;
  if (error !== null) return <ErrorBanner message={error} />;

  const buildings = data ?? [];
  // Группируем по оператору: платформе интересна организация целиком,
  // а не отдельный дом — деградация одного объекта из двадцати это норма,
  // а из двух — сигнал
  const byOperator = new Map<string, Building[]>();
  for (const b of buildings) {
    if (!b.operatorOrgId) continue;
    byOperator.set(b.operatorOrgId, [...(byOperator.get(b.operatorOrgId) ?? []), b]);
  }

  return (
    <>
      <div className="page-header">
        <h1>Эксплуатирующие организации</h1>
      </div>

      {byOperator.size === 0 ? (
        <div className="table-wrap">
          <table><tbody><EmptyRow colSpan={1} /></tbody></table>
        </div>
      ) : (
        [...byOperator.entries()].map(([orgId, list]) => {
          const total = list.reduce((s, b) => s + b.permitsTotal30d, 0);
          const overdue = list.reduce((s, b) => s + b.permitsOverdue30d, 0);
          const emergencyOverdue = list.reduce((s, b) => s + b.emergencyOverdue30d, 0);
          const degraded = list.filter((b) => b.connectionStatus === 'degraded').length;
          const share = total ? Math.round((overdue / total) * 100) : 0;

          return (
            <div className="card" key={orgId} style={{ marginBottom: 16, padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                <h2 style={{ margin: 0 }}>{orgId}</h2>
                <span className="muted">{list.length} объект(ов)</span>
                {degraded > 0 && <span className="tone--error">ограничено: {degraded}</span>}
              </div>

              <div className="muted" style={{ margin: '8px 0 12px' }}>
                Согласований за 30 дней: {total} · просрочено {overdue} ({share}%)
                {emergencyOverdue > 0 && (
                  <span className="tone--error"> · аварийных просрочек: {emergencyOverdue}</span>
                )}
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Объект</th><th>Адрес</th><th>Статус</th><th className="num">Ставка сбора</th></tr>
                  </thead>
                  <tbody>
                    {list.map((b) => (
                      <tr key={b.id}>
                        <td>{b.name}</td>
                        <td className="muted">{b.address}</td>
                        <td>
                          <span className={b.connectionStatus === 'degraded' ? 'tone--error' : undefined}>
                            {STATUS_LABEL[b.connectionStatus] ?? b.connectionStatus}
                          </span>
                        </td>
                        <td className="num">{(b.serviceFeeBps / 100).toFixed(0)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })
      )}
    </>
  );
}
