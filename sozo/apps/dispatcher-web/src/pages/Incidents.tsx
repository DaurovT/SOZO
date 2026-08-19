import { useState } from 'react';
import { api, ApiError } from '../api';
import { Modal } from '../components/Modal';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import { INCIDENT_CATEGORIES, INCIDENT_ZONES, incidentCategoryLabel } from '../dicts';
import { formatDateTime } from '../format';
import type { Incident, IncidentDetect, KanbanData, Order } from '../types';
import { useFetch } from '../useFetch';

function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
}

/** Форма открытия инцидента: зона подставляется из подозрительного кластера. */
function IncidentForm({
  zone,
  onClose,
  onCreated,
}: {
  zone: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [zoneValue, setZoneValue] = useState(zone);
  const [category, setCategory] = useState(INCIDENT_CATEGORIES[0].value);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post<Incident>('/dispatch/ops/incidents', {
        title: title.trim(),
        zone: zoneValue.trim(),
        category,
      });
      toast('Инцидент открыт');
      onCreated();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Новый инцидент" onClose={onClose}>
      {error !== null && <ErrorBanner message={error} />}
      <div className="form-grid">
        <div className="field">
          <label htmlFor="inc-title">Название</label>
          <input
            id="inc-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Например: отключение воды по улице"
            autoFocus
          />
        </div>
        <div className="field">
          <label htmlFor="inc-zone">Зона</label>
          <input
            id="inc-zone"
            list="inc-zones"
            value={zoneValue}
            onChange={(e) => setZoneValue(e.target.value)}
            placeholder="район или улица"
          />
          <datalist id="inc-zones">
            {INCIDENT_ZONES.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
        </div>
        <div className="field">
          <label htmlFor="inc-category">Категория</label>
          <select id="inc-category" value={category} onChange={(e) => setCategory(e.target.value)}>
            {INCIDENT_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="modal__actions">
        <button type="button" className="btn btn--link" onClick={onClose}>
          Отмена
        </button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy || title.trim() === '' || zoneValue.trim() === ''}
          onClick={() => void submit()}
        >
          Открыть инцидент
        </button>
      </div>
    </Modal>
  );
}

/** Прикрепление активной заявки к кластеру инцидента. */
function AttachForm({
  incident,
  onClose,
  onAttached,
}: {
  incident: Incident;
  onClose: () => void;
  onAttached: () => void;
}) {
  const toast = useToast();
  const [orderId, setOrderId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Активные заявки — колонки kanban без архива.
  const orders = useFetch(async () => {
    const data = await api.get<KanbanData>('/dispatch/kanban');
    return data.columns.flatMap((c) => c.orders);
  }, []);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post<Incident>(`/dispatch/ops/incidents/${incident.id}/attach`, { orderId });
      toast('Заявка прикреплена к инциденту');
      onAttached();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const free = (orders.data ?? []).filter((o: Order) => !incident.orderIds.includes(o.id));

  return (
    <Modal title={`Прикрепить заявку · ${incident.title}`} onClose={onClose}>
      {error !== null && <ErrorBanner message={error} />}
      {orders.error !== null && <ErrorBanner message={orders.error} />}
      {orders.loading && !orders.data && <Loading />}
      <div className="form-grid">
        <div className="field">
          <label htmlFor="inc-order">Активная заявка</label>
          <select id="inc-order" value={orderId} onChange={(e) => setOrderId(e.target.value)}>
            <option value="">— выберите заявку —</option>
            {free.map((o) => (
              <option key={o.id} value={o.id}>
                {o.number} · {o.address}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="tab-note">
        Уже в кластере: {incident.orderIds.length}. Приоритизация внутри кластера — уязвимые и
        аварийные первыми.
      </div>
      <div className="modal__actions">
        <button type="button" className="btn btn--link" onClick={onClose}>
          Отмена
        </button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy || orderId === ''}
          onClick={() => void submit()}
        >
          Прикрепить
        </button>
      </div>
    </Modal>
  );
}

/** Закрытие инцидента с примечанием — итог разбирается на передаче смены. */
function CloseForm({
  incident,
  onClose,
  onClosed,
}: {
  incident: Incident;
  onClose: () => void;
  onClosed: () => void;
}) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post<Incident>(`/dispatch/ops/incidents/${incident.id}/close`, {
        note: note.trim() || undefined,
      });
      toast('Инцидент закрыт');
      onClosed();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Закрыть инцидент · ${incident.title}`} onClose={onClose}>
      {error !== null && <ErrorBanner message={error} />}
      <div className="form-grid">
        <div className="field">
          <label htmlFor="inc-note">Примечание</label>
          <textarea
            id="inc-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Например: авария устранена, заявки кластера отработаны"
          />
        </div>
      </div>
      <div className="modal__actions">
        <button type="button" className="btn btn--link" onClick={onClose}>
          Отмена
        </button>
        <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void submit()}>
          Закрыть инцидент
        </button>
      </div>
    </Modal>
  );
}

export function IncidentsPage() {
  const [formZone, setFormZone] = useState<string | null>(null);
  const [attachTo, setAttachTo] = useState<Incident | null>(null);
  const [closeTarget, setCloseTarget] = useState<Incident | null>(null);

  const { data, loading, error, reload } = useFetch(async () => {
    const [detect, incidents] = await Promise.all([
      api.get<IncidentDetect>('/dispatch/ops/incidents/detect'),
      api.get<Incident[]>('/dispatch/ops/incidents'),
    ]);
    return { detect, incidents };
  }, []);

  const detect = data?.detect ?? null;
  const incidents = data?.incidents ?? [];

  return (
    <>
      <div className="page-header">
        <h1>Инциденты</h1>
        <button type="button" className="btn btn--primary" onClick={() => setFormZone('')}>
          Новый инцидент
        </button>
      </div>

      <div className="banner banner--warning">
        При инциденте приоритизация внутри кластера: уязвимые и аварийные первыми; полная пересборка
        лент зоны доступна старшему смены (ТЗ 17.3)
      </div>

      {error !== null && <ErrorBanner message={error} />}
      {loading && !data && <Loading />}

      {data && detect && (
        <>
          <div className="section-title" style={{ marginTop: 0 }}>
            Детект кластеров за {detect.windowHours} ч
          </div>
          {detect.clusters.length === 0 ? (
            <div className="banner banner--success">
              Кластеров за последний час нет — массовых аварий не видно
            </div>
          ) : (
            <div className="ops-grid">
              {detect.clusters.map((c) => (
                <div key={c.zone} className={c.suspicious ? 'card card--warning' : 'card'}>
                  <div className="tile__value">{c.count}</div>
                  <div className="tile__label">{c.zone}</div>
                  <div className="tile__hint">
                    {c.suspicious
                      ? `≥${detect.threshold} заявок одной зоны за час — возможна массовая авария`
                      : `заявок за ${detect.windowHours} ч`}
                  </div>
                  <div className="actions-row ops-card__actions">
                    <button
                      type="button"
                      className={c.suspicious ? 'btn btn--primary' : 'btn'}
                      onClick={() => setFormZone(c.zone)}
                    >
                      Открыть инцидент
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="section-title">Инциденты</div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Название</th>
                  <th>Зона</th>
                  <th>Категория</th>
                  <th className="num">Заявок</th>
                  <th>Открыт</th>
                  <th>Статус</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {incidents.length === 0 && <EmptyRow colSpan={7} />}
                {incidents.map((inc) => (
                  <tr key={inc.id}>
                    <td>{inc.title}</td>
                    <td>{inc.zone}</td>
                    <td>{incidentCategoryLabel(inc.category)}</td>
                    <td className="num">{inc.orderIds.length}</td>
                    <td>{formatDateTime(inc.openedAt)}</td>
                    <td>
                      {inc.closedAt ? (
                        <span className="badge badge--muted">закрыт {formatDateTime(inc.closedAt)}</span>
                      ) : (
                        <span className="badge badge--error">активен</span>
                      )}
                    </td>
                    <td className="num">
                      {!inc.closedAt && (
                        <>
                          <button
                            type="button"
                            className="btn btn--link"
                            onClick={() => setAttachTo(inc)}
                          >
                            Прикрепить заявку
                          </button>{' '}
                          <button
                            type="button"
                            className="btn btn--link"
                            onClick={() => setCloseTarget(inc)}
                          >
                            Закрыть
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="tab-note">
            Порог детекта — {detect.threshold} заявки одной зоны за {detect.windowHours} ч. Заявки
            кластера обрабатываются пакетом, клиенту сообщается причина задержки.
          </div>
        </>
      )}

      {formZone !== null && (
        <IncidentForm zone={formZone} onClose={() => setFormZone(null)} onCreated={reload} />
      )}
      {attachTo !== null && (
        <AttachForm incident={attachTo} onClose={() => setAttachTo(null)} onAttached={reload} />
      )}
      {closeTarget !== null && (
        <CloseForm incident={closeTarget} onClose={() => setCloseTarget(null)} onClosed={reload} />
      )}
    </>
  );
}
