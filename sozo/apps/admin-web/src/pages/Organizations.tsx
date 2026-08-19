import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useFetch } from '../useFetch';
import { formatSoums, soumsToTiyin } from '../format';
import { StatusBadge } from '../components/Badge';
import { Modal } from '../components/Modal';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import { Column, Pager, SortableTh, TableToolbar, useTableView } from '../components/TableView';
import type { Organization } from '../types';

export function contractTypeLabel(t: Organization['contractType']): string {
  return t === 'subscription' ? 'Абонентка' : 'Разовые';
}

export function contractKindLabel(k: Organization['contractKind']): string {
  return k === 'annual' ? 'годовой' : 'месячный';
}

/** Колонки реестра: по ним работают сортировка, поиск и выгрузка */
const COLUMNS: Array<Column<Organization>> = [
  { key: 'name', title: 'Название', value: (o) => o.name },
  { key: 'inn', title: 'ИНН', value: (o) => o.inn },
  { key: 'contract', title: 'Тип договора', value: (o) => `${contractTypeLabel(o.contractType)}, ${contractKindLabel(o.contractKind)}` },
  { key: 'subscription', title: 'Абонентка', value: (o) => o.subscriptionTiyin, num: true },
  { key: 'locations', title: 'Точек', value: (o) => o.locationsCount, num: true },
  { key: 'status', title: 'Статус', value: (o) => o.status },
];

export function OrganizationsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { data, loading, error, reload } = useFetch<Organization[]>(() =>
    api.get<Organization[]>('/admin/organizations'),
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState('');
  const [inn, setInn] = useState('');
  const [vatPayer, setVatPayer] = useState(false);
  const [contractType, setContractType] = useState<Organization['contractType']>('subscription');
  const [contractKind, setContractKind] = useState<Organization['contractKind']>('monthly');
  const [subscriptionSoums, setSubscriptionSoums] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await api.post('/admin/organizations', {
        name: name.trim(),
        inn: inn.trim(),
        vatPayer,
        contractType,
        contractKind,
        subscriptionTiyin:
          contractType === 'subscription' ? soumsToTiyin(Number(subscriptionSoums) || 0) : 0,
      });
      toast('Организация создана');
      setModalOpen(false);
      setName('');
      setInn('');
      setVatPayer(false);
      setSubscriptionSoums('');
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading />;
  if (error !== null) return <ErrorBanner message={error} />;

  const orgs = data ?? [];
  const view = useTableView(orgs, COLUMNS, { initialSort: 'name' });

  return (
    <>
      <div className="page-header">
        <h1>Организации B2B</h1>
        <button type="button" className="btn btn--primary" onClick={() => setModalOpen(true)}>
          Новая организация
        </button>
      </div>
      <TableToolbar view={view} fileName="organizations.csv" placeholder="название или ИНН" />

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
            {view.visible.map((o) => (
              <tr
                key={o.id}
                className="row--clickable"
                onClick={() => navigate(`/organizations/${o.id}`)}
              >
                <td>{o.name}</td>
                <td className="num">{o.inn}</td>
                <td>
                  {contractTypeLabel(o.contractType)}, {contractKindLabel(o.contractKind)}
                </td>
                <td className="num">
                  {o.contractType === 'subscription' ? formatSoums(o.subscriptionTiyin) : '—'}
                </td>
                <td className="num">{o.locationsCount}</td>
                <td>
                  <StatusBadge status={o.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager view={view} />

      {modalOpen && (
        <Modal title="Новая организация" onClose={() => setModalOpen(false)}>
          {formError !== null && <ErrorBanner message={formError} />}
          <form className="form-grid" onSubmit={submit}>
            <div className="field">
              <label htmlFor="org-name">Название</label>
              <input
                id="org-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="field">
              <label htmlFor="org-inn">ИНН</label>
              <input id="org-inn" value={inn} onChange={(e) => setInn(e.target.value)} required />
            </div>
            <div className="field field--checkbox">
              <input
                id="org-vat"
                type="checkbox"
                checked={vatPayer}
                onChange={(e) => setVatPayer(e.target.checked)}
              />
              <label htmlFor="org-vat" style={{ margin: 0 }}>
                Плательщик НДС
              </label>
            </div>
            <div className="field">
              <label htmlFor="org-type">Тип договора</label>
              <select
                id="org-type"
                value={contractType}
                onChange={(e) => setContractType(e.target.value as Organization['contractType'])}
              >
                <option value="subscription">Абонентка</option>
                <option value="one_off">Разовые</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="org-kind">Срок договора</label>
              <select
                id="org-kind"
                value={contractKind}
                onChange={(e) => setContractKind(e.target.value as Organization['contractKind'])}
              >
                <option value="monthly">Месячный</option>
                <option value="annual">Годовой</option>
              </select>
            </div>
            {contractType === 'subscription' && (
              <div className="field">
                <label htmlFor="org-sub">Абонентка, сум/мес</label>
                <input
                  id="org-sub"
                  inputMode="numeric"
                  value={subscriptionSoums}
                  onChange={(e) => setSubscriptionSoums(e.target.value.replace(/[^\d]/g, ''))}
                  required
                />
              </div>
            )}
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
