import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { Modal } from '../components/Modal';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import {
  COMPLAINT_SLA_NOTE,
  COMPLAINT_TYPE_OPTIONS,
  complaintStatusLabel,
  complaintStatusTone,
  complaintTypeLabel,
} from '../dicts';
import { formatDateTime, formatDuration, minutesSince, minutesUntil } from '../format';
import type {
  Complaint,
  ComplaintPattern,
  ComplaintResolved,
  ComplaintsResponse,
  ComplaintType,
  KanbanData,
  Order,
  PlaybookResponse,
} from '../types';
import { useFetch } from '../useFetch';

function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
}

/** Таймеры SLA должны идти сами, пока диспетчер смотрит на очередь. */
function useTick(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Жалоба считается просроченной, пока не закрыта и дедлайн уже позади. */
function isOverdue(c: Complaint, now: number): boolean {
  if (c.status === 'resolved' || c.status === 'rejected') return false;
  const responseLate = !c.firstResponseAt && minutesUntil(c.slaFirstResponseAt, now) < 0;
  const resolutionLate = !c.resolvedAt && minutesUntil(c.slaResolutionAt, now) < 0;
  return responseLate || resolutionLate;
}

/**
 * Ячейка SLA: пока отметки нет — обратный отсчёт до дедлайна (просрочка красным),
 * после отметки — фактическое время реакции от подачи жалобы.
 */
function SlaCell({
  deadline,
  doneAt,
  createdAt,
  doneLabel,
  now,
}: {
  deadline: string;
  doneAt?: string;
  createdAt: string;
  doneLabel: string;
  now: number;
}) {
  if (doneAt) {
    const spent = minutesSince(createdAt, new Date(doneAt).getTime());
    return (
      <span className="badge badge--success">
        {doneLabel} через {formatDuration(spent)}
      </span>
    );
  }
  const left = minutesUntil(deadline, now);
  if (left < 0) {
    return <span className="countdown--over">просрочено на {formatDuration(-left)}</span>;
  }
  return <span className="countdown">через {formatDuration(left)}</span>;
}

/** Красная карточка паттерна: 3+ подтверждённых жалобы на мастера за 30 дней. */
function PatternsCard({ patterns }: { patterns: ComplaintPattern[] }) {
  return (
    <div className="card card--error">
      <div className="ops-card__title">
        <span>Паттерны: 3+ подтверждённых жалобы за 30 дней</span>
        <span className="badge badge--error">{patterns.length}</span>
      </div>
      {patterns.map((p) => (
        <div key={p.masterId} className="pattern-row">
          <span className="semibold">{p.masterName || p.masterId}</span>
          <span className="badge badge--error">{p.count}</span>
          <span className="muted">{p.types.map(complaintTypeLabel).join(' · ')}</span>
        </div>
      ))}
      <div className="ops-card__meta ops-card__actions">
        повод для разбора (ТЗ 17.10, фаза 2 — авто-разбор)
      </div>
    </div>
  );
}

/** Регистрация жалобы: с заявкой телефон, номер и мастер подтягиваются сами. */
function FileComplaintModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const [orderId, setOrderId] = useState('');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [isOrgManager, setIsOrgManager] = useState(false);
  const [type, setType] = useState<ComplaintType>('quality');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Жалоба может прийти и на архивную заявку — берём все колонки вместе с архивом.
  const orders = useFetch(async () => {
    const data = await api.get<KanbanData>('/dispatch/kanban');
    return [...data.columns.flatMap((c) => c.orders), ...data.archive];
  }, []);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post<Complaint>('/dispatch/quality/complaints', {
        orderId: orderId || undefined,
        complainantPhone: phone.trim() || undefined,
        complainantName: name.trim() || undefined,
        isOrgManager,
        type,
        text: text.trim(),
      });
      toast('Жалоба зарегистрирована');
      onCreated();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // Без заявки телефон заявителя брать неоткуда — он становится обязательным.
  const phoneRequired = orderId === '';
  const canSubmit = text.trim() !== '' && (!phoneRequired || phone.trim() !== '');

  return (
    <Modal title="Зарегистрировать жалобу" onClose={onClose}>
      {error !== null && <ErrorBanner message={error} />}
      {orders.error !== null && <ErrorBanner message={orders.error} />}
      {orders.loading && !orders.data && <Loading />}
      <div className="form-grid">
        <div className="field">
          <label htmlFor="cm-order">Заявка (необязательно)</label>
          <select id="cm-order" value={orderId} onChange={(e) => setOrderId(e.target.value)}>
            <option value="">— без заявки —</option>
            {(orders.data ?? []).map((o: Order) => (
              <option key={o.id} value={o.id}>
                {o.number} · {o.clientName} · {o.address}
              </option>
            ))}
          </select>
          <div className="tab-note">
            С выбранной заявкой телефон, номер и мастер подтянутся автоматически
          </div>
        </div>
        <div className="field">
          <label htmlFor="cm-phone">
            Телефон заявителя{phoneRequired ? '' : ' (перекроет телефон клиента заявки)'}
          </label>
          <input
            id="cm-phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+998 90 123 45 67"
          />
        </div>
        <div className="field">
          <label htmlFor="cm-name">Имя заявителя</label>
          <input
            id="cm-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="как представился"
          />
        </div>
        <div>
          <label className="field--checkbox" htmlFor="cm-org">
            <input
              id="cm-org"
              type="checkbox"
              checked={isOrgManager}
              onChange={(e) => setIsOrgManager(e.target.checked)}
            />
            Жалоба руководителя организации
          </label>
          <div className="tab-note">эскалируется сразу старшему смены</div>
        </div>
        <div className="field">
          <label htmlFor="cm-type">Тип жалобы</label>
          <select
            id="cm-type"
            value={type}
            onChange={(e) => setType(e.target.value as ComplaintType)}
          >
            {COMPLAINT_TYPE_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="cm-text">Текст жалобы</label>
          <textarea
            id="cm-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Что произошло со слов заявителя"
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
          disabled={busy || !canSubmit}
          onClick={() => void submit()}
        >
          Зарегистрировать
        </button>
      </div>
    </Modal>
  );
}

/** Карточка жалобы: первый ответ и резолюция с обязательным методом плейбука. */
function ComplaintModal({
  initial,
  playbook,
  onClose,
  onChanged,
}: {
  initial: Complaint;
  playbook: PlaybookResponse | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const now = useTick(1000);
  const [rec, setRec] = useState<Complaint>(initial);
  const [playbookCode, setPlaybookCode] = useState('');
  const [resolution, setResolution] = useState('');
  const [confirmed, setConfirmed] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const closed = rec.status === 'resolved' || rec.status === 'rejected';

  const respond = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<Complaint>(`/dispatch/quality/complaints/${rec.id}/respond`);
      setRec(res);
      toast('Первый ответ зафиксирован');
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
      const res = await api.post<ComplaintResolved>(
        `/dispatch/quality/complaints/${rec.id}/resolve`,
        { playbookCode, resolution: resolution.trim(), confirmed: confirmed === true },
      );
      setRec(res);
      toast(res.confirmed ? 'Жалоба подтверждена' : 'Жалоба отклонена');
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Жалоба · ${complaintTypeLabel(rec.type)}`} onClose={onClose} wide>
      {error !== null && <ErrorBanner message={error} />}

      <dl className="kv">
        <dt>Заявка</dt>
        <dd className="mono">{rec.orderNumber ?? '—'}</dd>
        <dt>Заявитель</dt>
        <dd>
          {rec.complainantName ? `${rec.complainantName} · ` : ''}
          {rec.complainantPhone}
          {rec.isOrgManager && (
            <>
              {' '}
              <span className="badge badge--error">руководитель организации</span>
            </>
          )}
        </dd>
        <dt>Мастер</dt>
        <dd>{rec.masterName ?? '—'}</dd>
        <dt>Статус</dt>
        <dd>
          <span className={`badge badge--${complaintStatusTone(rec.status)}`}>
            {complaintStatusLabel(rec.status)}
          </span>
        </dd>
        <dt>SLA первого ответа</dt>
        <dd>
          <SlaCell
            deadline={rec.slaFirstResponseAt}
            doneAt={rec.firstResponseAt}
            createdAt={rec.createdAt}
            doneLabel="ответ"
            now={now}
          />
        </dd>
        <dt>SLA резолюции</dt>
        <dd>
          <SlaCell
            deadline={rec.slaResolutionAt}
            doneAt={rec.resolvedAt}
            createdAt={rec.createdAt}
            doneLabel="резолюция"
            now={now}
          />
        </dd>
        <dt>Создана</dt>
        <dd>{formatDateTime(rec.createdAt)}</dd>
      </dl>

      <div className="section-title">Текст жалобы</div>
      <div className="complaint-text">{rec.text}</div>

      {!rec.firstResponseAt && (
        <div className="actions-row ops-card__actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy}
            onClick={() => void respond()}
          >
            Зафиксировать первый ответ
          </button>
        </div>
      )}

      <div className="section-title">Резолюция</div>
      {closed ? (
        <dl className="kv">
          <dt>Метод плейбука</dt>
          <dd>
            {playbook?.playbook.find((p) => p.code === rec.playbookCode)?.title ??
              rec.playbookCode ??
              '—'}
          </dd>
          <dt>Решение</dt>
          <dd>{rec.resolution ?? '—'}</dd>
          <dt>Итог</dt>
          <dd>
            <span className={`badge badge--${complaintStatusTone(rec.status)}`}>
              {complaintStatusLabel(rec.status)}
            </span>
          </dd>
          <dt>Закрыта</dt>
          <dd>{formatDateTime(rec.resolvedAt)}</dd>
        </dl>
      ) : (
        <>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="cd-playbook">Метод плейбука (обязателен)</label>
              <select
                id="cd-playbook"
                value={playbookCode}
                onChange={(e) => setPlaybookCode(e.target.value)}
              >
                <option value="">— выберите метод —</option>
                {(playbook?.playbook ?? []).map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="cd-resolution">Что сделано</label>
              <textarea
                id="cd-resolution"
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                placeholder="Например: работы переделаны за счёт компании, клиент подтвердил"
              />
            </div>
          </div>
          <div className="urgency-options ops-card__actions">
            <label
              className={
                confirmed === true ? 'urgency-option urgency-option--selected' : 'urgency-option'
              }
            >
              <input
                type="radio"
                name="confirmed"
                checked={confirmed === true}
                onChange={() => setConfirmed(true)}
              />
              Подтверждена (вина есть)
            </label>
            <label
              className={
                confirmed === false ? 'urgency-option urgency-option--selected' : 'urgency-option'
              }
            >
              <input
                type="radio"
                name="confirmed"
                checked={confirmed === false}
                onChange={() => setConfirmed(false)}
              />
              Отклонена (вина не подтверждена)
            </label>
          </div>
          <div className="tab-note">
            подтверждённая жалоба на качество или поведение снижает рейтинг мастера — только после
            резолюции (ТЗ 17.10)
          </div>
          <div className="modal__actions">
            <button type="button" className="btn btn--link" onClick={onClose}>
              Отмена
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy || confirmed === null}
              onClick={() => void resolve()}
            >
              Закрыть жалобу
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

export function ComplaintsPage() {
  const now = useTick(30_000);
  const [filing, setFiling] = useState(false);
  const [openRec, setOpenRec] = useState<Complaint | null>(null);

  const { data, loading, error, reload } = useFetch(async () => {
    const [complaints, playbook] = await Promise.all([
      api.get<ComplaintsResponse>('/dispatch/quality/complaints'),
      api.get<PlaybookResponse>('/dispatch/quality/playbook'),
    ]);
    return { complaints, playbook };
  }, []);

  const items = data?.complaints.items ?? [];
  const stats = data?.complaints.stats ?? null;

  return (
    <>
      <div className="page-header">
        <h1>Жалобы</h1>
        <button type="button" className="btn btn--primary" onClick={() => setFiling(true)}>
          Зарегистрировать жалобу
        </button>
      </div>

      <div className="banner banner--warning">{COMPLAINT_SLA_NOTE}</div>

      {error !== null && <ErrorBanner message={error} />}
      {loading && !data && <Loading />}

      {data && stats && (
        <>
          <div className="tiles">
            <div className="card">
              <div className="tile__value">{stats.total}</div>
              <div className="tile__label">Всего жалоб</div>
            </div>
            <div className="card">
              <div className="tile__value">{stats.open}</div>
              <div className="tile__label">Открытых</div>
            </div>
            <div className={stats.overdueFirstResponse > 0 ? 'card tile--alert' : 'card'}>
              <div className="tile__value">{stats.overdueFirstResponse}</div>
              <div className="tile__label">Просрочен первый ответ</div>
              <div className="tile__hint">норматив — 2 часа в окне 8:00–22:00</div>
            </div>
            <div className={stats.overdueResolution > 0 ? 'card tile--alert' : 'card'}>
              <div className="tile__value">{stats.overdueResolution}</div>
              <div className="tile__label">Просрочена резолюция</div>
              <div className="tile__hint">24 часа, сложные — 72 часа</div>
            </div>
            <div className="card">
              <div className="tile__value">{stats.confirmedShare}%</div>
              <div className="tile__label">Доля подтверждённых</div>
              <div className="tile__hint">
                {stats.byType.map((t) => `${complaintTypeLabel(t.type)} ${t.count}`).join(' · ') ||
                  'жалоб пока нет'}
              </div>
            </div>
          </div>

          {stats.patterns.length > 0 && <PatternsCard patterns={stats.patterns} />}

          <div className="section-title">Очередь жалоб</div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Заявка</th>
                  <th>Заявитель</th>
                  <th>Тип</th>
                  <th>Статус</th>
                  <th>Мастер</th>
                  <th>SLA первого ответа</th>
                  <th>SLA резолюции</th>
                  <th>Создана</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && <EmptyRow colSpan={8} />}
                {items.map((c) => (
                  <tr
                    key={c.id}
                    className={
                      isOverdue(c, now) ? 'row--clickable row--warning' : 'row--clickable'
                    }
                    onClick={() => setOpenRec(c)}
                  >
                    <td className="mono">{c.orderNumber ?? '—'}</td>
                    <td>
                      {c.complainantName ? `${c.complainantName} · ` : ''}
                      {c.complainantPhone}
                      {c.isOrgManager && (
                        <>
                          {' '}
                          <span className="badge badge--error">руководитель организации</span>
                        </>
                      )}
                    </td>
                    <td>
                      <span className="badge badge--accent">{complaintTypeLabel(c.type)}</span>
                    </td>
                    <td>
                      <span className={`badge badge--${complaintStatusTone(c.status)}`}>
                        {complaintStatusLabel(c.status)}
                      </span>
                    </td>
                    <td>{c.masterName ?? '—'}</td>
                    <td>
                      <SlaCell
                        deadline={c.slaFirstResponseAt}
                        doneAt={c.firstResponseAt}
                        createdAt={c.createdAt}
                        doneLabel="ответ"
                        now={now}
                      />
                    </td>
                    <td>
                      <SlaCell
                        deadline={c.slaResolutionAt}
                        doneAt={c.resolvedAt}
                        createdAt={c.createdAt}
                        doneLabel="резолюция"
                        now={now}
                      />
                    </td>
                    <td>{formatDateTime(c.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="tab-note">
            Жалоба руководителя организации эскалируется сразу старшему смены. Таймеры SLA
            обновляются каждые 30 секунд.
          </div>
        </>
      )}

      {filing && <FileComplaintModal onClose={() => setFiling(false)} onCreated={reload} />}
      {openRec !== null && (
        <ComplaintModal
          key={openRec.id}
          initial={openRec}
          playbook={data?.playbook ?? null}
          onClose={() => setOpenRec(null)}
          onChanged={reload}
        />
      )}
    </>
  );
}
