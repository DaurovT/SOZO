import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApiError, request } from '../api';
import { getOrgId } from '../auth';
import { useFetch } from '../useFetch';
import { ConnectionBadge } from '../components/Badges';
import { Empty, ErrorState, Loading } from '../components/States';
import type { ConnectionStatus, Dashboard } from '../types';

/**
 * U-13. Единственное место, где объект становится `active`.
 * Чек-лист готовности показывается как список того, чего не хватает,
 * а не как ошибка после нажатия: человек должен видеть путь, а не отказ.
 */

interface BuildingFull {
  id: string;
  name: string;
  address: string;
  connectionStatus: ConnectionStatus;
  workFrom: string;
  workTo: string;
  noiseFrom: string;
  noiseTo: string;
  internalBufferMin: number;
  emergencyPhone: string | null;
  dispatchPhone: string | null;
  serviceFeeBps: number;
  readinessGaps: string[];
}

interface Staff {
  id: string;
  userPhone: string;
  fullName: string;
  staffRole: string;
  isBackup: boolean;
}

export function Settings() {
  const org = getOrgId();
  const [params, setParams] = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const dash = useFetch<Dashboard>(org ? `/operator/${org}/dashboard` : null);
  const objects = dash.data?.objects ?? [];
  const selected = params.get('building') ?? objects[0]?.buildingId ?? null;

  const building = useFetch<BuildingFull>(selected ? `/buildings/${selected}` : null, [selected]);
  const staff = useFetch<Staff[]>(selected ? `/buildings/${selected}/staff` : null, [selected]);

  if (dash.loading) return <Loading />;
  if (dash.error) return <ErrorState error={dash.error} onRetry={dash.reload} />;
  if (objects.length === 0) return <Empty text="Объекты пока не подключены" />;

  async function activate() {
    if (!selected) return;
    setBusy(true);
    try {
      await request(`/buildings/${selected}/activate`, { body: {} });
      setToast('Объект активирован');
      building.reload();
      dash.reload();
    } catch (e) {
      setToast(e instanceof ApiError ? e.message : 'Не удалось активировать');
    } finally {
      setBusy(false);
    }
  }

  const b = building.data;
  const gaps = b?.readinessGaps ?? [];
  const approvers = (staff.data ?? []).filter((s) => s.staffRole === 'approver');

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--s16)' }}>
        <div>
          <h1 className="h1">Настройки объекта</h1>
          <div className="cap" style={{ marginTop: 'var(--s4)' }}>{b?.address ?? ''}</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--s8)', alignItems: 'center' }}>
          {b && <ConnectionBadge status={b.connectionStatus} />}
          <select
            className="input"
            style={{ width: 240 }}
            value={selected ?? ''}
            onChange={(e) => setParams({ building: e.target.value })}
          >
            {objects.map((o) => <option key={o.buildingId} value={o.buildingId}>{o.name}</option>)}
          </select>
        </div>
      </div>

      {building.loading || !b ? (
        <Loading />
      ) : (
        <>
          {/* Чек-лист готовности: что мешает активации и почему это важно */}
          <div
            className="card"
            style={{
              padding: 'var(--s16)',
              border: gaps.length ? '1px solid rgba(240,140,30,.35)' : '1px solid var(--border)',
              background: gaps.length ? 'rgba(240,140,30,.05)' : 'var(--surface)',
            }}
          >
            <h2 className="h2" style={{ fontSize: 17, marginBottom: 'var(--s12)' }}>
              {gaps.length ? 'Что нужно для активации' : 'Объект готов'}
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s8)' }}>
              <Item ok={approvers.length > 0} text={
                approvers.length > 0 ? `Согласующий доступ — ${approvers[0].fullName}` : 'Не назначен согласующий доступ'
              } />
              <Item ok={approvers.some((a) => a.isBackup)} text={
                approvers.some((a) => a.isBackup) ? 'Назначен резервный согласующий' : 'Не назначен резервный согласующий'
              } />
              <Item ok={Boolean(b.emergencyPhone)} text={
                b.emergencyPhone ? `Аварийный телефон — ${b.emergencyPhone}` : 'Не указан круглосуточный аварийный телефон'
              } />
              <Item ok={!gaps.some((g) => g.includes('реестр'))} text={
                gaps.some((g) => g.includes('реестр')) ? 'Не заполнен реестр помещений' : 'Реестр помещений заполнен'
              } />
            </div>

            {b.connectionStatus !== 'active' && (
              <button
                className="btn btn--lg"
                style={{ marginTop: 'var(--s16)' }}
                disabled={gaps.length > 0 || busy}
                onClick={activate}
              >
                Активировать объект
              </button>
            )}
          </div>

          <div className="card" style={{ padding: 'var(--s16)' }}>
            <h2 className="h2" style={{ fontSize: 17, marginBottom: 'var(--s16)' }}>Правила доступа</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 'var(--s16)' }}>
              <Field label="Часы работ" value={`${b.workFrom} — ${b.workTo}`} />
              <Field label="Шумные работы" value={`${b.noiseFrom} — ${b.noiseTo}`} />
              <Field
                label="Проход от входа до помещения"
                value={`${b.internalBufferMin} мин`}
                note="Учитывается при планировании выездов"
              />
            </div>
          </div>

          <div className="card" style={{ padding: 'var(--s16)' }}>
            <h2 className="h2" style={{ fontSize: 17, marginBottom: 'var(--s16)' }}>Согласующие доступ</h2>
            {approvers.length === 0 ? (
              <div className="cap">Никто не назначен — объект не сможет быть активирован</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s8)' }}>
                {approvers.map((a) => (
                  <div key={a.id} style={{ display: 'flex', gap: 'var(--s12)', alignItems: 'center' }}>
                    <div className="dense" style={{ fontWeight: 600 }}>{a.fullName}</div>
                    <div className="cap">{a.userPhone}</div>
                    <span className={`chip ${a.isBackup ? 'chip--neutral' : 'chip--success'}`} style={{ marginLeft: 'auto' }}>
                      {a.isBackup ? 'резервный' : 'основной'}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {/* Кабинет им не нужен: согласование делается из SMS в один тап */}
            <div className="card" style={{ padding: 'var(--s12)', background: 'var(--bg)', border: 'none', marginTop: 'var(--s16)' }}>
              <div className="cap">
                Согласующему не нужен кабинет: ссылка приходит в SMS, решение — в один тап.
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: 'var(--s16)' }}>
            <h2 className="h2" style={{ fontSize: 17, marginBottom: 'var(--s16)' }}>Сервисный сбор</h2>
            <Field label="Ставка по договору" value={`${(b.serviceFeeBps / 100).toFixed(0)}%`} note="Потолок — 10%" />
            <div className="card" style={{ padding: 'var(--s12)', background: 'var(--bg)', border: 'none', marginTop: 'var(--s16)' }}>
              <div className="cap">
                Начисляется с частных заявок жителей, выполненных мастерами платформы.
                Работы по общему имуществу и заявки вашей службы сбора не приносят.
              </div>
            </div>
          </div>
        </>
      )}

      {toast && <div className="toast" onClick={() => setToast(null)}>{toast}</div>}
    </>
  );
}

function Item({ ok, text }: { ok: boolean; text: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s8)' }}>
      {ok ? (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5">
          <path d="M20 6L9 17l-5-5" />
        </svg>
      ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--error)" strokeWidth="2">
          <circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" />
        </svg>
      )}
      <div className="dense" style={{ color: ok ? undefined : 'var(--error)' }}>{text}</div>
    </div>
  );
}

function Field({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <div className="cap" style={{ marginBottom: 'var(--s4)' }}>{label}</div>
      <div className="input" style={{ display: 'flex', alignItems: 'center' }}>{value}</div>
      {note && <div className="cap" style={{ marginTop: 'var(--s4)' }}>{note}</div>}
    </div>
  );
}
