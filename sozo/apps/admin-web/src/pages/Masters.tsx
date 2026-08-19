import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useFetch } from '../useFetch';
import { formatSoums } from '../format';
import { StatusBadge } from '../components/Badge';
import { Modal } from '../components/Modal';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import { Column, Pager, SortableTh, TableToolbar, useTableView } from '../components/TableView';
import type { Master } from '../types';

export const GRADE_LABELS: Record<Master['grade'], string> = {
  bronze: 'Бронза',
  silver: 'Серебро',
  gold: 'Золото',
};

export const TAX_LABELS: Record<Master['taxMode'], string> = {
  self_employed: 'Самозанятый',
  gph: 'ГПХ',
};

/** Описание колонок: по нему строятся и сортировка, и поиск, и выгрузка */
const COLUMNS: Array<Column<Master>> = [
  { key: 'fullName', title: 'ФИО', value: (m) => m.fullName },
  { key: 'phone', title: 'Телефон', value: (m) => m.phone, num: true },
  { key: 'status', title: 'Статус', value: (m) => m.status },
  { key: 'skills', title: 'Навыки', value: (m) => m.skillTags.join(', ') },
  { key: 'rating', title: 'Рейтинг', value: (m) => m.rating, num: true },
  { key: 'grade', title: 'Грейд', value: (m) => GRADE_LABELS[m.grade] ?? m.grade },
  { key: 'taxMode', title: 'Налоговый режим', value: (m) => TAX_LABELS[m.taxMode] ?? m.taxMode },
  { key: 'debt', title: 'Наличный долг', value: (m) => m.cashDebtTiyin, num: true },
];

export function MastersPage() {
  const toast = useToast();
  const { data, loading, error, reload } = useFetch<Master[]>(() =>
    api.get<Master[]>('/admin/masters'),
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('+998');
  const [skillTagsText, setSkillTagsText] = useState('');
  const [taxMode, setTaxMode] = useState<Master['taxMode']>('self_employed');
  const [hasVehicle, setHasVehicle] = useState(false);

  const view = useTableView(data ?? [], COLUMNS, { initialSort: 'fullName' });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await api.post('/admin/masters', {
        fullName: fullName.trim(),
        phone: '+' + phone.replace(/\D/g, ''),
        skillTags: skillTagsText
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        taxMode,
        hasVehicle,
      });
      toast('Кандидат создан');
      setModalOpen(false);
      setFullName('');
      setPhone('+998');
      setSkillTagsText('');
      setHasVehicle(false);
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading />;
  if (error !== null) return <ErrorBanner message={error} />;

  return (
    <>
      <div className="page-header">
        <h1>Мастера</h1>
        <button type="button" className="btn btn--primary" onClick={() => setModalOpen(true)}>
          Новый кандидат
        </button>
      </div>
      <TableToolbar view={view} fileName="masters.csv" placeholder="фамилия, телефон, навык" />

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <SortableTh key={c.key} column={c} view={view} />
              ))}
            </tr>
          </thead>
          <tbody>
            {view.visible.length === 0 && <EmptyRow colSpan={COLUMNS.length} />}
            {view.visible.map((m) => (
              <tr key={m.id}>
                <td>
                  <Link to={`/masters/${m.id}`}>{m.fullName}</Link>
                </td>
                <td className="num">{m.phone}</td>
                <td>
                  <StatusBadge status={m.status} />
                </td>
                <td>
                  {m.skillTags.map((tag) => (
                    <span className="chip" key={tag}>
                      {tag}
                    </span>
                  ))}
                </td>
                <td className="num">{m.rating}</td>
                <td>{GRADE_LABELS[m.grade] ?? m.grade}</td>
                <td>{TAX_LABELS[m.taxMode] ?? m.taxMode}</td>
                <td className="num">{m.cashDebtTiyin > 0 ? formatSoums(m.cashDebtTiyin) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager view={view} />

      {modalOpen && (
        <Modal title="Новый кандидат" onClose={() => setModalOpen(false)}>
          {formError !== null && <ErrorBanner message={formError} />}
          <form className="form-grid" onSubmit={submit}>
            <div className="field">
              <label htmlFor="m-name">ФИО</label>
              <input
                id="m-name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="field">
              <label htmlFor="m-phone">Телефон</label>
              <input
                id="m-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+998 90 123 45 67"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="m-skills">Навыки (через запятую)</label>
              <input
                id="m-skills"
                value={skillTagsText}
                onChange={(e) => setSkillTagsText(e.target.value)}
                placeholder="электрика, сантехника"
              />
            </div>
            <div className="field">
              <label htmlFor="m-tax">Налоговый режим</label>
              <select
                id="m-tax"
                value={taxMode}
                onChange={(e) => setTaxMode(e.target.value as Master['taxMode'])}
              >
                <option value="self_employed">Самозанятый</option>
                <option value="gph">ГПХ</option>
              </select>
            </div>
            <div className="field field--checkbox">
              <input
                id="m-vehicle"
                type="checkbox"
                checked={hasVehicle}
                onChange={(e) => setHasVehicle(e.target.checked)}
              />
              <label htmlFor="m-vehicle" style={{ margin: 0 }}>
                Есть автомобиль
              </label>
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
