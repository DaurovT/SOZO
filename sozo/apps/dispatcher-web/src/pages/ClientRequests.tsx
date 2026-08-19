import { useState } from 'react';
import { api, ApiError } from '../api';
import { Modal } from '../components/Modal';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import { formatDateTime } from '../format';
import type { ClientRequest } from '../types';
import { useFetch } from '../useFetch';

function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
}

const KIND_LABEL: Record<ClientRequest['kind'], string> = {
  reschedule: 'Перенос',
  low_rating: 'Низкая оценка',
  message: 'Сообщение',
};

/** Низкая оценка — обещание перезвонить за 2 часа, остальное просто ждёт очереди. */
const KIND_TONE: Record<ClientRequest['kind'], string> = {
  reschedule: 'badge',
  low_rating: 'badge badge--warning',
  message: 'badge',
};

/** Закрытие обращения: резолюция обязательна — иначе список копит «сделано неизвестно что». */
function CloseForm({
  request,
  onClose,
  onClosed,
}: {
  request: ClientRequest;
  onClose: () => void;
  onClosed: () => void;
}) {
  const toast = useToast();
  const [resolution, setResolution] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post<ClientRequest>(`/dispatch/ops/client-requests/${request.id}/close`, {
        resolution: resolution.trim(),
      });
      toast('Обращение закрыто');
      onClosed();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Закрыть обращение · ${request.orderNumber}`} onClose={onClose}>
      {error !== null && <ErrorBanner message={error} />}
      <div className="tab-note">{request.detail}</div>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="cr-resolution">Чем закончилось</label>
          <textarea
            id="cr-resolution"
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            placeholder={
              request.kind === 'low_rating'
                ? 'Например: дозвонились, мастер переделает бесплатно во вторник'
                : 'Например: визит перенесён на 14 августа, клиент подтвердил'
            }
            autoFocus
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
          disabled={busy || resolution.trim() === ''}
          onClick={() => void submit()}
        >
          Закрыть обращение
        </button>
      </div>
    </Modal>
  );
}

export function ClientRequestsPage() {
  const toast = useToast();
  const [closeTarget, setCloseTarget] = useState<ClientRequest | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data, loading, error, reload } = useFetch(
    () => api.get<ClientRequest[]>('/dispatch/ops/client-requests'),
    [],
  );

  const take = async (r: ClientRequest) => {
    setBusyId(r.id);
    try {
      await api.post<ClientRequest>(`/dispatch/ops/client-requests/${r.id}/take`, {});
      toast('Обращение за вами');
      reload();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  const requests = data ?? [];
  const overdue = requests.filter((r) => r.overdue);

  return (
    <>
      <div className="page-header">
        <h1>Обращения клиентов</h1>
      </div>

      <div className="banner">
        Сюда попадает то, что клиент попросил из приложения: перенести визит, разобраться с низкой
        оценкой, передать сообщение мастеру. По оценке 1–2 обязателен звонок в течение 2 часов
        (ТЗ 7.4)
      </div>

      {overdue.length > 0 && (
        <div className="banner banner--warning">
          Просрочено: {overdue.length}. Сначала звоним по ним
        </div>
      )}

      {error !== null && <ErrorBanner message={error} />}
      {loading && !data && <Loading />}

      {data && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Тип</th>
                <th>Заявка</th>
                <th>Клиент</th>
                <th>Что просит</th>
                <th>Срок</th>
                <th>Статус</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {requests.length === 0 && <EmptyRow colSpan={7} />}
              {requests.map((r) => (
                <tr key={r.id} className={r.overdue ? 'row--warning' : undefined}>
                  <td>
                    <span className={KIND_TONE[r.kind]}>{KIND_LABEL[r.kind]}</span>
                  </td>
                  <td className="mono">{r.orderNumber}</td>
                  <td>
                    {r.clientName ?? '—'}
                    <div className="muted mono">{r.clientPhone}</div>
                  </td>
                  <td>
                    <div>{r.title}</div>
                    <div className="muted">{r.detail}</div>
                    {r.masterName !== undefined && <div className="muted">Мастер: {r.masterName}</div>}
                  </td>
                  <td>
                    {r.dueAt === undefined ? (
                      <span className="muted">{formatDateTime(r.createdAt)}</span>
                    ) : (
                      <span className={r.overdue ? 'badge badge--error' : 'badge badge--warning'}>
                        до {formatDateTime(r.dueAt)}
                      </span>
                    )}
                  </td>
                  <td>{r.status === 'new' ? 'Новое' : `В работе · ${r.takenByPhone ?? ''}`}</td>
                  <td className="actions-row">
                    {r.status === 'new' && (
                      <button
                        type="button"
                        className="btn"
                        disabled={busyId === r.id}
                        onClick={() => void take(r)}
                      >
                        Взять
                      </button>
                    )}
                    <button type="button" className="btn btn--primary" onClick={() => setCloseTarget(r)}>
                      Закрыть
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {closeTarget !== null && (
        <CloseForm request={closeTarget} onClose={() => setCloseTarget(null)} onClosed={reload} />
      )}
    </>
  );
}
