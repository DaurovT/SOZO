import { useState } from 'react';
import { api, openDocument } from '../api';
import { useFetch } from '../useFetch';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';
import { Modal } from '../components/Modal';
import { formatSoums } from '../format';
import { Column, Pager, SortableTh, TableToolbar, useTableView } from '../components/TableView';

interface ClientRow {
  phone: string;
  name: string;
  ordersTotal: number;
  ordersActive: number;
  ordersClosed: number;
  spentTiyin: number;
  debtTiyin: number;
  blocked: boolean;
  blockReason?: string;
  lastOrderAt?: string;
}

interface ClientOrder {
  id: string;
  number: string;
  status: string;
  address: string;
  totalFromTiyin: number;
  totalToTiyin: number;
  createdAt: string;
}

const STATUS_RU: Record<string, string> = {
  new: 'Новая',
  estimated: 'Оценена',
  assigned: 'Назначена',
  master_departed: 'Мастер выехал',
  in_progress: 'В работе',
  addwork_approval: 'Доп-согласование',
  completed: 'Выполнена',
  verified: 'Проверена',
  awaiting_payment: 'Ожидает оплаты',
  closed: 'Закрыта',
  rated: 'Оценена клиентом',
  cancelled: 'Отменена',
  dispute: 'Спор',
};

/**
 * То, что клиент сообщил о себе сам: согласия, язык, адреса, жалобы, роли
 * на точках. Реестр заявок этого не знает — данные живут в профиле приложения.
 */
interface AppClient {
  phone: string;
  fullName: string;
  locale: 'ru' | 'uz';
  consentPersonalData: boolean;
  consentMarketing: boolean;
  consentAt: string | null;
  addresses: number;
  complaints: number;
  favoriteMasterName: string | null;
  sites: Array<{ organization: string; location: string; role: string; approvalLimitTiyin: number | null }>;
}

interface AppClientCard {
  profile: { phone: string; fullName: string; locale: string; favoriteMasterName: string | null };
  addresses: Array<{ id: string; label?: string; street: string; apartment?: string; primary: boolean }>;
  complaints: Array<{ id: string; type: string; text: string; status: string; createdAt: string }>;
  sites: Array<{ organization: string; location: string; role: string; primary: boolean }>;
  orders: { personal: number; business: number };
  payments: Array<{ orderId: string; number: string; provider: string; status: string; amountTiyin: number; tipTiyin: number; at: string }>;
  warranty: Array<{ orderId: string; number: string; title: string; until: string }>;
}

/** Одна строка про приложение: заходил ли, на каком языке, есть ли роли на точках */
function appLabel(a: AppClient | undefined) {
  if (!a) return <span className="muted">не заходил</span>;
  const parts = [
    a.locale === 'uz' ? 'oʻzbekcha' : 'русский',
    a.consentMarketing ? 'реклама: да' : 'реклама: нет',
    a.addresses > 0 && `адресов ${a.addresses}`,
    a.sites.length > 0 && `точек ${a.sites.length}`,
  ].filter(Boolean);
  return (
    <>
      <span className="badge badge--success">есть профиль</span>
      <div className="muted">{parts.join(' · ')}</div>
    </>
  );
}

/** Колонки реестра: из них строятся сортировка, поиск и выгрузка */
const COLUMNS: Array<Column<ClientRow>> = [
  { key: 'phone', title: 'Телефон', value: (c) => c.phone, num: true },
  { key: 'name', title: 'Имя', value: (c) => c.name },
  { key: 'total', title: 'Заявок', value: (c) => c.ordersTotal, num: true },
  { key: 'active', title: 'Активных', value: (c) => c.ordersActive, num: true },
  { key: 'closed', title: 'Закрыто', value: (c) => c.ordersClosed, num: true },
  { key: 'spent', title: 'Сумма закрытых', value: (c) => c.spentTiyin, num: true },
  { key: 'debt', title: 'Долг', value: (c) => c.debtTiyin, num: true },
  { key: 'app', title: 'Приложение', noSort: true },
  { key: 'status', title: 'Статус', value: (c) => (c.blocked ? 'заблокирован' : 'активен') },
  { key: 'actions', title: '', noSort: true },
];

export function ClientsPage() {
  const { data, loading, error, reload } = useFetch<ClientRow[]>(() => api.get<ClientRow[]>('/admin/clients'));
  // Профили приложения — вторым запросом: реестр из заявок про них не знает,
  // а падать целиком, если у клиента ещё нет профиля, незачем
  const { data: appData } = useFetch<AppClient[]>(() => api.get<AppClient[]>('/admin/app-clients'), []);
  const view = useTableView(data ?? [], COLUMNS, { initialSort: 'debt', desc: true });
  const [selected, setSelected] = useState<ClientRow | null>(null);
  const [card, setCard] = useState<AppClientCard | null>(null);
  const [orders, setOrders] = useState<ClientOrder[] | null>(null);
  const [blockTarget, setBlockTarget] = useState<ClientRow | null>(null);
  const [blockReason, setBlockReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  if (loading) return <Loading />;
  if (error !== null) return <ErrorBanner message={error} />;

  const clients = data ?? [];
  const appByPhone = new Map((appData ?? []).map((a) => [a.phone, a]));

  async function openClient(c: ClientRow) {
    setSelected(c);
    setOrders(null);
    setCard(null);
    setOrders(await api.get<ClientOrder[]>(`/admin/clients/${encodeURIComponent(c.phone)}/orders`));
    // Профиль приложения может отсутствовать (клиент заведён по телефону
    // диспетчером и в приложение не заходил) — заявки от этого не пропадают
    try {
      setCard(await api.get<AppClientCard>(`/admin/app-clients/${encodeURIComponent(c.phone)}`));
    } catch {
      setCard(null);
    }
  }

  async function toggleBlock(c: ClientRow) {
    setActionError(null);
    try {
      if (c.blocked) {
        await api.post(`/admin/clients/${encodeURIComponent(c.phone)}/unblock`, {});
      } else {
        if (!blockReason.trim()) {
          setActionError('Укажите причину блокировки');
          return;
        }
        await api.post(`/admin/clients/${encodeURIComponent(c.phone)}/block`, { reason: blockReason.trim() });
      }
      setBlockTarget(null);
      setBlockReason('');
      reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Ошибка');
    }
  }

  return (
    <>
      <div className="page-header">
        <h1>Клиенты B2C</h1>
        <span className="muted">{clients.length} клиентов · реестр собирается из заявок (телефон — ключ)</span>
      </div>
      <div className="banner">
        Долг (заявки «Ожидает оплаты») блокирует новые заявки клиента, кроме аварийных — ТЗ 4.4. Блокировка применяется вручную с причиной.
      </div>
      <TableToolbar view={view} fileName="clients.csv" placeholder="телефон или имя" />

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
            {view.visible.map((c) => (
              <tr key={c.phone} className={c.debtTiyin > 0 ? 'row--warning' : undefined}>
                <td className="num">
                  <a href="#" onClick={(e) => { e.preventDefault(); void openClient(c); }}>{c.phone}</a>
                </td>
                <td>{c.name || '—'}</td>
                <td className="num">{c.ordersTotal}</td>
                <td className="num">{c.ordersActive}</td>
                <td className="num">{c.ordersClosed}</td>
                <td className="num">{formatSoums(c.spentTiyin)}</td>
                <td className="num">{c.debtTiyin > 0 ? <span className="neg">{formatSoums(c.debtTiyin)}</span> : '—'}</td>
                <td>{appLabel(appByPhone.get(c.phone))}</td>
                <td>
                  {c.blocked ? (
                    <span className="badge badge--error" title={c.blockReason}>Заблокирован</span>
                  ) : (
                    <span className="badge badge--success">Активен</span>
                  )}
                </td>
                <td>
                  {c.blocked ? (
                    <button className="btn btn--secondary" onClick={() => void toggleBlock(c)}>Разблокировать</button>
                  ) : (
                    <button className="btn btn--secondary" onClick={() => { setBlockTarget(c); setBlockReason(''); setActionError(null); }}>
                      Заблокировать
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager view={view} />

      {selected && (
        <Modal title={`Клиент ${selected.phone}`} onClose={() => setSelected(null)}>
          {card === null ? (
            <div className="muted">Профиля в приложении нет — клиент заведён по телефону</div>
          ) : (
            <>
              <div className="section-title" style={{ marginTop: 0 }}>
                Профиль приложения
              </div>
              <div className="muted">
                {card.profile.fullName || 'имя не указано'} · язык{' '}
                {card.profile.locale === 'uz' ? 'oʻzbekcha' : 'русский'} · заявок: личных{' '}
                {card.orders.personal}, по точкам {card.orders.business}
                {card.profile.favoriteMasterName !== null &&
                  ` · запомненный мастер: ${card.profile.favoriteMasterName}`}
              </div>

              {card.sites.length > 0 && (
                <div className="muted">
                  Роли:{' '}
                  {card.sites
                    .map((s) => `${s.organization} / ${s.location} — ${s.role}${s.primary ? ' (главный)' : ''}`)
                    .join('; ')}
                </div>
              )}

              {card.addresses.length > 0 && (
                <div className="muted">
                  Адреса:{' '}
                  {card.addresses
                    .map((a) => `${a.label ?? a.street}${a.apartment ? `, кв. ${a.apartment}` : ''}`)
                    .join('; ')}
                </div>
              )}

              {card.complaints.length > 0 && (
                <div className="muted">
                  Жалоб: {card.complaints.length} · последняя «{card.complaints[0].type}»
                </div>
              )}

              {/* Гарантия и платежи — то, ради чего чаще всего звонят.
                  Раньше оператор собирал это по трём экранам, пока человек ждал */}
              {card.warranty.length > 0 && (
                <div className="muted">
                  На гарантии: {card.warranty.length} · ближайшая до{' '}
                  {new Date(card.warranty[0].until).toLocaleDateString('ru-RU')}
                </div>
              )}

              {card.payments.length > 0 && (
                <>
                  <div className="section-title">Платежи</div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Заявка</th>
                          <th>Способ</th>
                          <th className="num">Сумма</th>
                          <th className="num">Чаевые</th>
                          <th>Статус</th>
                        </tr>
                      </thead>
                      <tbody>
                        {card.payments.map((p) => (
                          <tr key={p.orderId}>
                            <td className="mono">{p.number}</td>
                            <td>{p.provider}</td>
                            <td className="num">{formatSoums(p.amountTiyin)}</td>
                            <td className="num">{p.tipTiyin > 0 ? formatSoums(p.tipTiyin) : '—'}</td>
                            <td>
                              {p.status === 'succeeded' ? (
                                <span className="badge badge--success">оплачен</span>
                              ) : (
                                <span className="badge badge--warning">ждёт подтверждения</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}

          <div className="section-title">Заявки</div>
          {orders === null ? (
            <Loading />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Номер</th>
                    <th>Статус</th>
                    <th>Адрес</th>
                    <th>Вилка</th>
                    <th>Создана</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {orders.length === 0 && <EmptyRow colSpan={6} />}
                  {orders.map((o) => (
                    <tr key={o.id}>
                      <td className="num">{o.number}</td>
                      <td>{STATUS_RU[o.status] ?? o.status}</td>
                      <td>{o.address}</td>
                      <td className="num">
                        {formatSoums(o.totalFromTiyin)} — {formatSoums(o.totalToTiyin)}
                      </td>
                      <td className="num">{new Date(o.createdAt).toLocaleString('ru-RU')}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn--link"
                          onClick={() => openDocument(`/documents/orders/${o.id}/act`)}
                        >
                          Акт
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Modal>
      )}

      {blockTarget && (
        <Modal title={`Блокировка ${blockTarget.phone}`} onClose={() => setBlockTarget(null)}>
          <p className="muted">Новые заявки будут недоступны, кроме аварийных (ТЗ 4.4).</p>
          <div className="form-field">
            <label>Причина (обязательно)</label>
            <textarea value={blockReason} onChange={(e) => setBlockReason(e.target.value)} rows={3} />
          </div>
          {actionError && <ErrorBanner message={actionError} />}
          <div className="modal__actions">
            <button className="btn btn--secondary" onClick={() => setBlockTarget(null)}>Отмена</button>
            <button className="btn btn--danger" onClick={() => void toggleBlock(blockTarget)}>Заблокировать</button>
          </div>
        </Modal>
      )}
    </>
  );
}
