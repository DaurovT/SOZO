import { useState } from 'react';
import { request, ApiError } from '../api';
import { getOrgId } from '../auth';
import { useFetch } from '../useFetch';
import { PermitBadge } from '../components/Badges';
import { Empty, ErrorState, Loading } from '../components/States';
import { untilText, windowText, zoneName } from '../format';
import type { Dashboard, Permit } from '../types';

type Filter = 'all' | 'overdue' | 'critical';

/**
 * U-02. Ядро бесплатного контура: согласование доступа мастера в общие зоны.
 * Сортировка — по остатку SLA, просроченные сверху: очередь читают сверху вниз
 * и до конца доходят редко.
 */
export function Permits() {
  const org = getOrgId();
  const [filter, setFilter] = useState<Filter>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const dash = useFetch<Dashboard>(org ? `/operator/${org}/dashboard` : null);
  const ids = (dash.data?.objects ?? []).map((o) => o.buildingId).join(',');
  const permits = useFetch<Permit[]>(ids ? `/operator/permits?buildingIds=${ids}` : null, [ids]);

  if (dash.loading || permits.loading) return <Loading />;
  if (dash.error) return <ErrorState error={dash.error} onRetry={dash.reload} />;
  if (permits.error) return <ErrorState error={permits.error} onRetry={permits.reload} />;

  const all = permits.data ?? [];
  const list = all.filter((p) =>
    filter === 'overdue' ? untilText(p.slaDeadline).overdue : filter === 'critical' ? p.hasCriticalZone : true,
  );

  async function act(p: Permit, action: 'approve' | 'reject', reason?: string) {
    setBusy(p.id);
    try {
      await request(`/permits/${p.id}/transitions`, {
        body: { action, clientOpUuid: crypto.randomUUID(), reason },
      });
      setToast(action === 'approve' ? 'Доступ согласован' : 'Наряд отклонён');
      permits.reload();
    } catch (e) {
      setToast(e instanceof ApiError ? e.message : 'Не удалось выполнить');
    } finally {
      setBusy(null);
    }
  }

  const overdue = all.filter((p) => untilText(p.slaDeadline).overdue).length;
  const critical = all.filter((p) => p.hasCriticalZone).length;

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--s16)' }}>
        <div>
          <h1 className="h1">Наряды-допуски</h1>
          <div className="cap" style={{ marginTop: 'var(--s4)' }}>
            Согласуйте доступ мастера в общие зоны объекта
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--s8)' }}>
          <Tab active={filter === 'all'} onClick={() => setFilter('all')}>Все · {all.length}</Tab>
          <Tab active={filter === 'overdue'} onClick={() => setFilter('overdue')} danger>Просроченные · {overdue}</Tab>
          <Tab active={filter === 'critical'} onClick={() => setFilter('critical')}>Критичные зоны · {critical}</Tab>
        </div>
      </div>

      {list.length === 0 ? (
        <Empty text="Нет нарядов на согласование" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s16)' }}>
          {list
            .slice()
            .sort((a, b) => Date.parse(a.slaDeadline ?? '') - Date.parse(b.slaDeadline ?? ''))
            .map((p) => (
              <PermitCard key={p.id} permit={p} busy={busy === p.id} onAct={act} />
            ))}
        </div>
      )}

      {toast && (
        <div className="toast" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}
    </>
  );
}

function PermitCard({
  permit: p, busy, onAct,
}: { permit: Permit; busy: boolean; onAct: (p: Permit, a: 'approve' | 'reject', reason?: string) => void }) {
  const sla = untilText(p.slaDeadline);

  return (
    <div className="card" style={{ padding: 'var(--s16)', borderLeft: sla.overdue ? '3px solid var(--error)' : undefined }}>
      <div style={{ display: 'flex', gap: 'var(--s16)', alignItems: 'flex-start' }}>
        <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 'var(--s12)' }}>
          <div style={{ display: 'flex', gap: 'var(--s8)', flexWrap: 'wrap', alignItems: 'center' }}>
            <span className={`chip ${sla.overdue ? 'chip--error' : 'chip--warning'}`} style={{ fontWeight: 600 }}>
              {sla.text}
            </span>
            {p.zoneTypes.map((z) => (
              <span key={z} className="chip chip--neutral">{zoneName(z)}</span>
            ))}
            {p.requiresShutdown && <span className="chip chip--warning">Требуется отключение</span>}
            <PermitBadge status={p.status} />
          </div>

          <div>
            <div className="h2" style={{ fontSize: 18 }}>Заявка {p.orderId.slice(0, 8)}</div>
            <div className="cap" style={{ marginTop: 'var(--s4)' }}>{windowText(p.windowFrom, p.windowTo)}</div>
          </div>

          {p.requiresShutdown && p.affectedUnitIds.length > 0 && (
            <div className="card" style={{ padding: 'var(--s12)', background: 'var(--bg)', border: 'none' }}>
              <div className="dense">
                Отключение затронет <b>{p.affectedUnitIds.length}</b> помещ. — жителей предупредим автоматически
              </div>
            </div>
          )}

          {/* Критичная зона: авто-согласия не будет никогда, и это надо сказать до, а не после */}
          {p.hasCriticalZone && (
            <div className="card" style={{
              padding: 'var(--s12)', background: 'rgba(224,72,61,.06)',
              border: '1px solid rgba(224,72,61,.25)',
            }}>
              <div className="dense">
                <b>Критичная зона.</b> Авто-согласия по истечении срока не будет — наряд ждёт вашего решения.
              </div>
            </div>
          )}
        </div>

        <div style={{ width: 220, display: 'flex', flexDirection: 'column', gap: 'var(--s8)' }}>
          <div className="card" style={{ padding: 'var(--s12)', background: 'var(--bg)', border: 'none' }}>
            <div className="dense" style={{ fontWeight: 600 }}>
              {p.masterIsPlatform ? 'Мастер платформы' : 'Ваша служба'}
            </div>
          </div>
          {(p.status === 'requested' || p.status === 'rescheduled') && (
            <>
              <button className="btn btn--lg" disabled={busy} onClick={() => onAct(p, 'approve')}>
                Согласовать
              </button>
              <button
                className="btn btn--danger"
                disabled={busy}
                onClick={() => {
                  const reason = window.prompt('Причина отказа');
                  if (reason) onAct(p, 'reject', reason);
                }}
              >
                Отклонить
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Tab({ active, danger, onClick, children }: {
  active: boolean; danger?: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      className="btn btn--secondary"
      onClick={onClick}
      style={{
        borderColor: active ? 'var(--accent)' : danger ? 'var(--error)' : 'var(--border)',
        color: danger && !active ? 'var(--error)' : undefined,
        fontWeight: active ? 600 : 400,
      }}
    >
      {children}
    </button>
  );
}
