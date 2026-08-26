import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Query, UseGuards, Req } from '@nestjs/common';
import { ReferralsService, REFERRAL_BONUS_TIYIN, REFERRAL_TARGET_ORDERS } from './referrals.service';
import { masterShare } from '@sozo/kernel';
import { MasterGuard, type MasterRequest } from './master.guard';
import {
  MasterOpsService,
  NO_ACCESS_REASONS,
  CANT_GO_REASONS,
  HELPER_DURATIONS,
  HELPER_FEE_TIYIN,
  PURCHASE_LIMIT_TIYIN,
  SPARE_TIER_THRESHOLD_TIYIN,
  PERMIT_DENIED_ESCALATION_MINUTES,
} from './master-ops.service';
import { MasterOffersService } from './offers.service';
import { OrdersService } from '../orders/orders.service';
import type { OrderRecord } from '../orders/order.repository';
import { PricingService } from '../pricing/pricing.service';
import { BillingService } from '../billing/billing.service';
import { SchedulingService } from '../scheduling/scheduling.service';
import { MastersService } from '../masters/masters.module';
import { AuditService } from '../platform/audit.service';
import { MasterPhotoService } from './photo.service';
import { AccessService } from '../access/access.service';
import { ParametersService } from '../platform/parameters.service';
import { tr } from '../../common/locale';

/**
 * Ветки конвейера и разделы вне заявки (экраны M-14…M-41).
 *
 * Вынесено из основного контроллера: там — счастливый путь конвейера,
 * здесь — всё, что происходит, когда работа идёт не по плану, плюс деньги,
 * оборудование, график и рефералы.
 */
@Controller('master')
@UseGuards(MasterGuard)
export class MasterOpsController {
  constructor(
    private readonly ops: MasterOpsService,
    private readonly offers: MasterOffersService,
    private readonly orders: OrdersService,
    private readonly pricing: PricingService,
    private readonly billing: BillingService,
    private readonly scheduling: SchedulingService,
    private readonly masters: MastersService,
    private readonly audit: AuditService,
    private readonly photos: MasterPhotoService,
    private readonly referralsSvc: ReferralsService,
    private readonly access: AccessService,
    private readonly params: ParametersService,
  ) {}

  private async mine(id: string, masterId: string): Promise<OrderRecord> {
    const o = await this.orders.record('t0', id);
    if (o.masterId !== masterId && o.helperId !== masterId) throw new NotFoundException({ code: 'ORDER_NOT_FOUND' });
    return o;
  }

  /** Справочники — приложение кеширует их для офлайна */
  @Get('dictionaries')
  dictionaries() {
    return {
      noAccessReasons: NO_ACCESS_REASONS,
      cantGoReasons: CANT_GO_REASONS,
      helperDurations: HELPER_DURATIONS,
      helperFeeTiyin: HELPER_FEE_TIYIN,
      purchaseLimitTiyin: PURCHASE_LIMIT_TIYIN,
      spareTierThresholdTiyin: SPARE_TIER_THRESHOLD_TIYIN,
      assetTypes: ['кондиционер', 'котёл', 'бойлер', 'стиральная машина', 'смеситель', 'насос', 'счётчик', 'другое'],
    };
  }

  // ---------- M-12 «Задерживаюсь» ----------

  /** Каскадный сдвиг: если следующая заявка выпадает из окна, алерт уходит диспетчеру */
  @Post('orders/:id/delay')
  async delay(@Param('id') id: string, @Body() b: { minutes?: number }, @Req() req: MasterRequest) {
    const m = req.master!;
    const o = await this.mine(id, m.id);
    const minutes = b?.minutes === 60 ? 60 : 30;
    if (!['assigned', 'master_departed'].includes(o.status)) {
      throw new BadRequestException({ code: 'STAGE_INVALID', message: 'Задержка отмечается до начала работ' });
    }
    const rec = this.ops.openBranch({ orderId: id, masterId: m.id, kind: 'delay', payload: { minutes } });
    this.audit.write({ actorPhone: m.phone, action: 'master.delay', entity: 'Order', entityId: id, payload: { minutes } });
    return {
      ok: true,
      minutes,
      branchId: rec.id,
      message: 'План сдвинут. Очередь пересчитана',
      note: 'Клиент получит новое время',
    };
  }

  // ---------- M-14 нет доступа (третья сторона) ----------

  @Post('orders/:id/no-access')
  async noAccess(
    @Param('id') id: string,
    @Body() b: { reasonCode?: string; photoDataUrl?: string; nextAttemptAt?: string },
    @Req() req: MasterRequest,
  ) {
    const m = req.master!;
    await this.mine(id, m.id);
    if (!NO_ACCESS_REASONS.some((r) => r.code === b?.reasonCode)) {
      throw new BadRequestException({ code: 'REASON_REQUIRED', message: 'Выберите причину из списка' });
    }
    if (!b?.photoDataUrl) {
      throw new BadRequestException({ code: 'PHOTO_REQUIRED', message: 'Снимите закрытую дверь — без фото пауза не оформляется' });
    }
    await this.photos.save(await this.orders.record('t0', id), { stage: 'during', dataUrl: b.photoDataUrl, note: 'нет доступа: третья сторона', geo: null, masterName: m.fullName });
    const o = await this.orders.record('t0', id);
    const denied = b.reasonCode === 'permit_denied';
    const deadline = denied
      ? new Date(Date.now() + PERMIT_DENIED_ESCALATION_MINUTES * 60_000).toISOString()
      : undefined;
    const rec = this.ops.openBranch({
      orderId: id,
      masterId: m.id,
      kind: 'no_access',
      reasonCode: b.reasonCode,
      payload: denied
        ? { escalatedAt: new Date().toISOString(), deadline }
        : { nextAttemptAt: b.nextAttemptAt },
    });

    /**
     * Наряд согласован, а на месте не пускают — единственная причина, которая
     * НЕ ставит паузу.
     *
     * Пауза здесь означала бы «ждём, пока договорятся», но договариваться уже
     * поздно: согласование получено, окно допуска идёт и скоро истечёт, а
     * второй раз его согласовывать — ещё сутки. Поэтому вместо паузы
     * эскалация дежурному объекта с таймером (DEV-15 §10, M-14).
     */
    if (denied) {
      this.audit.write({
        actorPhone: m.phone,
        action: 'master.permit_denied',
        entity: 'Order',
        entityId: id,
        payload: { buildingId: o.buildingId, deadline },
      });
      const duty = o.buildingId ? this.access.buildingBrief('t0', o.buildingId) : null;
      return {
        ok: true,
        branchId: rec.id,
        escalated: true,
        deadline,
        dutyPhone: duty?.dispatchPhone ?? duty?.emergencyPhone ?? null,
        message: `Дежурный объекта оповещён. Ждём ${PERMIT_DENIED_ESCALATION_MINUTES} минут`,
        note: 'Заявка остаётся за вами: наряд согласован, и повторное согласование — ещё сутки',
      };
    }

    // Причина паузы хранится как есть, без языка и без приставки «Заблокировано»:
    // запись читают и диспетчер, и мастер, а перевод при записи привязал бы
    // содержимое базы к языку того, кто нажал кнопку. Мастеру её переведут на
    // выдаче — текст причины лежит в словаре целиком.
    o.pause = { reason: NO_ACCESS_REASONS.find((r) => r.code === b.reasonCode)!.title, since: new Date().toISOString(), until: b.nextAttemptAt };
    this.orders.touchOrder();
    this.audit.write({ actorPhone: m.phone, action: 'master.no_access', entity: 'Order', entityId: id, payload: { reason: b.reasonCode, nextAttemptAt: b.nextAttemptAt } });
    return {
      ok: true,
      branchId: rec.id,
      message: 'Отправлено. Вы свободны для других заявок',
      note: b.nextAttemptAt
        ? 'С указанной датой заявка вернётся в ленту автоматически'
        : 'Без даты диспетчер дозвонится до ТСЖ',
    };
  }

  // ---------- M-30 клиент недоступен ----------

  @Post('orders/:id/client-unavailable')
  async clientUnavailable(@Param('id') id: string, @Body() b: { photoDataUrl?: string }, @Req() req: MasterRequest) {
    const m = req.master!;
    const o = await this.mine(id, m.id);
    if (!b?.photoDataUrl) {
      throw new BadRequestException({ code: 'PHOTO_REQUIRED', message: 'Снимите дверь — это подтверждение выезда' });
    }
    await this.photos.save(await this.orders.record('t0', id), { stage: 'during', dataUrl: b.photoDataUrl, note: 'клиент недоступен: фото двери', geo: null, masterName: m.fullName });
    const rec = this.ops.openBranch({
      orderId: id,
      masterId: m.id,
      kind: 'client_unavailable',
      payload: { arrivedAt: o.arrivedAt ?? new Date().toISOString() },
    });
    this.audit.write({ actorPhone: m.phone, action: 'master.client_unavailable', entity: 'Order', entityId: id });
    return {
      ok: true,
      branchId: rec.id,
      message: 'Диспетчер прозванивает клиента — до 15 минут. Оставайтесь рядом',
    };
  }

  // ---------- M-31 прервать: небезопасно ----------

  @Post('orders/:id/abort-unsafe')
  async abortUnsafe(@Param('id') id: string, @Body() b: { comment?: string; photoDataUrl?: string }, @Req() req: MasterRequest) {
    const m = req.master!;
    await this.mine(id, m.id);
    // Безопасность не зависит от заполненности полей: фото и комментарий опциональны
    if (b?.photoDataUrl) {
      await this.photos.save(await this.orders.record('t0', id), { stage: 'during', dataUrl: b.photoDataUrl, note: 'прерывание: небезопасно', geo: null, masterName: m.fullName });
    }
    const rec = this.ops.openBranch({ orderId: id, masterId: m.id, kind: 'unsafe_abort', comment: b?.comment });
    this.audit.write({ actorPhone: m.phone, action: 'master.unsafe_abort', entity: 'Order', entityId: id, payload: { comment: b?.comment } });
    return { ok: true, branchId: rec.id, message: 'Отправлено диспетчеру. Санкций за прерывание нет' };
  }

  // ---------- M-32 не могу поехать ----------

  @Post('orders/:id/cant-go')
  async cantGo(@Param('id') id: string, @Body() b: { reasonCode?: string; comment?: string }, @Req() req: MasterRequest) {
    const m = req.master!;
    const o = await this.mine(id, m.id);
    if (!CANT_GO_REASONS.some((r) => r.code === b?.reasonCode)) {
      throw new BadRequestException({ code: 'REASON_REQUIRED', message: 'Укажите причину — это смягчает последствия' });
    }
    if (b.reasonCode === 'other' && !b?.comment?.trim()) {
      throw new BadRequestException({ code: 'COMMENT_REQUIRED', message: 'Опишите причину' });
    }
    if (!['assigned'].includes(o.status)) {
      throw new BadRequestException({ code: 'TOO_LATE', message: 'Вы уже выехали — позвоните диспетчеру' });
    }
    const rec = this.ops.openBranch({ orderId: id, masterId: m.id, kind: 'cant_go', reasonCode: b.reasonCode, comment: b.comment });
    this.audit.write({ actorPhone: m.phone, action: 'master.cant_go', entity: 'Order', entityId: id, payload: { reason: b.reasonCode } });
    return {
      ok: true,
      branchId: rec.id,
      message: 'Заявка снята с вас. Спасибо, что предупредили заранее',
      note: 'Замена запустится немедленно. Уважительная причина — без санкций',
    };
  }

  // ---------- M-16 вилка запчастей ----------

  @Post('orders/:id/spare-tiers')
  async spareTiers(
    @Param('id') id: string,
    @Body() b: { partName?: string; mode?: 'catalog' | 'photo'; variants?: Array<{ tier: string; title: string; amountSoums: number; note?: string }> },
    @Req() req: MasterRequest,
  ) {
    const m = req.master!;
    await this.mine(id, m.id);
    if (!b?.partName?.trim()) throw new BadRequestException({ code: 'PART_REQUIRED', message: 'Укажите деталь' });
    const variants = (b?.variants ?? []).map((v) => ({
      tier: v.tier as 'economy' | 'standard' | 'premium',
      title: v.title,
      amountTiyin: Math.round((v.amountSoums ?? 0) * 100),
      note: v.note,
    }));
    const rec = this.ops.sendSpareTiers({ orderId: id, masterId: m.id, partName: b.partName, mode: b?.mode ?? 'catalog', variants });
    this.audit.write({ actorPhone: m.phone, action: 'master.spare_tiers_sent', entity: 'Order', entityId: id, payload: { part: b.partName } });
    return {
      ...rec,
      note: 'Нет ответа 30 мин — повторный push и SMS, 2 часа — позвонит диспетчер',
    };
  }

  @Get('orders/:id/spare-tiers')
  async spareTiersList(@Param('id') id: string, @Req() req: MasterRequest) {
    const m = req.master!;
    await this.mine(id, m.id);
    return { items: this.ops.spareTiers.filter((s) => s.orderId === id), thresholdTiyin: SPARE_TIER_THRESHOLD_TIYIN };
  }

  // ---------- M-17 вынужденная доп-работа ----------

  @Post('orders/:id/addwork')
  async addwork(
    @Param('id') id: string,
    @Body() b: {
      photoDataUrl?: string;
      variants?: Array<{ kind: 'minimal' | 'full'; title?: string; lines: Array<{ priceItemId: string; qty?: number }> }>;
    },
    @Req() req: MasterRequest,
  ) {
    const m = req.master!;
    const o = await this.mine(id, m.id);
    if (b?.photoDataUrl) {
      await this.photos.save(await this.orders.record('t0', id), { stage: 'during', dataUrl: b.photoDataUrl, note: 'обоснование доп-работы', geo: null, masterName: m.fullName });
    }
    const fresh = await this.orders.record('t0', id);
    const photoCount = fresh.photos.filter((p) => p.stage === 'during').length;
    const release = this.pricing.active();
    const variants = (b?.variants ?? []).map((v) => {
      const lines = v.lines.map((l) => {
        const item = release.items.find((i) => i.id === l.priceItemId);
        if (!item) throw new BadRequestException({ code: 'PRICE_ITEM_UNKNOWN' });
        const qty = Math.max(1, Number(l.qty ?? 1));
        return { name: item.name, amountTiyin: item.priceFromTiyin, qty };
      });
      return {
        kind: v.kind,
        title: v.title ?? (v.kind === 'minimal' ? 'Минимальный: безопасная времянка' : 'Полный: замена целиком'),
        lines,
        totalTiyin: lines.reduce((s, l) => s + l.amountTiyin * l.qty, 0),
      };
    });
    const rec = this.ops.sendAddwork({ orderId: id, masterId: m.id, photoCount, variants });
    // Фиксируем в журнале смет заявки — доп-смета часть аудита (ТЗ 4.6)
    o.quotes.push({
      kind: 'additional_forced',
      amountTiyin: Math.min(...variants.map((v) => v.totalTiyin)),
      note: `Вынужденная доп-работа, вариантов: ${variants.length}`,
      at: new Date().toISOString(),
    });
    this.orders.touchOrder();
    this.audit.write({ actorPhone: m.phone, action: 'master.addwork_sent', entity: 'Order', entityId: id, payload: { variants: variants.length } });
    return rec;
  }

  @Get('orders/:id/addwork')
  async addworkStatus(@Param('id') id: string, @Req() req: MasterRequest) {
    const m = req.master!;
    await this.mine(id, m.id);
    const pending = this.ops.addworkFor(id);
    return {
      pending: pending ?? null,
      history: this.ops.addworks.filter((a) => a.orderId === id),
      hint: pending
        ? 'Можно выполнять согласованную часть. Без ответа несогласованные позиции будут сняты'
        : undefined,
    };
  }

  // ---------- M-19 консервация ----------

  @Post('orders/:id/conservation')
  async conservation(@Param('id') id: string, @Body() b: { photoDataUrl?: string }, @Req() req: MasterRequest) {
    const m = req.master!;
    const o = await this.mine(id, m.id);
    if (!b?.photoDataUrl) {
      throw new BadRequestException({ code: 'PHOTO_REQUIRED', message: 'Снимите выполненную консервацию — это юридическая защита' });
    }
    await this.photos.save(await this.orders.record('t0', id), { stage: 'during', dataUrl: b.photoDataUrl, note: 'консервация', geo: null, masterName: m.fullName });
    const release = this.pricing.active();
    const item = release.items.find((i) => /консерваци/i.test(i.name));
    const amountTiyin = item?.priceFromTiyin ?? 5_000_000;
    o.quotes.push({ kind: 'conservation', amountTiyin, note: 'Консервация: клиент отказался от вынужденных работ', at: new Date().toISOString() });
    o.totalFromTiyin += amountTiyin;
    o.totalToTiyin += amountTiyin;
    this.orders.touchOrder();
    const rec = this.ops.openBranch({ orderId: id, masterId: m.id, kind: 'conservation', payload: { amountTiyin } });
    this.audit.write({ actorPhone: m.phone, action: 'master.conservation', entity: 'Order', entityId: id, payload: { amountTiyin } });
    return {
      ok: true,
      branchId: rec.id,
      amountTiyin,
      note: 'Заявка будет закрыта с пометкой «выполнена частично». Фото проблемы и отказ клиента войдут в акт',
    };
  }

  // ---------- M-20 апсейл ----------

  @Post('orders/:id/recommendation')
  async recommend(
    @Param('id') id: string,
    @Body() b: { lines?: Array<{ priceItemId: string; qty?: number }>; comment?: string; photoDataUrl?: string },
    @Req() req: MasterRequest,
  ) {
    const m = req.master!;
    await this.mine(id, m.id);
    if (b?.photoDataUrl) {
      await this.photos.save(await this.orders.record('t0', id), { stage: 'during', dataUrl: b.photoDataUrl, note: 'рекомендация', geo: null, masterName: m.fullName });
    }
    const release = this.pricing.active();
    const lines = (b?.lines ?? []).map((l) => {
      const item = release.items.find((i) => i.id === l.priceItemId);
      if (!item) throw new BadRequestException({ code: 'PRICE_ITEM_UNKNOWN' });
      return { name: item.name, amountTiyin: item.priceFromTiyin, qty: Math.max(1, Number(l.qty ?? 1)) };
    });
    const rec = this.ops.sendRecommendation({ orderId: id, masterId: m.id, lines, comment: b?.comment });
    this.audit.write({ actorPhone: m.phone, action: 'master.recommendation_sent', entity: 'Order', entityId: id, payload: { lines: lines.length } });
    return { ...rec, stats: this.ops.recommendationStats(m.id) };
  }

  @Get('recommendations')
  recommendations(@Req() req: MasterRequest) {
    const m = req.master!;
    return { items: this.ops.recommendations.filter((r) => r.masterId === m.id).slice(-50).reverse(), stats: this.ops.recommendationStats(m.id) };
  }

  // ---------- M-23 список закупки клиенту ----------

  @Post('orders/:id/shopping-list')
  async shoppingList(
    @Param('id') id: string,
    @Body() b: { items?: Array<{ name: string; qty?: number; approxSoums?: number }>; revisitAt?: string },
    @Req() req: MasterRequest,
  ) {
    const m = req.master!;
    const o = await this.mine(id, m.id);
    if (!b?.items?.length) throw new BadRequestException({ code: 'ITEMS_REQUIRED', message: 'Добавьте хотя бы одну позицию' });
    const rec = this.ops.openBranch({
      orderId: id,
      masterId: m.id,
      kind: 'shopping_list',
      payload: { items: b.items, revisitAt: b.revisitAt },
    });
    o.pause = { reason: 'Ожидание материалов: клиент покупает сам', since: new Date().toISOString(), until: b.revisitAt };
    this.orders.touchOrder();
    this.audit.write({ actorPhone: m.phone, action: 'master.shopping_list', entity: 'Order', entityId: id, payload: { items: b.items.length } });
    return {
      ok: true,
      branchId: rec.id,
      message: 'Список у клиента. Вы свободны',
      note: 'Повторное фото «до» при возобновлении не нужно',
    };
  }

  // ---------- M-24 техника клиента ----------

  @Get('orders/:id/assets')
  async assets(@Param('id') id: string, @Req() req: MasterRequest) {
    const m = req.master!;
    const o = await this.mine(id, m.id);
    // Гейт условный: шаг обязателен только для категорий с оборудованием (ТЗ 17.17 п.6)
    const release = this.pricing.active();
    const requiresAsset = o.lines.some((l) => {
      const item = release.items.find((i) => i.id === l.priceItemId);
      return item?.requiresEquipment || /котёл|кондиционер|бойлер|стиральн|насос/i.test(item?.name ?? '');
    });
    return {
      known: this.ops.assetsOf(o.clientPhone),
      linked: this.ops.assetForOrder(id) ?? null,
      requiresAsset,
      hint: requiresAsset
        ? 'Категория с оборудованием — зафиксируйте шильдик'
        : 'Для этой категории техника не фиксируется — закройте шаг одним тапом',
    };
  }

  @Post('orders/:id/assets')
  async addAsset(
    @Param('id') id: string,
    @Body() b: { type?: string; brand?: string; model?: string; year?: number; photoDataUrl?: string; plateUnreadable?: boolean; linkedWork?: string[]; skip?: boolean },
    @Req() req: MasterRequest,
  ) {
    const m = req.master!;
    const o = await this.mine(id, m.id);
    if (b?.skip) return { skipped: true, note: 'Запись «Смеситель, -, -» хуже отсутствия записи' };
    if (!b?.photoDataUrl) {
      throw new BadRequestException({
        code: 'PLATE_PHOTO_REQUIRED',
        message: b?.plateUnreadable ? 'Снимите общий вид техники' : 'Снимите шильдик — модель дозаполнит модерация по фото',
      });
    }
    await this.photos.save(await this.orders.record('t0', id), { stage: 'during', dataUrl: b.photoDataUrl, note: b?.plateUnreadable ? 'общий вид техники' : 'шильдик', geo: null, masterName: m.fullName });
    const rec = this.ops.addAsset({
      orderId: id,
      clientPhone: o.clientPhone,
      type: b?.type ?? 'другое',
      brand: b?.brand,
      model: b?.model,
      year: b?.year,
      plateUnreadable: !!b?.plateUnreadable,
      linkedWork: b?.linkedWork ?? [],
    });
    this.audit.write({ actorPhone: m.phone, action: 'master.asset_fixed', entity: 'Order', entityId: id, payload: { type: rec.type } });
    return { ...rec, note: 'Повторные заявки по этой технике придут вам' };
  }

  // ---------- M-25 этапные сессии ----------

  @Get('orders/:id/stages')
  async stages(@Param('id') id: string, @Req() req: MasterRequest) {
    const m = req.master!;
    await this.mine(id, m.id);
    const plan = this.ops.stagePlan(id);
    return {
      plan: plan ?? null,
      canStart: plan?.allSlotsConfirmed ?? true,
      blocker: plan && !plan.allSlotsConfirmed ? 'Начать нельзя: не подтверждены слоты следующих этапов' : null,
    };
  }

  @Post('orders/:id/stages')
  async planStages(
    @Param('id') id: string,
    @Body() b: { stages?: Array<{ index: number; title: string; normHours: number; pauseMinHours: number; pauseMaxHours: number; slotAt?: string }> },
    @Req() req: MasterRequest,
  ) {
    const m = req.master!;
    await this.mine(id, m.id);
    if (!b?.stages?.length) throw new BadRequestException({ code: 'STAGES_REQUIRED' });
    const plan = this.ops.planStages(
      id,
      b.stages.map((s) => ({ ...s, status: s.slotAt ? ('booked' as const) : ('planned' as const) })),
    );
    this.audit.write({ actorPhone: m.phone, action: 'master.stages_planned', entity: 'Order', entityId: id, payload: { stages: plan.stages.length } });
    return plan;
  }

  @Post('orders/:id/stages/:index/complete')
  async completeStage(@Param('id') id: string, @Param('index') index: string, @Body() b: { photoDataUrl?: string }, @Req() req: MasterRequest) {
    const m = req.master!;
    await this.mine(id, m.id);
    if (!b?.photoDataUrl) throw new BadRequestException({ code: 'PHOTO_REQUIRED', message: 'Этап закрывается фото «в процессе»' });
    await this.photos.save(await this.orders.record('t0', id), {
      stage: 'during',
      dataUrl: b.photoDataUrl,
      note: `этап ${index}`,
      geo: null,
      masterName: m.fullName,
    });
    const plan = this.ops.completeStage(id, Number(index));
    const next = plan.stages.find((s) => s.status !== 'done');
    return {
      plan,
      message: next ? tr('Этап закрыт. Перерыв до {0} — заявка не занимает вашу ленту', next.slotAt ?? 'согласования') : 'Все этапы закрыты',
    };
  }

  // ---------- M-26 нужен помощник ----------

  @Post('orders/:id/helper-request')
  async helperRequest(@Param('id') id: string, @Body() b: { duration?: string }, @Req() req: MasterRequest) {
    const m = req.master!;
    const o = await this.mine(id, m.id);
    const d = HELPER_DURATIONS.find((x) => x.code === b?.duration);
    if (!d) throw new BadRequestException({ code: 'DURATION_REQUIRED', message: 'Оцените, сколько нужна помощь' });
    if (o.helperId) throw new BadRequestException({ code: 'HELPER_EXISTS', message: 'Помощник уже назначен' });
    const rec = this.ops.openBranch({ orderId: id, masterId: m.id, kind: 'helper_request', payload: { hours: d.hours, feeTiyin: HELPER_FEE_TIYIN } });
    // Мини-оффер бродкастом всем, кто на линии в зоне (механика M-10)
    const online = this.offers.onlineMasters().filter((s) => s.masterId !== m.id);
    const sent = online
      .map((s) => this.masters.list().find((x) => x.id === s.masterId))
      .filter((x): x is NonNullable<typeof x> => !!x && x.status === 'active')
      .map((helper) =>
        this.offers.create({
          orderId: o.id,
          orderNumber: o.number,
          masterId: helper.id,
          masterName: helper.fullName,
          category: `Помощник: ${o.description.slice(0, 40)}`,
          district: o.address.split(' ')[0],
          urgency: 'urgent',
          estimateFromTiyin: HELPER_FEE_TIYIN,
          estimateToTiyin: HELPER_FEE_TIYIN,
          masterShareFromTiyin: HELPER_FEE_TIYIN,
          isPaired: true,
          kind: 'helper',
          ttlSeconds: 120,
        }),
      );
    this.audit.write({ actorPhone: m.phone, action: 'master.helper_requested', entity: 'Order', entityId: id, payload: { hours: d.hours, broadcast: sent.length } });
    return {
      branchId: rec.id,
      broadcastTo: sent.length,
      feeTiyin: HELPER_FEE_TIYIN,
      message: sent.length ? 'Ищем помощника рядом…' : 'Свободных помощников нет. Позвоните диспетчеру — перенос согласует он',
      note: 'Фикс помощника оплачивает не клиент',
    };
  }

  /** M-11 блок «Помощник»: ведущий подтверждает, что помощь оказана */
  @Post('orders/:id/helper-confirm')
  async helperConfirm(@Param('id') id: string, @Req() req: MasterRequest) {
    const m = req.master!;
    const o = await this.mine(id, m.id);
    if (o.masterId !== m.id) throw new ForbiddenException({ code: 'LEAD_ONLY', message: 'Отметку ставит ведущий мастер' });
    if (!o.helperId) throw new BadRequestException({ code: 'NO_HELPER' });
    const rec = this.ops.openBranch({ orderId: id, masterId: m.id, kind: 'helper_request', payload: { confirmed: true } });
    this.ops.resolveBranch(rec.id, 'Помощь подтверждена ведущим');
    this.audit.write({ actorPhone: m.phone, action: 'master.helper_confirmed', entity: 'Order', entityId: id });
    return { ok: true, message: 'Помощь подтверждена — фикс придёт помощнику после закрытия заявки' };
  }

  // ---------- M-29 оплата ----------

  @Post('orders/:id/payment')
  async payment(@Param('id') id: string, @Body() b: { method?: 'qr' | 'link' | 'cash' }, @Req() req: MasterRequest) {
    const m = req.master!;
    const o = await this.mine(id, m.id);
    const method = b?.method ?? 'qr';
    const amountTiyin = o.totalFromTiyin;
    if (method === 'cash') {
      // Наличные становятся долгом мастера перед компанией (ТЗ 8.2)
      const rec = this.masters.adjustCashDebt(m.id, amountTiyin);
      this.audit.write({ actorPhone: m.phone, action: 'master.cash_received', entity: 'Order', entityId: id, payload: { amountTiyin } });
      return {
        method,
        amountTiyin,
        cashDebtTiyin: rec.cashDebtTiyin,
        warning: rec.cashDebtTiyin >= 200_000_000 ? 'Долг у лимита 2 000 000 сум — внесите через Payme, иначе снятие с линии' : undefined,
        message: 'Наличные приняты. Сумма стала вашим долгом перед компанией',
      };
    }
    // QR и ссылка — dev-заглушка провайдера: реальный платёж придёт вебхуком
    return {
      method,
      amountTiyin,
      qrPayload: method === 'qr' ? `sozo://pay/${o.id}?amount=${amountTiyin}` : undefined,
      linkSent: method === 'link',
      status: 'pending',
      message: method === 'qr' ? 'Покажите QR клиенту' : 'Ссылка отправлена клиенту — ждём оплату',
      note: 'Приёмка подтвердится автоматически вебхуком успешного платежа',
    };
  }

  /**
   * Приложение сообщает, сколько действий у него зависло в офлайн-очереди.
   *
   * Метрика без этого нечем считалась: очередь копится ровно тогда, когда связи
   * нет, и сервер о ней не знает. Отчёт приходит при первом же удавшемся
   * запросе — то есть в момент, когда очередь начала разгружаться.
   */
  @Post('sync/queue')
  reportQueue(@Body() b: { depth?: number; oldestAt?: string }, @Req() req: MasterRequest) {
    const depth = Math.max(0, Number(b?.depth) || 0);
    this.masters.update(req.master!.id, {
      offlineQueue: { depth, oldestAt: b?.oldestAt, at: new Date().toISOString() },
    });
    return { ok: true };
  }

  // ---------- M-34 кошелёк ----------

  @Get('wallet')
  async wallet(@Query('period') period: string | undefined, @Req() req: MasterRequest) {
    const m = req.master!;
    const payout = this.billing.payouts().find((p) => p.masterId === m.id);
    const all = await this.orders.list('t0');
    const mine = all.filter((o) => o.masterId === m.id && ['closed', 'rated'].includes(o.status));

    const now = new Date();
    const startOf = (p: string): Date => {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      if (p === 'today') return d;
      if (p === 'week') {
        d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
        return d;
      }
      if (p === 'prev_week') {
        d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7);
        return d;
      }
      d.setDate(1);
      return d;
    };
    const p = period ?? 'week';
    const from = startOf(p).getTime();
    const to = p === 'prev_week' ? from + 7 * 86_400_000 : Date.now();
    const inPeriod = mine.filter((o) => {
      const t = new Date(o.statusLog.find((l) => l.to === 'closed')?.at ?? o.createdAt).getTime();
      return t >= from && t <= to;
    });
    const shareOf = (o: OrderRecord) => Number(masterShare(BigInt(o.baseFromTiyin || 0), 1000n, BigInt(this.orders.masterSharePermilleFor(o))));

    // Возмещения материалов — не доход, налогом не облагаются
    const reimbursements = inPeriod.flatMap((o) =>
      o.materials
        .filter((mm) => mm.sourceChannel === 'master_own')
        .map((mm) => ({ orderNumber: o.number, name: mm.name, amountTiyin: mm.amountTiyin })),
    );
    const consumables = inPeriod.flatMap((o) =>
      o.materials.filter((mm) => mm.kind === 'consumable').map((mm) => ({ orderNumber: o.number, name: mm.name, amountTiyin: mm.amountTiyin })),
    );
    // Чаевые берём из проводок, а не из заявок периода: клиент мог оценить
    // работу через неделю после закрытия, и деньги относятся к дню оценки
    const tips = this.billing.tipsOf(m.id, from, to);

    return {
      period: p,
      periods: [
        { code: 'today', title: 'Сегодня' },
        { code: 'week', title: 'Эта неделя' },
        { code: 'prev_week', title: 'Прошлая' },
        { code: 'month', title: 'Месяц' },
      ],
      accruedTiyin: payout?.accruedTiyin ?? 0,
      paidTiyin: payout?.paidTiyin ?? 0,
      dueTiyin: payout?.dueTiyin ?? 0,
      /**
       * «Когда деньги» — первый вопрос мастера, и до этого экран кошелька
       * на него не отвечал вовсе. Период берём из параметра №65, дату —
       * из проводок: выдумывать «выплата в понедельник» нельзя, ведомость
       * закрывает бухгалтер.
       */
      payout: {
        scheduleText: `Выплата: ${this.params.text(65, 'раз в неделю')}`,
        lastPaidAt: this.billing.lastPayoutAt(m.id),
      },
      cashDebtTiyin: m.cashDebtTiyin,
      cashLimitTiyin: 200_000_000,
      taxMode: m.taxMode,
      sections: [
        {
          code: 'work_share',
          title: 'Доля за работы',
          totalTiyin: inPeriod.reduce((s, o) => s + shareOf(o), 0),
          rows: inPeriod.map((o) => ({ title: o.number, amountTiyin: shareOf(o), orderId: o.id })),
        },
        {
          code: 'tips',
          title: 'Чаевые',
          note: 'Чаевые целиком ваши: комиссия с них не берётся',
          totalTiyin: tips.reduce((s, t) => s + t.amountTiyin, 0),
          rows: tips.map((t) => ({
            title: t.comment?.replace(/^Чаевые мастеру.*?по /, '') ?? 'Чаевые',
            amountTiyin: t.amountTiyin,
            orderId: t.orderId,
          })),
        },
        {
          code: 'reimbursements',
          title: 'Возмещения материалов',
          note: 'Возмещения — не доход, налогом не облагаются',
          totalTiyin: reimbursements.reduce((s, r) => s + r.amountTiyin, 0),
          rows: reimbursements.map((r) => ({ title: `${r.orderNumber} · ${r.name}`, amountTiyin: r.amountTiyin })),
        },
        {
          code: 'consumables',
          title: 'Расходники сумки',
          totalTiyin: consumables.reduce((s, r) => s + r.amountTiyin, 0),
          rows: consumables.map((r) => ({ title: `${r.orderNumber} · ${r.name}`, amountTiyin: r.amountTiyin })),
        },
        {
          code: 'deductions',
          title: 'Удержания',
          totalTiyin: 0,
          rows: [],
          note: 'Удержания появляются при гарантийных переделках по вине и регрессе ущерба',
        },
      ],
      deposits: this.ops.deposits.filter((d) => d.masterId === m.id).slice(-20).reverse(),
      /** Спор блокирует долю до резолюции (ТЗ 4.2) */
      blocked: all
        .filter((o) => o.masterId === m.id && o.status === 'dispute')
        .map((o) => ({ orderNumber: o.number, note: 'Доля заблокирована спором до резолюции' })),
      frozen: m.status === 'offboarding' ? 'Выплаты заморожены: идёт сверка' : undefined,
    };
  }

  // ---------- M-35 внесение наличных ----------

  @Post('cash-deposit')
  deposit(@Body() b: { amountSoums?: number }, @Req() req: MasterRequest) {
    const m = req.master!;
    const amountTiyin = Math.round((b?.amountSoums ?? 0) * 100);
    if (amountTiyin > m.cashDebtTiyin) {
      throw new BadRequestException({ code: 'AMOUNT_TOO_BIG', message: 'Сумма больше вашего долга' });
    }
    const rec = this.ops.deposit(m.id, amountTiyin);
    // Dev: провайдер подтверждает мгновенно; в проде — вебхук, идемпотентно
    this.ops.settleDeposit(rec.id);
    const master = this.masters.adjustCashDebt(m.id, -amountTiyin);
    this.audit.write({ actorPhone: m.phone, action: 'master.cash_deposited', entity: 'MasterProfile', entityId: m.id, payload: { amountTiyin } });
    return {
      ok: true,
      amountTiyin,
      cashDebtTiyin: master.cashDebtTiyin,
      message: master.cashDebtTiyin === 0 ? 'Зачислено. Вы снова на линии' : 'Зачислено',
    };
  }

  // ---------- M-37 оборудование ----------

  @Get('equipment')
  equipment(@Req() req: MasterRequest) {
    const m = req.master!;
    // Реестр оборудования ведёт админка; здесь — выданное конкретному мастеру
    return {
      items: [],
      note: 'Заявки, требующие оборудование, приходят только мастерам с выданным оборудованием и транспортом',
      hasVehicle: m.hasVehicle,
      empty: 'Оборудование не выдано',
    };
  }

  // ---------- M-40 график и отпуска ----------

  @Get('schedule')
  schedule(@Query('month') month: string | undefined, @Req() req: MasterRequest) {
    const m = req.master!;
    const mm = month ?? new Date().toISOString().slice(0, 7);
    const days: Array<{ date: string; shift: boolean; duty: boolean }> = [];
    const [y, mo] = mm.split('-').map(Number);
    const last = new Date(y, mo, 0).getDate();
    for (let d = 1; d <= last; d++) {
      const date = `${mm}-${String(d).padStart(2, '0')}`;
      const shifts = this.scheduling.listShifts(date).filter((s) => s.masterId === m.id);
      days.push({ date, shift: shifts.length > 0, duty: shifts.some((s) => s.isDuty) });
    }
    return {
      month: mm,
      days,
      requests: this.ops.timeOffFor(m.id),
      note: 'Одобренный отпуск исключает вас из распределения заявок',
    };
  }

  @Post('time-off')
  timeOff(@Body() b: { from?: string; to?: string; kind?: 'vacation' | 'sick'; comment?: string }, @Req() req: MasterRequest) {
    const m = req.master!;
    return this.ops.requestTimeOff({
      masterId: m.id,
      from: b?.from ?? '',
      to: b?.to ?? '',
      kind: b?.kind ?? 'vacation',
      comment: b?.comment,
    });
  }

  // ---------- M-41 рефералы ----------

  @Get('referrals')
  async referrals(@Req() req: MasterRequest) {
    const m = req.master!;
    // Считаем по коду, а не по имени: тёзки и переименования рвут связь молча
    const rows = await this.referralsSvc.byReferrer(m.qrBadgeCode);
    return {
      code: m.qrBadgeCode,
      link: `https://sozo.uz/masters?ref=${m.qrBadgeCode}`,
      target: REFERRAL_TARGET_ORDERS,
      bonusTiyin: REFERRAL_BONUS_TIYIN,
      earnedTiyin: rows.filter((r) => r.earned).reduce((s, r) => s + r.bonusTiyin, 0),
      invited: rows.map((r) => ({
        fullName: r.invitedName,
        status: r.invitedStatus,
        closedOrders: r.closedOrders,
        target: r.target,
        bonusStatus: r.paidAt ? 'Выплачен' : r.earned ? 'Заработан' : tr('Ещё {0} заявок', r.target - r.closedOrders),
      })),
      empty: 'Приведите мастера — получите бонус после его 20 закрытых заявок',
    };
  }

  // ---------- M-39 инструмент и NPS ----------

  @Get('tool-checklist')
  toolChecklist(@Req() req: MasterRequest) {
    const m = req.master!;
    const BY_SKILL: Record<string, string[]> = {
      сантехника: ['Разводной ключ', 'Труборез', 'Набор прокладок', 'Пресс-клещи'],
      электрика: ['Индикатор напряжения', 'Мультиметр', 'Кримпер', 'Изолента и клеммы'],
      кондиционеры: ['Манометрический коллектор', 'Вакуумный насос', 'Течеискатель'],
    };
    return {
      skills: m.skillTags.map((s) => ({
        skill: s,
        items: BY_SKILL[s] ?? ['Базовый набор'],
        lastCheck: [...this.ops.toolChecks].reverse().find((c) => c.masterId === m.id && c.skill === s) ?? null,
      })),
      note: 'Без полного набора навык снимается и заявки по нему не приходят',
    };
  }

  @Post('tool-check')
  toolCheck(@Body() b: { skill?: string; complete?: boolean; missing?: string }, @Req() req: MasterRequest) {
    const m = req.master!;
    if (!b?.skill) throw new BadRequestException({ code: 'SKILL_REQUIRED' });
    const rec = this.ops.toolCheck(m.id, b.skill, !!b.complete, b.missing);
    if (!b.complete) {
      // Неполный набор снимает навык до восстановления (ТЗ 17.1)
      this.masters.update(m.id, { skillTags: m.skillTags.filter((s) => s !== b.skill) });
      this.audit.write({ actorPhone: m.phone, action: 'master.skill_suspended', entity: 'MasterProfile', entityId: m.id, payload: { skill: b.skill, missing: b.missing } });
    }
    return { ...rec, skillSuspended: !b.complete };
  }

  @Get('nps')
  npsDue(@Req() req: MasterRequest) {
    const m = req.master!;
    return { due: this.ops.npsDue(m.id), question: 'Насколько вероятно, что вы порекомендуете работу в SOZO знакомому мастеру?' };
  }

  @Post('nps')
  nps(@Body() b: { score?: number; comment?: string }, @Req() req: MasterRequest) {
    const m = req.master!;
    return this.ops.submitNps(m.id, Number(b?.score ?? -1), b?.comment);
  }
}
