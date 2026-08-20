import { Injectable } from '@nestjs/common';

/**
 * In-process шина событий — dev-реализация контракта kernel/outbox (DEV-07 §5).
 * С переходом на PostgreSQL заменяется на outbox-таблицу + воркеры BullMQ.
 * Правило зависимостей (DEV-07 §3): billing подписан на события и не импортирует
 * доменные модули; orders публикует и ничего не знает о подписчиках.
 */
@Injectable()
export class EventBus {
  private readonly handlers = new Map<string, Array<(payload: unknown) => unknown>>();

  subscribe<T>(name: string, fn: (payload: T) => unknown): void {
    const list = this.handlers.get(name) ?? [];
    list.push(fn as (payload: unknown) => unknown);
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

  /**
   * То же, но с ожиданием асинхронных обработчиков.
   *
   * Нужно там, где ответ клиенту описывает результат работы подписчика:
   * аварийное замечание становится заявкой, и HTTP-ответ обязан вернуть уже
   * связанное замечание, а не то, что свяжется через миг. На файловом
   * хранилище разница была невидимой — подписчик успевал в том же тике; с
   * PostgreSQL каждый его шаг ходит в базу, и ответ обгонял маршрутизацию.
   *
   * Публикуется ПОСЛЕ сохранения самой сущности, поэтому сбой подписчика
   * по-прежнему не может её потерять — ошибки так же гасятся.
   */
  async publishAndWait<T>(name: string, payload: T): Promise<void> {
    for (const fn of this.handlers.get(name) ?? []) {
      try {
        await fn(payload);
      } catch (e) {
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
  // ---- контур «Дом» (M7, DEV-15 §8.2): всё нужное для сбора приходит В СОБЫТИИ,
  // чтобы billing не импортировал buildings (правило DEV-07 §3 п.2) ----
  buildingId?: string;
  operatorOrgId?: string;
  orderScope?: 'private' | 'common_area';
  laborSettlement?: 'salary' | 'share';
  /** ставка сервисного сбора объекта в базисных пунктах */
  serviceFeeBps?: number;
}

/** Payload события observation.created — контракт для подписчика в orders */
export interface ObservationCreatedEvent {
  observationId: string;
  buildingId: string;
  severity: 'emergency' | 'work_required' | 'housekeeping' | 'info';
  source: 'walkthrough' | 'resident' | 'master' | 'complaint';
  categoryId: string;
  /** зона или место — идёт в адрес заявки, чтобы бригада знала, куда ехать */
  zoneKey: string;
  authorPhone: string;
  comment: string | null;
}
