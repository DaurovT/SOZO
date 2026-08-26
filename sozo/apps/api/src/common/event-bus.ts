import { Injectable } from '@nestjs/common';
import { uuidv7 } from '@sozo/kernel';
import { StateStore } from './state-store';

/**
 * Шина событий с журналом доставки (outbox) — реализация контракта
 * kernel/outbox (DEV-07 §5).
 *
 * До этого шина была списком колбэков: публикация звала подписчиков в том же
 * тике, исключение обработчика уходило в console.error и на этом история
 * заканчивалась. Стоило биллингу отказать — закрытый период, недоступная
 * база, — и проводок по заявке не появлялось никогда: заявка закрыта, событие
 * потеряно, повторить нечем. Ровно так теряются выручка, доля мастера и
 * отчисление в резервный фонд, причём молча.
 *
 * Теперь событие сначала попадает в журнал (он переживает рестарт вместе с
 * остальным состоянием), и только потом раздаётся подписчикам. Доставка
 * считается по паре «событие × подписчик»: успешно отработавший обработчик
 * помечается, и повтор его не трогает — отсюда идемпотентность, которой
 * требует контракт. Упавший обработчик повторяется с нарастающей паузой; на
 * исчерпании попыток запись уходит в DLQ и остаётся видимой, а не исчезает.
 *
 * Это по-прежнему не BullMQ: очередь живёт в процессе, а её долговечность
 * равна долговечности снимка состояния. Но три свойства контракта —
 * «переживает рестарт», «повторяется», «не теряется молча» — выполняются.
 */

/** Сколько раз пробуем доставить событие подписчику, прежде чем признать мёртвым */
const MAX_ATTEMPTS = 8;
/** Пауза перед повтором: 2 с, 4, 8, 16 … но не больше пяти минут */
const BACKOFF_BASE_MS = 2_000;
const BACKOFF_CAP_MS = 5 * 60_000;
/** Как часто воркер осматривает журнал */
const TICK_MS = Number(process.env.OUTBOX_TICK_MS ?? 2_000);
/** Сколько доставленных записей держим в журнале — для разбора инцидентов */
const KEEP_DONE = 500;

interface Delivery {
  /** Стабильный идентификатор подписчика: по нему считается «уже доставлено» */
  handlerId: string;
  /** Повторять ли доставку. Копия настройки подписки — она нужна и после рестарта */
  retry?: boolean;
  status: 'pending' | 'done' | 'dead';
  attempts: number;
  nextAttemptAt: number;
  lastError?: string;
}

interface OutboxRecord {
  /** Идентификатор события — ключ идемпотентности контракта kernel/outbox */
  eventId: string;
  name: string;
  payload: unknown;
  createdAt: string;
  deliveries: Delivery[];
}

/**
 * Обработчик события.
 *
 * Вторым аргументом приходит `eventId` — и это не декорация. Повтор доставки
 * означает повторное выполнение обработчика, а «идемпотентный обработчик» без
 * ключа события физически невозможен: ему не с чем сравнивать. Биллинг берёт
 * этот идентификатор как `operationId` проводки, и повтор перестаёт создавать
 * вторую операцию.
 */
type Handler = (payload: unknown, eventId: string) => unknown;

/**
 * Настройки подписки.
 *
 * `retry` по умолчанию выключен, и это не осторожность, а следствие того, что
 * повторная доставка означает повторное выполнение обработчика. Для проводки
 * это спасение: без неё выручки просто не будет. Для уведомления — вред:
 * человек получит второе сообщение о том же, а «доставлено» в журнале станет
 * двумя строками.
 *
 * Включать повтор можно ТОЛЬКО тому, кто действительно идемпотентен, — а
 * идемпотентным обработчик становится не по намерению, а по ключу: он обязан
 * использовать `eventId` как идентификатор своей операции. Биллинг так и
 * делает: `operationId` проводки равен `eventId` события, и `post()`
 * отказывается писать операцию, которая уже есть. Без этого восемь попыток
 * доставки означали бы восемь начислений выручки — каждое со своим случайным
 * `operationId`, то есть даже не похожее на дубль.
 */
export interface SubscribeOptions {
  retry?: boolean;
}

@Injectable()
export class EventBus {
  private readonly handlers = new Map<string, Array<{ id: string; fn: Handler; retry: boolean }>>();
  /** Синхронные справки подписчиков: «можешь ли ты сейчас провести?» */
  private readonly probes = new Map<string, Array<(payload: unknown) => unknown>>();
  private readonly outbox: OutboxRecord[] = [];
  /**
   * Доставки, которые прямо сейчас в полёте.
   *
   * Без этого асинхронный обработчик успевал попасть под воркер повторов:
   * запись ещё `pending`, потому что `await` не вернулся, — и то же событие
   * уходило подписчику второй раз. Наружу это выглядело как заявка,
   * созданная дважды из одного замечания.
   */
  private readonly inFlight = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private store: StateStore | null = null;

  constructor(store?: StateStore) {
    if (store) this.attach(store);
  }

  /**
   * Журнал попадает в общий снимок состояния.
   *
   * Отдельным разделом, а не внутри billing: событие принадлежит шине, и
   * ровно потому оно переживает падение любого отдельного подписчика.
   */
  attach(store: StateStore): void {
    this.store = store;
    store.register(
      'event_outbox',
      () => this.outbox,
      (data) => {
        this.outbox.length = 0;
        for (const r of (data as OutboxRecord[]) ?? []) this.outbox.push(r);
      },
    );
  }

  /**
   * Подписка. `handlerId` — стабильное имя подписчика в журнале доставки:
   * по нему после рестарта видно, что именно не доехало. Без него берётся
   * позиция регистрации, и это работает ровно до перестановки подписок
   * местами — поэтому у всего, что двигает деньги, имя задано явно.
   */
  subscribe<T>(name: string, fn: (payload: T, eventId: string) => unknown, handlerId?: string, opts: SubscribeOptions = {}): void {
    const list = this.handlers.get(name) ?? [];
    const id = handlerId ?? `${name}#${list.length}`;
    if (list.some((h) => h.id === id)) {
      throw new Error(`[EventBus] подписчик ${id} уже зарегистрирован`);
    }
    list.push({ id, fn: fn as Handler, retry: opts.retry === true });
    this.handlers.set(name, list);
    this.startWorker();
  }

  /**
   * Справка у подписчика без смены зависимостей.
   *
   * Нужна там, где публикующий обязан узнать ответ ДО того, как совершит
   * действие: заявка не имеет права закрыться, если биллинг сейчас провести
   * не сможет — иначе закрытие пройдёт, а проводок не будет. Импортировать
   * биллинг в заявки нельзя (DEV-07 §3), спрашивать через событие — можно.
   */
  registerProbe<T, R>(name: string, fn: (payload: T) => R): void {
    const list = this.probes.get(name) ?? [];
    list.push(fn as (payload: unknown) => unknown);
    this.probes.set(name, list);
  }

  probe<T, R>(name: string, payload: T): R[] {
    const out: R[] = [];
    for (const fn of this.probes.get(name) ?? []) out.push(fn(payload) as R);
    return out;
  }

  /**
   * Опубликовать событие.
   *
   * Запись в журнал делается до раздачи: если процесс погибнет между записью
   * статуса заявки и доставкой, событие останется и уедет после старта.
   * `eventId` можно задать снаружи — тогда повторная публикация того же
   * факта (повтор запроса, повтор перехода) не создаст второй доставки.
   */
  publish<T>(name: string, payload: T, eventId?: string): void {
    const rec = this.enqueue(name, payload, eventId);
    if (rec) void this.deliver(rec);
  }

  /**
   * То же, но с ожиданием асинхронных обработчиков.
   *
   * Нужно там, где ответ клиенту описывает результат работы подписчика:
   * аварийное замечание становится заявкой, и HTTP-ответ обязан вернуть уже
   * связанное замечание, а не то, что свяжется через миг.
   */
  async publishAndWait<T>(name: string, payload: T, eventId?: string): Promise<void> {
    const rec = this.enqueue(name, payload, eventId);
    if (rec) await this.deliver(rec);
  }

  private enqueue(name: string, payload: unknown, eventId?: string): OutboxRecord | null {
    if (eventId && this.outbox.some((r) => r.eventId === eventId)) return null; // дедупликация по event_id
    const subs = this.handlers.get(name) ?? [];
    const rec: OutboxRecord = {
      eventId: eventId ?? uuidv7(),
      name,
      payload,
      createdAt: new Date().toISOString(),
      deliveries: subs.map((h) => ({ handlerId: h.id, status: 'pending' as const, attempts: 0, nextAttemptAt: 0, retry: h.retry })),
    };
    this.outbox.push(rec);
    this.persist();
    return rec;
  }

  /** Раздать событие тем подписчикам, чья доставка ещё висит */
  private async deliver(rec: OutboxRecord): Promise<void> {
    const subs = this.handlers.get(rec.name) ?? [];
    for (const d of rec.deliveries) {
      if (d.status !== 'pending' || d.nextAttemptAt > Date.now()) continue;
      const h = subs.find((s) => s.id === d.handlerId);
      if (!h) continue; // подписчика больше нет в сборке — доставлять некому
      const key = `${rec.eventId}#${d.handlerId}`;
      if (this.inFlight.has(key)) continue; // уже доставляется — второй раз не зовём
      this.inFlight.add(key);
      d.attempts += 1;
      try {
        const res = h.fn(rec.payload, rec.eventId);
        if (res && typeof (res as Promise<unknown>).then === 'function') await res;
        d.status = 'done';
        d.lastError = undefined;
      } catch (e) {
        this.fail(rec, d, e);
      } finally {
        this.inFlight.delete(key);
      }
    }
    this.sweep();
    this.persist();
  }

  private fail(rec: OutboxRecord, d: Delivery, e: unknown): void {
    d.lastError = e instanceof Error ? e.message : String(e);
    /**
     * Подписчик без повторов: одна попытка и в DLQ.
     *
     * Смысл журнала для него не в том, чтобы доставить любой ценой, а в том,
     * чтобы падение перестало быть невидимым: раньше исключение уходило в
     * console.error и на этом история заканчивалась. Теперь оно лежит в
     * `pending()` с текстом ошибки — его видно в админке и в прогоне.
     */
    if (!d.retry || d.attempts >= MAX_ATTEMPTS) {
      d.status = 'dead';
      // eslint-disable-next-line no-console
      console.error(`[EventBus] DLQ: ${rec.name} → ${d.handlerId} после ${d.attempts} попыток: ${d.lastError}`);
      return;
    }
    d.nextAttemptAt = Date.now() + Math.min(BACKOFF_BASE_MS * 2 ** (d.attempts - 1), BACKOFF_CAP_MS);
    // eslint-disable-next-line no-console
    console.error(`[EventBus] ${rec.name} → ${d.handlerId} попытка ${d.attempts} не удалась: ${d.lastError}`);
  }

  /** Воркер повторов: один на процесс, таймер не держит event loop */
  private startWorker(): void {
    if (this.timer || TICK_MS <= 0) return;
    this.timer = setInterval(() => {
      void this.drain();
    }, TICK_MS);
    this.timer.unref?.();
  }

  /** Повторить всё, чей срок подошёл. Публично — прогону e2e нужен явный шаг */
  async drain(): Promise<void> {
    const now = Date.now();
    const due = this.outbox.filter((r) =>
      r.deliveries.some((d) => d.status === 'pending' && d.nextAttemptAt <= now),
    );
    for (const rec of due) await this.deliver(rec);
  }

  /**
   * Переиграть событие вручную: переоткрыли период — проводки должны
   * появиться, а не ждать следующего закрытия заявки, которого не будет.
   */
  async replay(filter?: { name?: string; onlyDead?: boolean }): Promise<number> {
    let n = 0;
    for (const rec of this.outbox) {
      if (filter?.name && rec.name !== filter.name) continue;
      for (const d of rec.deliveries) {
        if (d.status === 'done') continue;
        if (filter?.onlyDead && d.status !== 'dead') continue;
        d.status = 'pending';
        d.attempts = 0;
        d.nextAttemptAt = 0;
        n += 1;
      }
    }
    await this.drain();
    return n;
  }

  /** Что не доехало — для админки и для прогона e2e */
  pending(): Array<{ eventId: string; name: string; handlerId: string; attempts: number; status: string; lastError?: string; createdAt: string }> {
    const out = [];
    for (const r of this.outbox) {
      for (const d of r.deliveries) {
        if (d.status === 'done') continue;
        out.push({ eventId: r.eventId, name: r.name, handlerId: d.handlerId, attempts: d.attempts, status: d.status, lastError: d.lastError, createdAt: r.createdAt });
      }
    }
    return out;
  }

  /**
   * Подрезка журнала: полностью доставленные записи держим последние KEEP_DONE.
   * Незавершённые не трогаем никогда — иначе потеря вернётся тем же способом,
   * ради устранения которого журнал и заводился.
   */
  private sweep(): void {
    const done: number[] = [];
    for (let i = 0; i < this.outbox.length; i++) {
      if (this.outbox[i].deliveries.every((d) => d.status === 'done')) done.push(i);
    }
    const excess = done.length - KEEP_DONE;
    if (excess <= 0) return;
    const drop = new Set(done.slice(0, excess));
    const kept = this.outbox.filter((_, i) => !drop.has(i));
    this.outbox.length = 0;
    this.outbox.push(...kept);
  }

  private persist(): void {
    this.store?.persist();
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
  /**
   * Ставка доли мастера в промилле на момент закрытия.
   *
   * Едет в событии, а не берётся биллингом из прайса: биллинг не импортирует
   * доменные модули (DEV-07 §3), а ставка зависит от двух вещей сразу —
   * коэффициента релиза и грейда мастера.
   */
  masterSharePermille?: number;
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

/**
 * Payload события order.cancelled — деньги по матрице отмены (ТЗ 4.4).
 *
 * До этого события не существовало вовсе: матрица жила только в
 * предпросмотре, её результат уходил в лог, и отменённая заявка не
 * порождала ни одной проводки. Каждый ложный вызов был бесплатным.
 */
export interface OrderCancelledEvent {
  orderId: string;
  number: string;
  graphType: string;
  organizationId?: string;
  clientPhone?: string;
  masterId?: string;
  masterName?: string;
  /** Статус, из которого отменили: от него зависит вся матрица */
  fromStatus: string;
  reason?: string;
  /** Сколько выставляем клиенту (стоимость выезда и выполненная часть) */
  clientPaysTiyin: number;
  /** Сколько компенсируем мастеру за ложный вызов */
  masterCompTiyin: number;
  note: string;
}

/**
 * Payload события order.status_changed — контракт для подписчика в notifications.
 *
 * Публикуется на каждый переход статусной машины, а не только на интересные:
 * что интересно, решает подписчик по матрице (PRD-01 §5), и решать это в
 * заявке значило бы держать в ней список из сорока событий доставки.
 *
 * Всё, что нужно для текста уведомления, едет в событии — имя мастера, окно,
 * адрес, сумма. Иначе доставка полезла бы читать заявку, а с ней и всё, что
 * к заявке привязано, и правило зависимостей (DEV-07 §3) не пережило бы
 * первого же уведомления про смету.
 */
export interface OrderStatusChangedEvent {
  orderId: string;
  number: string;
  graphType: string;
  /** Действие перехода: assign, depart, complete — по нему выбирается текст */
  action: string;
  from: string;
  to: string;
  clientPhone: string;
  clientName: string;
  address: string;
  masterId?: string;
  masterName?: string;
  organizationId?: string;
  locationId?: string;
  urgency: 'normal' | 'urgent' | 'emergency';
  /** Причина паузы или отмены — из неё человек понимает, что происходит */
  reason?: string;
  /** Окно, которое выбрал клиент: «сегодня 14:00–16:00» в тексте уведомления */
  window?: { date?: string; startMin?: number; endMin?: number };
  /** Сумма к подтверждению или к оплате, тийины */
  amountTiyin?: number;
  /**
   * Кому в организации уходит запрос на утверждение (B2B, ТЗ §5.2).
   *
   * Считается в заявке и едет готовым списком по той же причине, что и
   * ставка сбора в order.closed: доставка не должна знать про представителей
   * точки и пороги договора. Пусто для B2C — там решает сам клиент.
   */
  approvers?: Array<{ phone: string; name: string }>;
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
