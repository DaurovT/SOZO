import { ReactNode, useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { Modal } from '../components/Modal';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import {
  REPLACEMENT_TARGET_MIN,
  SANCTION_OPTIONS,
  replacementReasonLabel,
  replacementStageLabel,
  replacementStageTone,
} from '../dicts';
import { formatDateTime, formatDuration, formatSeconds, minutesSince } from '../format';
import type {
  Replacement,
  ReplacementCandidates,
  ReplacementClosed,
  ReplacementDetect,
  ReplacementRisk,
  Sanction,
} from '../types';
import { useFetch } from '../useFetch';

function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
}

/** Живые счётчики протокола: время с детекта и окно бродкаста должны идти сами. */
function useTick(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Карточка риска срыва: заявка, мастер, причина и сколько минут нет движения. */
function RiskCard({
  risk,
  busy,
  onOpen,
}: {
  risk: ReplacementRisk;
  busy: boolean;
  onOpen: () => void;
}) {
  return (
    <div className="card card--warning">
      <div className="ops-card__title">
        <span className="mono">{risk.orderNumber}</span>
        <span className="badge badge--warning">{replacementReasonLabel(risk.reason)}</span>
      </div>
      <div className="ops-card__meta">{risk.masterName ?? 'мастер не назначен'}</div>
      <div className="ops-card__meta">{risk.minutes} мин без движения</div>
      <div className="actions-row ops-card__actions">
        <button type="button" className="btn btn--primary" disabled={busy} onClick={onOpen}>
          Открыть протокол замены
        </button>
      </div>
    </div>
  );
}

interface StepProps {
  num: number;
  title: string;
  done: boolean;
  current: boolean;
  children?: ReactNode;
}

function ProtocolStep({ num, title, done, current, children }: StepProps) {
  const classes = ['protocol__step'];
  if (done) classes.push('protocol__step--done');
  else if (current) classes.push('protocol__step--current');
  return (
    <li className={classes.join(' ')}>
      <span className="protocol__marker">{done ? '✓' : num}</span>
      <div className="protocol__body">
        <div className="protocol__title">{title}</div>
        {children}
      </div>
    </li>
  );
}

/** Модал протокола замены: шаги, кандидаты, эскалация, закрытие с квалификацией. */
function ProtocolModal({
  initial,
  onClose,
  onChanged,
}: {
  initial: Replacement;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const now = useTick(1000);
  const [rec, setRec] = useState<Replacement>(initial);
  const [closed, setClosed] = useState<ReplacementClosed | null>(null);
  const [sanction, setSanction] = useState<Sanction>('none');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cands = useFetch(
    () => api.get<ReplacementCandidates>(`/dispatch/ops/replacements/${rec.id}/candidates`),
    [rec.id],
  );

  const run = async <T extends Replacement>(fn: () => Promise<T>, message: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      setRec(res);
      toast(message);
      onChanged();
      return res;
    } catch (e) {
      setError(errorMessage(e));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const broadcast = () =>
    run(
      () => api.post<Replacement>(`/dispatch/ops/replacements/${rec.id}/broadcast`),
      'Бродкаст-оффер запущен',
    );

  const assign = (masterId: string) =>
    run(
      () =>
        api.post<Replacement>(`/dispatch/ops/replacements/${rec.id}/assign`, {
          masterId,
          reason: 'Протокол замены D-12',
        }),
      'Замена назначена, клиент уведомлён',
    ).then((res) => {
      if (res) cands.reload();
    });

  const escalate = () =>
    run(
      () => api.post<Replacement>(`/dispatch/ops/replacements/${rec.id}/escalate`, {}),
      'Эскалация: задача звонка клиенту создана',
    );

  const close = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<ReplacementClosed>(
        `/dispatch/ops/replacements/${rec.id}/close`,
        { sanction, note: note.trim() || undefined },
      );
      setRec(res);
      setClosed(res);
      toast('Протокол закрыт');
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const broadcastDone = rec.broadcastStartedAt !== undefined;
  const assignDone = rec.stage === 'assigned' || rec.toMasterId !== undefined;
  const closeDone = rec.stage === 'closed';
  // Первый невыполненный шаг подсвечивается как текущий.
  const currentStep = !broadcastDone ? 2 : !assignDone ? 3 : !closeDone ? 4 : 0;

  const secondsLeft = rec.broadcastStartedAt
    ? Math.ceil(
        (new Date(rec.broadcastStartedAt).getTime() + rec.broadcastSeconds * 1000 - now) / 1000,
      )
    : 0;
  const elapsedMin = minutesSince(rec.detectedAt, now);

  return (
    <Modal title={`Протокол замены · ${rec.orderNumber}`} onClose={onClose} wide>
      {error !== null && <ErrorBanner message={error} />}

      <dl className="kv">
        <dt>Этап</dt>
        <dd>
          <span className={`badge badge--${replacementStageTone(rec.stage)}`}>
            {replacementStageLabel(rec.stage)}
          </span>
        </dd>
        <dt>Причина</dt>
        <dd>{replacementReasonLabel(rec.reason)}</dd>
        <dt>Мастер, которого меняем</dt>
        <dd>{rec.fromMasterName ?? '—'}</dd>
        <dt>С момента детекта</dt>
        <dd className={elapsedMin >= REPLACEMENT_TARGET_MIN ? 'countdown--over' : undefined}>
          {formatDuration(elapsedMin)} · цель — новый мастер за {REPLACEMENT_TARGET_MIN} минут
        </dd>
        <dt>Клиент</dt>
        <dd>
          {rec.clientNotified ? (
            <span className="badge badge--success">клиент уведомлён</span>
          ) : (
            <span className="badge badge--warning">клиент не уведомлён</span>
          )}
        </dd>
      </dl>

      <div className="section-title">Шаги протокола (ТЗ 17.3)</div>
      <ol className="protocol">
        <ProtocolStep num={1} title="Детект срыва" done current={false}>
          <div className="protocol__note">
            обнаружено {formatDateTime(rec.detectedAt)} · {replacementReasonLabel(rec.reason)}
          </div>
        </ProtocolStep>

        <ProtocolStep
          num={2}
          title={`Бродкаст-оффер ${rec.broadcastSeconds} сек`}
          done={broadcastDone}
          current={currentStep === 2}
        >
          <div className="protocol__note">
            Оффер уходит всем подходящим сразу — первый принявший забирает заявку.
          </div>
          {!broadcastDone && (
            <div className="actions-row ops-card__actions">
              <button
                type="button"
                className="btn btn--primary"
                disabled={busy || closeDone}
                onClick={() => void broadcast()}
              >
                Запустить бродкаст
              </button>
            </div>
          )}
          {broadcastDone &&
            (secondsLeft > 0 ? (
              <div className="protocol__note">
                до конца окна <span className="countdown">{formatSeconds(secondsLeft)}</span>
              </div>
            ) : (
              <div className="protocol__note countdown--over">время вышло — эскалируйте</div>
            ))}
        </ProtocolStep>

        <ProtocolStep
          num={3}
          title="Назначение замены"
          done={assignDone}
          current={currentStep === 3}
        >
          <div className="protocol__note">
            {assignDone
              ? `заявку принял ${rec.toMasterName ?? '—'}`
              : 'выберите мастера из списка кандидатов ниже'}
          </div>
        </ProtocolStep>

        <ProtocolStep
          num={4}
          title="Закрытие с квалификацией"
          done={closeDone}
          current={currentStep === 4}
        >
          <div className="protocol__note">
            {closeDone
              ? `санкция: ${SANCTION_OPTIONS.find((s) => s.value === rec.sanction)?.label ?? '—'}`
              : 'невыход мастера фиксируется санкцией — она влияет на счётчик 90 дней'}
          </div>
        </ProtocolStep>
      </ol>

      <div className="section-title">Кандидаты на замену</div>
      {cands.error !== null && <ErrorBanner message={cands.error} />}
      {cands.loading && !cands.data && <Loading />}
      {cands.data && (
        <>
          {cands.data.candidates.length === 0 && (
            <div className="muted">
              Подходящих мастеров нет — запустите бродкаст или эскалируйте на звонок клиенту
            </div>
          )}
          {cands.data.candidates.map((c, i) => (
            <div key={c.masterId} className="cand-row">
              <div className="cand-row__body">
                <div>
                  <span className="semibold">
                    {i === 0 ? '★ ' : ''}
                    {c.masterName}
                  </span>{' '}
                  <span className="badge badge--accent">{c.score} баллов</span>
                </div>
                <div className="muted">загрузка ленты {c.loadPercent}%</div>
                {!c.hasShift && (
                  <div className="cand-warning">нет смены на сегодня — создайте в «Лентах»</div>
                )}
                <div className="muted">{c.reasons.join(' · ')}</div>
              </div>
              <button
                type="button"
                className="btn btn--primary"
                disabled={busy || closeDone}
                onClick={() => void assign(c.masterId)}
              >
                Назначить
              </button>
            </div>
          ))}
          {cands.data.rejected.length > 0 && (
            <details className="ops-details">
              <summary className="muted">Отсеяны: {cands.data.rejected.length}</summary>
              {cands.data.rejected.map((c) => (
                <div key={c.masterId} className="muted ops-details__row">
                  {c.masterName} · загрузка {c.loadPercent}%: {c.blockers.join('; ')}
                </div>
              ))}
            </details>
          )}
        </>
      )}

      <div className="section-title">Эскалация</div>
      <div className="muted">
        {REPLACEMENT_TARGET_MIN} минут без замены — согласовать сдвиг или перенос
      </div>
      <div className="actions-row ops-card__actions">
        <button type="button" className="btn" disabled={busy || closeDone} onClick={() => void escalate()}>
          Эскалация: звонок клиенту
        </button>
      </div>
      {rec.note && <div className="protocol__note">{rec.note}</div>}

      <div className="section-title">Закрытие протокола</div>
      {closed !== null ? (
        <div className="banner banner--warning">
          Невыходов за 90 дней: {closed.noShowCount} → {closed.autoSanction}. Второй невыход — снятие
          с линии и разбор, третий — блокировка (ТЗ 17.3).
        </div>
      ) : (
        <>
          <div className="urgency-options">
            {SANCTION_OPTIONS.map((s) => (
              <label
                key={s.value}
                className={
                  sanction === s.value
                    ? 'urgency-option urgency-option--selected'
                    : 'urgency-option'
                }
              >
                <input
                  type="radio"
                  name="sanction"
                  value={s.value}
                  checked={sanction === s.value}
                  onChange={() => setSanction(s.value)}
                />
                {s.label}
              </label>
            ))}
          </div>
          <div className="field ops-card__actions">
            <label htmlFor="rp-note">Примечание</label>
            <textarea
              id="rp-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Например: мастер не вышел на связь, заявку принял дежурный"
            />
          </div>
          <div className="modal__actions">
            <button type="button" className="btn btn--link" onClick={onClose}>
              Отмена
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy || closeDone}
              onClick={() => void close()}
            >
              Закрыть протокол
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

export function ReplacementsPage() {
  const toast = useToast();
  const now = useTick(10_000);
  const [openRec, setOpenRec] = useState<Replacement | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data, loading, error, reload } = useFetch(async () => {
    const [detect, list] = await Promise.all([
      api.get<ReplacementDetect>('/dispatch/ops/replacements/detect'),
      api.get<Replacement[]>('/dispatch/ops/replacements'),
    ]);
    return { detect, list };
  }, []);

  const openProtocol = async (risk: ReplacementRisk) => {
    setBusy(true);
    setActionError(null);
    try {
      const rec = await api.post<Replacement>('/dispatch/ops/replacements', {
        orderId: risk.orderId,
        reason: risk.reason,
      });
      toast('Протокол замены открыт');
      reload();
      setOpenRec(rec);
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const risks = data?.detect.candidates ?? [];
  const protocols = data?.list ?? [];

  return (
    <>
      <div className="page-header">
        <h1>Замены</h1>
        <span className="muted">
          Цель протокола — новый мастер за {REPLACEMENT_TARGET_MIN} минут (ТЗ 17.3)
        </span>
      </div>

      {actionError !== null && <ErrorBanner message={actionError} />}
      {error !== null && <ErrorBanner message={error} />}
      {loading && !data && <Loading />}

      {data && (
        <>
          <div className="section-title" style={{ marginTop: 0 }}>
            Требуют внимания
          </div>
          {risks.length === 0 ? (
            <div className="banner banner--success">Рисков срыва нет</div>
          ) : (
            <div className="ops-grid">
              {risks.map((r) => (
                <RiskCard
                  key={r.orderId}
                  risk={r}
                  busy={busy}
                  onOpen={() => void openProtocol(r)}
                />
              ))}
            </div>
          )}

          <div className="section-title">Протоколы замены</div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Заявка</th>
                  <th>Было</th>
                  <th>Стало</th>
                  <th>Причина</th>
                  <th>Этап</th>
                  <th>С момента детекта</th>
                  <th>Клиент</th>
                </tr>
              </thead>
              <tbody>
                {protocols.length === 0 && <EmptyRow colSpan={7} />}
                {protocols.map((r) => (
                  <tr key={r.id} className="row--clickable" onClick={() => setOpenRec(r)}>
                    <td className="mono">{r.orderNumber}</td>
                    <td>{r.fromMasterName ?? '—'}</td>
                    <td>{r.toMasterName ?? '—'}</td>
                    <td>{replacementReasonLabel(r.reason)}</td>
                    <td>
                      <span className={`badge badge--${replacementStageTone(r.stage)}`}>
                        {replacementStageLabel(r.stage)}
                      </span>
                    </td>
                    <td className="num">{formatDuration(minutesSince(r.detectedAt, now))}</td>
                    <td>
                      {r.clientNotified ? (
                        <span className="badge badge--success">клиент уведомлён</span>
                      ) : (
                        <span className="badge badge--warning">клиент не уведомлён</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="tab-note">
            Уровни поиска замены: дежурный → свободные рядом → завершающие заявку → бродкаст-оффер
            всем подходящим (ТЗ 17.3). Счётчики обновляются каждые 10 секунд.
          </div>
        </>
      )}

      {openRec !== null && (
        <ProtocolModal
          key={openRec.id}
          initial={openRec}
          onClose={() => setOpenRec(null)}
          onChanged={reload}
        />
      )}
    </>
  );
}
