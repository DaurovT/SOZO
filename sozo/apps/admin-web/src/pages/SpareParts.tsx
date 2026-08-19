import { FormEvent, useState } from 'react';
import { api } from '../api';
import { useFetch } from '../useFetch';
import { formatSoums, soumsToTiyin } from '../format';
import { Modal } from '../components/Modal';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import type { SparePart } from '../types';

/** A-24: каталог запчастей с вилками эконом/стандарт/премиум (порог 200 000, ТЗ 8.4.3). */
export function SparePartsPage() {
  const toast = useToast();
  const { data, loading, error, reload } = useFetch<SparePart[]>(() =>
    api.get<SparePart[]>('/admin/registry/spare-parts'),
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState('');
  const [unit, setUnit] = useState('шт');
  const [economSoums, setEconomSoums] = useState('');
  const [standardSoums, setStandardSoums] = useState('');
  const [premiumSoums, setPremiumSoums] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await api.post('/admin/registry/spare-parts', {
        name: name.trim(),
        unit: unit.trim() || 'шт',
        economTiyin: soumsToTiyin(Number(economSoums) || 0),
        standardTiyin: soumsToTiyin(Number(standardSoums) || 0),
        premiumTiyin: soumsToTiyin(Number(premiumSoums) || 0),
      });
      toast('Запчасть добавлена');
      setModalOpen(false);
      setName('');
      setEconomSoums('');
      setStandardSoums('');
      setPremiumSoums('');
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading />;
  if (error !== null) return <ErrorBanner message={error} />;

  const parts = data ?? [];

  return (
    <>
      <div className="page-header">
        <h1>Запчасти</h1>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => {
            setFormError(null);
            setModalOpen(true);
          }}
        >
          Добавить запчасть
        </button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Название</th>
              <th>Ед.</th>
              <th className="num">Эконом</th>
              <th className="num">Стандарт</th>
              <th className="num">Премиум</th>
            </tr>
          </thead>
          <tbody>
            {parts.length === 0 && <EmptyRow colSpan={5} />}
            {parts.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td className="muted">{p.unit}</td>
                <td className="num">{formatSoums(p.economTiyin)}</td>
                <td className="num">{formatSoums(p.standardTiyin)}</td>
                <td className="num">{formatSoums(p.premiumTiyin)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <Modal title="Новая запчасть" onClose={() => setModalOpen(false)}>
          {formError !== null && <ErrorBanner message={formError} />}
          <form className="form-grid" onSubmit={submit}>
            <div className="field">
              <label htmlFor="sp-name">Название</label>
              <input
                id="sp-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="field">
              <label htmlFor="sp-unit">Единица</label>
              <input id="sp-unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="sp-econom">Эконом, сум</label>
              <input
                id="sp-econom"
                inputMode="numeric"
                value={economSoums}
                onChange={(e) => setEconomSoums(e.target.value.replace(/[^\d]/g, ''))}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="sp-standard">Стандарт, сум</label>
              <input
                id="sp-standard"
                inputMode="numeric"
                value={standardSoums}
                onChange={(e) => setStandardSoums(e.target.value.replace(/[^\d]/g, ''))}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="sp-premium">Премиум, сум</label>
              <input
                id="sp-premium"
                inputMode="numeric"
                value={premiumSoums}
                onChange={(e) => setPremiumSoums(e.target.value.replace(/[^\d]/g, ''))}
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
