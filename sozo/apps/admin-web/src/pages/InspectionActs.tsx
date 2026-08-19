import { useState } from 'react';
import { api } from '../api';
import { useFetch } from '../useFetch';
import { formatDateTime, formatSoums } from '../format';
import { downloadCsv } from '../csv';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import type { InspectionAct, InspectionActsPending } from '../types';

/**
 * Акты осмотра (ТЗ 9.3).
 *
 * По акту ответственный на точке принимает или отклоняет дефекты, и из
 * принятых сами собой рождаются заявки. До этого экрана вся эта механика
 * была видна только клиенту в его приложении: спор по акту в админке
 * разбирать было не с чем, а зависшие акты не видел никто.
 *
 * Решение здесь принять нельзя и не должно быть можно — акт подписывает
 * заказчик. Админка только наблюдает и звонит, когда точка молчит.
 */

const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: 'Черновик', cls: 'badge badge--muted' },
  sent: { label: 'Ждёт решения', cls: 'badge badge--warning' },
  approved: { label: 'Принят', cls: 'badge badge--success' },
  partially_approved: { label: 'Принят частично', cls: 'badge badge--accent' },
  rejected: { label: 'Отклонён', cls: 'badge badge--error' },
  expired: { label: 'Просрочен', cls: 'badge badge--error' },
};

const SEVERITY: Record<string, string> = { high: 'Критичный', medium: 'Средний', low: 'Низкий' };
const DECISION: Record<string, string> = {
  pending: 'ждёт решения',
  accepted: 'принят',
  declined: 'отклонён',
};

export function InspectionActsPage() {
  const toast = useToast();
  const [status, setStatus] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pending = useFetch<InspectionActsPending>(
    () => api.get<InspectionActsPending>('/admin/acts/pending'),
    [],
  );
  const { data, loading, error, reload } = useFetch<InspectionAct[]>(
    () => api.get<InspectionAct[]>(`/admin/acts${status ? `?status=${status}` : ''}`),
    [status],
  );

  const acts = data ?? [];
  const open = acts.find((a) => a.id === openId) ?? null;

  const runExpire = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ expired: number; numbers: string[] }>('/admin/acts/expire-overdue', {});
      toast(res.expired > 0 ? `Просрочено актов: ${res.expired}` : 'Просроченных актов нет');
      reload();
      pending.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const sum = (a: InspectionAct) => a.items.reduce((s, i) => s + (i.estimateTiyin ?? 0), 0);

  return (
    <>
      <div className="page-header">
        <h1>Акты осмотра</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s16)' }}>
          <button type="button" className="btn" disabled={busy} onClick={() => void runExpire()}>
            Прогнать просрочку
          </button>
          <button
            type="button"
            className="btn"
            disabled={acts.length === 0}
            onClick={() =>
              downloadCsv(
                'inspection-acts.csv',
                ['Акт', 'Точка', 'Мастер', 'Статус', 'Дефектов', 'Сумма', 'Отправлен'],
                acts.map((a) => [
                  a.number,
                  a.locationName,
                  a.masterName,
                  STATUS[a.status]?.label ?? a.status,
                  String(a.items.length),
                  String(Math.round(sum(a) / 100)),
                  a.sentAt ?? '',
                ]),
              )
            }
          >
            Скачать CSV
          </button>
        </div>
      </div>

      <div className="banner">
        Решение по акту принимает ответственный на точке — из админки его подменить нельзя.
        Здесь видно, что ушло на подпись и где точка молчит
      </div>

      {pending.data && (pending.data.waiting > 0 || pending.data.overdue > 0) && (
        <div className="tiles">
          <div className={pending.data.overdue > 0 ? 'card card--warning' : 'card'}>
            <div className="tile__value">{pending.data.overdue}</div>
            <div className="tile__label">просрочено</div>
            <div className="tile__hint">точка молчит дольше срока — повод позвонить</div>
          </div>
          <div className="card">
            <div className="tile__value">{pending.data.waiting}</div>
            <div className="tile__label">ждут решения</div>
          </div>
        </div>
      )}

      <div className="form-grid">
        <div className="field">
          <label htmlFor="act-status">Статус</label>
          <select id="act-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">— все —</option>
            {Object.entries(STATUS).map(([code, s]) => (
              <option key={code} value={code}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error !== null && <ErrorBanner message={error} />}
      {loading && !data && <Loading />}

      {data && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Акт</th>
                <th>Точка</th>
                <th>Мастер</th>
                <th className="num">Дефектов</th>
                <th className="num">Сумма</th>
                <th>Статус</th>
                <th>Отправлен</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {acts.length === 0 && <EmptyRow colSpan={8} />}
              {acts.map((a) => (
                <tr key={a.id} className={a.status === 'expired' ? 'row--warning' : undefined}>
                  <td className="mono">{a.number}</td>
                  <td>{a.locationName}</td>
                  <td>{a.masterName}</td>
                  <td className="num">{a.items.length}</td>
                  <td className="num">{formatSoums(sum(a))}</td>
                  <td>
                    <span className={STATUS[a.status]?.cls ?? 'badge'}>{STATUS[a.status]?.label ?? a.status}</span>
                  </td>
                  <td className="muted">{a.sentAt === undefined ? '—' : formatDateTime(a.sentAt)}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn--secondary"
                      onClick={() => setOpenId(openId === a.id ? null : a.id)}
                    >
                      {openId === a.id ? 'Свернуть' : 'Дефекты'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <>
          <div className="section-title">
            Дефекты акта {open.number} · {open.locationName}
          </div>
          {open.representative && (
            <div className="muted">
              Отправлен: {open.representative.fullName} ({open.representative.phone})
              {open.representativeAbsent && ' · представителя не было на месте'}
            </div>
          )}
          {open.decidedBy && (
            <div className="muted">
              Решение принял: {open.decidedBy.fullName}
              {open.decidedAt !== undefined && ` · ${formatDateTime(open.decidedAt)}`}
            </div>
          )}
          {open.rejectionReason !== undefined && (
            <div className="muted">Причина отклонения: {open.rejectionReason}</div>
          )}

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Категория</th>
                  <th>Что нашли</th>
                  <th>Важность</th>
                  <th className="num">Оценка</th>
                  <th>Решение</th>
                  <th>Заявка</th>
                </tr>
              </thead>
              <tbody>
                {open.items.length === 0 && <EmptyRow colSpan={6} />}
                {open.items.map((i) => (
                  <tr key={i.id}>
                    <td>{i.category}</td>
                    <td>{i.description}</td>
                    <td>{SEVERITY[i.severity] ?? i.severity}</td>
                    <td className="num">
                      {/* Пустая оценка — не ноль: цену считает офис после замера */}
                      {i.estimateTiyin === null ? <span className="muted">считает офис</span> : formatSoums(i.estimateTiyin)}
                    </td>
                    <td>
                      {DECISION[i.decision] ?? i.decision}
                      {i.declineReason !== undefined && <div className="muted">{i.declineReason}</div>}
                    </td>
                    <td className="mono">
                      {i.orderId === undefined ? '—' : <a href={`/orders?id=${i.orderId}`}>заявка создана</a>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {open.checklist.length > 0 && (
            <>
              <div className="section-title">Что смотрели</div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Зона</th>
                      <th>Результат</th>
                      <th>Примечание</th>
                    </tr>
                  </thead>
                  <tbody>
                    {open.checklist.map((z) => (
                      <tr key={z.zone}>
                        <td>{z.zone}</td>
                        <td>{z.ok ? 'в порядке' : 'есть замечания'}</td>
                        <td className="muted">{z.note ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
