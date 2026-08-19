import { api } from '../api';
import { useFetch } from '../useFetch';
import { formatDateTime, formatSoums } from '../format';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';

/**
 * Что ждёт ответа прямо сейчас.
 *
 * Три очереди, которые до этого жили только у диспетчера и мастера: обращения
 * клиентов, невыкупленные запчасти и зависшие заявки. Разбирают их часто
 * админы — низкую оценку, спор, застрявшую заявку, — а видеть их им было
 * негде: приходилось открывать диспетчерскую под чужой учётной записью.
 *
 * Экран только показывает. Действие — в том продукте, где ему место:
 * обращение закрывает диспетчер, запчасть отмечает мастер.
 */

interface ClientRequestRow {
  id: string;
  kind: 'reschedule' | 'low_rating' | 'message';
  orderNumber: string;
  clientPhone: string;
  clientName?: string;
  masterName?: string;
  title: string;
  detail: string;
  dueAt?: string;
  status: string;
  takenByPhone?: string;
  createdAt: string;
  overdue: boolean;
}

interface WebCardLink {
  code: string;
  orderId: string;
  clientPhone: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
  opens: number;
  lastOpenedAt?: string;
  expired: boolean;
  neverOpened: boolean;
}

interface ProcurementRow {
  id: string;
  orderId: string;
  partName: string;
  tier: string;
  amountTiyin: number;
  chosenAt?: string;
  waitingHours: number;
}

const KIND: Record<string, string> = {
  reschedule: 'Перенос визита',
  low_rating: 'Низкая оценка',
  message: 'Сообщение клиента',
};

const TIER: Record<string, string> = { economy: 'Эконом', standard: 'Стандарт', premium: 'Премиум' };

export function PendingPage() {
  const requests = useFetch<ClientRequestRow[]>(
    () => api.get<ClientRequestRow[]>('/dispatch/ops/client-requests'),
    [],
  );
  const procurement = useFetch<{ items: ProcurementRow[]; totalTiyin: number }>(
    () => api.get<{ items: ProcurementRow[]; totalTiyin: number }>('/dispatch/ops/procurement'),
    [],
  );

  const links = useFetch<{ links: WebCardLink[]; neverOpened: number }>(
    () => api.get<{ links: WebCardLink[]; neverOpened: number }>('/dispatch/web-card/all'),
    [],
  );

  const rows = requests.data ?? [];
  const parts = procurement.data?.items ?? [];
  const overdue = rows.filter((r) => r.overdue);

  return (
    <>
      <div className="page-header">
        <h1>Ждёт ответа</h1>
        <span className="muted">обновляется при открытии страницы</span>
      </div>

      <div className="banner">
        Действия — в диспетчерской и в приложении мастера, здесь только видно, что накопилось.
        По оценке 1–2 обязателен звонок в течение 2 часов (ТЗ 7.4)
      </div>

      <div className="tiles">
        <div className={overdue.length > 0 ? 'card card--warning' : 'card'}>
          <div className="tile__value">{overdue.length}</div>
          <div className="tile__label">просрочено обращений</div>
        </div>
        <div className="card">
          <div className="tile__value">{rows.length}</div>
          <div className="tile__label">обращений в работе</div>
        </div>
        <div className={parts.length > 0 ? 'card card--warning' : 'card'}>
          <div className="tile__value">{parts.length}</div>
          <div className="tile__label">запчастей не куплено</div>
          <div className="tile__hint">на {formatSoums(procurement.data?.totalTiyin ?? 0)}</div>
        </div>
        <div className={(links.data?.neverOpened ?? 0) > 0 ? 'card card--warning' : 'card'}>
          <div className="tile__value">{links.data?.neverOpened ?? 0}</div>
          <div className="tile__label">ссылок не открыли</div>
          <div className="tile__hint">SMS ушла, клиент не перешёл</div>
        </div>
      </div>

      <div className="section-title">Обращения клиентов</div>
      {requests.error !== null && <ErrorBanner message={requests.error} />}
      {requests.loading && !requests.data && <Loading />}
      {requests.data && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Тип</th>
                <th>Заявка</th>
                <th>Клиент</th>
                <th>Что просит</th>
                <th>Срок</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <EmptyRow colSpan={6} />}
              {rows.map((r) => (
                <tr key={r.id} className={r.overdue ? 'row--warning' : undefined}>
                  <td>{KIND[r.kind] ?? r.kind}</td>
                  <td className="mono">{r.orderNumber}</td>
                  <td>
                    {r.clientName ?? '—'}
                    <div className="muted mono">{r.clientPhone}</div>
                  </td>
                  <td>
                    {r.title}
                    <div className="muted">{r.detail}</div>
                  </td>
                  <td>
                    {r.dueAt === undefined ? (
                      <span className="muted">{formatDateTime(r.createdAt)}</span>
                    ) : (
                      <span className={r.overdue ? 'badge badge--error' : 'badge badge--warning'}>
                        до {formatDateTime(r.dueAt)}
                      </span>
                    )}
                  </td>
                  <td>{r.status === 'new' ? 'Новое' : `В работе · ${r.takenByPhone ?? ''}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="section-title">Запчасти к закупке</div>
      <div className="muted">
        Клиент выбрал вариант детали, а купить её ещё предстоит. Пока список не пуст, кто-то
        приедет к клиенту без детали
      </div>
      {procurement.error !== null && <ErrorBanner message={procurement.error} />}
      {procurement.data && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Деталь</th>
                <th>Вариант</th>
                <th className="num">Стоимость</th>
                <th className="num">Ждёт</th>
                <th>Выбрано</th>
              </tr>
            </thead>
            <tbody>
              {parts.length === 0 && <EmptyRow colSpan={5} />}
              {parts.map((p) => (
                <tr key={p.id} className={p.waitingHours >= 24 ? 'row--warning' : undefined}>
                  <td>{p.partName}</td>
                  <td>{TIER[p.tier] ?? p.tier}</td>
                  <td className="num">{formatSoums(p.amountTiyin)}</td>
                  <td className="num">{p.waitingHours} ч</td>
                  <td className="muted">{p.chosenAt === undefined ? '—' : formatDateTime(p.chosenAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="section-title">Ссылки на веб-карточку</div>
      <div className="muted">
        Провайдер сообщает о доставке SMS, а не о том, что человек по ней перешёл. Ноль открытий
        через сутки — повод позвонить, а не ждать
      </div>
      {links.data && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Код</th>
                <th>Клиент</th>
                <th className="num">Открытий</th>
                <th>Последнее открытие</th>
                <th>Действует до</th>
                <th>Состояние</th>
              </tr>
            </thead>
            <tbody>
              {links.data.links.length === 0 && <EmptyRow colSpan={6} />}
              {links.data.links.slice(0, 100).map((l) => (
                <tr
                  key={l.code}
                  className={l.neverOpened && !l.expired && l.revokedAt === undefined ? 'row--warning' : undefined}
                >
                  <td className="mono">{l.code}</td>
                  <td className="mono">{l.clientPhone}</td>
                  <td className="num">{l.opens}</td>
                  <td className="muted">
                    {l.lastOpenedAt === undefined ? 'не открывали' : formatDateTime(l.lastOpenedAt)}
                  </td>
                  <td className="muted">{formatDateTime(l.expiresAt)}</td>
                  <td>
                    {l.revokedAt !== undefined ? (
                      <span className="badge badge--muted">отозвана</span>
                    ) : l.expired ? (
                      <span className="badge badge--muted">истекла</span>
                    ) : (
                      <span className="badge badge--success">действует</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
