import { FormEvent, useState } from 'react';
import { api } from '../api';
import { useFetch } from '../useFetch';
import { formatDateTime } from '../format';
import { Modal } from '../components/Modal';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import type { PromoCode } from '../types';

/** Промокоды B2C (ТЗ 15, решение №13): скидка применяется последней к итогу работ. */
export function PromoCodesPage() {
  const toast = useToast();
  const { data, loading, error, reload } = useFetch<PromoCode[]>(() =>
    api.get<PromoCode[]>('/admin/promo-codes'),
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const [code, setCode] = useState('');
  const [discountPercent, setDiscountPercent] = useState(10);
  const [maxUses, setMaxUses] = useState('');
  const [comment, setComment] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await api.post('/admin/promo-codes', {
        code: code.trim(),
        discountPercent,
        ...(maxUses.trim() !== '' ? { maxUses: Number(maxUses) } : {}),
        ...(comment.trim() !== '' ? { comment: comment.trim() } : {}),
      });
      toast('Промокод создан');
      setModalOpen(false);
      setCode('');
      setDiscountPercent(10);
      setMaxUses('');
      setComment('');
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (p: PromoCode) => {
    setTogglingId(p.id);
    try {
      await api.put(`/admin/promo-codes/${p.id}`, { active: !p.active });
      toast(p.active ? `Промокод ${p.code} выключен` : `Промокод ${p.code} включён`);
      reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    } finally {
      setTogglingId(null);
    }
  };

  if (loading) return <Loading />;
  if (error !== null) return <ErrorBanner message={error} />;

  const codes = data ?? [];

  return (
    <>
      <div className="page-header">
        <h1>Промокоды</h1>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => {
            setFormError(null);
            setModalOpen(true);
          }}
        >
          Новый промокод
        </button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Код</th>
              <th className="num">Скидка</th>
              <th className="num">Использовано</th>
              <th>Статус</th>
              <th>Комментарий</th>
              <th>Создан</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {codes.length === 0 && <EmptyRow colSpan={7} />}
            {codes.map((p) => (
              <tr key={p.id}>
                <td className="mono semibold">{p.code}</td>
                <td className="num">{p.discountPercent}%</td>
                <td className="num">
                  {p.usedCount} / {p.maxUses ?? '∞'}
                </td>
                <td>
                  {p.active ? (
                    <span className="badge badge--success">Активен</span>
                  ) : (
                    <span className="badge badge--muted">Выключен</span>
                  )}
                </td>
                <td>{p.comment ?? '—'}</td>
                <td className="num">{formatDateTime(p.createdAt)}</td>
                <td className="num">
                  <button
                    type="button"
                    className="btn btn--link"
                    disabled={togglingId === p.id}
                    onClick={() => toggle(p)}
                  >
                    {p.active ? 'Выключить' : 'Включить'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 12 }}>
        Скидка применяется последней к итогу работ и НЕ уменьшает долю мастера (ТЗ 3.7, решение
        №13).
      </p>

      {modalOpen && (
        <Modal title="Новый промокод" onClose={() => setModalOpen(false)}>
          {formError !== null && <ErrorBanner message={formError} />}
          <form className="form-grid" onSubmit={submit}>
            <div className="field">
              <label htmlFor="p-code">Код</label>
              <input
                id="p-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="SALOM10"
                required
                autoFocus
              />
            </div>
            <div className="field">
              <label htmlFor="p-discount">Скидка, % (1–50)</label>
              <input
                id="p-discount"
                type="number"
                min={1}
                max={50}
                value={discountPercent}
                onChange={(e) => setDiscountPercent(Number(e.target.value))}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="p-max">Лимит использований (пусто — без лимита)</label>
              <input
                id="p-max"
                type="number"
                min={1}
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="p-comment">Комментарий</label>
              <input
                id="p-comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
            </div>
            <div className="modal__actions">
              <button type="button" className="btn" onClick={() => setModalOpen(false)}>
                Отмена
              </button>
              <button type="submit" className="btn btn--primary" disabled={busy}>
                Создать
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
