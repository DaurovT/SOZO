import { Injectable } from '@nestjs/common';
import type { GraphType, OrderStatus } from '@sozo/contracts';
import { StateStore } from '../../common/state-store';

export const ORDER_REPOSITORY = Symbol('ORDER_REPOSITORY');

export interface OrderLineRec {
  priceItemId: string;
  name: string;
  unit: string;
  priceFromTiyin: number;
  priceToTiyin: number;
  qty: number;
}

export interface OrderRecord {
  id: string;
  tenantId: string;
  number: string;
  graphType: GraphType;
  status: OrderStatus;
  version: number;
  urgency: 'normal' | 'urgent' | 'emergency';
  source: 'phone' | 'app' | 'landing';
  clientPhone: string;
  clientName: string;
  address: string;
  lat: number | null; // dev: заглушка геокодера (PRD-05 §12.4); координата точки для B2B
  lng: number | null;
  description: string;
  organizationId?: string;
  locationId?: string;
  masterId?: string;
  masterName?: string;
  /** Парная работа: ведущий + помощник, деньги по ролям (ТЗ 4.5) */
  helperId?: string;
  helperName?: string;
  /** Оценка клиента 1–5, окно 72 ч после закрытия (ТЗ 4.1) */
  rating?: number;
  /** Режимный объект: фотофиксация запрещена, приёмка кодом и подписью (ТЗ 4.1) */
  restrictedSite?: boolean;
  /** M-11 «Я на месте»: отметка прибытия — статус не меняет, но считает SLA выезда */
  arrivedAt?: string;
  /** M-22 пауза: суб-состояние in_progress, статус не меняется (DEV-10 §3) */
  pause?: { reason: string; since: string; until?: string } | null;
  /** M-29 приёмка: код клиента, подпись пальцем или «отсутствовал» + фото (ТЗ 4.1) */
  acceptance?: {
    /** client_app — принял ответственный точки в своём приложении (B2B) */
    method: 'code' | 'signature' | 'absent_with_photo' | 'client_app';
    code?: string;
    signatureDataUrl?: string;
    signerName?: string;
    /** Замечания при приёмке: работа принята, но с оговорками */
    note?: string;
    at: string;
  };
  /**
   * B2B: мастер отправил работу на приёмку ответственному. Пока решения нет,
   * заявка висит в in_progress — завершить её мастер не может (ТЗ 5.2).
   */
  acceptanceRequest?: {
    at: string;
    /** Ждём решения. Отказ снимает флаг — мастер доделывает и отправляет заново */
    pending: boolean;
    representative: { id: string; fullName: string; phone: string } | null;
    /** Ответственного не было на месте — приёмка удалённая */
    absent: boolean;
    /** Отклонения с причиной: заявка осталась в работе */
    rejections?: Array<{ at: string; reason: string; by: string }>;
  } | null;
  /**
   * Код приёмки, который клиент называет мастеру (C-19, C-34).
   * Выдаётся приложением клиента; мастер вводит его у себя, и код сверяется —
   * до появления приложения клиента любые четыре цифры проходили как приёмка.
   */
  acceptanceCode?: string;
  /**
   * C-50: детали доступа, которые клиент уточняет после назначения мастера.
   * В визарде создания их не спрашивают — сначала мастер, потом подробности.
   */
  addressDetails?: {
    apartment?: string;
    entrance?: string;
    floor?: string;
    intercom?: string;
    hasLift?: boolean;
    comment?: string;
    at: string;
  };
  /** Оплата клиентом из приложения (C-20). Наличные фиксирует мастер у себя. */
  payment?: {
    provider: 'payme' | 'click' | 'uzum' | 'card' | 'cash';
    amountTiyin: number;
    status: 'pending' | 'succeeded' | 'failed';
    at: string;
  };
  /** Чаевые мастеру (C-21) — идут мастеру целиком, в расчёт заявки не входят */
  tipTiyin?: number;
  lines: OrderLineRec[];
  /** База до скидок — от неё считается доля мастера (ТЗ 3.7) */
  baseFromTiyin: number;
  baseToTiyin: number;
  /** Итог клиенту после промокода (скидка последней, ТЗ 3.7) */
  totalFromTiyin: number;
  totalToTiyin: number;
  promoCode?: string;
  promoDiscountPercent?: number;
  /** Наценка «Срочно», уже учтённая в totalFrom/To — строкой в расчёте клиента */
  urgentSurchargePercent?: number;
  /**
   * Мастер, которого клиент попросил запомнить после хорошей работы (C-21).
   *
   * Пишется на заявку в момент создания, а не читается из профиля при
   * распределении: предпочтение — факт на дату заказа. Клиент может передумать
   * завтра, но заявку он оформлял с этим ожиданием.
   *
   * Мягкий приоритет: если мастер занят, в другой зоне или без нужного навыка,
   * заявка всё равно уедет — обещания «только этот мастер» платформа не даёт.
   */
  preferredMasterId?: string;
  /**
   * Срок по договору для аварийной заявки (ТЗ 18 п.2).
   *
   * Раньше `slaEmergencyMin` печатался в отчёте и больше нигде не жил:
   * ни диспетчер, ни планировщик о сроке не знали, а нарушение не фиксировалось.
   * Здесь он превращается в конкретный момент времени, который можно проверить.
   */
  slaDueAt?: string;
  /**
   * Сколько раз клиент переносил визит (F-19): не более двух.
   *
   * Считаем на заявке, а не по журналу статусов: перенос не меняет статус,
   * и в журнале его следа нет — он меняет только пожелание по времени.
   */
  rescheduleCount?: number;
  /**
   * Время, которое выбрал клиент при создании (C-10). Бронь в ленте мастера
   * ставит планировщик или диспетчер — до назначения это пожелание, а не факт,
   * и путать их нельзя: клиенту нельзя обещать окно, которое ещё не занято.
   */
  requestedWindow?: {
    mode: 'slot' | 'urgent' | 'waitlist';
    date?: string;
    startMin?: number;
    endMin?: number;
  };
  /** Ответы чек-листа доступа к общим зонам (C-11) — нужны мастеру до выезда */
  commonAreaAccess?: {
    needRiser: boolean;
    needCommonArea: boolean;
    confirmed?: boolean;
    confirmedAt?: string;
  };
  /** D-06 вкладка «Смета»: первичная вилка → подтверждённая → доп-сметы */
  quotes: Array<{
    kind: 'initial' | 'approved' | 'additional_forced' | 'additional_upsell' | 'conservation';
    amountTiyin: number;
    approvedVia?: string; // app | phone_dispatcher | offline_signature
    note?: string;
    at: string;
  }>;
  /** D-06 вкладка «Фото» (ТЗ 4.1, PRD-05 §9): гейты статусов; файл появляется при загрузке */
  photos: Array<{
    id?: string;
    stage: 'before' | 'during' | 'after' | 'receipt';
    source: string;
    file?: string; // имя файла в хранилище; доступ — только по токену
    geoMissing?: boolean;
    at: string;
  }>;
  /** D-06 вкладка «Материалы» (ТЗ 8.4) */
  materials: Array<{
    kind: 'spare_part' | 'consumable';
    name: string;
    amountTiyin: number;
    sourceChannel: 'partner_store' | 'master_own' | 'client_self' | 'company_stock';
    hasReceipt: boolean;
    priceTier?: 'economy' | 'standard' | 'premium';
    at: string;
  }>;
  totalMaterialTiyin: number;
  priceListReleaseId: string; // фиксация релиза (ТЗ 3.7)
  statusLog: Array<{
    from: OrderStatus | null;
    to: OrderStatus;
    action: string;
    actorPhone?: string;
    reason?: string;
    clientOpUuid?: string;
    at: Date;
  }>;
  createdAt: Date;
}

export interface OrderRepository {
  create(order: OrderRecord): Promise<OrderRecord>;
  findById(tenantId: string, id: string): Promise<OrderRecord | undefined>;
  list(tenantId: string): Promise<OrderRecord[]>;
  applyTransition(
    tenantId: string,
    id: string,
    expectedVersion: number,
    entry: { from: OrderStatus | null; to: OrderStatus; action: string; actorPhone?: string; reason?: string; clientOpUuid?: string },
    patch?: Partial<Pick<OrderRecord, 'masterId' | 'masterName'>>,
  ): Promise<OrderRecord | 'version_conflict' | 'duplicate'>;
  /** Сохранить состояние после мутации вложенных коллекций заявки */
  touch(): void;
}

@Injectable()
export class InMemoryOrderRepository implements OrderRepository {
  private readonly orders = new Map<string, OrderRecord>();

  constructor(private readonly store: StateStore) {
    this.store.register(
      'orders',
      () => [...this.orders.values()],
      (data) => {
        this.orders.clear();
        for (const raw of data as OrderRecord[]) {
          // даты в JSON — строки, возвращаем в Date (журнал переходов и createdAt)
          const order: OrderRecord = {
            ...raw,
            createdAt: new Date(raw.createdAt),
            statusLog: raw.statusLog.map((l) => ({ ...l, at: new Date(l.at) })),
          };
          this.orders.set(order.id, order);
        }
      },
    );
  }

  async create(order: OrderRecord): Promise<OrderRecord> {
    this.orders.set(order.id, order);
    this.store.persist();
    return order;
  }

  async findById(tenantId: string, id: string): Promise<OrderRecord | undefined> {
    const o = this.orders.get(id);
    return o && o.tenantId === tenantId ? o : undefined;
  }

  async list(tenantId: string): Promise<OrderRecord[]> {
    return [...this.orders.values()]
      .filter((o) => o.tenantId === tenantId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async applyTransition(
    tenantId: string,
    id: string,
    expectedVersion: number,
    entry: { from: OrderStatus | null; to: OrderStatus; action: string; actorPhone?: string; reason?: string; clientOpUuid?: string },
    patch?: Partial<Pick<OrderRecord, 'masterId' | 'masterName'>>,
  ): Promise<OrderRecord | 'version_conflict' | 'duplicate'> {
    const order = await this.findById(tenantId, id);
    if (!order) return 'version_conflict';
    if (
      entry.clientOpUuid &&
      order.statusLog.some((l) => l.from === entry.from && l.to === entry.to && l.clientOpUuid === entry.clientOpUuid)
    ) {
      return 'duplicate'; // идемпотентность (DEV-10 §3.5)
    }
    if (order.version !== expectedVersion) return 'version_conflict';
    order.status = entry.to;
    order.version += 1;
    if (patch) Object.assign(order, patch);
    order.statusLog.push({ ...entry, at: new Date() });
    this.store.persist();
    return order;
  }

  /** Мутации вкладок карточки (сметы, фото, материалы, переназначение) — сохраняем явно */
  touch(): void {
    this.store.persist();
  }
}
