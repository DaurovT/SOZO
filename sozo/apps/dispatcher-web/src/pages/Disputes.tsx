import { useState } from 'react';
import { api, ApiError } from '../api';
import { Modal } from '../components/Modal';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import {
  DISPUTABLE_STATUSES,
  DISPUTE_RESOLUTION_OPTIONS,
  disputeResolutionLabel,
  disputeRoleLabel,
  disputeStatusLabel,
  disputeStatusTone,
  statusLabel,
} from '../dicts';
import { formatDateTime, formatSoums } from '../format';
import type { Dispute, DisputeResolution, KanbanData, Order } from '../types';
import { useFetch } from '../useFetch';

/** Окно спора и правила возвратов — диспетчер должен видеть их до действия (ТЗ 4.2). */
const DISPUTE_NOTE =
  'Окно спора — 72 ч после «Выполнена». Спор блокирует начисление доли мастера до резолюции. ' +
  'Возвраты проводятся через refund-API сторнирующей проводкой; наличные возвращает компания, не мастер (ТЗ 4.2).';

function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
}

function errorCode(e: unknown): string | undefined {
  return e instanceof ApiError ? e.code : undefined;
}

/** Открытие спора: спорить можно только по заявке, доведённой до «Выполнена». */
function OpenDisputeModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [orderId, setOrderId] = useState('');
  const [openedByRole, setOpenedByRole] = useState<'client' | 'dispatcher'>('client');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const orders = useFetch(async () => {
    const data = await api.get<KanbanData>('/dispatch/kanban');
    return [...data.columns.flatMap((c) => c.orders), ...data.archive].filter((o: Order) =>
      DISPUTABLE_STATUSES.has(o.status),
    );
  }, []);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post<Dispute>('/dispatch/quality/disputes', {
        orderId,
        reason: reason.trim(),
        openedByRole,
      });
      toast('Спор открыт, доля мастера заблокирована');
      onCreated();
      onClose();
    } catch (e) {
      setError(
        errorCode(e) === 'WINDOW_CLOSED'
          ? 'Окно спора 72 часа после «Выполнена» истекло'
          : errorMessage(e),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Открыть спор" onClose={onClose}>
      {error !== null && <ErrorBanner message={error} />}
      {orders.error !== null && <ErrorBanner message={orders.error} />}
      {orders.loading && !orders.data && <Loading />}
      <div className="form-grid">
        <div className="field">
          <label htmlFor="dp-order">Заявка</label>
          <select id="dp-order" value={orderId} onChange={(e) => setOrderId(e.target.value)}>
            <option value="">— выберите заявку —</option>
            {(orders.data ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.number} · {statusLabel(o.status)} · {formatSoums(o.totalFromTiyin)}
              </option>
            ))}
          </select>
          <div className="tab-note">
            Доступны заявки от «Выполнена» и дальше — спорить раньше не о чем
          </div>
        </div>
        <div className="field">
          <label>Инициатор</label>
          <div className="urgency-options">
            <label
              className={
                openedByRole === 'client'
                  ? 'urgency-option urgency-option--selected'
                  : 'urgency-option'
              }
            >
              <input
                type="radio"
                name="opened-by"
                checked={openedByRole === 'client'}
                onChange={() => setOpenedByRole('client')}
              />
              Клиент
            </label>
            <label
              className={
                openedByRole === 'dispatcher'
                  ? 'urgency-option urgency-option--selected'
                  : 'urgency-option'
              }
            >
              <input
                type="radio"
                name="opened-by"
                checked={openedByRole === 'dispatcher'}
                onChange={() => setOpenedByRole('dispatcher')}
              />
              Диспетчер
            </label>
          </div>
        </div>
        <div className="field">
          <label htmlFor="dp-reason">Причина спора</label>
          <textarea
            id="dp-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Например: клиент не согласен с суммой за доп-работы"
          />
        </div>
      </div>
      <div className="modal__actions">
        <button type="button" className="btn btn--link" onClick={onClose}>
          Отмена
        </button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy || orderId === '' || reason.trim() === ''}
          onClick={() => void submit()}
        >
          Открыть спор
        </button>
      </div>
    </Modal>
  );
}

/** Карточка спора: эскалация старшему и резолюция с возвратом через refund-API. */
function DisputeModal({
  initial,
  onClose,
  onChanged,
}: {
  initial: Dispute;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [rec, setRec] = useState<Dispute>(initial);
  const [resolution, setResolution] = useState<DisputeResolution>('for_client');
  const [refund, setRefund] = useState('');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [selfJudge, setSelfJudge] = useState(false);
  const [busy, setBusy] = useState(false);

  const resolved = rec.status === 'resolved';
  const needsRefund =
    DISPUTE_RESOLUTION_OPTIONS.find((r) => r.value === resolution)?.needsRefund ?? false;

  const escalate = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<Dispute>(`/dispatch/quality/disputes/${rec.id}/escalate`, {});
      setRec(res);
      setSelfJudge(false);
      toast('Спор эскалирован старшему смены');
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const resolve = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<Dispute>(`/dispatch/quality/disputes/${rec.id}/resolve`, {
        resolution,
        refundSoums: needsRefund ? Number(refund) : undefined,
        comment: comment.trim(),
      });
      setRec(res);
      setSelfJudge(false);
      toast('Резолюция вынесена');
      onChanged();
    } catch (e) {
      setSelfJudge(errorCode(e) === 'SELF_JUDGE_FORBIDDEN');
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Спор · ${rec.orderNumber}`} onClose={onClose} wide>
      {error !== null && <ErrorBanner message={error} />}

      <dl className="kv">
        <dt>Заявка</dt>
        <dd className="mono">{rec.orderNumber}</dd>
        <dt>Инициатор</dt>
        <dd>
          {disputeRoleLabel(rec.openedByRole)} · {rec.openedByPhone}
        </dd>
        <dt>Причина</dt>
        <dd>{rec.reason}</dd>
        <dt>Сумма заявки</dt>
        <dd>{formatSoums(rec.amountTiyin)}</dd>
        <dt>Статус</dt>
        <dd>
          <span className={`badge badge--${disputeStatusTone(rec.status)}`}>
            {disputeStatusLabel(rec.status)}
          </span>
          {rec.masterShareBlocked && (
            <>
              {' '}
              <span className="badge badge--warning">доля мастера заблокирована</span>
            </>
          )}
        </dd>
        <dt>Открыт</dt>
        <dd>{formatDateTime(rec.createdAt)}</dd>
      </dl>

      {rec.escalationReason && <div className="tab-note">{rec.escalationReason}</div>}

      {!resolved && (
        <>
          <div className="section-title">Эскалация</div>
          <div className="actions-row">
            <button
              type="button"
              className={selfJudge ? 'btn btn--primary' : 'btn'}
              disabled={busy}
              onClick={() => void escalate()}
            >
              Эскалировать старшему
            </button>
          </div>
          <div className="tab-note">диспетчер не судит собственные заявки (ТЗ 4.2)</div>
        </>
      )}

      <div className="section-title">Резолюция</div>
      {resolved ? (
        <dl className="kv">
          <dt>Решение</dt>
          <dd>{disputeResolutionLabel(rec.resolution ?? '')}</dd>
          <dt>Возврат клиенту</dt>
          <dd>{rec.refundTiyin ? formatSoums(rec.refundTiyin) : '—'}</dd>
          <dt>Комментарий</dt>
          <dd>{rec.comment ?? '—'}</dd>
          <dt>Решил</dt>
          <dd>{rec.handledByPhone ?? '—'}</dd>
          <dt>Закрыт</dt>
          <dd>{formatDateTime(rec.resolvedAt)}</dd>
        </dl>
      ) : (
        <>
          <div className="urgency-options">
            {DISPUTE_RESOLUTION_OPTIONS.map((r) => (
              <label
                key={r.value}
                className={
                  resolution === r.value
                    ? 'urgency-option urgency-option--selected'
                    : 'urgency-option'
                }
              >
                <input
                  type="radio"
                  name="dispute-resolution"
                  checked={resolution === r.value}
                  onChange={() => setResolution(r.value)}
                />
                {r.label}
              </label>
            ))}
          </div>
          <div className="form-grid ops-card__actions">
            {needsRefund && (
              <div className="field">
                <label htmlFor="dp-refund">Возврат, сум</label>
                <input
                  id="dp-refund"
                  inputMode="numeric"
                  value={refund}
                  onChange={(e) => setRefund(e.target.value.replace(/\D/g, ''))}
                  placeholder="0"
                />
                <div className="tab-note">
                  не больше суммы заявки — {formatSoums(rec.amountTiyin)}
                </div>
              </div>
            )}
            <div className="field">
              <label htmlFor="dp-comment">Комментарий</label>
              <textarea
                id="dp-comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Почему решено так — уходит в аудит"
              />
              <div className="tab-note">уходит в аудит</div>
            </div>
          </div>
          <div className="modal__actions">
            <button type="button" className="btn btn--link" onClick={onClose}>
              Отмена
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy || comment.trim() === '' || (needsRefund && refund === '')}
              onClick={() => void resolve()}
            >
              Вынести резолюцию
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

export function DisputesPage() {
  const [opening, setOpening] = useState(false);
  const [openRec, setOpenRec] = useState<Dispute | null>(null);

  const { data, loading, error, reload } = useFetch(
    () => api.get<Dispute[]>('/dispatch/quality/disputes'),
    [],
  );

  const items = data ?? [];
  const open = items.filter((d) => d.status === 'open').length;
  const escalated = items.filter((d) => d.status === 'escalated').length;
  const refunded = items.reduce((sum, d) => sum + (d.refundTiyin ?? 0), 0);

  return (
    <>
      <div className="page-header">
        <h1>Споры</h1>
        <button type="button" className="btn btn--primary" onClick={() => setOpening(true)}>
          Открыть спор
        </button>
      </div>

      <div className="banner banner--warning">{DISPUTE_NOTE}</div>

      {error !== null && <ErrorBanner message={error} />}
      {loading && !data && <Loading />}

      {data && (
        <>
          <div className="tiles">
            <div className="card">
              <div className="tile__value">{items.length}</div>
              <div className="tile__label">Всего споров</div>
            </div>
            <div className="card">
              <div className="tile__value">{open}</div>
              <div className="tile__label">Открытых</div>
            </div>
            <div className={escalated > 0 ? 'card tile--alert' : 'card'}>
              <div className="tile__value">{escalated}</div>
              <div className="tile__label">Эскалировано</div>
              <div className="tile__hint">решает старший смены</div>
            </div>
            <div className="card">
              <div className="tile__value">{formatSoums(refunded)}</div>
              <div className="tile__label">Возвращено клиентам</div>
              <div className="tile__hint">сторнирующими проводками через refund-API</div>
            </div>
          </div>

          <div className="section-title">Споры</div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Заявка</th>
                  <th>Инициатор</th>
                  <th>Причина</th>
                  <th className="num">Сумма заявки</th>
                  <th>Статус</th>
                  <th className="num">Возврат</th>
                  <th>Создан</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && <EmptyRow colSpan={7} />}
                {items.map((d) => (
                  <tr key={d.id} className="row--clickable" onClick={() => setOpenRec(d)}>
                    <td className="mono">{d.orderNumber}</td>
                    <td>
                      {disputeRoleLabel(d.openedByRole)} · {d.openedByPhone}
                    </td>
                    <td>{d.reason}</td>
                    <td className="num">{formatSoums(d.amountTiyin)}</td>
                    <td>
                      <span className={`badge badge--${disputeStatusTone(d.status)}`}>
                        {disputeStatusLabel(d.status)}
                      </span>
                      {d.masterShareBlocked && (
                        <>
                          {' '}
                          <span className="badge badge--warning">доля мастера заблокирована</span>
                        </>
                      )}
                    </td>
                    <td className="num">{d.refundTiyin ? formatSoums(d.refundTiyin) : '—'}</td>
                    <td>{formatDateTime(d.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="tab-note">
            Резолюция снимает блокировку доли мастера. Комментарий резолюции обязателен — он уходит
            в аудит.
          </div>
        </>
      )}

      {opening && <OpenDisputeModal onClose={() => setOpening(false)} onCreated={reload} />}
      {openRec !== null && (
        <DisputeModal
          key={openRec.id}
          initial={openRec}
          onClose={() => setOpenRec(null)}
          onChanged={reload}
        />
      )}
    </>
  );
}
