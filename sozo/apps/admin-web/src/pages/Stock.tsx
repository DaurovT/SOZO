import { FormEvent, useState } from 'react';
import { api } from '../api';
import { useFetch } from '../useFetch';
import { formatDateTime, formatSoums, soumsToTiyin } from '../format';
import { Modal } from '../components/Modal';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import type { Master, StockCategory, StockItem, StockMovement, StockMovementType } from '../types';

const CATEGORY_LABELS: Record<StockCategory, string> = {
  special_equipment: 'Спецоборудование',
  tool: 'Инструмент',
  consumable: 'Расходник',
  uniform_merch: 'Форма/мерч',
  other: 'Прочее',
};

const MOVEMENT_LABELS: Record<StockMovementType, string> = {
  receipt: 'Приход',
  temp_use: 'Врем. использование',
  sale_to_master: 'Продажа мастеру',
  write_off: 'Списание',
  return: 'Возврат',
};

/** Типы движений, доступные из формы (A-38). */
const MOVEMENT_TYPES: StockMovementType[] = ['receipt', 'sale_to_master', 'write_off', 'return'];

interface PageData {
  items: StockItem[];
  movements: StockMovement[];
}

/** A-38: внутренний склад (ТЗ 17.16) — журнал движений append-only. */
export function StockPage() {
  const toast = useToast();
  const { data, loading, error, reload } = useFetch<PageData>(async () => {
    const [items, movements] = await Promise.all([
      api.get<StockItem[]>('/admin/stock/items'),
      api.get<StockMovement[]>('/admin/stock/movements'),
    ]);
    return { items, movements };
  });
  const { data: masters } = useFetch<Master[]>(() => api.get<Master[]>('/admin/masters'));

  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [itemOpen, setItemOpen] = useState(false);
  const [category, setCategory] = useState<StockCategory>('consumable');
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('шт');
  const [qty, setQty] = useState('');
  const [minQty, setMinQty] = useState('');
  const [costSoums, setCostSoums] = useState('');

  const [moveItem, setMoveItem] = useState<StockItem | null>(null);
  const [moveType, setMoveType] = useState<StockMovementType>('receipt');
  const [moveQty, setMoveQty] = useState('');
  const [moveMasterId, setMoveMasterId] = useState('');
  const [movePriceSoums, setMovePriceSoums] = useState('');

  const addItem = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await api.post('/admin/stock/items', {
        category,
        name: name.trim(),
        unit: unit.trim() || 'шт',
        qtyOnHand: Number(qty) || 0,
        minQty: Number(minQty) || 0,
        costTiyin: soumsToTiyin(Number(costSoums) || 0),
      });
      toast('Позиция добавлена');
      setItemOpen(false);
      setName('');
      setQty('');
      setMinQty('');
      setCostSoums('');
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const submitMovement = async (e: FormEvent) => {
    e.preventDefault();
    if (!moveItem) return;
    setBusy(true);
    setFormError(null);
    try {
      const master = masters?.find((m) => m.id === moveMasterId);
      await api.post('/admin/stock/movements', {
        stockItemId: moveItem.id,
        type: moveType,
        qty: Number(moveQty) || 0,
        ...(moveType === 'sale_to_master'
          ? {
              masterId: moveMasterId,
              masterName: master?.fullName,
              priceTiyin: soumsToTiyin(Number(movePriceSoums) || 0),
            }
          : {}),
      });
      toast('Движение проведено');
      setMoveItem(null);
      setMoveQty('');
      setMoveMasterId('');
      setMovePriceSoums('');
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading />;
  if (error !== null) return <ErrorBanner message={error} />;
  if (!data) return null;

  const { items, movements } = data;

  return (
    <>
      <div className="page-header">
        <h1>Склад</h1>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => {
            setFormError(null);
            setItemOpen(true);
          }}
        >
          + Позиция
        </button>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Категория</th>
              <th>Название</th>
              <th>Ед.</th>
              <th className="num">Остаток</th>
              <th className="num">Минимум</th>
              <th className="num">Стоимость</th>
              <th></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && <EmptyRow colSpan={8} />}
            {items.map((i) => (
              <tr key={i.id} className={i.belowMin ? 'row--warning' : undefined}>
                <td className="muted">{CATEGORY_LABELS[i.category] ?? i.category}</td>
                <td>{i.name}</td>
                <td className="muted">{i.unit}</td>
                <td className="num">{i.qtyOnHand}</td>
                <td className="num muted">{i.minQty}</td>
                <td className="num">{formatSoums(i.costTiyin)}</td>
                <td>
                  {i.belowMin && <span className="badge badge--warning">Ниже минимума</span>}
                </td>
                <td className="num">
                  <button
                    type="button"
                    className="btn btn--link"
                    onClick={() => {
                      setFormError(null);
                      setMoveType('receipt');
                      setMoveItem(i);
                    }}
                  >
                    Движение
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="section-title">Журнал движений</div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Время</th>
              <th>Позиция</th>
              <th>Тип</th>
              <th className="num">Кол-во</th>
              <th>Мастер</th>
              <th className="num">Сумма</th>
            </tr>
          </thead>
          <tbody>
            {movements.length === 0 && <EmptyRow colSpan={6} />}
            {movements.map((m) => (
              <tr key={m.id}>
                <td className="num">{formatDateTime(m.createdAt)}</td>
                <td>{m.itemName}</td>
                <td>{MOVEMENT_LABELS[m.type] ?? m.type}</td>
                <td className="num">{m.qty}</td>
                <td>{m.masterName ?? '—'}</td>
                <td className="num">
                  {m.priceTiyin != null ? formatSoums(m.priceTiyin * m.qty) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 12 }}>
        Продажа мастеру создаёт удержание из ведомости (≤30% выплаты, ТЗ 17.16).
      </p>

      {itemOpen && (
        <Modal title="Новая позиция" onClose={() => setItemOpen(false)}>
          {formError !== null && <ErrorBanner message={formError} />}
          <form className="form-grid" onSubmit={addItem}>
            <div className="field">
              <label htmlFor="st-cat">Категория</label>
              <select
                id="st-cat"
                value={category}
                onChange={(e) => setCategory(e.target.value as StockCategory)}
              >
                {(Object.keys(CATEGORY_LABELS) as StockCategory[]).map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>
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
              <label htmlFor="st-unit">Единица</label>
              <input id="st-unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="st-qty">Количество</label>
              <input
                id="st-qty"
                inputMode="numeric"
                value={qty}
                onChange={(e) => setQty(e.target.value.replace(/[^\d]/g, ''))}
              />
            </div>
            <div className="field">
              <label htmlFor="st-min">Минимальный остаток</label>
              <input
                id="st-min"
                inputMode="numeric"
                value={minQty}
                onChange={(e) => setMinQty(e.target.value.replace(/[^\d]/g, ''))}
              />
            </div>
            <div className="field">
              <label htmlFor="st-cost">Стоимость, сум</label>
              <input
                id="st-cost"
                inputMode="numeric"
                value={costSoums}
                onChange={(e) => setCostSoums(e.target.value.replace(/[^\d]/g, ''))}
              />
            </div>
            <div className="modal__actions">
              <button type="button" className="btn" onClick={() => setItemOpen(false)}>
                Отмена
              </button>
              <button type="submit" className="btn btn--primary" disabled={busy}>
                Добавить
              </button>
            </div>
          </form>
        </Modal>
      )}

      {moveItem !== null && (
        <Modal title={`Движение: ${moveItem.name}`} onClose={() => setMoveItem(null)}>
          {formError !== null && <ErrorBanner message={formError} />}
          <p className="muted" style={{ marginTop: 0 }}>
            Остаток: {moveItem.qtyOnHand} {moveItem.unit}
          </p>
          <form className="form-grid" onSubmit={submitMovement}>
            <div className="field">
              <label htmlFor="mv-type">Тип движения</label>
              <select
                id="mv-type"
                value={moveType}
                onChange={(e) => setMoveType(e.target.value as StockMovementType)}
              >
                {MOVEMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {MOVEMENT_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="mv-qty">Количество</label>
              <input
                id="mv-qty"
                inputMode="numeric"
                value={moveQty}
                onChange={(e) => setMoveQty(e.target.value.replace(/[^\d]/g, ''))}
                required
              />
            </div>
            {moveType === 'sale_to_master' && (
              <>
                <div className="field">
                  <label htmlFor="mv-master">Мастер</label>
                  <select
                    id="mv-master"
                    value={moveMasterId}
                    onChange={(e) => setMoveMasterId(e.target.value)}
                    required
                  >
                    <option value="" disabled>
                      — выберите мастера —
                    </option>
                    {(masters ?? []).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.fullName}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="mv-price">Цена за единицу, сум</label>
                  <input
                    id="mv-price"
                    inputMode="numeric"
                    value={movePriceSoums}
                    onChange={(e) => setMovePriceSoums(e.target.value.replace(/[^\d]/g, ''))}
                    required
                  />
                </div>
              </>
            )}
            <div className="modal__actions">
              <button type="button" className="btn" onClick={() => setMoveItem(null)}>
                Отмена
              </button>
              <button type="submit" className="btn btn--primary" disabled={busy}>
                Провести
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
