import { useState } from 'react';
import { getOrgId } from '../auth';
import { useFetch } from '../useFetch';
import { BuildingPicker, useSelectedBuilding } from '../components/BuildingPicker';
import { ErrorState, Loading } from '../components/States';
import type { Dashboard } from '../types';

/**
 * U-12. Отчёты.
 *
 * Три адресата — и это не три оформления одного отчёта, а три разных отчёта.
 * Правлению нужны сроки и деньги, собственнику — состояние актива и техдолг,
 * арендаторам — что делалось у них и когда отключат воду. Показывать всем
 * одно и то же значит, что двое из трёх читают чужое.
 *
 * Выгрузка сохраняется как файл на стороне браузера: отчёт уходит в почту и
 * в правление, и требовать для этого доступа в кабинет бессмысленно.
 */

type Audience = 'board' | 'owner' | 'tenants';

const AUDIENCE: Array<{ id: Audience; title: string; hint: string }> = [
  { id: 'board', title: 'Правлению', hint: 'сроки, заявки, соблюдение SLA' },
  { id: 'owner', title: 'Собственнику', hint: 'состояние актива, техдолг, деньги' },
  { id: 'tenants', title: 'Арендаторам', hint: 'что делалось и что планируется' },
];

export function Reports() {
  const org = getOrgId();
  const [audience, setAudience] = useState<Audience>('board');
  const dash = useFetch<Dashboard>(org ? `/operator/${org}/dashboard` : null);
  const buildingId = useSelectedBuilding(dash.data);
  const report = useFetch<Record<string, unknown>>(
    org && buildingId ? `/operator/${org}/buildings/${buildingId}/report?audience=${audience}` : null,
    [org, buildingId, audience],
  );

  if (dash.loading) return <Loading />;
  if (dash.error) return <ErrorState error={dash.error} onRetry={dash.reload} />;

  const download = () => {
    if (!report.data) return;
    const blob = new Blob([JSON.stringify(report.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `отчёт-${audience}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--s16)' }}>
        <div>
          <h1 className="h1">Отчёты</h1>
          <div className="cap" style={{ marginTop: 'var(--s4)' }}>Три адресата — три разных отчёта</div>
        </div>
        <BuildingPicker dash={dash.data} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 'var(--s16)' }}>
        {AUDIENCE.map((a) => (
          <button
            key={a.id}
            type="button"
            className="card"
            onClick={() => setAudience(a.id)}
            style={{
              padding: 'var(--s16)',
              textAlign: 'left',
              cursor: 'pointer',
              border: audience === a.id ? '2px solid var(--accent, #2f6fed)' : undefined,
            }}
          >
            <div style={{ fontWeight: 600 }}>{a.title}</div>
            <div className="cap" style={{ marginTop: 'var(--s4)' }}>{a.hint}</div>
          </button>
        ))}
      </div>

      {report.loading && <Loading />}
      {report.error && <ErrorState error={report.error} onRetry={report.reload} />}

      {report.data && (
        <div className="card" style={{ padding: 'var(--s16)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s16)' }}>
            <h2 className="h2" style={{ flex: 1 }}>Предпросмотр</h2>
            <button type="button" onClick={download}>Выгрузить</button>
          </div>
          <pre
            className="dense"
            style={{ marginTop: 'var(--s8)', maxHeight: 420, overflow: 'auto', whiteSpace: 'pre-wrap' }}
          >
            {JSON.stringify(report.data, null, 2)}
          </pre>
        </div>
      )}
    </>
  );
}
