import { useState } from 'react';
import { api } from '../api';
import { useFetch } from '../useFetch';
import { Modal } from '../components/Modal';
import { ErrorBanner, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import { formatDateTime } from '../format';
import type { OnboardingCandidate, OnboardingFunnel } from '../types';

/**
 * A-12: воронка онбординга мастеров (ТЗ 17.1).
 *
 * Шесть стадий заявки кандидата, а не четыре статуса карточки мастера: анкету
 * и документы человек заполняет до того, как карточка вообще появится, а
 * собеседование и экзамен в статусе не отражаются вовсе. Раньше экран гонял
 * статусы — и вся середина воронки была невидимой.
 */

/** Что можно сделать с кандидатом на каждой стадии. Пусто — ждём его самого. */
const HINT: Record<string, string> = {
  application: 'Кандидат заполняет анкету. Торопить нечем — ждём',
  documents: 'Проверьте документы и подтверждённый инструмент, затем зовите на собеседование',
  interview: 'Собеседование назначено. Пришёл — отметьте, экзамен откроется',
  training: 'Кандидат проходит модули. Экзамен доступен ему самому',
  exam: 'Экзамен сдан или в попытках — активация после успешной',
  activation: 'Договор подписан, мастер на линии',
};

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Назначение собеседования: дата обязательна — кандидат её увидит в приложении. */
function InterviewForm({
  candidate,
  onClose,
  onDone,
}: {
  candidate: OnboardingCandidate;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [at, setAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/admin/onboarding/interview', { phone: candidate.phone, at });
      toast(`${candidate.fullName}: приглашение отправлено`);
      onDone();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Собеседование · ${candidate.fullName}`} onClose={onClose}>
      {error !== null && <ErrorBanner message={error} />}
      <div className="form-grid">
        <div className="field">
          <label htmlFor="ob-at">Когда приходить</label>
          <input
            id="ob-at"
            value={at}
            onChange={(e) => setAt(e.target.value)}
            placeholder="12 августа, 15:00, офис на Мирабаде"
            autoFocus
          />
          <div className="muted">Эту строку кандидат увидит в приложении как есть</div>
        </div>
      </div>
      <div className="modal__actions">
        <button type="button" className="btn" onClick={onClose}>
          Отмена
        </button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy || at.trim() === ''}
          onClick={() => void submit()}
        >
          Пригласить
        </button>
      </div>
    </Modal>
  );
}

/** Отказ: причина обязательна — кандидат её прочитает. */
function RejectForm({
  candidate,
  onClose,
  onDone,
}: {
  candidate: OnboardingCandidate;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/admin/onboarding/reject', { phone: candidate.phone, reason: reason.trim() });
      toast(`${candidate.fullName}: отказ отправлен`);
      onDone();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Отказ · ${candidate.fullName}`} onClose={onClose}>
      {error !== null && <ErrorBanner message={error} />}
      <div className="form-grid">
        <div className="field">
          <label htmlFor="ob-reason">Причина</label>
          <textarea
            id="ob-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Например: нет опыта по заявленным навыкам, инструмент не подтверждён"
            autoFocus
          />
        </div>
      </div>
      <div className="modal__actions">
        <button type="button" className="btn" onClick={onClose}>
          Отмена
        </button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy || reason.trim() === ''}
          onClick={() => void submit()}
        >
          Отказать
        </button>
      </div>
    </Modal>
  );
}

export function MastersFunnelPage() {
  const toast = useToast();
  const { data, loading, error, reload } = useFetch<OnboardingFunnel>(() =>
    api.get<OnboardingFunnel>('/admin/onboarding'),
  );
  const [interviewFor, setInterviewFor] = useState<OnboardingCandidate | null>(null);
  const [rejectFor, setRejectFor] = useState<OnboardingCandidate | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const act = async (path: string, c: OnboardingCandidate, done: string) => {
    setBusy(true);
    setActionError(null);
    try {
      await api.post(path, { phone: c.phone });
      toast(`${c.fullName}: ${done}`);
      reload();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading />;
  if (error !== null) return <ErrorBanner message={error} />;

  const funnel = data ?? { stages: [], total: 0 };

  return (
    <>
      <div className="page-header">
        <h1>Онбординг мастеров</h1>
        <span className="muted">Кандидатов в работе: {funnel.total}</span>
      </div>

      {actionError !== null && <ErrorBanner message={actionError} />}

      <div className="funnel">
        {funnel.stages.map((s) => (
          <div key={s.code} className="funnel-col">
            <div className="funnel-col__title">
              <span>{s.title}</span>
              <span>{s.count}</span>
            </div>
            <div className="funnel-card__meta">{HINT[s.code] ?? ''}</div>

            {s.candidates.length === 0 && <div className="funnel-card__meta">Пусто</div>}
            {s.candidates.map((c) => (
              <div key={c.id} className="funnel-card" style={{ cursor: 'default' }}>
                <div className="semibold">{c.fullName}</div>
                <div className="muted">{c.phone}</div>
                <div style={{ marginTop: 'var(--s4)' }}>
                  {c.skillTags.map((tag) => (
                    <span className="chip" key={tag}>
                      {tag}
                    </span>
                  ))}
                </div>

                <div className="funnel-card__meta" style={{ marginTop: 'var(--s4)' }}>
                  Опыт {c.experienceYears} г. · документы {c.documentsReady ? 'готовы' : 'не готовы'} ·
                  инструмент {c.toolsReady ? 'подтверждён' : 'не подтверждён'}
                </div>
                {s.code !== 'application' && s.code !== 'documents' && (
                  <div className="funnel-card__meta">
                    модулей пройдено: {c.trainingDone}
                    {c.bestExam > 0 && ` · лучший экзамен ${c.bestExam}%`}
                  </div>
                )}
                {c.interviewAt !== undefined && (
                  <div className="funnel-card__meta">Собеседование: {c.interviewAt}</div>
                )}
                <div className="funnel-card__meta">Обновлено {formatDateTime(c.updatedAt)}</div>

                <div style={{ marginTop: 'var(--s8)', display: 'flex', gap: 'var(--s8)', flexWrap: 'wrap' }}>
                  {s.code === 'documents' && (
                    <button
                      type="button"
                      className="btn btn--link"
                      disabled={busy}
                      onClick={() => setInterviewFor(c)}
                    >
                      Пригласить на собеседование
                    </button>
                  )}
                  {s.code === 'interview' && (
                    <button
                      type="button"
                      className="btn btn--link"
                      disabled={busy}
                      onClick={() => void act('/admin/onboarding/interview/passed', c, 'собеседование пройдено')}
                    >
                      Пришёл, открыть обучение
                    </button>
                  )}
                  {s.code === 'exam' && (
                    <button
                      type="button"
                      className="btn btn--link"
                      disabled={busy}
                      onClick={() => void act('/admin/onboarding/activate', c, 'на линии')}
                    >
                      Активировать
                    </button>
                  )}
                  {s.code !== 'activation' && (
                    <button
                      type="button"
                      className="btn btn--link"
                      disabled={busy}
                      onClick={() => setRejectFor(c)}
                    >
                      Отказать
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {interviewFor !== null && (
        <InterviewForm candidate={interviewFor} onClose={() => setInterviewFor(null)} onDone={reload} />
      )}
      {rejectFor !== null && (
        <RejectForm candidate={rejectFor} onClose={() => setRejectFor(null)} onDone={reload} />
      )}
    </>
  );
}
