import { useNavigate } from 'react-router-dom';
import { useFetch } from '../useFetch';
import { getOrgId } from '../auth';
import { ConnectionBadge, HealthDot } from '../components/Badges';
import { Empty, ErrorState, Loading } from '../components/States';
import type { Dashboard as DashboardData } from '../types';

/**
 * U-01. Отвечает на один вопрос — что горит прямо сейчас.
 * Порядок объектов задаёт светофор: красные сверху, чтобы важное не пришлось искать.
 */
export function Dashboard() {
  const org = getOrgId();
  const nav = useNavigate();
  const { data, loading, error, reload } = useFetch<DashboardData>(org ? `/operator/${org}/dashboard` : null);

  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return null;

  const order = { red: 0, amber: 1, green: 2 } as const;
  const objects = [...data.objects].sort((a, b) => order[a.health] - order[b.health]);

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--s16)' }}>
        <div>
          <h1 className="h1">Портфель объектов</h1>
          <div className="cap" style={{ marginTop: 'var(--s4)' }}>
            {data.objectsTotal} {plural(data.objectsTotal, 'объект', 'объекта', 'объектов')}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 'var(--s16)' }}>
        <Tile title="Нарядов на согласовании" value={data.totals.permitsPending}
          note={data.totals.permitsOverdue > 0 ? `${data.totals.permitsOverdue} просрочено` : undefined} danger />
        <Tile title="Критичные зоны" value={data.totals.criticalPending} note="авто-согласия не будет" />
        <Tile title="Объектов не активно" value={data.totals.objectsNotActive} note="не завершена настройка" />
        <Tile title="Объектов ограничено" value={data.totals.objectsDegraded} note="гарантии сняты" danger />
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ padding: 'var(--s16)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center' }}>
          <h2 className="h2">Объекты</h2>
          <div className="cap" style={{ marginLeft: 'auto' }}>Красный — требует действия сегодня</div>
        </div>

        {objects.length === 0 ? (
          <Empty text="Объекты пока не подключены" />
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 36 }} />
                <th>Объект</th>
                <th>Статус</th>
                <th className="num">Наряды</th>
                <th className="num">Отключения</th>
                <th className="num">Замечания</th>
                <th>Что горит</th>
              </tr>
            </thead>
            <tbody>
              {objects.map((o) => (
                <tr key={o.buildingId} style={{ cursor: 'pointer' }} onClick={() => nav(`/settings?building=${o.buildingId}`)}>
                  <td><HealthDot health={o.health} /></td>
                  <td><div style={{ fontWeight: 600 }}>{o.name}</div></td>
                  <td><ConnectionBadge status={o.connectionStatus} /></td>
                  <td className="num">{o.permitsPending}{o.criticalPending > 0 && <span className="cap"> (крит. {o.criticalPending})</span>}</td>
                  <td className="num">{o.shutdownsActive + o.shutdownsPlanned}</td>
                  <td className="num">{o.observationsOpen}</td>
                  <td className="dense" style={{ color: reasonColor(o.health) }}>{reason(o)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function Tile({ title, value, note, danger }: { title: string; value: number; note?: string; danger?: boolean }) {
  return (
    <div className="card" style={{ padding: 'var(--s16)' }}>
      <div className="cap">{title}</div>
      <div className="h1" style={{ marginTop: 'var(--s8)' }}>{value}</div>
      {note && (
        <div className="cap" style={{ marginTop: 'var(--s4)', color: danger && value > 0 ? 'var(--error)' : undefined }}>
          {note}
        </div>
      )}
    </div>
  );
}

/** Одна причина, самая срочная: список причин на дашборде не читают. */
function reason(o: DashboardData['objects'][number]): string {
  if (o.observationsEmergency > 0) return 'Аварийное замечание';
  if (o.connectionStatus === 'degraded') return 'Объект ограничен из-за просрочек';
  if (o.readinessGaps.length > 0) return o.readinessGaps[0];
  if (o.criticalPending > 0) return 'Наряд в критичную зону ждёт решения';
  if (o.permitsOverdue > 0) return 'Просроченное согласование';
  if (o.shutdownsLateNotice > 0) return 'Отключение опубликовано поздно';
  return 'Всё спокойно';
}

function reasonColor(h: string): string | undefined {
  if (h === 'red') return 'var(--error)';
  if (h === 'amber') return '#8A5200';
  return 'var(--text-secondary)';
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
