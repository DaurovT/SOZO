import { AccessService } from '../access/access.service';
import { zoneLabel, resourceLabelLower } from '@sozo/contracts';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { masterShare, uuidv7 } from '@sozo/kernel';
import { MasterGuard, type MasterRequest } from './master.guard';
import { MasterWalkthroughController } from './master-walkthrough.controller';
import { MasterOpsController } from './master-ops.controller';
import { SyncLogService } from './sync-log.service';
import { MasterOffersService, DECLINE_REASONS, OFFER_TTL_SECONDS } from './offers.service';
import { MasterPhotoService } from './photo.service';
import { NotificationsService } from './notifications.service';
import { OrdersService } from '../orders/orders.service';
import type { OrderRecord } from '../orders/order.repository';
import { PricingService } from '../pricing/pricing.service';
import { BillingService } from '../billing/billing.service';
import { SchedulingService } from '../scheduling/scheduling.service';
import { MastersService } from '../masters/masters.module';
import { AuditService } from '../platform/audit.service';
import { CrmService } from '../crm/crm.service';
import { MasterOpsService } from './master-ops.service';
import { FieldService } from '../field/field.service';
import { tr } from '../../common/locale';
import { localDateKey } from '../../common/tz';


/** Действия, доступные мастеру. Всё остальное — диспетчер и система (PRD-02 §4) */
const MASTER_ACTIONS = new Set([
  'depart',
  'start',
  'confirm_estimate',
  'request_addwork',
  'pause',
  'resume',
  'complete_stage',
  'complete',
]);

/** Расстояние по сфере: для 300 м достаточно, тригонометрию не усложняем */
function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const ACTIVE_STATUSES = ['assigned', 'master_departed', 'in_progress', 'addwork_approval'];

/** Подписи кнопок конвейера — языком мастера, не языком графа (DEV-09) */
const ACTION_TITLES: Record<string, string> = {
  depart: 'Выехал',
  start: 'Приступить к работе',
  confirm_estimate: 'Смета согласована',
  request_addwork: 'Нужны доп-работы',
  pause: 'Пауза',
  resume: 'Продолжить',
  complete_stage: 'Этап завершён',
  complete: 'Работа выполнена',
};

/**
 * API приложения мастера (PRD-02, DEV-09) — экраны M-01…M-42.
 *
 * Принципиальное отличие от dispatch-контура: обстоятельства перехода
 * НЕ приходят флагами от клиента, а считаются на сервере из фактических данных заявки —
 * фото есть в хранилище, чеки приложены, приёмка зафиксирована. Мастер сообщает только то,
 * что знает лично: получил наличные, номер этапа, причина паузы.
 */

function windowText(from: string | null, to: string | null): string {
  if (!from || !to) return 'время не выбрано';
  const f = new Date(from);
  const tt = new Date(to);
  const day = f.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  const hm = (d: Date) => d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return `${day}, ${hm(f)} — ${hm(tt)}`;
}

@Controller('master')
@UseGuards(MasterGuard)
export class MasterApiController {
  constructor(
    private readonly orders: OrdersService,
    private readonly offersSvc: MasterOffersService,
    private readonly photos: MasterPhotoService,
    private readonly pricing: PricingService,
    private readonly billing: BillingService,
    private readonly scheduling: SchedulingService,
    private readonly masters: MastersService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly field: FieldService,
    private readonly ops: MasterOpsService,
    private readonly crm: CrmService,
    private readonly access: AccessService,
    private readonly walkthrough: MasterWalkthroughController,
    private readonly opsCtrl: MasterOpsController,
    private readonly syncLog: SyncLogService,
  ) {}

  // ---------- Профиль и смена (M-01, M-02, M-33) ----------

  /** M-33 «Профиль»: карточка, грейд, бейдж, показатели откликов */
  @Get('me')
  async me(@Req() req: MasterRequest) {
    const m = req.master!;
    const shift = this.offersSvc.shift(m.id);
    const all = await this.orders.list('t0');
    const mine = all.filter((o) => o.masterId === m.id || o.helperId === m.id);
    const closed = mine.filter((o) => ['closed', 'rated'].includes(o.status));
    const rated = closed.filter((o) => typeof o.rating === 'number');
    return {
      id: m.id,
      fullName: m.fullName,
      phone: m.phone,
      status: m.status,
      grade: m.grade,
      rating: m.rating,
      skillTags: m.skillTags,
      zones: m.zones,
      transport: m.transport,
      taxMode: m.taxMode,
      qrBadgeCode: m.qrBadgeCode,
      /** Документы с истекающим сроком — мастер видит это раньше, чем его снимут с линии */
      documents: m.documents,
      gphContractUntil: m.gphContractUntil,
      onProbation: m.status === 'training',
      shift: { online: shift.online, since: shift.since, lastPing: shift.lastPing },
      stats: {
        ordersTotal: mine.length,
        ordersClosed: closed.length,
        activeNow: mine.filter((o) => ACTIVE_STATUSES.includes(o.status)).length,
        avgRating: rated.length ? Math.round((rated.reduce((s, o) => s + (o.rating ?? 0), 0) / rated.length) * 10) / 10 : null,
        offers: this.offersSvc.responseStats(m.id),
      },
    };
  }

  /** M-02: начать / закончить смену. Гео пишем к событию, отсутствие — флаг, не отказ */
  @Post('shift')
  shiftToggle(@Body() b: { online?: boolean; lat?: number; lng?: number }, @Req() req: MasterRequest) {
    const m = req.master!;
    const geo = typeof b?.lat === 'number' && typeof b?.lng === 'number' ? { lat: b.lat, lng: b.lng } : undefined;
    const s = this.offersSvc.setOnline(m.id, !!b?.online, geo);
    this.audit.write({
      actorPhone: m.phone,
      action: s.online ? 'master.shift_started' : 'master.shift_ended',
      entity: 'MasterProfile',
      entityId: m.id,
      payload: { geoMissing: !geo },
    });
    return { online: s.online, since: s.since, geoMissing: !geo };
  }

  /** M-06 «Сегодня»: лента дня — заявки, окна, загрузка полосы, дежурство, итог дня */
  @Get('today')
  async today(@Query('date') date: string | undefined, @Req() req: MasterRequest) {
    const m = req.master!;
    const day = date ?? localDateKey();
    const all = await this.orders.list('t0');
    const mine = all.filter((o) => (o.masterId === m.id || o.helperId === m.id) && ACTIVE_STATUSES.includes(o.status));
    const lane = this.scheduling.lane(m.id, day);
    const shift = this.offersSvc.shift(m.id);
    const isDuty = this.scheduling.listShifts(day).some((s) => s.masterId === m.id && s.isDuty);
    // Заявка «в работе» — всегда первой: мастер открывает приложение, чтобы продолжить её
    const current = mine.find((o) => ['master_departed', 'in_progress', 'addwork_approval'].includes(o.status));

    // Итог дня — строка над лентой; тап ведёт в кошелёк (ТЗ 17.17 п.10)
    const closedToday = all.filter(
      (o) => o.masterId === m.id && ['closed', 'rated'].includes(o.status) && (o.statusLog.find((l) => l.to === 'closed')?.at.toString().slice(0, 10) ?? '') === day,
    );
    const dayEarnedTiyin = closedToday.reduce((s, o) => s + Number(masterShare(BigInt(o.baseFromTiyin || 0), 1000n, BigInt(this.orders.masterSharePermilleFor(o)))), 0);

    // Долг по наличным сверх лимита снимает с линии — единственное действие тогда «Внести» (ТЗ 8.2)
    const cashLimitTiyin = 200_000_000;
    const lockedByDebt = m.cashDebtTiyin >= cashLimitTiyin;
    const probationTarget = 20;
    const closedTotal = all.filter((o) => o.masterId === m.id && ['closed', 'rated'].includes(o.status)).length;

    return {
      date: day,
      shift: { online: shift.online, since: shift.since },
      current: current ? this.cardBrief(current, m.id) : null,
      upcoming: mine.filter((o) => o.id !== current?.id).map((o) => this.cardBrief(o, m.id)),
      lane,
      offersPending: this.offersSvc.pendingFor(m.id).length,
      unreadNotifications: this.notifications.unreadCount(m.id),
      day: { earnedTiyin: dayEarnedTiyin, orders: closedToday.length },
      duty: isDuty ? { minimumTiyin: 25_000_000, earnedTiyin: dayEarnedTiyin } : null,
      probation: m.status === 'training' ? { done: closedTotal, target: probationTarget } : null,
      cash: {
        debtTiyin: m.cashDebtTiyin,
        limitTiyin: cashLimitTiyin,
        locked: lockedByDebt,
        warning: !lockedByDebt && m.cashDebtTiyin >= cashLimitTiyin * 0.8 ? 'Долг близок к лимиту — внесите наличные' : undefined,
      },
      hint: lockedByDebt
        ? 'Сняты с линии: долг по наличным. Внесите через Payme, чтобы вернуться'
        : shift.online
          ? undefined
          : 'Смена не начата — офферы не приходят',
    };
  }

  /** M-07 «Завтра»: черновик маршрута, собирается вечером; тап — только «Не могу поехать» */
  @Get('tomorrow')
  async tomorrow(@Req() req: MasterRequest) {
    const m = req.master!;
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const day = d.toISOString().slice(0, 10);
    const all = await this.orders.list('t0');
    const mine = all.filter((o) => (o.masterId === m.id || o.helperId === m.id) && ACTIVE_STATUSES.includes(o.status));
    const isDuty = this.scheduling.listShifts(day).some((s) => s.masterId === m.id && s.isDuty);
    return {
      date: day,
      draft: true,
      note: 'Черновик — маршрут может измениться до утра',
      items: mine.map((o) => this.cardBrief(o, m.id)),
      duty: isDuty ? { minimumTiyin: 25_000_000 } : null,
      lane: this.scheduling.lane(m.id, day),
      empty: 'Лента на завтра собирается вечером',
    };
  }

  // ---------- Офферы (M-04) ----------

  @Get('offers')
  offers(@Req() req: MasterRequest) {
    const m = req.master!;
    return {
      ttlSeconds: OFFER_TTL_SECONDS,
      declineReasons: DECLINE_REASONS,
      items: this.offersSvc.pendingFor(m.id),
      note: 'Точный адрес и телефон клиента открываются после принятия (PRD-02 §3.2)',
    };
  }

  @Post('offers/:id/accept')
  async acceptOffer(@Param('id') id: string, @Body() b: { lat?: number; lng?: number }, @Req() req: MasterRequest) {
    const m = req.master!;
    /**
     * Заявку мог назначить диспетчер, пока оффер висел у мастера.
     *
     * Гонка двух офферов между собой закрыта, а вот проверки «заявку уже
     * назначили вручную» не было: условие `allowedActions.includes('assign')`
     * просто не выполнялось, ошибка не возвращалась, и метод отдавал полную
     * карточку. Мастер B жал «Принять», получал 200, адрес и телефон клиента
     * чужой заявки — и ехал на тот же адрес.
     */
    const pending = this.offersSvc.get(id);
    const before = await this.orders.record('t0', pending.orderId).catch(() => null);
    if (before?.masterId && before.masterId !== m.id) {
      this.offersSvc.revokeOffer(id, 'Заявку назначил диспетчер');
      throw new ConflictException({
        code: 'ORDER_ALREADY_ASSIGNED',
        message: 'Заявку уже назначили другому мастеру — оффер снят',
      });
    }
    const offer = this.offersSvc.accept(id, m.id);
    const order = await this.orders.get('t0', offer.orderId);
    // Назначение проводим по графу — assign валиден из estimated/approved/new в зависимости от типа
    if (order.allowedActions.includes('assign')) {
      await this.orders.transition(
        't0',
        offer.orderId,
        { action: 'assign', version: order.version, reason: `Принят мастером через приложение (оффер ${offer.id.slice(0, 8)})` } as never,
        m.phone,
        { masterId: m.id, masterName: m.fullName },
      );
    }
    this.offersSvc.trackGeo(m.id, 'offer.accepted', b?.lat && b?.lng ? { lat: b.lat, lng: b.lng } : null, offer.orderId);
    this.audit.write({ actorPhone: m.phone, action: 'offer.accepted', entity: 'Order', entityId: offer.orderId, payload: { offerId: offer.id } });
    const fresh = await this.orders.get('t0', offer.orderId);
    return this.cardFull(fresh, m.id);
  }

  @Post('offers/:id/decline')
  declineOffer(@Param('id') id: string, @Body() b: { reason?: string }, @Req() req: MasterRequest) {
    const m = req.master!;
    const offer = this.offersSvc.decline(id, m.id, b?.reason ?? '');
    this.audit.write({ actorPhone: m.phone, action: 'offer.declined', entity: 'Order', entityId: offer.orderId, payload: { reason: offer.declineReason } });
    return offer;
  }

  // ---------- Заявки (M-08…M-30) ----------

  @Get('orders')
  async list(@Query('scope') scope: string | undefined, @Req() req: MasterRequest) {
    const m = req.master!;
    const all = await this.orders.list('t0');
    const mine = all.filter((o) => o.masterId === m.id || o.helperId === m.id);
    const active = mine.filter((o) => ACTIVE_STATUSES.includes(o.status));
    const history = mine.filter((o) => ['completed', 'verified', 'awaiting_payment', 'closed', 'rated', 'cancelled', 'dispute'].includes(o.status));
    if (scope === 'history') return { items: history.map((o) => this.cardBrief(o, m.id)) };
    if (scope === 'active') return { items: active.map((o) => this.cardBrief(o, m.id)) };
    return { active: active.map((o) => this.cardBrief(o, m.id)), history: history.slice(0, 50).map((o) => this.cardBrief(o, m.id)) };
  }

  @Get('orders/:id')
  async card(@Param('id') id: string, @Req() req: MasterRequest) {
    const m = req.master!;
    const order = await this.mineOrThrow(id, m.id);
    return this.cardFull(order, m.id);
  }

  /**
   * Конвейер. Обстоятельства считает сервер: фото — из хранилища, чеки — из материалов,
   * приёмка — из поля acceptance. Мастер передаёт только личные факты (наличные, этап, причина).
   */
  @Post('orders/:id/actions')
  async act(
    @Param('id') id: string,
    @Body() b: { action?: string; version?: number; reason?: string; clientOpUuid?: string; lat?: number; lng?: number; payload?: Record<string, unknown> },
    @Req() req: MasterRequest,
  ) {
    const m = req.master!;
    const action = b?.action ?? '';
    if (!MASTER_ACTIONS.has(action)) {
      throw new ForbiddenException({
        code: 'ACTION_NOT_FOR_MASTER',
        message: tr('Это действие выполняет диспетчер. Мастеру доступны: {0}', [...MASTER_ACTIONS].join(', ')),
      });
    }
    const order = await this.mineOrThrow(id, m.id);
    const input = b?.payload ?? {};

    // «Я на месте» — отметка внутри выезда, статус не меняет
    if (action === 'depart' && input.arrivedOnly) {
      order.arrivedAt = new Date().toISOString();
      this.orders.touchOrder();
      this.offersSvc.trackGeo(m.id, 'order.arrived', this.geo(b), order.id);
      return this.cardFull(order, m.id);
    }

    const payload = { ...this.serverContext(order), ...this.masterInput(action, input) };
    const before = order.status;
    await this.orders.transition(
      't0',
      id,
      { action, version: b?.version ?? order.version, reason: b?.reason, clientOpUuid: b?.clientOpUuid, payload } as never,
      m.phone,
      // Мастер сообщает факты с объекта (чек-лист, представитель, отказ от
      // восстановления). Санкции диспетчера и модерация ему недоступны
      { roles: ['master'] },
    );

    // Пауза — суб-состояние: статус не меняется, фиксируем причину и время
    if (action === 'pause') {
      order.pause = { reason: String(input.reason ?? b?.reason ?? 'без причины'), since: new Date().toISOString() };
      this.orders.touchOrder();
    }
    if (action === 'resume') {
      order.pause = null;
      this.orders.touchOrder();
    }
    if (action === 'depart') order.arrivedAt = undefined;

    const geo = this.geo(b);
    this.offersSvc.trackGeo(m.id, `order.${action}`, geo, order.id);
    // Гео-контроль ±300 м при «Приступить»: расхождение — флаг диспетчеру,
    // конвейер не блокируется и мастеру ничего не показывается (ТЗ 7.2)
    if (action === 'start' && geo && order.lat != null && order.lng != null) {
      const meters = distanceMeters(geo.lat, geo.lng, order.lat, order.lng);
      if (meters > 300) {
        this.audit.write({
          actorPhone: m.phone,
          action: 'master.geo_mismatch',
          entity: 'Order',
          entityId: id,
          payload: { meters: Math.round(meters), note: 'Начало работ дальше 300 м от адреса заявки' },
        });
      }
    }
    this.audit.write({
      actorPhone: m.phone,
      action: `master.${action}`,
      entity: 'Order',
      entityId: id,
      payload: { from: before, reason: b?.reason, geoMissing: !this.geo(b) },
    });
    const fresh = await this.orders.get('t0', id);
    return this.cardFull(fresh, m.id);
  }

  /** M-13/M-27 камера: фото стадии. Файл на диск, серверный таймштамп — источник истины */
  @Post('orders/:id/photos')
  async photo(
    @Param('id') id: string,
    @Body() b: { stage?: string; dataUrl?: string; data?: string; lat?: number; lng?: number; note?: string; clientOpUuid?: string },
    @Req() req: MasterRequest,
  ) {
    const m = req.master!;
    const order = await this.mineOrThrow(id, m.id);
    const geo = this.geo(b);
    const r = await this.photos.save(order, {
      stage: b?.stage ?? 'before',
      dataUrl: b?.dataUrl,
      data: b?.data,
      note: b?.note,
      geo,
      clientOpUuid: b?.clientOpUuid,
      masterName: m.fullName,
    });
    if (!r.duplicate) this.offersSvc.trackGeo(m.id, `photo.${r.stage}`, geo, order.id);
    // `id` и `photoId` — одно и то же поле под двумя именами: приложение
    // читает `id`, наряд ссылается на `photoId`, и обоих в ответе не было
    return { ok: true, id: r.id, photoId: r.id, duplicate: r.duplicate, stage: r.stage, count: r.count, geoMissing: r.geoMissing };
  }

  /**
   * M-14/M-15 смета: позиции из релиза заявки, цена не редактируется вручную (ТЗ 3.7).
   *
   * Три вещи здесь были неправильны и все три про деньги:
   *
   *   · принадлежность проверялась, а статус — нет: смету можно было
   *     переписать на уже закрытой заявке;
   *   · релиз брался АКТИВНЫЙ и присваивался заявке, уничтожая заморозку цен
   *     годового договора — организация подписывала фиксированный прайс и
   *     получала пересчёт по текущему;
   *   · наценка «срочно» была захардкожена как 1.3 мимо параметра и, главное,
   *     записывалась в БАЗУ. Основной сервис намеренно держит базу без
   *     наценки — иначе она молча увеличивает и долю мастера, а это отдельное
   *     решение владельца, а не следствие галочки в приложении.
   */
  @Post('orders/:id/quote')
  async quote(
    @Param('id') id: string,
    @Body() b: { lines?: Array<{ priceItemId: string; qty?: number }>; urgent?: boolean; note?: string },
    @Req() req: MasterRequest,
  ) {
    const m = req.master!;
    const order = await this.mineOrThrow(id, m.id);
    const QUOTABLE = ['assigned', 'master_departed', 'in_progress', 'addwork_approval', 'estimated', 'new'];
    if (!QUOTABLE.includes(order.status)) {
      throw new BadRequestException({
        code: 'QUOTE_STAGE_INVALID',
        message: `Смету составляют до завершения работ; заявка в статусе «${order.status}»`,
      });
    }
    // Релиз заявки, а не текущий: у годового договора цены заморожены
    let release;
    try {
      release = this.pricing.get(order.priceListReleaseId);
    } catch {
      release = this.pricing.active();
    }
    const lines = (b?.lines ?? []).map((l) => {
      const item = release.items.find((i) => i.id === l.priceItemId);
      if (!item) throw new BadRequestException({ code: 'PRICE_ITEM_UNKNOWN', message: 'Позиция отсутствует в активном релизе прайса' });
      // Позиция доступна только мастеру с нужным тегом (ТЗ 3.7)
      const missing = item.requiredSkills.filter((s) => !m.skillTags.includes(s));
      if (missing.length) {
        throw new ForbiddenException({
          code: 'SKILL_REQUIRED',
          message: tr('«{0}» требует допуск: {1}. Вызовите помощника или передайте заявку.', item.name, missing.join(', ')),
        });
      }
      const qty = Math.max(1, Number(l.qty ?? 1));
      return {
        priceItemId: item.id,
        name: item.name,
        unit: item.unit,
        priceFromTiyin: item.priceFromTiyin,
        priceToTiyin: item.priceToTiyin,
        qty,
      };
    });
    if (!lines.length) throw new BadRequestException({ code: 'LINES_REQUIRED', message: 'Добавьте хотя бы одну позицию' });

    // Наценка «Срочно» — из параметра, а не из литерала, и только к итогу
    const urgentPercent = b?.urgent ? this.orders.urgentSurchargePercent() : 0;
    const baseFrom = lines.reduce((s, l) => s + l.priceFromTiyin * l.qty, 0);
    const baseTo = lines.reduce((s, l) => s + l.priceToTiyin * l.qty, 0);
    const withUrgency = (v: number) => v + Math.floor((v * urgentPercent) / 100);
    const from = withUrgency(baseFrom);
    const to = withUrgency(baseTo);
    order.lines = lines;
    // База — без наценки: от неё считается доля мастера, и наценка не должна
    // молча её увеличивать
    order.baseFromTiyin = baseFrom;
    order.baseToTiyin = baseTo;
    order.totalFromTiyin = from;
    order.totalToTiyin = to;
    order.urgentSurchargePercent = urgentPercent || undefined;
    order.quotes.push({
      kind: 'initial',
      amountTiyin: from,
      note: `Смета мастера${urgentPercent ? ` · срочно +${urgentPercent}%` : ''}${b?.note ? ` · ${b.note}` : ''}`,
      at: new Date().toISOString(),
    });
    this.orders.touchOrder();
    this.audit.write({ actorPhone: m.phone, action: 'master.quote_drafted', entity: 'Order', entityId: id, payload: { amountTiyin: from, lines: lines.length } });
    return {
      lines,
      totalFromTiyin: from,
      totalToTiyin: to,
      masterShareFromTiyin: Number(masterShare(BigInt(baseFrom), 1000n, BigInt(this.orders.masterSharePermilleFor(order)))),
      next: 'Отправьте смету клиенту: подтверждение в приложении, звонком диспетчера или подписью офлайн',
    };
  }

  /** M-19 материалы: запчасть без чека блокирует завершение (ТЗ 8.4) */
  @Post('orders/:id/materials')
  async material(
    @Param('id') id: string,
    @Body() b: { kind?: 'spare_part' | 'consumable'; name?: string; amountSoums?: number; sourceChannel?: string; receiptDataUrl?: string; priceTier?: string },
    @Req() req: MasterRequest,
  ) {
    const m = req.master!;
    await this.mineOrThrow(id, m.id);
    if (!b?.name?.trim()) throw new BadRequestException({ code: 'NAME_REQUIRED' });
    const kind = b?.kind ?? 'spare_part';
    // Запчасть без чека не сохраняется вовсе (ТЗ 8.4) — говорим об этом до, а не после ввода
    if (kind === 'spare_part' && !b?.receiptDataUrl) {
      throw new BadRequestException({
        code: 'RECEIPT_PHOTO_REQUIRED',
        message: 'Сфотографируйте чек — запчасть без чека внести нельзя. Без чека проводятся только расходники «сумки».',
      });
    }
    let hasReceipt = false;
    if (b?.receiptDataUrl) {
      await this.photo(id, { stage: 'receipt', dataUrl: b.receiptDataUrl, note: tr('чек: {0}', b.name) }, req);
      hasReceipt = true;
    }
    const order = await this.orders.addMaterial('t0', id, {
      kind,
      name: b.name,
      amountTiyin: Math.round((b?.amountSoums ?? 0) * 100),
      sourceChannel: b?.sourceChannel ?? 'partner_store',
      hasReceipt: kind === 'consumable' ? true : hasReceipt, // расходники «сумки» чека не требуют
      priceTier: b?.priceTier,
    });
    // Внесённый материал и есть факт покупки: снимаем позицию со списка закупки,
    // не требуя от мастера отмечать одно и то же дважды
    this.ops.markProcuredByMaterial(id, b.name);
    return { materials: order.materials, totalMaterialTiyin: order.totalMaterialTiyin };
  }

  /**
   * Список закупки мастера: что клиент выбрал и что ещё надо купить.
   *
   * Склада запчастей нет — их берут в партнёрских магазинах, поэтому
   * «зарезервировать» нечего. Задача другая: не дать выехать без детали.
   */
  @Get('procurement')
  procurement(@Req() req: MasterRequest) {
    const m = req.master!;
    const rows = this.ops.toProcure(m.id).map((s) => {
      const v = s.variants.find((x) => x.tier === s.chosenTier);
      return {
        id: s.id,
        orderId: s.orderId,
        partName: s.partName,
        tier: s.chosenTier,
        tierTitle: s.chosenTier === 'economy' ? 'Эконом' : s.chosenTier === 'premium' ? 'Премиум' : 'Стандарт',
        title: v?.title ?? null,
        amountTiyin: v?.amountTiyin ?? 0,
        chosenAt: s.chosenAt,
      };
    });
    return {
      items: rows,
      totalTiyin: rows.reduce((s, r) => s + r.amountTiyin, 0),
      empty: 'Покупать нечего — все выбранные позиции уже в заявках',
    };
  }

  @Post('procurement/:id/bought')
  markBought(@Param('id') id: string, @Body() b: { note?: string }, @Req() req: MasterRequest) {
    const rec = this.ops.markProcured(id, b?.note);
    this.audit.write({
      actorPhone: req.master!.phone,
      action: 'master.part_procured',
      entity: 'Order',
      entityId: rec.orderId,
      payload: { part: rec.partName, tier: rec.chosenTier },
    });
    return { ok: true, message: 'Отметили как купленное' };
  }

  /** M-29 приёмка: код клиента, подпись пальцем или «клиента не было» + фото (ТЗ 4.1) */
  @Post('orders/:id/acceptance')
  async acceptance(
    @Param('id') id: string,
    @Body() b: { method?: 'code' | 'signature' | 'absent_with_photo'; code?: string; signatureDataUrl?: string; signerName?: string },
    @Req() req: MasterRequest,
  ) {
    const m = req.master!;
    const order = await this.mineOrThrow(id, m.id);
    const method = b?.method ?? 'code';
    if (method === 'code' && !/^\d{4}$/.test(b?.code ?? '')) {
      throw new BadRequestException({ code: 'CODE_INVALID', message: 'Код приёмки — 4 цифры из приложения клиента' });
    }
    // Сверка с кодом, выданным приложению клиента. Пока приложения не было,
    // проходили любые четыре цифры — то есть приёмка кодом ничего не значила.
    if (method === 'code' && order.acceptanceCode && b?.code !== order.acceptanceCode) {
      throw new BadRequestException({
        code: 'CODE_MISMATCH',
        message: 'Код не совпал. Попросите клиента назвать код с экрана приёмки',
      });
    }
    if (method === 'signature' && !b?.signatureDataUrl) {
      throw new BadRequestException({ code: 'SIGNATURE_REQUIRED', message: 'Попросите клиента расписаться на экране' });
    }
    if (method === 'absent_with_photo' && !order.photos.some((p) => p.stage === 'after')) {
      throw new BadRequestException({
        code: 'PHOTO_REQUIRED',
        message: 'Клиента не было — приёмка фиксируется фотографиями «после». Снимите результат.',
      });
    }
    order.acceptance = {
      method,
      code: b?.code,
      signatureDataUrl: b?.signatureDataUrl,
      signerName: b?.signerName,
      at: new Date().toISOString(),
    };
    this.orders.touchOrder();
    this.audit.write({ actorPhone: m.phone, action: 'master.acceptance_fixed', entity: 'Order', entityId: id, payload: { method } });
    return { ok: true, method, next: 'Приёмка зафиксирована — можно завершать заявку' };
  }

  // ---------- Деньги (M-31, M-32) ----------

  @Get('earnings')
  async earnings(@Req() req: MasterRequest) {
    const m = req.master!;
    const payout = this.billing.payouts().find((p) => p.masterId === m.id);
    const all = await this.orders.list('t0');
    const mine = all.filter((o) => o.masterId === m.id && ['closed', 'rated'].includes(o.status));
    const startOfWeek = new Date();
    startOfWeek.setHours(0, 0, 0, 0);
    startOfWeek.setDate(startOfWeek.getDate() - ((startOfWeek.getDay() + 6) % 7));
    const shareOf = (o: OrderRecord) => Number(masterShare(BigInt(o.baseFromTiyin || 0), 1000n, BigInt(this.orders.masterSharePermilleFor(o))));
    const week = mine.filter((o) => new Date(o.createdAt).getTime() >= startOfWeek.getTime());
    return {
      accruedTiyin: payout?.accruedTiyin ?? 0,
      paidTiyin: payout?.paidTiyin ?? 0,
      dueTiyin: payout?.dueTiyin ?? 0,
      cashDebtTiyin: m.cashDebtTiyin, // наличные на руках — сдать в кассу (ТЗ 8.2)
      weekTiyin: week.reduce((s, o) => s + shareOf(o), 0),
      weekOrders: week.length,
      sharePercent: 55,
      orders: mine.slice(0, 30).map((o) => ({
        id: o.id,
        number: o.number,
        closedAt: o.statusLog.find((l) => l.to === 'closed')?.at,
        baseTiyin: o.baseFromTiyin,
        shareTiyin: shareOf(o),
        rating: o.rating,
      })),
      note: m.cashDebtTiyin > 0 ? 'Наличные на руках сдаются в кассу; при просрочке офферы приостанавливаются (ТЗ 8.2)' : undefined,
    };
  }

  // ---------- Офлайн (M-40) ----------

  /** Каталог для офлайн-кеша: только позиции по допускам мастера */
  @Get('catalog')
  catalog(@Req() req: MasterRequest) {
    const m = req.master!;
    const release = this.pricing.active();
    return {
      releaseId: release.id,
      releaseNumber: release.number,
      items: release.items
        .filter((i) => i.requiredSkills.every((s) => m.skillTags.includes(s)))
        .map((i) => ({
          id: i.id,
          category: i.category,
          name: i.name,
          unit: i.unit,
          priceFromTiyin: i.priceFromTiyin,
          priceToTiyin: i.priceToTiyin,
          normHours: i.normHours,
          isPaired: i.isPaired,
          isStaged: i.isStaged,
        })),
      declineReasons: DECLINE_REASONS,
    };
  }

  /**
   * Список видов, которые умеет применять сервер.
   *
   * Нужен прогону: он читает виды прямо из исходников приложения и сверяет с
   * этим списком. Расхождение здесь — это потерянная работа мастера, и
   * поймать его тестом дешевле, чем письмом из поля.
   */
  @Get('sync-kinds')
  syncKinds() {
    return { kinds: MasterApiController.SYNC_KINDS };
  }

  /**
   * Виды операций офлайн-очереди, которые умеет применять сервер.
   *
   * Отдаётся наружу ради прогона, который читает виды прямо из исходников
   * приложения и сверяет с этим списком. Ровно такой пятистрочной проверки не
   * было — и из-за этого больше половины видов очереди сервер не знал вовсе:
   * `addwork`, `conservation`, `delay`, `spare_tiers`, `recommendation`,
   * `asset`, `shopping_list`, `payment`, `permit_*`, `shutdown_*`, `branch_*`
   * получали `KIND_UNKNOWN`. Мастер вносил доп-работу в подвале, видел
   * «уйдёт при связи», а при появлении сети операция вставала с ошибкой — и
   * единственной кнопкой в интерфейсе было «убрать из очереди», то есть
   * удалить собственную работу за день.
   */
  static readonly SYNC_KINDS = [
    'photo',
    'action',
    'quote',
    'material',
    'acceptance',
    'observation',
    'walk_zone',
    'walk_finish',
    'addwork',
    'conservation',
    'delay',
    'spare_tiers',
    'recommendation',
    'asset',
    'shopping_list',
    'payment',
    /**
     * «Нет доступа» приходит под двумя именами, и оба живут.
     *
     * Экран ветвлений собирает вид интерполяцией — `branch_${kind.name}`, — а
     * `BranchKind.noAccess` даёт `branch_noAccess`. Онлайн-метод при этом
     * называется `noAccess`, и по нему вид ошибочно назвали `no_access`.
     * Переименовать в приложении нельзя: очереди с этим именем уже лежат на
     * телефонах у мастеров, и обновление сделало бы их операции неизвестными
     * задним числом — ровно та потеря данных, ради устранения которой всё это
     * и делается. Принимаем оба.
     */
    'no_access',
    'branch_noAccess',
    'branch_clientUnavailable',
    'branch_unsafe',
    'branch_cantGo',
    'permit_open',
    'permit_close',
    'shutdown_start',
    'shutdown_restore',
  ] as const;

  /**
   * M-40 выгрузка офлайн-очереди.
   *
   * Операции применяются строго по порядку; первая упавшая останавливает
   * цепочку по своей заявке — иначе фото «после» прилетит раньше начала
   * работ. Идемпотентность — по `clientOpUuid`, и теперь для всех видов
   * сразу (см. SyncLogService), а не только для фото и действий.
   */
  @Post('sync')
  async sync(
    @Body() b: { ops?: Array<{ clientOpUuid: string; orderId: string; kind: string; payload: Record<string, unknown>; deviceTime: string }> },
    @Req() req: MasterRequest,
  ) {
    const m = req.master!;
    const ops = b?.ops ?? [];
    const results: Array<{ clientOpUuid: string; status: 'applied' | 'duplicate' | 'failed' | 'skipped'; code?: string; message?: string }> = [];
    const blocked = new Set<string>();

    for (const op of ops) {
      // Ключ цепочки — обычно заявка: порядок действий по одной заявке значим,
      // и после неудачи следующие пропускаются, а не применяются к чужому
      // состоянию. Замечания независимы друг от друга: одно испорченное не
      // должно навсегда запирать очередь со снимками остальных.
      const chainKey = op.kind === 'observation' ? op.clientOpUuid : op.orderId;
      if (blocked.has(chainKey)) {
        results.push({ clientOpUuid: op.clientOpUuid, status: 'skipped', code: 'CHAIN_BLOCKED', message: 'Предыдущая операция по заявке не прошла' });
        continue;
      }
      // Тот же ключ — тот же результат. Приложение, потеряв ответ, обязано
      // отправить пакет заново, и второй материал заводиться не должен
      const seen = this.syncLog.seen(m.id, op.clientOpUuid);
      if (seen) {
        results.push({ clientOpUuid: op.clientOpUuid, status: 'duplicate', code: seen.code, message: seen.message });
        continue;
      }
      const body = { ...(op.payload ?? {}), clientOpUuid: op.clientOpUuid };
      try {
        await this.applySyncOp(op, body, req);
        results.push({ clientOpUuid: op.clientOpUuid, status: 'applied' });
        this.syncLog.remember({ clientOpUuid: op.clientOpUuid, masterId: m.id, kind: op.kind, orderId: op.orderId, at: new Date().toISOString(), status: 'applied' });
      } catch (e) {
        const err = e as { response?: { code?: string; message?: string }; message?: string };
        const code = err.response?.code ?? 'ERROR';
        const message = err.response?.message ?? err.message;
        results.push({ clientOpUuid: op.clientOpUuid, status: 'failed', code, message });
        blocked.add(chainKey);
        /**
         * Неприменимую операцию запоминаем тоже, но только ту, повтор которой
         * ничего не изменит: неизвестный вид или несуществующая заявка. Отказ
         * по состоянию (не тот статус, не хватает фото) не запоминаем — такой
         * повтор как раз имеет смысл.
         */
        if (code === 'KIND_UNKNOWN' || code === 'ORDER_NOT_FOUND') {
          this.syncLog.remember({ clientOpUuid: op.clientOpUuid, masterId: m.id, kind: op.kind, orderId: op.orderId, at: new Date().toISOString(), status: 'failed', code, message });
        }
      }
    }
    this.audit.write({
      actorPhone: m.phone,
      action: 'master.offline_sync',
      entity: 'MasterProfile',
      entityId: m.id,
      payload: { total: ops.length, applied: results.filter((r) => r.status === 'applied').length, failed: results.filter((r) => r.status === 'failed').length },
    });
    return { results, serverTime: new Date().toISOString() };
  }

  /**
   * Применение одной операции очереди.
   *
   * Маршруты один в один с онлайн-путями экранов: очередь — это тот же
   * запрос, только отложенный, и расхождение между «сделал при связи» и
   * «сделал в подвале» недопустимо по определению.
   */
  private async applySyncOp(
    op: { clientOpUuid: string; orderId: string; kind: string; payload: Record<string, unknown> },
    body: Record<string, unknown>,
    req: MasterRequest,
  ): Promise<void> {
    const p = (op.payload ?? {}) as Record<string, unknown>;
    switch (op.kind) {
      case 'photo':
        await this.photo(op.orderId, body as never, req);
        return;
      case 'action': {
        /**
         * Версия перебазируется на текущую.
         *
         * Приложение кладёт в payload версию заявки на момент постановки в
         * очередь и офлайн обновить её не может — ответа нет. Поэтому все
         * накопленные действия несут ОДИН номер: применялось первое, второе
         * падало конфликтом версий, третье пропускалось как заблокированное,
         * и работа мастера за день не доезжала.
         *
         * Внутри очереди оптимистическая блокировка не нужна и вредна:
         * порядок операций по заявке строгий, повтор ловится ключом
         * операции, а конкурировать здесь не с кем — это одна и та же лента
         * одного и того же мастера. Строгая сверка версии остаётся на
         * онлайн-переходах, где карточка у мастера свежая.
         */
        const order = await this.mineOrThrow(op.orderId, req.master!.id);
        await this.act(op.orderId, { ...body, version: order.version } as never, req);
        return;
      }
      case 'quote':
        await this.quote(op.orderId, op.payload as never, req);
        return;
      case 'material':
        await this.material(op.orderId, body as never, req);
        return;
      case 'acceptance':
        await this.acceptance(op.orderId, op.payload as never, req);
        return;
      case 'observation':
        // orderId в этих операциях несёт объект: обход не привязан к заявке
        await this.walkthrough.addObservation(op.orderId, op.payload as never, req);
        return;
      case 'walk_zone':
        this.walkthrough.passZone((op.payload as { walkId: string }).walkId, op.payload as never, req);
        return;
      case 'walk_finish':
        this.walkthrough.finishWalk((op.payload as { walkId: string }).walkId, req);
        return;

      // ---- виды, которых сервер не знал вовсе (находка M1) ----
      case 'addwork':
        await this.opsCtrl.addwork(op.orderId, op.payload as never, req);
        return;
      case 'conservation':
        await this.opsCtrl.conservation(op.orderId, op.payload as never, req);
        return;
      case 'delay':
        await this.opsCtrl.delay(op.orderId, op.payload as never, req);
        return;
      case 'no_access':
      case 'branch_noAccess':
        await this.opsCtrl.noAccess(op.orderId, op.payload as never, req);
        return;
      case 'spare_tiers':
        await this.opsCtrl.spareTiers(op.orderId, op.payload as never, req);
        return;
      case 'recommendation':
        await this.opsCtrl.recommend(op.orderId, op.payload as never, req);
        return;
      case 'asset':
        await this.opsCtrl.addAsset(op.orderId, op.payload as never, req);
        return;
      case 'shopping_list':
        await this.opsCtrl.shoppingList(op.orderId, op.payload as never, req);
        return;
      case 'payment':
        await this.opsCtrl.payment(op.orderId, op.payload as never, req);
        return;
      case 'branch_clientUnavailable':
        await this.opsCtrl.clientUnavailable(op.orderId, op.payload as never, req);
        return;
      case 'branch_unsafe':
        await this.opsCtrl.abortUnsafe(op.orderId, op.payload as never, req);
        return;
      case 'branch_cantGo':
        await this.opsCtrl.cantGo(op.orderId, op.payload as never, req);
        return;
      case 'permit_open':
      case 'permit_close': {
        const permitId = String(p.permitId ?? '');
        if (!permitId) throw new BadRequestException({ code: 'PERMIT_REQUIRED', message: 'В операции наряда нет идентификатора' });
        this.access.transition(
          't0',
          permitId,
          {
            action: op.kind === 'permit_open' ? 'open' : 'close',
            clientOpUuid: op.clientOpUuid,
            photoId: typeof p.photoId === 'string' ? p.photoId : undefined,
            zoneSecured: p.zoneSecured === true,
          },
          { phone: req.master!.phone, isApprover: false, scopedToBuilding: true },
        );
        return;
      }
      case 'shutdown_start':
        this.access.startShutdown('t0', String(p.shutdownId ?? ''));
        return;
      case 'shutdown_restore':
        this.access.restoreShutdown('t0', String(p.shutdownId ?? ''));
        return;
      default:
        throw new BadRequestException({
          code: 'KIND_UNKNOWN',
          message: `Сервер не знает вид операции «${op.kind}» — обновите приложение`,
        });
    }
  }

  // ---------- Внутреннее ----------

  private geo(b: { lat?: number; lng?: number } | undefined): { lat: number; lng: number } | null {
    return typeof b?.lat === 'number' && typeof b?.lng === 'number' ? { lat: b.lat, lng: b.lng } : null;
  }

  private async mineOrThrow(id: string, masterId: string): Promise<OrderRecord> {
    const order = await this.orders.record('t0', id);
    if (order.masterId !== masterId && order.helperId !== masterId) {
      // Чужую заявку не показываем даже фактом существования
      throw new NotFoundException({ code: 'ORDER_NOT_FOUND' });
    }
    return order;
  }

  /**
   * Обстоятельства перехода из фактических данных заявки.
   * Это и есть разница между dev-чекбоксом и настоящим приложением:
   * «фото есть» — потому что файл лежит в хранилище, а не потому что кто-то поставил галочку.
   */
  private serverContext(order: OrderRecord): Record<string, unknown> {
    const approved = [...order.quotes].reverse().find((q) => q.kind === 'approved');
    const act = this.field.byOrder(order.id);
    return {
      photosBefore: order.photos.filter((p) => p.stage === 'before').length,
      photosAfter: order.photos.filter((p) => p.stage === 'after').length,
      photoEvidence: order.photos.filter((p) => p.stage === 'during').length > 0,
      materialsWithoutReceipt: order.materials.filter((m) => m.kind === 'spare_part' && !m.hasReceipt).length,
      totalEqualsSanctioned: !!approved && approved.amountTiyin === order.totalFromTiyin,
      acceptanceFixed: !!order.acceptance,
      restrictedSite: !!order.restrictedSite, // режимный объект: код и подпись вместо фото (ТЗ 4.1)
      dispatcherSanction: false, // мастер не санкционирует сам себя
      moderationPassed: false,
      billingPosted: false,
      paymentConfirmed: false,
      // Осмотр: обход подтверждается заполненным чек-листом и отправленным актом.
      // Ждать решения ответственного мастер не обязан — он не может стоять на
      // объекте, пока тот читает акт; решение придёт в клиентское приложение.
      checklistFilled: (act?.checklist.length ?? 0) > 0,
      representativeFixed: !!act && act.status !== 'draft',
    };
  }

  /** Что мастеру позволено сообщить о себе — узкий белый список */
  private masterInput(action: string, input: Record<string, unknown>): Record<string, unknown> {
    switch (action) {
      case 'complete':
        return { paymentCollected: !!input.paymentCollected, isLastSession: input.isLastSession !== false };
      case 'request_addwork':
        return { isUpsell: !!input.isUpsell, amountTiyin: Number(input.amountSoums ?? 0) * 100 };
      case 'confirm_estimate':
        return { via: String(input.via ?? 'offline_signature'), amountTiyin: Number(input.amountSoums ?? 0) * 100 || undefined };
      case 'complete_stage':
        return { stageChainConfirmed: true, isLastSession: !!input.isLastSession };
      default:
        return {};
    }
  }

  /** Доступ к объекту B2B — из паспорта точки. Для частного адреса пусто */
  private siteAccessOf(o: OrderRecord) {
    if (!o.organizationId || !o.locationId) return null;
    const loc = this.crm.get(o.organizationId).locations.find((l) => l.id === o.locationId);
    if (!loc) return null;
    const a = loc.access;
    if (!a.schedule && !a.accessNotes && !a.hoaContact) return null;
    return {
      locationName: loc.name,
      schedule: a.schedule,
      accessNotes: a.accessNotes,
      hoaContact: a.hoaContact,
      photoForbidden: loc.photoForbidden,
    };
  }

  private cardBrief(o: OrderRecord, masterId: string) {
    return {
      id: o.id,
      number: o.number,
      status: o.status,
      graphType: o.graphType,
      urgency: o.urgency,
      clientName: o.clientName,
      address: o.address,
      lat: o.lat,
      lng: o.lng,
      description: o.description,
      totalFromTiyin: o.totalFromTiyin,
      totalToTiyin: o.totalToTiyin,
      myShareTiyin: Number(masterShare(BigInt(o.baseFromTiyin || 0), 1000n, BigInt(this.orders.masterSharePermilleFor(o)))),
      role: o.helperId === masterId ? 'helper' : 'lead',
      arrivedAt: o.arrivedAt,
      paused: !!o.pause,
      createdAt: o.createdAt,
    };
  }

  /**
   * Наряд-допуск для карточки мастера (M-43). Кладётся В КАРТОЧКУ, а не отдаётся
   * отдельным запросом: в подвале второго запроса не будет, и наряд должен
   * приехать в устройство вместе с заявкой (DEV-15 §10.8.1).
   */
  private permitOf(o: OrderRecord) {
    const permits = this.access.permitsOfOrder('t0', o.id);
    if (permits.length === 0) return null;
    // берём последний живой: аннулированные и отклонённые мастеру не нужны
    const live =
      permits.find((p) => p.status === 'opened') ??
      permits.find((p) => p.status === 'scheduled' || p.status === 'approved') ??
      permits.find((p) => p.status === 'requested' || p.status === 'rescheduled') ??
      permits[permits.length - 1];
    const pass = this.access.passOfOrder('t0', o.id, o.masterId ?? '');
    const shutdown = live.requiresShutdown ? this.access.shutdownOfOrder('t0', o.id) : null;
    const building = live.buildingId ? this.access.buildingBrief('t0', live.buildingId) : null;
    return {
      id: live.id,
      status: live.status,
      zoneLabels: live.zoneTypes.map((z) => zoneLabel(z)),
      hasCriticalZone: live.hasCriticalZone,
      requiresShutdown: live.requiresShutdown,
      affectedUnitIds: live.affectedUnitIds,
      windowText: windowText(live.windowFrom, live.windowTo),
      escortName: null,
      dutyPhone: building?.dispatchPhone ?? building?.emergencyPhone ?? null,
      shutdownId: shutdown?.id ?? null,
      shutdownResource: shutdown ? resourceLabelLower(shutdown.resourceType) : null,
      shutdownStartedAt: shutdown?.actualFrom ?? null,
      qrToken: pass?.qrToken ?? null,
      fallbackCode: pass?.fallbackCode ?? null,
      passRules: building
        ? [
            building.parkingRules,
            building.hasServiceLift ? 'Грузовой лифт есть' : 'Грузового лифта нет',
            `Шумные работы: ${building.noiseFrom}—${building.noiseTo}`,
          ].filter((x): x is string => Boolean(x))
        : [],
    };
  }

  private cardFull(o: OrderRecord, masterId: string) {
    const allowed = this.steps(o);
    return {
      ...this.cardBrief(o, masterId),
      version: o.version,
      permit: this.permitOf(o),
      clientPhone: o.clientPhone, // открыт только после назначения — карточка доступна лишь своему мастеру
      /**
       * Детали доступа, которые клиент уточнил после назначения (C-50).
       * Без них мастер стоит у подъезда и звонит спрашивать номер квартиры —
       * при том, что клиент это уже написал.
       */
      addressDetails: o.addressDetails ?? null,
      /**
       * Пропускной режим объекта: график, как попасть, контакт УК.
       *
       * Всё это заведено в паспорте точки и до сих пор попадало только в
       * PDF-отчёт. Мастер приезжал к закрытому объекту и звонил диспетчеру
       * выяснять, у кого ключи, — при том, что ответ давно записан.
       */
      siteAccess: this.siteAccessOf(o),
      /**
       * Техника этого клиента: что уже стоит и когда обслуживалось.
       *
       * Мастер приезжает к кондиционеру, который сам же ставил полгода назад,
       * и узнаёт об этом только со слов клиента. История здесь экономит
       * диагностику и не даёт продать то, что уже сделано.
       */
      /**
       * Что надо купить до выезда по этой заявке.
       *
       * Клиент выбрал вариант запчасти — деталь ещё в магазине. Без этой
       * строки мастер узнаёт об этом на объекте.
       */
      toBuy: this.ops.toProcure().filter((s) => s.orderId === o.id).map((s) => ({
        id: s.id,
        partName: s.partName,
        tierTitle: s.chosenTier === 'economy' ? 'Эконом' : s.chosenTier === 'premium' ? 'Премиум' : 'Стандарт',
        amountTiyin: s.variants.find((v) => v.tier === s.chosenTier)?.amountTiyin ?? 0,
      })),
      clientAssets: this.ops.assetsOf(o.clientPhone).map((a) => ({
        id: a.id,
        type: a.type,
        brand: a.brand ?? null,
        model: a.model ?? null,
        year: a.year ?? null,
        plateUnreadable: a.plateUnreadable,
        linkedWork: a.linkedWork,
        addedAt: a.createdAt,
        // Заведена по этой же заявке — не «история», а то, что ставим сейчас
        fromThisOrder: a.orderId === o.id,
      })),
      lines: o.lines,
      quotes: o.quotes,
      photos: o.photos.map((p) => ({ id: p.id, stage: p.stage, file: p.file, geoMissing: p.geoMissing, at: p.at })),
      materials: o.materials,
      totalMaterialTiyin: o.totalMaterialTiyin,
      acceptance: o.acceptance,
      pause: o.pause,
      statusLog: o.statusLog,
      allowedActions: allowed.map((a) => a.action),
      /**
       * Кнопки конвейера с причиной блокировки. Причину даёт та же машина состояний,
       * что откажет при нажатии — приложение не гадает, а показывает ответ сервера заранее.
       */
      steps: allowed,
      blockers: allowed.filter((a) => !a.enabled).map((a) => a.reason!),
    };
  }

  /** Прогоняем каждое доступное мастеру действие вхолостую — по guards его графа */
  private steps(o: OrderRecord) {
    const ctx = this.serverContext(o);
    return this.orders
      .allowedActionsFor(o)
      .filter((a) => MASTER_ACTIONS.has(a))
      .map((action) => {
        // «Оплата собрана» знает только мастер — на предпросмотре считаем оптимистично,
        // иначе кнопка «Завершить» была бы вечно серой
        const check = this.orders.preflight(o, action, { ...ctx, paymentCollected: true } as never);
        return { action, title: ACTION_TITLES[action] ?? action, enabled: check.ok, reason: check.ok ? undefined : check.message };
      });
  }
}
