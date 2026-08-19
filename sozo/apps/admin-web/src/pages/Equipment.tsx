import { FormEvent, useState } from 'react';
import { api } from '../api';
import { useFetch } from '../useFetch';
import { formatSoums, soumsToTiyin } from '../format';
import { Modal } from '../components/Modal';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import type { EquipmentItem, EquipmentStatus } from '../types';

const STATUS_LABELS: Record<EquipmentStatus, string> = {
  in_stock: 'На складе',
  issued: 'Выдано',
  maintenance: 'ТО',
  written_off: 'Списано',
};

function statusBadgeClass(status: EquipmentStatus): string {
  switch (status) {
    case 'issued':
      return 'badge badge--accent';
    case 'maintenance':
      return 'badge badge--warning';
    case 'written_off':
      return 'badge badge--muted badge--strike';
    default:
      return 'badge badge--muted';
  }
}

export function EquipmentPage() {
  const toast = useToast();
  const { data, loading, error, reload } = useFetch<EquipmentItem[]>(() =>
    api.get<EquipmentItem[]>('/admin/registry/equipment'),
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [inventoryNumber, setInventoryNumber] = useState('');
  const [name, setName] = useState('');
  const [costSoums, setCostSoums] = useState('');

  const changeStatus = async (item: EquipmentItem, status: EquipmentStatus) => {
    if (status === item.status) return;
    setActionError(null);
    try {
      await api.put(`/admin/registry/equipment/${item.id}`, { status });
      toast(`Статус: ${STATUS_LABELS[status]}`);
      reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await api.post('/admin/registry/equipment', {
        inventoryNumber: inventoryNumber.trim(),
        name: name.trim(),
        costTiyin: soumsToTiyin(Number(costSoums) || 0),
      });
      toast('Оборудование добавлено');
      setModalOpen(false);
      setInventoryNumber('');
      setName('');
      setCostSoums('');
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
        <h1>Оборудование</h1>
        <button type="button" className="btn btn--primary" onClick={() => setModalOpen(true)}>
          Добавить
        </button>
      </div>
      {actionError !== null && <ErrorBanner message={actionError} />}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Инв. №</th>
              <th>Название</th>
              <th className="num">Стоимость</th>
              <th>Статус</th>
              <th>Выдано кому</th>
              <th>Сменить статус</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && <EmptyRow colSpan={6} />}
            {items.map((item) => (
              <tr key={item.id}>
                <td className="mono">{item.inventoryNumber}</td>
                <td>{item.name}</td>
                <td className="num">{formatSoums(item.costTiyin)}</td>
                <td>
                  <span className={statusBadgeClass(item.status)}>
                    {STATUS_LABELS[item.status]}
                  </span>
                </td>
                <td className="muted">{item.issuedToMasterName ?? '—'}</td>
                <td>
                  <select
                    className="cell-select"
                    value={item.status}
                    onChange={(e) => void changeStatus(item, e.target.value as EquipmentStatus)}
                  >
                    {(Object.keys(STATUS_LABELS) as EquipmentStatus[]).map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <Modal title="Добавить оборудование" onClose={() => setModalOpen(false)}>
          {formError !== null && <ErrorBanner message={formError} />}
          <form className="form-grid" onSubmit={submit}>
            <div className="field">
              <label htmlFor="eq-inv">Инвентарный номер</label>
              <input
                id="eq-inv"
                value={inventoryNumber}
                onChange={(e) => setInventoryNumber(e.target.value)}
                placeholder="EQ-0003"
                required
                autoFocus
              />
            </div>
            <div className="field">
              <label htmlFor="eq-name">Название</label>
              <input id="eq-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="eq-cost">Стоимость, сум</label>
              <input
                id="eq-cost"
                inputMode="numeric"
                value={costSoums}
                onChange={(e) => setCostSoums(e.target.value.replace(/[^\d]/g, ''))}
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
