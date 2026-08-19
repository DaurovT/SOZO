import { FormEvent, useState } from 'react';
import { api } from '../api';
import { useFetch } from '../useFetch';
import { formatSoums, soumsToTiyin } from '../format';
import { StatusBadge } from '../components/Badge';
import { Modal } from '../components/Modal';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import type { PartnerStore } from '../types';

export function StoresPage() {
  const toast = useToast();
  const { data, loading, error, reload } = useFetch<PartnerStore[]>(() =>
    api.get<PartnerStore[]>('/admin/registry/stores'),
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState('');
  const [categoriesText, setCategoriesText] = useState('');
  const [creditLimitSoums, setCreditLimitSoums] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await api.post('/admin/registry/stores', {
        name: name.trim(),
        categories: categoriesText
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean),
        creditLimitTiyin: soumsToTiyin(Number(creditLimitSoums) || 0),
      });
      toast('Магазин добавлен');
      setModalOpen(false);
      setName('');
      setCategoriesText('');
      setCreditLimitSoums('');
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading />;
  if (error !== null) return <ErrorBanner message={error} />;

  const stores = data ?? [];

  return (
    <>
      <div className="page-header">
        <h1>Партнёрские магазины</h1>
        <button type="button" className="btn btn--primary" onClick={() => setModalOpen(true)}>
          Добавить
        </button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Название</th>
              <th>Категории</th>
              <th className="num">Кредитный лимит</th>
              <th className="num">Кредиторка</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            {stores.length === 0 && <EmptyRow colSpan={5} />}
            {stores.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>
                  {s.categories.map((c) => (
                    <span className="chip" key={c}>
                      {c}
                    </span>
                  ))}
                </td>
                <td className="num">{formatSoums(s.creditLimitTiyin)}</td>
                <td className="num">{s.payableTiyin > 0 ? formatSoums(s.payableTiyin) : '—'}</td>
                <td>
                  <StatusBadge status={s.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <Modal title="Добавить магазин" onClose={() => setModalOpen(false)}>
          {formError !== null && <ErrorBanner message={formError} />}
          <form className="form-grid" onSubmit={submit}>
            <div className="field">
              <label htmlFor="st-name">Название</label>
              <input
                id="st-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="field">
              <label htmlFor="st-cats">Категории (через запятую)</label>
              <input
                id="st-cats"
                value={categoriesText}
                onChange={(e) => setCategoriesText(e.target.value)}
                placeholder="сантехника, электрика"
              />
            </div>
            <div className="field">
              <label htmlFor="st-limit">Кредитный лимит, сум</label>
              <input
                id="st-limit"
                inputMode="numeric"
                value={creditLimitSoums}
                onChange={(e) => setCreditLimitSoums(e.target.value.replace(/[^\d]/g, ''))}
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
