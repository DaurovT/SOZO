import { useMemo, useState } from 'react';
import { api, openDocument, photoUrl } from '../api';
import { useFetch } from '../useFetch';
import { formatDateTime, formatSoums } from '../format';
import { Modal } from '../components/Modal';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';
import {
  ACT_STATUSES,
  APPROVED_VIA_LABELS,
  CANCELLED_STATUSES,
  DISPATCHER_URL,
  GRAPH_TYPES,
  MATERIAL_KIND_LABELS,
  MATERIAL_SOURCE_LABELS,
  ORDER_STATUSES,
  PHOTO_STAGE_LABELS,
  QUOTE_KIND_LABELS,
  SOURCE_LABELS,
  TERMINAL_STATUSES,
  URGENCY_LABELS,
  graphTypeLabel,
  graphTypeVariant,
  logActionLabel,
  orderStatusLabel,
  orderStatusVariant,
} from '../orderDicts';
import { Column, Pager, SortableTh, useTableView } from '../components/TableView';
import type { AdminOrder, AdminOrderDetail } from '../types';

/** Аварийной считаем и заявку аварийного графа, и любую с аварийной срочностью. */
function isEmergency(o: { graphType: string; urgency: string }): boolean {
  return o.graphType === 'emergency' || o.urgency === 'emergency';
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`badge badge--${orderStatusVariant(status)}`}>{orderStatusLabel(status)}</span>
  );
}

function TypeBadge({ graphType }: { graphType: string }) {
  return (
    <span className={`badge badge--${graphTypeVariant(graphType)}`}>{graphTypeLabel(graphType)}</span>
  );
}

function openDispatcher() {
  window.open(DISPATCHER_URL, '_blank');
}

/**
 * A-01: реестр заявок — read-only срез операционки для владельца платформы (PRD-04).
 * Переходы статусов, назначения и брони живут в диспетчерской (PRD-03), здесь их нет
 * намеренно: админка отвечает за просмотр и аналитику.
 */
/** Колонки таблицы заявок: по ним работают сортировка и выгрузка */
const COLUMNS: Array<Column<AdminOrder>> = [
  { key: 'number', title: 'Номер', value: (o) => o.number },
  { key: 'graphType', title: 'Тип', value: (o) => graphTypeLabel(o.graphType) },
  { key: 'status', title: 'Статус', value: (o) => orderStatusLabel(o.status) },
  { key: 'client', title: 'Клиент', value: (o) => `${o.clientName ?? ''} ${o.clientPhone}`.trim() },
  { key: 'address', title: 'Адрес', value: (o) => o.address },
  { key: 'master', title: 'Мастер', value: (o) => o.masterName ?? '' },
  { key: 'total', title: 'Сумма', value: (o) => o.totalFromTiyin, num: true },
  { key: 'photos', title: 'Фото', noSort: true },
  { key: 'createdAt', title: 'Создана', value: (o) => o.createdAt },
  { key: 'closedAt', title: 'Закрыта', noSort: true },
];

export function OrdersPage() {
  const { data, loading, error } = useFetch<AdminOrder[]>(() =>
    api.get<AdminOrder[]>('/admin/orders'),
  );

  const [status, setStatus] = useState('all');
  const [graphType, setGraphType] = useState('all');
  const [query, setQuery] = useState('');
  const [period, setPeriod] = useState('all');
  const [openId, setOpenId] = useState<string | null>(null);

  const orders = useMemo(() => data ?? [], [data]);

  const stats = useMemo(() => {
    const active = orders.filter((o) => !TERMINAL_STATUSES.has(o.status));
    return {
      total: orders.length,
      active: active.length,
      closed: orders.filter((o) => o.status === 'closed' || o.status === 'rated').length,
      cancelled: orders.filter((o) => CANCELLED_STATUSES.has(o.status)).length,
      emergencies: active.filter(isEmergency).length,
    };
  }, [orders]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Период считаем от начала суток, а не «минус 24 часа»: «за сегодня»
    // должно означать сегодняшний день, а не последние сутки
    const since = (() => {
      if (period === 'all') return 0;
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      if (period === '7') d.setDate(d.getDate() - 6);
      if (period === '30') d.setDate(d.getDate() - 29);
      return d.getTime();
    })();
    return orders.filter((o) => {
      if (status !== 'all' && o.status !== status) return false;
      if (graphType !== 'all' && o.graphType !== graphType) return false;
      if (since > 0 && new Date(o.createdAt).getTime() < since) return false;
      if (q === '') return true;
      return (
        o.number.toLowerCase().includes(q) ||
        o.clientPhone.toLowerCase().includes(q) ||
        o.address.toLowerCase().includes(q)
      );
    });
  }, [orders, status, graphType, query, period]);

  /**
   * Сортировка, страницы и выгрузка поверх уже отфильтрованного списка.
   *
   * Свой поиск и свои фильтры у этого экрана были и работают — хук нужен
   * ради остального: без страниц браузер рисует тысячу строк разом.
   */
  const view = useTableView(visible, COLUMNS, { initialSort: 'createdAt', desc: true });

  if (loading) return <Loading />;
  if (error !== null) return <ErrorBanner message={error} />;

  const tiles = [
    { value: stats.total, label: 'Заявок всего' },
    { value: stats.active, label: 'Активных', hint: 'не закрыты и не отменены' },
    { value: stats.closed, label: 'Закрыто' },
    { value: stats.cancelled, label: 'Отменено' },
    {
      value: stats.emergencies,
      label: 'Аварийных активных',
      cardClass: stats.emergencies > 0 ? 'card--outline-error' : undefined,
    },
  ];

  return (
    <>
      <div className="page-header">
        <h1>Заявки</h1>
        <button type="button" className="btn" onClick={openDispatcher}>
          Открыть в диспетчерской
        </button>
      </div>

      <div className="tiles">
        {tiles.map((t) => (
          <div className={t.cardClass ? `card ${t.cardClass}` : 'card'} key={t.label}>
            <div className="tile__value">{t.value}</div>
            <div className="tile__label">{t.label}</div>
            {t.hint !== undefined && <div className="tile__hint">{t.hint}</div>}
          </div>
        ))}
      </div>

      <div className="filters">
        <div className="field">
          <label htmlFor="o-status">Статус</label>
          <select id="o-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">Все статусы</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s.status} value={s.status}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="o-type">Тип</label>
          <select id="o-type" value={graphType} onChange={(e) => setGraphType(e.target.value)}>
            <option value="all">Все типы</option>
            {GRAPH_TYPES.map((t) => (
              <option key={t.graphType} value={t.graphType}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="o-period">Период</label>
          <select id="o-period" value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option value="all">За всё время</option>
            <option value="today">Сегодня</option>
            <option value="7">7 дней</option>
            <option value="30">30 дней</option>
          </select>
        </div>
        <div className="field field--grow">
          <label htmlFor="o-search">Поиск</label>
          <input
            id="o-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="номер, телефон или адрес"
          />
        </div>
        <div className="field">
          <label>&nbsp;</label>
          <div className="actions-row">
            <span className="muted">найдено: {view.total}</span>
            <button
              type="button"
              className="btn"
              disabled={view.total === 0}
              onClick={() => view.exportCsv('orders.csv')}
            >
              Скачать CSV
            </button>
          </div>
        </div>
      </div>

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
            {view.visible.length === 0 && <EmptyRow colSpan={10} />}
            {view.visible.map((o) => (
              <tr
                key={o.id}
                className={isEmergency(o) ? 'row--clickable row--warning' : 'row--clickable'}
                onClick={() => setOpenId(o.id)}
              >
                <td className="mono">{o.number}</td>
                <td>
                  <TypeBadge graphType={o.graphType} />
                  {o.urgency === 'urgent' && (
                    <span className="badge badge--warning" style={{ marginLeft: 'var(--s4)' }}>
                      Срочно
                    </span>
                  )}
                </td>
                <td>
                  <StatusBadge status={o.status} />
                </td>
                <td>
                  <div>{o.clientName || '—'}</div>
                  <div className="tile__hint">{o.clientPhone}</div>
                </td>
                <td>{o.address}</td>
                <td>{o.masterName ?? '—'}</td>
                <td className="num">
                  <div>{formatSoums(o.totalFromTiyin)}</div>
                  {o.promoCode !== null && (
                    <div className="tile__hint">
                      промокод {o.promoCode} −{o.promoDiscountPercent ?? 0}%
                    </div>
                  )}
                </td>
                <td className="num">
                  {o.photosWithFile}/{o.photosCount}
                </td>
                <td className="num">{formatDateTime(o.createdAt)}</td>
                <td className="num">{formatDateTime(o.closedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager view={view} />

      {openId !== null && <OrderCard id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

/** Карточка заявки: полный состав без единого действия над конвейером. */
function OrderCard({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, loading, error } = useFetch<AdminOrderDetail>(
    () => api.get<AdminOrderDetail>(`/admin/orders/${id}`),
    [id],
  );

  const title = data ? `Заявка ${data.number}` : 'Заявка';

  return (
    <Modal title={title} onClose={onClose} wide>
      {loading && <Loading />}
      {error !== null && <ErrorBanner message={error} />}
      {data && <OrderCardBody order={data} />}
    </Modal>
  );
}

function OrderCardBody({ order }: { order: AdminOrderDetail }) {
  const lines = order.lines ?? [];
  const quotes = order.quotes ?? [];
  const photos = order.photos ?? [];
  const materials = order.materials ?? [];
  const statusLog = order.statusLog ?? [];

  return (
    <>
      <div className="section-title" style={{ marginTop: 0 }}>
        Клиент и адрес
      </div>
      <dl className="kv">
        <dt>Статус</dt>
        <dd>
          <StatusBadge status={order.status} />
        </dd>
        <dt>Тип</dt>
        <dd>
          <TypeBadge graphType={order.graphType} />
        </dd>
        <dt>Срочность</dt>
        <dd>{URGENCY_LABELS[order.urgency] ?? order.urgency}</dd>
        <dt>Клиент</dt>
        <dd>
          {order.clientName || '—'} · {order.clientPhone}
        </dd>
        <dt>Адрес</dt>
        <dd>{order.address}</dd>
        <dt>Описание</dt>
        <dd>{order.description || '—'}</dd>
        <dt>Источник</dt>
        <dd>{SOURCE_LABELS[order.source] ?? order.source}</dd>
        <dt>Мастер</dt>
        <dd>{order.masterName ?? '—'}</dd>
        <dt>Сумма работ</dt>
        <dd>{formatSoums(order.totalFromTiyin)}</dd>
        <dt>Материалы</dt>
        <dd>{formatSoums(order.totalMaterialTiyin ?? 0)}</dd>
        {order.promoCode != null && (
          <>
            <dt>Промокод</dt>
            <dd>
              {order.promoCode} · −{order.promoDiscountPercent ?? 0}%
            </dd>
          </>
        )}
        <dt>Создана</dt>
        <dd>{formatDateTime(order.createdAt)}</dd>
      </dl>

      <div className="section-title">Состав работ</div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Наименование</th>
              <th>Ед.</th>
              <th>Кол-во</th>
              <th>Цена от</th>
              <th>Цена до</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && <EmptyRow colSpan={5} />}
            {lines.map((l, i) => (
              <tr key={`${l.name}:${i}`}>
                <td>{l.name}</td>
                <td>{l.unit}</td>
                <td className="num">{l.qty}</td>
                <td className="num">{formatSoums(l.priceFromTiyin)}</td>
                <td className="num">{formatSoums(l.priceToTiyin)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="section-title">Сметы</div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Тип</th>
              <th>Сумма</th>
              <th>Санкция</th>
              <th>Комментарий</th>
              <th>Время</th>
            </tr>
          </thead>
          <tbody>
            {quotes.length === 0 && <EmptyRow colSpan={5} />}
            {quotes.map((q, i) => (
              <tr key={`${q.kind}:${i}`}>
                <td>{QUOTE_KIND_LABELS[q.kind] ?? q.kind}</td>
                <td className="num">{formatSoums(q.amountTiyin)}</td>
                <td className="muted">
                  {q.approvedVia ? (APPROVED_VIA_LABELS[q.approvedVia] ?? q.approvedVia) : '—'}
                </td>
                <td className="muted">{q.note ?? '—'}</td>
                <td className="num">{formatDateTime(q.at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="section-title">Материалы</div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Вид</th>
              <th>Название</th>
              <th>Канал</th>
              <th>Сумма</th>
              <th>Чек</th>
              <th>Время</th>
            </tr>
          </thead>
          <tbody>
            {materials.length === 0 && <EmptyRow colSpan={6} />}
            {materials.map((m, i) => (
              <tr key={`${m.name}:${i}`}>
                <td>{MATERIAL_KIND_LABELS[m.kind] ?? m.kind}</td>
                <td>{m.name}</td>
                <td className="muted">
                  {m.sourceChannel
                    ? (MATERIAL_SOURCE_LABELS[m.sourceChannel] ?? m.sourceChannel)
                    : '—'}
                </td>
                <td className="num">{formatSoums(m.amountTiyin)}</td>
                <td>{m.hasReceipt ? 'Да' : '—'}</td>
                <td className="num">{formatDateTime(m.at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="section-title">Фото</div>
      {photos.length === 0 ? (
        <div className="muted">Пока пусто</div>
      ) : (
        <div className="photo-grid">
          {photos.map((p, i) => (
            <div className="photo-card" key={p.id ?? `${p.stage}:${i}`}>
              {p.file ? (
                <a href={photoUrl(p.file)} target="_blank" rel="noreferrer">
                  <img src={photoUrl(p.file)} alt={PHOTO_STAGE_LABELS[p.stage] ?? p.stage} />
                </a>
              ) : (
                <div className="photo-card__empty">Отметка конвейера без файла</div>
              )}
              <div className="photo-card__cap">
                <span className="photo-card__stage">
                  {PHOTO_STAGE_LABELS[p.stage] ?? p.stage}
                </span>
                <span>{formatDateTime(p.at)}</span>
              </div>
              <div className="photo-card__source">{p.source}</div>
            </div>
          ))}
        </div>
      )}

      <div className="section-title">Журнал переходов</div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Время</th>
              <th>Действие</th>
              <th>Переход</th>
              <th>Кто</th>
              <th>Причина</th>
            </tr>
          </thead>
          <tbody>
            {statusLog.length === 0 && <EmptyRow colSpan={5} />}
            {statusLog.map((l, i) => (
              <tr key={`${l.at}:${i}`}>
                <td className="num">{formatDateTime(l.at)}</td>
                <td>{logActionLabel(l.action)}</td>
                <td className="muted">
                  {l.from !== null ? `${orderStatusLabel(l.from)} → ` : ''}
                  {orderStatusLabel(l.to)}
                </td>
                <td className="num">{l.actorPhone}</td>
                <td className="muted">{l.reason ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="banner banner--warning" style={{ marginTop: 'var(--s24)' }}>
        {order.readOnlyNote}
      </div>

      <div className="modal__actions" style={{ alignItems: 'center' }}>
        <span className="muted" style={{ marginRight: 'auto' }}>
          управление конвейером — там
        </span>
        {ACT_STATUSES.has(order.status) && (
          <button
            type="button"
            className="btn"
            onClick={() => openDocument(`/documents/orders/${order.id}/act`)}
          >
            Акт (PDF)
          </button>
        )}
        <button type="button" className="btn btn--primary" onClick={openDispatcher}>
          Открыть в диспетчерской
        </button>
      </div>
    </>
  );
}
