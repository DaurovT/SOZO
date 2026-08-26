import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuditService } from '../platform/audit.service';
import { BillingService } from '../billing/billing.service';
import { DispatchOpsService } from '../dispatch-ops/dispatch-ops.service';
import { MasterOpsService } from '../master-api/master-ops.service';
import { NotificationsService } from '../master-api/notifications.service';
import { OrdersService } from '../orders/orders.service';
import type { OrderRecord } from '../orders/order.repository';
import { QualityService } from '../quality/quality.service';
import { PromoService } from '../promo/promo.module';
import { SchedulingService } from '../scheduling/scheduling.service';
import { AppGuard, type AppRequest } from './app.guard';
import { ClientPhotoService } from './client-photo.service';
import { ClientProfilesService } from './client-profiles.service';
import { ClientViewService } from './client-view.service';

/**
 * Действия клиента по своей заявке (C-14…C-22, C-50).
 *
 * Все решения — только онлайн: согласие на смету и отказ от доп-работ
 * фиксируются в аудите как юридические факты, и офлайн-очереди у них
 * быть не может (DEV-08 C-15).
 */
@Controller('app/orders')
@UseGuards(AppGuard)
export class ClientOrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly ops: MasterOpsService,
    private readonly notifications: NotificationsService,
    private readonly profiles: ClientProfilesService,
    private readonly photos: ClientPhotoService,
    private readonly view: ClientViewService,
    private readonly audit: AuditService,
    private readonly quality: QualityService,
    private readonly billing: BillingService,
    private readonly dispatch: DispatchOpsService,
    private readonly sched: SchedulingService,
    private readonly promo: PromoService,
  ) {}

  /** Общая часть обращения к диспетчеру: кто, по какой заявке, с каким мастером */
  private clientRequestBase(req: AppRequest, order: OrderRecord) {
    return {
      orderId: order.id,
      orderNumber: order.number,
      clientPhone: this.phone(req),
      clientName: order.clientName,
      masterId: order.masterId,
      masterName: order.masterName,
    };
  }

  private phone(req: AppRequest): string {
    return req.clientPhone!;
  }

  private async mine(req: AppRequest, id: string): Promise<OrderRecord> {
    const order = await this.orders.record('t0', id);
    if (order.clientPhone !== this.phone(req)) {
      throw new ForbiddenException({ code: 'FOREIGN_ORDER', message: 'Это не ваша заявка' });
    }
    return order;
  }

  private log(req: AppRequest, order: OrderRecord, action: string, payload: Record<string, unknown> = {}) {
    this.audit.write({
      actorPhone: this.phone(req),
      action: `client.${action}`,
      entity: 'Order',
      entityId: order.id,
      payload: { number: order.number, ...payload },
    });
  }

  // ---------- C-50: детали адреса для мастера ----------

  @Post(':id/details')
  async details(
    @Param('id') id: string,
    @Body()
    b: {
      apartment?: string;
      entrance?: string;
      floor?: string;
      intercom?: string;
      hasLift?: boolean;
      comment?: string;
      saveToAddresses?: boolean;
    },
    @Req() req: AppRequest,
  ) {
    const order = await this.mine(req, id);
    order.addressDetails = {
      apartment: b?.apartment?.trim(),
      entrance: b?.entrance?.trim(),
      floor: b?.floor?.trim(),
      intercom: b?.intercom?.trim(),
      hasLift: b?.hasLift,
      comment: b?.comment?.trim(),
      at: new Date().toISOString(),
    };
    this.orders.touchOrder();
    if (b?.saveToAddresses) {
      this.profiles.saveAddress(this.phone(req), { street: order.address, ...order.addressDetails });
    }
    if (order.masterId) {
      this.notifications.push({
        masterId: order.masterId,
        kind: 'order_changed',
        title: 'Клиент уточнил детали адреса',
        body: [order.addressDetails.apartment && `кв. ${order.addressDetails.apartment}`, order.addressDetails.comment]
          .filter(Boolean)
          .join(' · ') || 'Подробности в карточке заявки',
        priority: 'normal',
        deepLink: `sozo-master://order/${order.id}`,
        orderId: order.id,
      });
    }
    this.log(req, order, 'address_details_set');
    return { ok: true, addressDetails: order.addressDetails, message: 'Передали мастеру' };
  }

  // ---------- C-15…C-18: решения по смете ----------

  /**
   * Одно решение — один эндпоинт: клиент отвечает на то, что ему прислали.
   * Разные виды (смета, запчасть, доп-работа, апсейл, план сессий) отличаются
   * последствиями, но приходят одним потоком, и разводить их по путям значит
   * заставлять приложение угадывать, куда стучаться.
   */
  @Post(':id/decision')
  async decision(
    @Param('id') id: string,
    @Body()
    b: {
      kind?: 'estimate' | 'spare_tier' | 'addwork' | 'recommendation' | 'stages';
      accept?: boolean;
      /** Доп-работа: какой из вариантов выбран */
      variant?: 'minimal' | 'full';
      /** Запчасть: уровень цены */
      tier?: 'economy' | 'standard' | 'premium';
      /** Апсейл: отложить вместо отказа */
      postpone?: boolean;
      /** План сессий: подтверждённые слоты по индексам этапов */
      slots?: Array<{ index: number; at: string }>;
      recordId?: string;
    },
    @Req() req: AppRequest,
  ) {
    const order = await this.mine(req, id);
    const kind = b?.kind;

    switch (kind) {
      case 'estimate': {
        if (b.accept === false) {
          // Отказ от работ: заявка завершается, оплачивается выезд и диагностика
          this.log(req, order, 'estimate_declined', { amountTiyin: order.totalFromTiyin });
          await this.orders.transition('t0', id, { action: 'cancel', version: order.version, reason: 'Клиент отказался от работ после сметы' } as never, this.phone(req));
          return { ok: true, message: 'Работы не начнутся. Оплачивается выезд и диагностика' };
        }
        const approved = [...order.quotes].reverse().find((q) => q.kind === 'approved');
        if (approved) return { ok: true, alreadyApproved: true, message: 'Смета уже подтверждена' };
        await this.orders.transition(
          't0',
          id,
          {
            action: 'confirm_estimate',
            version: order.version,
            payload: { amountTiyin: order.totalFromTiyin, via: 'app' },
          } as never,
          this.phone(req),
        );
        this.log(req, order, 'estimate_approved', { amountTiyin: order.totalFromTiyin });
        return { ok: true, message: 'Смета подтверждена, мастер приступает' };
      }

      case 'spare_tier': {
        const rec = this.ops.spareTiers.find((s) => s.orderId === order.id && s.status === 'sent');
        if (!rec) throw new BadRequestException({ code: 'NO_PENDING_TIER', message: 'Выбор запчасти уже сделан' });
        if (!b.tier) throw new BadRequestException({ code: 'TIER_REQUIRED', message: 'Выберите вариант' });
        this.ops.chooseSpareTier(rec.id, b.tier);
        this.log(req, order, 'spare_tier_chosen', { tier: b.tier, part: rec.partName });
        return { ok: true, message: 'Мастер получил ваш выбор' };
      }

      case 'addwork': {
        const rec = this.ops.addworkFor(order.id);
        if (!rec) throw new BadRequestException({ code: 'NO_PENDING_ADDWORK', message: 'Решение уже принято' });
        if (b.accept === false) {
          this.ops.resolveAddwork(rec.id, 'declined');
          this.log(req, order, 'addwork_declined');
          return {
            ok: true,
            message: 'Мастер выполнит консервацию. Отказ будет отмечен в акте',
          };
        }
        if (!b.variant) throw new BadRequestException({ code: 'VARIANT_REQUIRED', message: 'Выберите вариант работ' });
        this.ops.resolveAddwork(rec.id, 'approved', b.variant);
        // Заявка возвращается в работу: доп-смета согласована
        if (order.status === 'addwork_approval') {
          await this.orders.transition('t0', id, { action: 'resolve_addwork', version: order.version } as never, this.phone(req));
        }
        this.log(req, order, 'addwork_approved', { variant: b.variant });
        return { ok: true, message: 'Мастер продолжает работу' };
      }

      case 'recommendation': {
        const rec = this.ops.recommendations.find((r) => r.orderId === order.id && r.status === 'sent');
        if (!rec) throw new BadRequestException({ code: 'NO_PENDING_RECOMMENDATION', message: 'Решение уже принято' });
        const status = b.postpone ? 'postponed' : b.accept === false ? 'declined' : 'accepted';
        this.ops.resolveRecommendation(rec.id, status);
        this.log(req, order, `recommendation_${status}`);
        return {
          ok: true,
          message:
            status === 'accepted'
              ? 'Мастер сделает сейчас'
              : status === 'postponed'
                ? 'Сохранили в ваших рекомендациях'
                : 'Рекомендация отклонена',
        };
      }

      case 'stages': {
        const plan = this.ops.stagePlan(order.id);
        if (!plan) throw new BadRequestException({ code: 'NO_STAGE_PLAN', message: 'План визитов ещё не составлен' });
        const slots = b.slots ?? [];
        for (const s of slots) {
          const stage = plan.stages.find((x) => x.index === s.index);
          if (stage) {
            stage.slotAt = s.at;
            stage.status = 'booked';
          }
        }
        // Инвариант ТЗ 4.1: первый этап не стартует, пока не подтверждена вся цепочка
        const unconfirmed = plan.stages.filter((s) => !s.slotAt);
        if (unconfirmed.length) {
          throw new BadRequestException({
            code: 'ALL_SLOTS_REQUIRED',
            message: `Выберите время для всех визитов: не хватает ${unconfirmed.length}`,
          });
        }
        this.ops.planStages(order.id, plan.stages);
        this.log(req, order, 'stage_plan_confirmed', { stages: plan.stages.length });
        return { ok: true, message: 'План визитов подтверждён' };
      }

      default:
        throw new BadRequestException({ code: 'KIND_REQUIRED', message: 'Неизвестный вид решения' });
    }
  }

  // ---------- C-14: перенос и отмена ----------

  /** Что будет стоить отмена — показываем до диалога, а не после (ТЗ 4.4) */
  @Get(':id/cancel-preview')
  async cancelPreview(@Param('id') id: string, @Req() req: AppRequest) {
    const order = await this.mine(req, id);
    return this.orders.cancelPreview('t0', order.id);
  }

  @Post(':id/cancel')
  async cancel(@Param('id') id: string, @Body() b: { reason?: string }, @Req() req: AppRequest) {
    const order = await this.mine(req, id);
    const reason = b?.reason?.trim();
    if (!reason) throw new BadRequestException({ code: 'REASON_REQUIRED', message: 'Выберите причину отмены' });
    const preview = await this.orders.cancelPreview('t0', order.id);
    await this.orders.transition('t0', id, { action: 'cancel', version: order.version, reason } as never, this.phone(req));
    this.log(req, order, 'order_cancelled', { reason, clientPaysTiyin: preview.clientPaysTiyin });
    return { ok: true, ...preview };
  }

  /**
   * Перенос — это заявка диспетчеру, а не бронь. Клиент не выбирает мастера,
   * а окно в чужой ленте может уйти между показом и нажатием.
   */
  @Post(':id/reschedule')
  async reschedule(
    @Param('id') id: string,
    @Body() b: { date?: string; startMin?: number; reason?: string },
    @Req() req: AppRequest,
  ) {
    const order = await this.mine(req, id);
    if (!['new', 'estimated', 'assigned'].includes(order.status)) {
      throw new BadRequestException({
        code: 'RESCHEDULE_NOT_ALLOWED',
        message: 'Перенести уже нельзя — можно только отменить',
      });
    }
    if (!b?.date || b.startMin == null) {
      throw new BadRequestException({ code: 'SLOT_REQUIRED', message: 'Выберите новое время' });
    }

    // Правила переноса (F-19). Раньше принимался любой перенос в любой момент:
    // клиент двигал визит за десять минут до окна, мастер уже ехал, а лента
    // рассыпалась. Оба ограничения — про чужое время, поэтому объясняем их.
    const booking = this.sched.bookingFor(order.id);
    if (booking?.date && booking.startMin != null) {
      const start = new Date(`${booking.date}T00:00:00`);
      start.setMinutes(booking.startMin);
      const hoursLeft = (start.getTime() - Date.now()) / 3_600_000;
      if (hoursLeft < 2) {
        throw new BadRequestException({
          code: 'RESCHEDULE_TOO_LATE',
          message: 'До визита меньше двух часов — мастер уже планирует день. Позвоните диспетчеру, он решит на месте',
        });
      }
    }
    const already = order.statusLog.filter((l) => l.action === 'reschedule').length + (order.rescheduleCount ?? 0);
    if (already >= 2) {
      throw new BadRequestException({
        code: 'RESCHEDULE_LIMIT',
        message: 'Заявку уже переносили дважды. Дальше — только через диспетчера, чтобы не потерять ваше время',
      });
    }
    order.rescheduleCount = already + 1;
    order.requestedWindow = { mode: 'slot', date: b.date, startMin: b.startMin, endMin: b.startMin + 120 };
    this.orders.touchOrder();

    // Поле в заявке само себя не переназначит: перенос — это работа диспетчера,
    // и он должен увидеть её в очереди, а не наткнуться случайно
    const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
    this.dispatch.fileClientRequest({
      ...this.clientRequestBase(req, order),
      kind: 'reschedule',
      title: 'Клиент просит перенести визит',
      detail: [
        `Новое окно: ${b.date}, ${hhmm(b.startMin)}–${hhmm(b.startMin + 120)}`,
        b.reason?.trim() && `Причина: ${b.reason.trim()}`,
      ]
        .filter(Boolean)
        .join('. '),
    });

    this.log(req, order, 'reschedule_requested', { date: b.date, startMin: b.startMin });
    return {
      ok: true,
      requestedWindow: order.requestedWindow,
      message: 'Передали диспетчеру. Мастер будет назначен заново',
    };
  }

  /** Быстрое сообщение вместо чата (MVP, DEV-08 C-14) */
  @Post(':id/message')
  async message(@Param('id') id: string, @Body() b: { text?: string }, @Req() req: AppRequest) {
    const order = await this.mine(req, id);
    const text = b?.text?.trim();
    if (!text) throw new BadRequestException({ code: 'TEXT_REQUIRED', message: 'Напишите сообщение' });
    if (order.masterId) {
      this.notifications.push({
        masterId: order.masterId,
        kind: 'order_changed',
        title: 'Сообщение от клиента',
        body: text,
        priority: 'high',
        deepLink: `sozo-master://order/${order.id}`,
        orderId: order.id,
      });
    }

    // Пуш мастеру — не доставка: телефон может быть в кармане, в метро или
    // разряжен. Копия ложится в очередь диспетчера, и «домофон не работает»
    // не пропадает вместе с уведомлением.
    this.dispatch.fileClientRequest({
      ...this.clientRequestBase(req, order),
      kind: 'message',
      title: order.masterId ? 'Сообщение клиента мастеру' : 'Сообщение клиента (мастер не назначен)',
      detail: text,
    });

    this.log(req, order, 'quick_message', { text });
    return { ok: true, message: order.masterId ? 'Передали мастеру' : 'Передали диспетчеру' };
  }

  // ---------- C-19/C-34: приёмка ----------

  /**
   * Код приёмки: четыре цифры, которые клиент называет мастеру.
   * Генерируется здесь и хранится на заявке — до появления этого экрана
   * мастер вводил любые четыре цифры, и проверять их было не с чем.
   */
  @Get(':id/acceptance-code')
  async acceptanceCode(@Param('id') id: string, @Req() req: AppRequest) {
    const order = await this.mine(req, id);
    if (!order.acceptanceCode) {
      order.acceptanceCode = String(Math.floor(1000 + Math.random() * 9000));
      this.orders.touchOrder();
    }
    return { code: order.acceptanceCode, accepted: !!order.acceptance };
  }

  @Post(':id/accept')
  async accept(@Param('id') id: string, @Body() b: { note?: string }, @Req() req: AppRequest) {
    const order = await this.mine(req, id);
    if (order.acceptance) return { ok: true, acceptance: order.acceptance, alreadyAccepted: true };
    if (!['completed', 'verified', 'awaiting_payment', 'in_progress'].includes(order.status)) {
      throw new BadRequestException({ code: 'NOT_COMPLETED', message: 'Работа ещё не завершена' });
    }
    order.acceptance = {
      method: 'client_app',
      signerName: this.profiles.get(this.phone(req)).fullName || this.phone(req),
      note: b?.note?.trim() || undefined,
      at: new Date().toISOString(),
    };
    this.orders.touchOrder();
    this.log(req, order, 'acceptance_confirmed', { method: 'in_app' });
    return { ok: true, acceptance: order.acceptance, message: 'Приёмка подтверждена' };
  }

  // ---------- C-20: оплата ----------

  /**
   * Оплата. Мерчант-SDK Payme/Click не подключены — договоров нет, поэтому
   * здесь фиксируется канал и приёмка, а место подключения провайдера помечено.
   * Успешная онлайн-оплата подтверждает приёмку (ТЗ 17.17 п.3) — отдельного
   * нажатия не требуется.
   */
  @Post(':id/pay')
  async pay(@Param('id') id: string, @Body() b: { provider?: string; promoCode?: string }, @Req() req: AppRequest) {
    const order = await this.mine(req, id);
    const provider = (b?.provider ?? 'payme') as NonNullable<OrderRecord['payment']>['provider'];
    if (!['payme', 'click', 'uzum', 'card', 'cash'].includes(provider)) {
      throw new BadRequestException({ code: 'PROVIDER_INVALID', message: 'Выберите способ оплаты' });
    }
    if (order.payment?.status === 'succeeded') {
      return { ok: true, payment: order.payment, alreadyPaid: true };
    }

    // Промокод применяется здесь, а не только при оформлении: скидку человек
    // вспоминает в момент, когда видит сумму. Считается от работ — материалы
    // идут по чекам, и скидывать с них значит платить за них из своего кармана.
    // Долю мастера скидка не трогает (ТЗ 3.7), она от базовой стоимости работ
    const phone = this.phone(req);
    const promo = (b?.promoCode ?? '').trim();
    /**
     * Скидка вычитается ровно один раз.
     *
     * `totalFromTiyin` уже посчитан со скидкой при создании заявки, а здесь
     * она вычиталась из него ещё раз: промо 15% на базе 1 000 000 давало итог
     * 850 000, клиент платил 722 500, а биллинг при закрытии проводил
     * выручку 850 000 — недобор 127 500 на каждой такой заявке, и клиринг не
     * сходился. Через клиентское приложение промо применялось один раз, через
     * этот маршрут дважды: результат зависел от канала.
     *
     * Поэтому промокод здесь можно только ДОБАВИТЬ к заявке, у которой его не
     * было. Если он уже применён при создании — сумма к оплате берётся из
     * заявки как есть.
     */
    let discountTiyin = 0;
    let discountPercent = order.promoDiscountPercent ?? 0;
    if (promo && !order.promoDiscountPercent) {
      const all = await this.orders.list('t0');
      const isFirst = !all.some(
        (o) => o.clientPhone === phone && o.id !== order.id && o.status !== 'cancelled',
      );
      discountPercent = this.promo.redeemFor(promo, phone, isFirst);
      discountTiyin = Math.floor((order.totalFromTiyin * discountPercent) / 100);
      // Скидка ложится на саму заявку — иначе биллинг проведёт выручку без неё
      order.totalFromTiyin -= discountTiyin;
      order.totalToTiyin -= Math.floor((order.totalToTiyin * discountPercent) / 100);
      order.promoCode = promo.toUpperCase();
      order.promoDiscountPercent = discountPercent;
      this.profiles.markPromoUsed(phone, promo, order.number);
      this.orders.touchOrder();
    }
    const amountTiyin = order.totalFromTiyin + order.totalMaterialTiyin;
    if (provider === 'cash') {
      // Наличные принимает мастер: приложение клиента только сообщает выбор
      order.payment = { provider, amountTiyin, status: 'pending', at: new Date().toISOString() };
      this.orders.touchOrder();
      this.log(req, order, 'payment_started', { provider, promoCode: order.promoCode ?? null });
      return {
        ok: true,
        payment: order.payment,
        promoCode: order.promoCode ?? null,
        discountTiyin,
        message: 'Передайте наличные мастеру — он зафиксирует оплату',
      };
    }

    /**
     * Платёж проводится заглушкой — мерчанта в системе нет (HANDOVER §3).
     *
     * Это известный блокер, и трогать его здесь не место: без заглушки
     * заявки перестали бы закрываться вовсе. Новое и исправленное — другое:
     * заглушка ОДНОВРЕМЕННО фиксировала приёмку. Ядро считает приёмку
     * зафиксированной по одному факту наличия объекта `order.acceptance`, и
     * один вызов `POST /v1/app/orders/<id>/pay` на своей заявке снимал
     * приёмочный гейт графа B2B: «оплачено», «принято», закрытие проходит —
     * без кода, без подписи, без участия ответственного на точке.
     *
     * Приёмка — отдельное действие человека, а не следствие платежа.
     * Клиент подтверждает работу в приложении (`POST …/accept`), мастер
     * вводит названный код, ответственный подписывает. Оплата означает
     * ровно то, что она означает: деньги.
     */
    order.payment = { provider, amountTiyin, status: 'succeeded', at: new Date().toISOString() };
    this.orders.touchOrder();
    this.log(req, order, 'payment_succeeded', { provider, amountTiyin, promoCode: order.promoCode ?? null });
    return {
      ok: true,
      payment: order.payment,
      promoCode: order.promoCode ?? null,
      discountTiyin,
      acceptanceFixed: !!order.acceptance,
      message: discountTiyin > 0 ? `Оплата прошла, скидка −${discountPercent}% учтена` : 'Оплата прошла',
    };
  }

  // ---------- C-21: оценка и чаевые ----------

  @Post(':id/rating')
  async rate(
    @Param('id') id: string,
    @Body() b: { rating?: number; comment?: string; tipTiyin?: number; rememberMaster?: boolean },
    @Req() req: AppRequest,
  ) {
    const order = await this.mine(req, id);
    const rating = Number(b?.rating);
    if (!(rating >= 1 && rating <= 5)) {
      throw new BadRequestException({ code: 'RATING_REQUIRED', message: 'Поставьте оценку от 1 до 5' });
    }
    // Низкая оценка без объяснения бесполезна и клиенту, и мастеру
    if (rating <= 2 && !b?.comment?.trim()) {
      throw new BadRequestException({
        code: 'COMMENT_REQUIRED',
        message: 'Расскажите, что случилось — разберёмся и перезвоним',
      });
    }
    await this.orders.transition(
      't0',
      id,
      { action: 'rate', version: order.version, payload: { rating, comment: b?.comment } } as never,
      this.phone(req),
    );
    const tip = Math.max(0, Number(b?.tipTiyin) || 0);
    if (tip > 0) {
      order.tipTiyin = tip;
      this.orders.touchOrder();
      if (order.masterId) {
        // Деньги, а не только уведомление: чаевые ложатся в кошелёк мастера
        // отдельной проводкой и попадают в ближайшую выплату
        this.billing.tip({
          orderId: order.id,
          orderNumber: order.number,
          masterId: order.masterId,
          masterName: order.masterName,
          amountTiyin: tip,
        });
        this.notifications.push({
          masterId: order.masterId,
          kind: 'tips',
          title: 'Чаевые от клиента',
          body: `Заявка ${order.number}`,
          priority: 'normal',
          deepLink: `sozo-master://wallet`,
          orderId: order.id,
        });
      }
    }
    if (b?.rememberMaster && order.masterId) {
      this.profiles.setFavoriteMaster(this.phone(req), order.masterId, order.masterName);
    }

    // Оценка 1–2 — это не цифра в отчёте, а обещание перезвонить за 2 часа
    // (ТЗ 7.4). Без записи в очередь обещание некому исполнять.
    if (rating <= 2) {
      this.dispatch.fileClientRequest({
        ...this.clientRequestBase(req, order),
        kind: 'low_rating',
        title: `Оценка ${rating} — нужен разбор и звонок`,
        detail: b?.comment?.trim() || 'Клиент не пояснил причину',
        dueAt: new Date(Date.now() + 2 * 3_600_000).toISOString(),
      });
    }

    this.log(req, order, 'rating_submitted', { rating, tipTiyin: tip });
    return { ok: true, rating, tipTiyin: tip, message: 'Спасибо! Заявка закрыта' };
  }

  // ---------- C-26: гарантийное обращение ----------

  @Post(':id/warranty')
  async warranty(
    @Param('id') id: string,
    @Body() b: { description?: string; photos?: string[]; slotDate?: string; slotStartMin?: number },
    @Req() req: AppRequest,
  ) {
    const source = await this.mine(req, id);
    const description = b?.description?.trim();
    if (!description) {
      throw new BadRequestException({ code: 'DESCRIPTION_REQUIRED', message: 'Опишите, что случилось снова' });
    }
    const until = this.warrantyUntil(source);
    if (!until || until < new Date()) {
      throw new BadRequestException({ code: 'WARRANTY_EXPIRED', message: 'Гарантийный срок истёк' });
    }
    // Гарантийная заявка — отдельный граф: сметы нет, суммы клиенту не показываются
    const order = await this.orders.create(
      't0',
      {
        clientPhone: this.phone(req),
        clientName: source.clientName,
        address: source.address,
        lat: source.lat ?? undefined,
        lng: source.lng ?? undefined,
        description: `Гарантия по заявке ${source.number}: ${description}`,
        source: 'app',
        requestedWindow:
          b?.slotDate && b.slotStartMin != null
            ? { mode: 'slot', date: b.slotDate, startMin: b.slotStartMin, endMin: b.slotStartMin + 120 }
            : undefined,
        addressDetails: source.addressDetails,
      },
      this.phone(req),
    );
    this.photos.saveMany(order, b?.photos);
    this.log(req, source, 'warranty_claim', { newOrder: order.number });
    return { ...this.view.full(order, this.phone(req)), message: 'Диспетчер позвонит в течение 4 часов' };
  }

  private warrantyUntil(order: OrderRecord): Date | null {
    const closed = [...order.statusLog].reverse().find((l) => l.to === 'closed');
    if (!closed) return null;
    const d = new Date(closed.at);
    d.setDate(d.getDate() + this.view.warrantyDays);
    return d;
  }

  // ---------- C-22: спор ----------

  @Post(':id/dispute')
  async dispute(
    @Param('id') id: string,
    @Body() b: { reason?: string; description?: string; photos?: string[] },
    @Req() req: AppRequest,
  ) {
    const order = await this.mine(req, id);
    const reason = b?.reason?.trim();
    const description = b?.description?.trim();
    if (!reason) throw new BadRequestException({ code: 'REASON_REQUIRED', message: 'Выберите причину' });
    if (!description || description.length < 10) {
      throw new BadRequestException({ code: 'DESCRIPTION_TOO_SHORT', message: 'Опишите, в чём проблема' });
    }
    this.photos.saveMany(order, b?.photos, 10);

    // Спор заводится в реестре качества первым: там правило окна 72 ч и запрет
    // второго спора по одной заявке. Сначала переведёшь заявку — и при отказе
    // получишь заявку в статусе «Спор», которого нигде нет.
    const dispute = this.quality.openDispute({
      orderId: order.id,
      orderNumber: order.number,
      openedByPhone: this.phone(req),
      openedByRole: 'client',
      reason: `${reason}: ${description}`,
      amountTiyin: order.totalFromTiyin + order.totalMaterialTiyin,
      completedAt: order.statusLog.find((s) => s.to === 'completed')?.at?.toISOString(),
    });
    try {
      await this.orders.transition(
        't0',
        id,
        { action: 'open_dispute', version: order.version, reason: `${reason}: ${description}` } as never,
        this.phone(req),
      );
    } catch (e) {
      this.quality.discard(dispute.id);
      throw e;
    }

    this.log(req, order, 'dispute_opened', { reason, disputeId: dispute.id });
    return {
      ok: true,
      disputeId: dispute.id,
      message: 'Мы заморозим расчёты по заявке и разберёмся. Обычно это занимает до 3 дней',
    };
  }
}
