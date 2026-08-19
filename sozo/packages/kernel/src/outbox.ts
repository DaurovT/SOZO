/**
 * EventBus — контракт внутренней шины (DEV-07 §5): outbox-таблица в PostgreSQL + воркеры BullMQ.
 * Kafka не используем. Запись события — в ТОЙ ЖЕ транзакции, что и бизнес-операция (DEV-07 §4.А, §4.В).
 * Каждый обработчик идемпотентен по event_id, ретраится с backoff, после N падений — DLQ + алерт.
 */

export interface DomainEvent<T = unknown> {
  id: string; // uuid v7
  tenantId: string;
  name: string; // `domain.event_name` — каталог DEV-03 x-events
  payload: T;
  createdAt: Date;
}

export interface EventPublisher {
  /** Вызывается внутри открытой транзакции бизнес-операции */
  publish(event: Omit<DomainEvent, 'id' | 'createdAt'>): Promise<void>;
}

export interface EventHandler<T = unknown> {
  eventName: string;
  handle(event: DomainEvent<T>): Promise<void>; // идемпотентно по event.id
}

/** Каталог имён событий статусной машины (PRD-05 §1.5) */
export const ORDER_EVENTS = {
  created: 'order.created',
  statusChanged: 'order.status_changed',
  addworkRequested: 'order.addwork_requested',
  replacementRequired: 'order.replacement_required',
  closed: 'order.closed',
} as const;
