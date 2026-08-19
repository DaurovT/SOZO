import { ConflictException, Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import type { GraphType, TransitionRequest } from '@sozo/contracts';
import { createOrderStateMachine, emptyContext, uuidv7, type TransitionContext } from '@sozo/kernel';
import { ORDER_REPOSITORY, type OrderRecord, type OrderRepository } from './order.repository';
import { PricingService } from '../pricing/pricing.service';
import { EventBus, type OrderClosedEvent } from '../../common/event-bus';
import { CrmService } from '../crm/crm.service';
import { PromoService } from '../promo/promo.module';
import { ParametersService } from '../platform/parameters.service';

export interface CreateOrderDto {
  clientPhone: string;
  clientName?: string;
  address: string;
  lat?: number;
  lng?: number;
  description?: string;
  urgency?: 'normal' | 'urgent' | 'emergency';
  source?: 'phone' | 'app' | 'landing';
  organizationId?: string;
  locationId?: string;
  promoCode?: string;
  items?: Array<{ priceItemId: string; qty?: number }>;
  /** Заявка из подписанной позиции акта осмотра — граф from_defect (DEV-10 §4.6) */
  fromDefect?: { actId: string; itemId: string };
  /** Плановый обход точки: чек-лист и акт вместо фото-цикла — граф inspection (ТЗ 9.3) */
  inspection?: boolean;
  /** Выбранное клиентом время (C-10): пожелание до брони в ленте мастера */
  requestedWindow?: OrderRecord['requestedWindow'];
  /** Чек-лист доступа к общим зонам (C-11) */
  commonAreaAccess?: OrderRecord['commonAreaAccess'];
  /** Детали доступа, если клиент указал их сразу (сохранённый адрес, C-29) */
  addressDetails?: OrderRecord['addressDetails'];
  /** Мастер, которого клиент попросил запомнить (C-21) — мягкий приоритет */
  preferredMasterId?: string;
}

/** Заглушка геокодера (PRD-05 §12.4): детерминированная точка в пределах Ташкента по хешу адреса */
function geocodeStub(address: string): { lat: number; lng: number } {
  let h = 0;
  for (const ch of address) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return {
    lat: 41.311 + ((h % 1000) / 1000 - 0.5) * 0.12,
    lng: 69.279 + (((h >> 10) % 1000) / 1000 - 0.5) * 0.16,
  };
}

/**
 * Публичный сервис переходов — единственная точка смены статуса (DEV-10, PRD-05 §1).
 * Недопустимый переход → 409 с машиночитаемым телом.
 */
@Injectable()
export class OrdersService {
  private readonly sm = createOrderStateMachine();
  private seq = 0;
  /** Блок-лист B2C: долг блокирует новые заявки, кроме аварийных (ТЗ 4.4) */
  private readonly blockedClients = new Map<string, { reason: string; at: string }>();

  constructor(
    @Inject(ORDER_REPOSITORY) private readonly repo: OrderRepository,
    private readonly pricing: PricingService,
    private readonly bus: EventBus,
    private readonly promo: PromoService,
    private readonly params: ParametersService,
    private readonly crm: CrmService,
  ) {}

  /**
   * Коэффициент срочности из параметра 5 («+30%»). Значение редактируется
   * админом как текст, поэтому число из него достаём разбором, а не парсингом
   * фиксированного формата; не разобрали — наценки нет (безопасно для клиента).
   */
  private urgentSurchargePercent(): number {
    const raw = this.params.list().find((p) => p.num === 5)?.value ?? '';
    const m = /(\d+)\s*%/.exec(raw);
    return m ? Number(m[1]) : 0;
  }

  /**
   * По какому релизу прайса считать заявку.
   *
   * Обычно — по действующему. Но годовой договор обещает замороженные цены,
   * и это обещание должно исполняться само: организация не обязана следить,
   * не вышел ли новый релиз. Замораживаем на первой заявке — раньше просто
   * нечего было замораживать, а к моменту подписания релиз уже известен.
   */
  private releaseFor(dto: CreateOrderDto) {
    const active = this.pricing.active();
    if (!dto.organizationId) return active;
    const org = this.crm.get(dto.organizationId);
    if (org.contractKind !== 'annual') return active;

    if (!org.priceReleaseIdFrozen) {
      org.priceReleaseIdFrozen = active.id;
      this.crm.touch();
      return active;
    }
    try {
      return this.pricing.get(org.priceReleaseIdFrozen);
    } catch {
      // Замороженный релиз удалили — считаем по действующему, но молча
      // подменять цены нельзя, поэтому возвращаем ссылку на актуальный
      return active;
    }
  }

  private graphTypeFor(dto: CreateOrderDto): GraphType {
    if (dto.urgency === 'emergency') return 'emergency'; // аварийная минует оценку (ТЗ 4.3)
    // Позиция акта уже подписана ответственным — заявка стартует сразу «Утверждена»
    if (dto.fromDefect) return 'from_defect';
    // Обход помещения: приоритет 8, завершается актом, а не оплатой
    if (dto.inspection) return 'inspection';
    return dto.locationId || dto.organizationId ? 'b2b' : 'b2c';
  }

  async create(tenantId: string, dto: CreateOrderDto, actorPhone?: string): Promise<OrderRecord> {
    if (!dto.clientPhone?.match(/^\+998\d{9}$/)) {
      throw new BadRequestException({ code: 'PHONE_INVALID', message: 'Телефон клиента: +998XXXXXXXXX' });
    }
    const graphType = this.graphTypeFor(dto);
    const block = this.blockedClients.get(dto.clientPhone);
    if (block && graphType !== 'emergency') {
      throw new BadRequestException({
        code: 'CLIENT_BLOCKED',
        message: `Клиент заблокирован (${block.reason}) — новые заявки недоступны, кроме аварийных (ТЗ 4.4)`,
      });
    }
    const res = this.sm.validate(graphType, 'create', emptyContext({ defectEstimateFresh: true }));
    if (!res.ok) throw new ConflictException(res.violation);

    // Фиксация релиза прайса на момент создания + копии цен (ТЗ 3.7)
    const release = this.releaseFor(dto);
    const lines = (dto.items ?? []).map((it) => {
      const item = release.items.find((p) => p.id === it.priceItemId);
      if (!item) throw new BadRequestException({ code: 'PRICE_ITEM_NOT_FOUND', priceItemId: it.priceItemId });
      const qty = it.qty && it.qty > 0 ? it.qty : 1;
      return {
        priceItemId: item.id,
        name: item.name,
        unit: item.unit,
        priceFromTiyin: item.priceFromTiyin * qty,
        priceToTiyin: item.priceToTiyin * qty,
        qty,
      };
    });
    const baseFrom = lines.reduce((s, l) => s + l.priceFromTiyin, 0);
    const baseTo = lines.reduce((s, l) => s + l.priceToTiyin, 0);
    // Наценка «Срочно» — к работам, не к материалам (ТЗ 3.7, параметр 5).
    // Ложится только на итог клиенту: база остаётся прежней, иначе наценка
    // молча увеличила бы и долю мастера, а это отдельное решение владельца.
    const urgentPercent = dto.urgency === 'urgent' ? this.urgentSurchargePercent() : 0;
    const withUrgency = (v: number) => v + Math.floor((v * urgentPercent) / 100);
    // Промокод: скидка последней к итогу работ; долю мастера не трогает (ТЗ 3.7, решение №13)
    let discount = 0;
    if (dto.promoCode) discount = this.promo.redeem(dto.promoCode);
    const applyDiscount = (v: number) => Math.floor((withUrgency(v) * (100 - discount)) / 100);
    const geo = dto.lat != null && dto.lng != null ? { lat: dto.lat, lng: dto.lng } : geocodeStub(dto.address ?? dto.clientPhone);

    const now = new Date();
    // Счётчик номеров восстанавливается из существующих заявок (переживает рестарт)
    if (this.seq === 0) {
      const existing = await this.repo.list(tenantId);
      this.seq = existing.reduce((max, o) => Math.max(max, Number(o.number.split('-').pop()) || 0), 0);
    }
    this.seq += 1;
    return this.repo.create({
      id: uuidv7(),
      tenantId,
      number: `Z-${now.getFullYear()}-${String(this.seq).padStart(6, '0')}`,
      graphType,
      status: res.def.to,
      version: 0,
      urgency: dto.urgency ?? 'normal',
      source: dto.source ?? 'phone',
      clientPhone: dto.clientPhone,
      clientName: dto.clientName ?? '',
      address: dto.address ?? '',
      lat: geo.lat,
      lng: geo.lng,
      description: dto.description ?? '',
      organizationId: dto.organizationId,
      locationId: dto.locationId,
      lines,
      baseFromTiyin: baseFrom,
      baseToTiyin: baseTo,
      totalFromTiyin: applyDiscount(baseFrom),
      totalToTiyin: applyDiscount(baseTo),
      promoCode: dto.promoCode?.toUpperCase(),
      promoDiscountPercent: discount || undefined,
      urgentSurchargePercent: urgentPercent || undefined,
      requestedWindow: dto.requestedWindow,
      commonAreaAccess: dto.commonAreaAccess,
      addressDetails: dto.addressDetails,
      preferredMasterId: dto.preferredMasterId,
      priceListReleaseId: release.id,
      quotes: baseFrom > 0 ? [{ kind: 'initial', amountTiyin: applyDiscount(baseFrom), note: 'Первичная вилка «от» при создании', at: now.toISOString() }] : [],
      photos: [],
      materials: [],
      totalMaterialTiyin: 0,
      statusLog: [{ from: null, to: res.def.to, action: 'create', actorPhone, at: now }],
      createdAt: now,
    });
  }

  async list(tenantId: string): Promise<OrderRecord[]> {
    return this.repo.list(tenantId);
  }

  /**
   * Заявка для ответа API: копия с вычисленными действиями.
   * ВНИМАНИЕ: это снимок — присваивание полей на нём не сохраняется.
   * Для изменения полей берите record(), а не get().
   */
  async get(tenantId: string, orderId: string): Promise<OrderRecord & { allowedActions: string[] }> {
    const order = await this.record(tenantId, orderId);
    return { ...order, allowedActions: this.sm.allowedActions(order.graphType, order.status) };
  }

  /**
   * Живая запись заявки для мутаций (смета, пауза, приёмка, итоги).
   * После изменения обязателен touchOrder() — иначе правка не переживёт рестарт.
   */
  allowedActionsFor(order: OrderRecord): string[] {
    return this.sm.allowedActions(order.graphType, order.status);
  }

  async record(tenantId: string, orderId: string): Promise<OrderRecord> {
    const order = await this.repo.findById(tenantId, orderId);
    if (!order) throw new NotFoundException({ code: 'ORDER_NOT_FOUND', orderId });
    return order;
  }

  /**
   * Сухой прогон перехода без записи: почему кнопка неактивна.
   * Нужен приложению мастера — вместо немого 409 показываем ту же причину,
   * которую вернёт сервер, и ровно по тем guards, что стоят в графе этого типа заявки.
   */
  preflight(order: OrderRecord, action: string, ctx: Partial<TransitionContext>): { ok: boolean; failedGuard?: string; message?: string } {
    const full = emptyContext({ status: order.status, version: order.version, now: new Date(), ...ctx });
    const res = this.sm.validate(order.graphType, action as never, full);
    if (res.ok) return { ok: true };
    const v = res.violation as { failedGuard?: string; message?: string };
    return { ok: false, failedGuard: v.failedGuard, message: v.message };
  }

  async transition(
    tenantId: string,
    orderId: string,
    req: TransitionRequest,
    actorPhone?: string,
    extra?: { masterId?: string; masterName?: string },
  ): Promise<OrderRecord> {
    const order = await this.repo.findById(tenantId, orderId);
    if (!order) throw new NotFoundException({ code: 'ORDER_NOT_FOUND', orderId });

    const ctx: TransitionContext = emptyContext({
      status: order.status,
      version: order.version,
      now: new Date(),
      reason: req.reason,
      completedAt: this.lastAt(order, 'completed'),
      closedAt: this.lastAt(order, 'closed'),
      // Dev-мост M1: обстоятельства (фото, оплата, модерация) приходят флагами payload;
      // с появлением мобильных приложений и биллинга — собираются из БД
      ...(req.payload as Partial<TransitionContext> | undefined),
    });
    // Приёмку уже не нужно спрашивать флагом: её ставит клиент в приложении
    // или ответственный на точке, и запись об этом есть на заявке. Считаем
    // по факту и после payload — иначе диспетчер закрыл бы работу флагом,
    // которую заказчик не принимал
    ctx.acceptanceFixed = !!order.acceptance;

    const res = this.sm.validate(order.graphType, req.action, ctx);
    if (!res.ok) throw new ConflictException(res.violation);
    if (req.action === 'assign' && !extra?.masterId) {
      throw new BadRequestException({ code: 'MASTER_REQUIRED', message: 'Для назначения укажите мастера' });
    }

    // Вкладки D-06: фиксация смет и dev-фото по действиям конвейера
    const nowIso = new Date().toISOString();
    const p = (req.payload ?? {}) as Record<string, unknown>;
    // Dev-мост телефонного канала: диспетчер отмечает галочкой, что фото у мастера есть.
    // Если снимок уже загружен из приложения — заглушку НЕ дорисовываем, иначе задвоение.
    if (req.action === 'start' && Number(p.photosBefore) >= 1 && !order.photos.some((ph) => ph.stage === 'before' && ph.file)) {
      order.photos.push({ stage: 'before', source: 'dev-флаг диспетчера (приложение мастера — M-13)', at: nowIso });
    }
    if (req.action === 'complete' && Number(p.photosAfter) >= 1 && !order.photos.some((ph) => ph.stage === 'after' && ph.file)) {
      order.photos.push({ stage: 'after', source: 'dev-флаг диспетчера (приложение мастера — M-27)', at: nowIso });
    }
    if (req.action === 'confirm_estimate') {
      order.quotes.push({
        kind: 'approved',
        amountTiyin: Number(p.amountTiyin) || order.totalFromTiyin,
        approvedVia: String(p.via ?? 'phone_dispatcher'),
        note: 'Санкция клиента (аудит-запись, ТЗ 4.6)',
        at: nowIso,
      });
    }
    if (req.action === 'rate' && typeof p.rating === 'number') {
      order.rating = Math.max(1, Math.min(5, Number(p.rating))); // окно 72 ч проверяет граф (DEV-10)
    }
    if (req.action === 'request_addwork') {
      order.quotes.push({
        kind: p.isUpsell ? 'additional_upsell' : 'additional_forced',
        amountTiyin: Number(p.amountTiyin) || 0,
        note: p.isUpsell ? 'Апсейл — не блокирует конвейер' : 'Вынужденная доп-работа (фото обязательно)',
        at: nowIso,
      });
    }

    if (res.def.internal) {
      this.repo.touch(); // сметы/фото, добавленные внутренними действиями
      return order;
    }

    const applied = await this.repo.applyTransition(
      tenantId,
      orderId,
      req.version,
      { from: order.status, to: res.def.to, action: req.action, actorPhone, reason: req.reason, clientOpUuid: req.clientOpUuid },
      req.action === 'assign' ? { masterId: extra?.masterId, masterName: extra?.masterName } : undefined,
    );
    if (applied === 'version_conflict') {
      throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Конкурирующий переход: обновите заявку и повторите' });
    }
    if (applied === 'duplicate') return order;

    // Закрытие → событие для биллинга (DEV-07 §4.В: orders не знает о подписчиках)
    if (req.action === 'close') {
      const payload = (req.payload ?? {}) as { cashPayment?: boolean };
      this.bus.publish<OrderClosedEvent>('order.closed', {
        orderId: applied.id,
        number: applied.number,
        graphType: applied.graphType,
        organizationId: applied.organizationId,
        clientPhone: applied.clientPhone,
        masterId: applied.masterId,
        masterName: applied.masterName,
        totalWorkTiyin: applied.totalFromTiyin, // dev: санкционированная = нижняя вилка; с M2 — утверждённая смета
        baseWorkTiyin: applied.baseFromTiyin, // доля мастера — от базы, скидки её не трогают
        paymentChannel: applied.graphType === 'b2b' ? 'subscription' : payload.cashPayment ? 'cash' : 'online',
        materialsTiyin: applied.totalMaterialTiyin,
      });
    }
    return applied;
  }

  /** Сохранить изменения вложенных коллекций заявки (фото, сметы) */
  touchOrder(): void {
    this.repo.touch();
  }

  // ---------- Вкладки D-06: материалы, предпросмотр отмены, переназначение ----------

  async addMaterial(
    tenantId: string,
    orderId: string,
    m: { kind: 'spare_part' | 'consumable'; name: string; amountTiyin: number; sourceChannel: string; hasReceipt?: boolean; priceTier?: string },
  ) {
    const order = await this.repo.findById(tenantId, orderId);
    if (!order) throw new NotFoundException({ code: 'ORDER_NOT_FOUND' });
    if (!['in_progress', 'addwork_approval', 'completed'].includes(order.status)) {
      throw new BadRequestException({ code: 'MATERIALS_STAGE_INVALID', message: 'Материалы вносятся в статусах «В работе» … «Выполнена»' });
    }
    if (m.kind === 'spare_part' && !m.hasReceipt) {
      throw new BadRequestException({ code: 'RECEIPT_REQUIRED', message: 'Запчасть — всегда с чеком; без чека только расходники «сумки» (ТЗ 8.4)' });
    }
    if (m.kind === 'spare_part' && m.amountTiyin > 20_000_000 && !m.priceTier) {
      throw new BadRequestException({ code: 'PRICE_TIER_REQUIRED', message: 'Запчасть дороже 200 000 сум — укажите вилку эконом/стандарт/премиум (ТЗ 8.4.3)' });
    }
    this.repo.touch();
    order.materials.push({
      kind: m.kind,
      name: m.name,
      amountTiyin: m.amountTiyin,
      sourceChannel: m.sourceChannel as never,
      hasReceipt: !!m.hasReceipt,
      priceTier: m.priceTier as never,
      at: new Date().toISOString(),
    });
    order.totalMaterialTiyin += m.amountTiyin;
    this.repo.touch();
    return order;
  }

  /** Предпросмотр денежных последствий отмены — матрица ТЗ 4.4 */
  async cancelPreview(tenantId: string, orderId: string) {
    const order = await this.repo.findById(tenantId, orderId);
    if (!order) throw new NotFoundException({ code: 'ORDER_NOT_FOUND' });
    const calloutTiyin = 5_000_000; // параметр №10 (50 000 сум)
    const s = order.status;
    if (['new', 'estimated', 'pending_approval', 'approved'].includes(s)) {
      return { clientPaysTiyin: 0, masterCompTiyin: 0, note: 'До назначения — отмена бесплатна (ТЗ 4.4)' };
    }
    if (s === 'assigned') {
      return {
        clientPaysTiyin: 0,
        masterCompTiyin: 0,
        note: 'Бесплатно при отмене более чем за 2 ч до окна; менее 2 ч — ложный вызов: клиенту стоимость выезда, мастеру 50% (ТЗ 4.4)',
        conditional: { lateCancelClientTiyin: calloutTiyin, lateCancelMasterTiyin: calloutTiyin / 2 },
      };
    }
    if (s === 'master_departed') {
      return { clientPaysTiyin: calloutTiyin, masterCompTiyin: calloutTiyin / 2, note: 'Мастер выехал — ложный вызов: стоимость выезда, мастеру 50% (ТЗ 4.4)' };
    }
    return {
      clientPaysTiyin: calloutTiyin + order.totalFromTiyin,
      masterCompTiyin: null,
      note: 'После начала работ — выезд + фактически выполненная часть (долю считает биллинг по факту); «скрытая зависимость» — клиент не платит, мастеру 50% от компании (ТЗ 4.4)',
    };
  }

  /** Переназначение — статусы 5–8, причина обязательна, история хранится (ТЗ 4.5) */
  async reassign(tenantId: string, orderId: string, masterId: string, masterName: string, reason: string, actorPhone?: string) {
    const order = await this.repo.findById(tenantId, orderId);
    if (!order) throw new NotFoundException({ code: 'ORDER_NOT_FOUND' });
    if (!['assigned', 'master_departed', 'in_progress', 'addwork_approval'].includes(order.status)) {
      throw new BadRequestException({ code: 'REASSIGN_STAGE_INVALID', message: 'Переназначение возможно на статусах «Назначена»…«Доп-согласование» (ТЗ 4.5)' });
    }
    if (!reason) throw new BadRequestException({ code: 'REASON_REQUIRED', message: 'Причина переназначения обязательна (справочник D-15)' });
    order.statusLog.push({ from: order.status, to: order.status, action: 'reassign', actorPhone, reason: `${reason} · ${order.masterName ?? '—'} → ${masterName}`, at: new Date() });
    order.masterId = masterId;
    order.masterName = masterName;
    this.repo.touch();
    return order;
  }

  // ---------- Реестр B2C-клиентов (A-10) ----------

  /**
   * Заблокирован ли клиент и почему.
   *
   * Нужно приложению: до этого запрет срабатывал только в момент отправки
   * заявки, и человек узнавал о блокировке, собрав её целиком.
   */
  blockOf(phone: string): { reason: string; at: string } | null {
    return this.blockedClients.get(phone) ?? null;
  }

  blockClient(phone: string, reason: string): void {
    this.blockedClients.set(phone, { reason, at: new Date().toISOString() });
    this.repo.touch();
  }

  unblockClient(phone: string): void {
    this.blockedClients.delete(phone);
    this.repo.touch();
  }

  async clientsRegistry(tenantId: string) {
    const all = await this.repo.list(tenantId);
    const b2c = all.filter((o) => o.graphType !== 'b2b');
    const byPhone = new Map<string, typeof b2c>();
    for (const o of b2c) {
      const list = byPhone.get(o.clientPhone) ?? [];
      list.push(o);
      byPhone.set(o.clientPhone, list);
    }
    return [...byPhone.entries()].map(([phone, orders]) => {
      const closed = orders.filter((o) => o.status === 'closed' || o.status === 'rated');
      const debt = orders.filter((o) => o.status === 'awaiting_payment').reduce((s, o) => s + o.totalFromTiyin, 0);
      const block = this.blockedClients.get(phone);
      return {
        phone,
        name: orders.find((o) => o.clientName)?.clientName ?? '',
        ordersTotal: orders.length,
        ordersActive: orders.filter((o) => !['closed', 'rated', 'cancelled'].includes(o.status)).length,
        ordersClosed: closed.length,
        spentTiyin: closed.reduce((s, o) => s + o.totalFromTiyin, 0),
        debtTiyin: debt,
        blocked: !!block,
        blockReason: block?.reason,
        lastOrderAt: orders[0]?.createdAt,
      };
    });
  }

  private lastAt(order: OrderRecord, status: string): Date | undefined {
    const entry = [...order.statusLog].reverse().find((l) => l.to === status);
    return entry?.at;
  }
}
