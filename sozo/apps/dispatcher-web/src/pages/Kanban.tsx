import { useState } from 'react';
import { GraphTypeBadge } from '../components/Badges';
import { OrderModal } from '../components/OrderModal';
import { ErrorBanner, Loading } from '../components/States';
import { KANBAN_STATUSES } from '../dicts';
import { formatSoums } from '../format';
import { useKanban } from '../useKanban';
import type { Order } from '../types';

function OrderCard({ order, onClick }: { order: Order; onClick: () => void }) {
  const emergency = order.urgency === 'emergency' || order.graphType === 'emergency';
  return (
    // Drag между колонками запрещён (PRD-03) — карточка открывается только кликом.
    <button
      type="button"
      className={emergency ? 'order-card order-card--emergency' : 'order-card'}
      onClick={onClick}
    >
      <div className="order-card__top">
        <span className="order-card__number">{order.number}</span>
        <GraphTypeBadge graphType={order.graphType} />
      </div>
      <div className="order-card__client">{order.clientName || order.clientPhone}</div>
      <div className="order-card__address">{order.address}</div>
      <div className="order-card__bottom">
        <span className="order-card__sum">
          {formatSoums(order.totalFromTiyin)} — {formatSoums(order.totalToTiyin)}
        </span>
      </div>
      {order.masterName && <div className="order-card__master">Мастер: {order.masterName}</div>}
      {slaLabel(order) !== null && (
        <div className="order-card__master">
          <span className={slaOverdue(order) ? 'badge badge--error' : 'badge badge--warning'}>
            {slaLabel(order)}
          </span>
        </div>
      )}
    </button>
  );
}

/** Срок выезда по договору просрочен — заявка уже стоит дороже, чем кажется */
function slaOverdue(order: Order): boolean {
  return order.slaDueAt !== undefined && new Date(order.slaDueAt).getTime() < Date.now();
}

/**
 * Подпись срока по договору. Показываем только пока заявка не в работе:
 * после выезда мастера срок либо соблюдён, либо уже нарушен — и то и другое
 * разбирают не на доске.
 */
function slaLabel(order: Order): string | null {
  if (order.slaDueAt === undefined) return null;
  if (['in_progress', 'completed', 'verified', 'closed', 'rated', 'cancelled'].includes(order.status)) return null;
  const left = Math.round((new Date(order.slaDueAt).getTime() - Date.now()) / 60_000);
  return left < 0 ? `SLA просрочен на ${-left} мин` : `Выезд по договору: ${left} мин`;
}

export function KanbanPage() {
  const { data, loading, error, reload } = useKanban(10000);
  const [openId, setOpenId] = useState<string | null>(null);

  if (loading) return <Loading />;
  if (error !== null && !data) return <ErrorBanner message={error} />;
  if (!data) return null;

  const byStatus = new Map(data.columns.map((c) => [c.status, c.orders]));

  return (
    <>
      <div className="page-header">
        <h1>Kanban-доска</h1>
        <span className="muted">Автообновление каждые 10 секунд · перенос карточек запрещён</span>
      </div>
      {error !== null && <ErrorBanner message={error} />}
      <div className="kanban">
        {KANBAN_STATUSES.map(({ status, label }) => {
          const orders = byStatus.get(status) ?? [];
          return (
            <div className="kanban__column" key={status}>
              <div className="kanban__column-header">
                <span>{label}</span>
                <span className="kanban__count">{orders.length}</span>
              </div>
              <div className="kanban__cards">
                {orders.length === 0 && <div className="kanban__empty">Пусто</div>}
                {orders.map((order) => (
                  <OrderCard key={order.id} order={order} onClick={() => setOpenId(order.id)} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {openId !== null && (
        <OrderModal orderId={openId} onClose={() => setOpenId(null)} onChanged={reload} />
      )}
    </>
  );
}
