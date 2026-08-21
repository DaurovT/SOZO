import { getOrgId } from '../auth';
import { useFetch } from '../useFetch';
import { BuildingPicker, useSelectedBuilding } from '../components/BuildingPicker';
import { Empty, ErrorState, Loading } from '../components/States';
import type { Dashboard } from '../types';

/**
 * U-09. Техдолг объекта.
 *
 * Главное число здесь — не сумма, а количество дефектов без решения. Дефект,
 * по которому не сказано «чиним» или «откладываем», не попадает ни в план,
 * ни в бюджет — и всплывает аварией, когда выбирать уже не из чего.
 */

interface TechDebtData {
  summary: {
    total: number;
    open: number;
    totalCostTiyin: number;
    undecided: number;
    bySeverity: Record<string, { count: number; costTiyin: number }>;
  };
  defects: Array<{
    id: string;
    title?: string;
    description?: string;
    severity: string;
    status: string;
    decision?: string | null;
    estimatedCostTiyin: number;
    zoneKey?: string | null;
  }>;
  observations: Array<{ id: string; zoneKey: string; severity: string; comment: string | null; createdAt: string }>;
}

const SEVERITY: Record<string, string> = {
  emergency: 'аварийный',
  critical: 'критичный',
  substantial: 'существенный',
  cosmetic: 'косметический',
  high: 'высокая',
  medium: 'средняя',
  low: 'низкая',
};

const sum = (t: number) => `${Math.round(t / 100).toLocaleString('ru-RU')} сум`;

export function TechDebt() {
  const org = getOrgId();
  const dash = useFetch<Dashboard>(org ? `/operator/${org}/dashboard` : null);
  const buildingId = useSelectedBuilding(dash.data);
  const data = useFetch<TechDebtData>(
    org && buildingId ? `/operator/${org}/buildings/${buildingId}/tech-debt` : null,
    [org, buildingId],
  );

  if (dash.loading || data.loading) return <Loading />;
  if (dash.error) return <ErrorState error={dash.error} onRetry={dash.reload} />;
  if (data.error) return <ErrorState error={data.error} onRetry={data.reload} />;
  const d = data.data;
  if (!d) return null;

  // Порядок: аварийное сверху. Тот же порядок, что в реестре замечаний —
  // человек не должен переучиваться, переходя между экранами
  const order = ['emergency', 'critical', 'high', 'substantial', 'medium', 'cosmetic', 'low'];
  const defects = [...d.defects].sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--s16)' }}>
        <div>
          <h1 className="h1">Техдолг объекта</h1>
          <div className="cap" style={{ marginTop: 'var(--s4)' }}>
            {d.summary.open} открытых из {d.summary.total}
          </div>
        </div>
        <BuildingPicker dash={dash.data} />
      </div>

      {d.summary.undecided > 0 && (
        <div className="card" style={{ padding: 'var(--s16)', background: 'rgba(240,140,30,.06)', border: '1px solid rgba(240,140,30,.3)' }}>
          <div className="dense">
            <b>По {d.summary.undecided} дефектам решение не принято.</b> Пока нет решения,
            дефект не попадает ни в план работ, ни в бюджет — и всплывёт аварией.
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 'var(--s16)' }}>
        <div className="card" style={{ padding: 'var(--s16)' }}>
          <div className="cap">Открытых дефектов</div>
          <div className="h1" style={{ marginTop: 'var(--s4)' }}>{d.summary.open}</div>
        </div>
        <div className="card" style={{ padding: 'var(--s16)' }}>
          <div className="cap">Оценка устранения</div>
          <div className="h1" style={{ marginTop: 'var(--s4)' }}>{sum(d.summary.totalCostTiyin)}</div>
        </div>
        <div className="card" style={{ padding: 'var(--s16)' }}>
          <div className="cap">Открытых замечаний</div>
          <div className="h1" style={{ marginTop: 'var(--s4)' }}>{d.observations.length}</div>
        </div>
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ padding: 'var(--s16) var(--s16) 0' }}><h2 className="h2">Дефекты</h2></div>
        {defects.length === 0 ? (
          <Empty text="Дефектов нет — либо их ещё не заводили с обходов" />
        ) : (
          <table>
            <thead>
              <tr><th>Дефект</th><th>Зона</th><th>Серьёзность</th><th>Решение</th><th className="num">Оценка</th></tr>
            </thead>
            <tbody>
              {defects.map((x) => (
                <tr key={x.id}>
                  <td style={{ fontWeight: 600 }}>{x.title ?? x.description ?? '—'}</td>
                  <td>{x.zoneKey ?? '—'}</td>
                  <td style={{ color: ['emergency', 'critical', 'high'].includes(x.severity) ? 'var(--error)' : undefined }}>
                    {SEVERITY[x.severity] ?? x.severity}
                  </td>
                  <td className={x.decision ? undefined : 'cap'} style={{ color: x.decision ? undefined : 'var(--error)' }}>
                    {x.decision ?? 'не принято'}
                  </td>
                  <td className="num">{x.estimatedCostTiyin ? sum(x.estimatedCostTiyin) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
