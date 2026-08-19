import { useNavigate } from 'react-router-dom';
import { ErrorBanner, Loading } from '../components/States';
import { useKanban } from '../useKanban';
import type { KanbanData, Order } from '../types';

const IN_WORK_STATUSES = new Set(['assigned', 'master_departed', 'in_progress', 'addwork_approval']);

function byStatuses(data: KanbanData, statuses: Set<string>): Order[] {
  return data.columns.filter((c) => statuses.has(c.status)).flatMap((c) => c.orders);
}

function oldestAgeMinutes(orders: Order[]): number | null {
  if (orders.length === 0) return null;
  const oldest = Math.min(...orders.map((o) => new Date(o.createdAt).getTime()));
  return Math.max(0, Math.round((Date.now() - oldest) / 60000));
}

function isClosedToday(order: Order): boolean {
  const entry = (order.statusLog ?? []).find((e) => e.to === 'closed');
  const at = entry?.at ?? order.createdAt;
  return order.status === 'closed' && new Date(at).toDateString() === new Date().toDateString();
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { data, loading, error } = useKanban(10000);

  if (loading) return <Loading />;
  if (error !== null && !data) return <ErrorBanner message={error} />;
  if (!data) return null;

  const unassigned = byStatuses(data, new Set(['new', 'estimated']));
  const age = oldestAgeMinutes(unassigned);
  const inWork = byStatuses(data, IN_WORK_STATUSES);
  const onCheck = byStatuses(data, new Set(['completed']));
  const awaitingPayment = byStatuses(data, new Set(['awaiting_payment']));
  const emergencies = data.columns.flatMap((c) => c.orders).filter((o) => o.urgency === 'emergency');
  const closedToday = data.archive.filter(isClosedToday);

  const tiles: { value: number; label: string; hint: string; alert?: boolean }[] = [
    {
      value: unassigned.length,
      label: 'Новые неназначенные',
      hint: age !== null ? `старейшая ждёт ${age} мин` : 'очередь пуста',
    },
    {
      value: inWork.length,
      label: 'В работе',
      hint: 'от назначения до доп-согласования',
    },
    {
      value: onCheck.length,
      label: 'На проверке',
      hint: 'выполнены, ждут проверки',
    },
    {
      value: awaitingPayment.length,
      label: 'Ожидают оплаты',
      hint: 'отпущены без оплаты',
    },
    {
      value: emergencies.length,
      label: 'Аварийные активные',
      hint: emergencies.length > 0 ? 'требуют немедленной реакции' : 'аварий нет',
      alert: true,
    },
    {
      value: closedToday.length,
      label: 'Закрыто сегодня',
      hint: 'успешно завершённые заявки',
    },
  ];

  return (
    <>
      <div className="page-header">
        <h1>Дашборд</h1>
        <button type="button" className="btn btn--primary" onClick={() => navigate('/orders/new')}>
          Новая заявка
        </button>
      </div>
      {error !== null && <ErrorBanner message={error} />}
      <div className="tiles">
        {tiles.map((t) => (
          <button
            type="button"
            key={t.label}
            className={
              t.alert && t.value > 0 ? 'card tile--clickable tile--alert' : 'card tile--clickable'
            }
            onClick={() => navigate('/kanban')}
          >
            <div className="tile__value">{t.value}</div>
            <div className="tile__label">{t.label}</div>
            <div className="tile__hint">{t.hint}</div>
          </button>
        ))}
      </div>
      <div className="muted">Данные обновляются автоматически каждые 10 секунд. Клик по плитке открывает Kanban-доску.</div>
    </>
  );
}
