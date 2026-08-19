import { useState } from 'react';
import { api, ApiError } from '../api';
import { ErrorBanner, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import { handoverKindLabel, handoverKindTone } from '../dicts';
import { formatDateTime, formatTime } from '../format';
import type { Handover, HandoverDraft } from '../types';
import { useFetch } from '../useFetch';

function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
}

export function HandoverPage() {
  const toast = useToast();
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data, loading, error, reload } = useFetch(
    () => api.get<HandoverDraft>('/dispatch/ops/handover/draft'),
    [],
  );

  const current = data?.current ?? null;
  const draftItems = data?.items ?? [];

  const startHandover = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await api.post<Handover>('/dispatch/ops/handover', { items: draftItems });
      toast('Смена сдана — ждём приёмки');
      reload();
    } catch (e) {
      // HANDOVER_OPEN — предыдущая смена ещё не принята.
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const acceptItem = async (handoverId: string, itemId: string) => {
    setBusy(true);
    setActionError(null);
    try {
      await api.post<Handover>(`/dispatch/ops/handover/${handoverId}/items/${itemId}/accept`);
      reload();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const acceptShift = async (handoverId: string) => {
    setBusy(true);
    setActionError(null);
    try {
      await api.post<Handover>(`/dispatch/ops/handover/${handoverId}/accept`);
      toast('Смена принята');
      reload();
    } catch (e) {
      // ITEMS_PENDING — остались пункты без явной отметки.
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const pending = current ? current.items.filter((i) => !i.accepted).length : 0;

  return (
    <>
      <div className="page-header">
        <h1>Передача смены</h1>
        <span className="muted">
          Смена не считается сданной, пока каждый пункт не отмечен явно (PRD-03 D-17)
        </span>
      </div>

      {actionError !== null && <ErrorBanner message={actionError} />}
      {error !== null && <ErrorBanner message={error} />}
      {loading && !data && <Loading />}

      {data && current !== null && (
        <>
          <div className="banner banner--warning">
            Смена сдана {current.fromPhone} в {formatTime(current.startedAt)} · пунктов{' '}
            {current.items.length}, не принято {pending}
          </div>

          {current.items.length === 0 && (
            <div className="banner banner--success">
              Хвостов в журнале нет — смену можно принять сразу
            </div>
          )}

          {current.items.map((item) => (
            <div
              key={item.id}
              className={item.accepted ? 'handover-item handover-item--accepted' : 'handover-item'}
            >
              <div className="handover-item__body">
                <div className="handover-item__title">
                  <span className={`badge badge--${handoverKindTone(item.kind)}`}>
                    {handoverKindLabel(item.kind)}
                  </span>{' '}
                  {item.title}
                </div>
                <div className="handover-item__detail">{item.detail}</div>
                {item.accepted && item.acceptedAt && (
                  <div className="handover-item__detail">
                    отмечено {formatDateTime(item.acceptedAt)}
                  </div>
                )}
              </div>
              {item.accepted ? (
                <span className="badge badge--success">принято {item.acceptedBy ?? '—'}</span>
              ) : (
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => void acceptItem(current.id, item.id)}
                >
                  Принял
                </button>
              )}
            </div>
          ))}

          <div className="actions-row ops-card__actions">
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy || pending > 0}
              onClick={() => void acceptShift(current.id)}
            >
              Принять смену
            </button>
          </div>
          <div className="tab-note">
            Смена не считается сданной, пока каждый пункт не отмечен явно (PRD-03 D-17)
          </div>
        </>
      )}

      {data && current === null && (
        <>
          <div className="section-title" style={{ marginTop: 0 }}>
            К передаче: {draftItems.length} пунктов
          </div>
          {draftItems.length === 0 ? (
            <div className="banner banner--success">
              Незакрытых хвостов нет — смену можно сдать пустой
            </div>
          ) : (
            draftItems.map((item, i) => (
              <div key={`${item.kind}-${i}`} className="handover-item">
                <div className="handover-item__body">
                  <div className="handover-item__title">
                    <span className={`badge badge--${handoverKindTone(item.kind)}`}>
                      {handoverKindLabel(item.kind)}
                    </span>{' '}
                    {item.title}
                  </div>
                  <div className="handover-item__detail">{item.detail}</div>
                </div>
              </div>
            ))
          )}
          <div className="actions-row ops-card__actions">
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy}
              onClick={() => void startHandover()}
            >
              Сдать смену
            </button>
          </div>
          <div className="tab-note">
            Журнал собирается автоматически из незакрытого: замены, инциденты, споры, паузы, заявки
            в ожидании оплаты и утверждения (PRD-03 D-17).
          </div>
        </>
      )}
    </>
  );
}
