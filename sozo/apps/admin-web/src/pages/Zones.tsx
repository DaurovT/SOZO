import { FormEvent, useState } from 'react';
import { api } from '../api';
import { useFetch } from '../useFetch';
import { Modal } from '../components/Modal';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import type { Zone } from '../types';

/** A-29: зоны и города (city_id с первого дня, ТЗ 17.4). */
export function ZonesPage() {
  const toast = useToast();
  const { data, loading, error, reload } = useFetch<Zone[]>(() =>
    api.get<Zone[]>('/admin/registry/zones'),
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [city, setCity] = useState('Ташкент');
  const [name, setName] = useState('');
  const [active, setActive] = useState(true);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await api.post('/admin/registry/zones', {
        city: city.trim(),
        name: name.trim(),
        active,
      });
      toast('Зона добавлена');
      setModalOpen(false);
      setName('');
      setActive(true);
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading />;
  if (error !== null) return <ErrorBanner message={error} />;

  const zones = data ?? [];

  return (
    <>
      <div className="page-header">
        <h1>Зоны покрытия</h1>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => {
            setFormError(null);
            setModalOpen(true);
          }}
        >
          Добавить зону
        </button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Город</th>
              <th>Зона</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            {zones.length === 0 && <EmptyRow colSpan={3} />}
            {zones.map((z) => (
              <tr key={z.id}>
                <td>{z.city}</td>
                <td>{z.name}</td>
                <td>
                  {z.active ? (
                    <span className="badge badge--success">Активна</span>
                  ) : (
                    <span className="badge badge--muted">Неактивна</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <Modal title="Новая зона" onClose={() => setModalOpen(false)}>
          {formError !== null && <ErrorBanner message={formError} />}
          <form className="form-grid" onSubmit={submit}>
            <div className="field">
              <label htmlFor="z-city">Город</label>
              <input
                id="z-city"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="z-name">Название зоны</label>
              <input
                id="z-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="field field--checkbox">
              <input
                id="z-active"
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
              />
              <label htmlFor="z-active" style={{ margin: 0 }}>
                Активна
              </label>
            </div>
            <div className="modal__actions">
              <button type="button" className="btn" onClick={() => setModalOpen(false)}>
                Отмена
              </button>
              <button type="submit" className="btn btn--primary" disabled={busy}>
                Добавить
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
