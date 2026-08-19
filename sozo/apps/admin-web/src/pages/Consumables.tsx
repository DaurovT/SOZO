import { FormEvent, useState } from 'react';
import { api } from '../api';
import { useFetch } from '../useFetch';
import { formatSoums, soumsToTiyin } from '../format';
import { Modal } from '../components/Modal';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import type { Consumable } from '../types';

export function ConsumablesPage() {
  const toast = useToast();
  const { data, loading, error, reload } = useFetch<Consumable[]>(() =>
    api.get<Consumable[]>('/admin/registry/consumables'),
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const [priceSoums, setPriceSoums] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await api.post('/admin/registry/consumables', {
        name: name.trim(),
        unit: unit.trim(),
        fixPriceTiyin: soumsToTiyin(Number(priceSoums) || 0),
      });
      toast('Расходник добавлен');
      setModalOpen(false);
      setName('');
      setUnit('');
      setPriceSoums('');
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading />;
  if (error !== null) return <ErrorBanner message={error} />;

  const items = data ?? [];

  return (
    <>
      <div className="page-header">
        <h1>Расходники «сумки»</h1>
        <button type="button" className="btn btn--primary" onClick={() => setModalOpen(true)}>
          Добавить
        </button>
      </div>
      <div className="banner">
        Списываются в смету без чека по фикс-прайсу — вся сумма мастеру (ТЗ 8.4)
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Название</th>
              <th>Ед.</th>
              <th className="num">Фикс-цена</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && <EmptyRow colSpan={3} />}
            {items.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td className="muted">{c.unit}</td>
                <td className="num">{formatSoums(c.fixPriceTiyin)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <Modal title="Добавить расходник" onClose={() => setModalOpen(false)}>
          {formError !== null && <ErrorBanner message={formError} />}
          <form className="form-grid" onSubmit={submit}>
            <div className="field">
              <label htmlFor="cs-name">Название</label>
              <input
                id="cs-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="field">
              <label htmlFor="cs-unit">Единица измерения</label>
              <input
                id="cs-unit"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="шт, упак, компл"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="cs-price">Фикс-цена, сум</label>
              <input
                id="cs-price"
                inputMode="numeric"
                value={priceSoums}
                onChange={(e) => setPriceSoums(e.target.value.replace(/[^\d]/g, ''))}
                required
              />
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
