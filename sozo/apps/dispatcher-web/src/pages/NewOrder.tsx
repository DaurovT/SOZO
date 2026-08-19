import { FormEvent, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useToast } from '../components/Toast';
import { ErrorBanner, Loading } from '../components/States';
import { URGENCY_LABELS } from '../dicts';
import { formatSoums } from '../format';
import { useFetch } from '../useFetch';
import { maskPhone, phoneToE164 } from './Login';
import type {
  DispatchOrganization,
  Order,
  PriceItem,
  PriceItemsResponse,
  Urgency,
} from '../types';

interface ChosenItem {
  item: PriceItem;
  qty: number;
}

const URGENCIES: Urgency[] = ['normal', 'urgent', 'emergency'];

export function NewOrderPage() {
  const navigate = useNavigate();
  const toast = useToast();

  const { data, loading, error } = useFetch<{
    price: PriceItemsResponse;
    organizations: DispatchOrganization[];
  }>(async () => {
    const [price, organizations] = await Promise.all([
      api.get<PriceItemsResponse>('/dispatch/price-items'),
      api.get<DispatchOrganization[]>('/dispatch/organizations'),
    ]);
    return { price, organizations };
  });

  const [phone, setPhone] = useState('+998');
  const [clientName, setClientName] = useState('');
  const [address, setAddress] = useState('');
  const [description, setDescription] = useState('');
  const [urgency, setUrgency] = useState<Urgency>('normal');
  const [organizationId, setOrganizationId] = useState('');
  const [search, setSearch] = useState('');
  const [chosen, setChosen] = useState<ChosenItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const phoneValid = phoneToE164(phone).length === 13;
  const canSubmit = phoneValid && address.trim() !== '' && !busy;

  /** Фильтр по подстроке + группировка по категориям (порядок прайса сохраняется). */
  const groups = useMemo(() => {
    const items = data?.price.items ?? [];
    const q = search.trim().toLowerCase();
    const filtered =
      q === ''
        ? items
        : items.filter(
            (i) =>
              i.name.toLowerCase().includes(q) ||
              i.category.toLowerCase().includes(q) ||
              String(i.num) === q,
          );
    const result: { category: string; items: PriceItem[] }[] = [];
    for (const item of filtered) {
      const last = result[result.length - 1];
      if (last && last.category === item.category) last.items.push(item);
      else result.push({ category: item.category, items: [item] });
    }
    return result;
  }, [data, search]);

  const addItem = (item: PriceItem) => {
    setChosen((prev) => {
      const found = prev.find((c) => c.item.id === item.id);
      if (found) {
        return prev.map((c) => (c.item.id === item.id ? { ...c, qty: c.qty + 1 } : c));
      }
      return [...prev, { item, qty: 1 }];
    });
  };

  const changeQty = (id: string, delta: number) => {
    setChosen((prev) =>
      prev
        .map((c) => (c.item.id === id ? { ...c, qty: c.qty + delta } : c))
        .filter((c) => c.qty > 0),
    );
  };

  const totalFrom = chosen.reduce((s, c) => s + c.item.priceFromTiyin * c.qty, 0);
  const totalTo = chosen.reduce((s, c) => s + c.item.priceToTiyin * c.qty, 0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setSubmitError(null);
    try {
      const order = await api.post<Order>('/dispatch/orders', {
        clientPhone: phoneToE164(phone),
        clientName: clientName.trim(),
        address: address.trim(),
        description: description.trim(),
        urgency,
        ...(organizationId !== '' ? { organizationId } : {}),
        items: chosen.map((c) => ({ priceItemId: c.item.id, qty: c.qty })),
      });
      toast(`Заявка ${order.number} создана`);
      navigate('/kanban');
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  if (loading) return <Loading />;
  if (error !== null) return <ErrorBanner message={error} />;
  if (!data) return null;

  return (
    <>
      <div className="page-header">
        <h1>Новая заявка (телефон)</h1>
      </div>
      {submitError !== null && <ErrorBanner message={submitError} />}
      <form className="new-order" onSubmit={submit}>
        <div className="card form-grid">
          <div className="field">
            <label htmlFor="clientPhone">Телефон клиента *</label>
            <input
              id="clientPhone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(maskPhone(e.target.value))}
              placeholder="+998 90 123 45 67"
              autoFocus
            />
          </div>
          <div className="field">
            <label htmlFor="clientName">Имя клиента</label>
            <input
              id="clientName"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Как обращаться"
            />
          </div>
          <div className="field">
            <label htmlFor="address">Адрес *</label>
            <input
              id="address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Ташкент, район, улица, дом"
            />
          </div>
          <div className="field">
            <label htmlFor="description">Описание проблемы</label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Что случилось, со слов клиента"
            />
          </div>
          <div className="field">
            <label>Срочность</label>
            <div className="urgency-options">
              {URGENCIES.map((u) => (
                <label
                  key={u}
                  className={[
                    'urgency-option',
                    urgency === u ? 'urgency-option--selected' : '',
                    u === 'emergency' ? 'urgency-option--emergency' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <input
                    type="radio"
                    name="urgency"
                    value={u}
                    checked={urgency === u}
                    onChange={() => setUrgency(u)}
                  />
                  {URGENCY_LABELS[u]}
                </label>
              ))}
            </div>
          </div>
          <div className="field">
            <label htmlFor="organization">Организация (B2B — конвейер с утверждениями)</label>
            <select
              id="organization"
              value={organizationId}
              onChange={(e) => setOrganizationId(e.target.value)}
            >
              <option value="">— частный клиент (B2C) —</option>
              {data.organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="card">
          <div className="field">
            <label htmlFor="search">Подбор работ (прайс, {data.price.items.length} позиций)</label>
            <input
              id="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск: смеситель, розетка, №…"
            />
          </div>
          <div className="price-picker__list">
            {groups.length === 0 && <div className="state-text">Ничего не найдено</div>}
            {groups.map((g) => (
              <div key={g.category}>
                <div className="price-picker__category">{g.category}</div>
                {g.items.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className="price-picker__item"
                    onClick={() => addItem(item)}
                    title="Добавить в смету"
                  >
                    <span>{item.name}</span>
                    <span className="num">
                      {formatSoums(item.priceFromTiyin)} — {formatSoums(item.priceToTiyin)} /{' '}
                      {item.unit}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>

          {chosen.length > 0 && (
            <>
              <div className="section-title">Смета</div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Работа</th>
                      <th>Кол-во</th>
                      <th className="num">От</th>
                      <th className="num">До</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chosen.map((c) => (
                      <tr key={c.item.id}>
                        <td>{c.item.name}</td>
                        <td>
                          <span className="stepper">
                            <button type="button" onClick={() => changeQty(c.item.id, -1)}>
                              −
                            </button>
                            <span className="stepper__qty">{c.qty}</span>
                            <button type="button" onClick={() => changeQty(c.item.id, 1)}>
                              +
                            </button>
                          </span>
                        </td>
                        <td className="num">{formatSoums(c.item.priceFromTiyin * c.qty)}</td>
                        <td className="num">{formatSoums(c.item.priceToTiyin * c.qty)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <div className="estimate-total">
            <span className="muted">Итого по вилке прайса</span>
            <span className="estimate-total__value">
              {formatSoums(totalFrom)} — {formatSoums(totalTo)}
            </span>
          </div>

          <div className="modal__actions">
            <button type="submit" className="btn btn--primary" disabled={!canSubmit}>
              Создать заявку
            </button>
          </div>
        </div>
      </form>
    </>
  );
}
