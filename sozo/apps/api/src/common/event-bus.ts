import { Injectable } from '@nestjs/common';

/**
 * In-process шина событий — dev-реализация контракта kernel/outbox (DEV-07 §5).
 * С переходом на PostgreSQL заменяется на outbox-таблицу + воркеры BullMQ.
 * Правило зависимостей (DEV-07 §3): billing подписан на события и не импортирует
 * доменные модули; orders публикует и ничего не знает о подписчиках.
 */
@Injectable()
export class EventBus {
  private readonly handlers = new Map<string, Array<(payload: unknown) => void>>();

  subscribe<T>(name: string, fn: (payload: T) => void): void {
    const list = this.handlers.get(name) ?? [];
    list.push(fn as (payload: unknown) => void);
    this.handlers.set(name, list);
  }

  publish<T>(name: string, payload: T): void {
    for (const fn of this.handlers.get(name) ?? []) {
      try {
        fn(payload);
      } catch (e) {
        // обработчик не должен ронять бизнес-операцию (at-least-once + DLQ в проде)
        // eslint-disable-next-line no-console
        console.error(`[EventBus] handler failed for ${name}:`, e);
      }
    }
  }
}

/** Payload события order.closed — контракт для подписчиков (billing) */
export interface OrderClosedEvent {
  orderId: string;
  number: string;
  graphType: string;
  organizationId?: string;
  clientPhone?: string;
  masterId?: string;
  masterName?: string;
  /** Итог клиенту (после скидки) — выручка */
  totalWorkTiyin: number;
  /** База до скидки — от неё доля мастера и баллы (ТЗ 3.7, 17.14) */
  baseWorkTiyin: number;
  paymentChannel: 'online' | 'cash' | 'subscription' | 'invoice';
  /** Материалы по заявке — при `materialsSeparateInvoice` на них свой счёт */
  materialsTiyin?: number;
}
