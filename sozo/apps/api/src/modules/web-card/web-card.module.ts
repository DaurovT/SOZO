import { Body, Controller, Get, Header, Module, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { signJwt, type JwtClaims } from '../../common/jwt';
import { AuthGuard, Roles } from '../identity/auth.guard';
import { AuditService } from '../platform/audit.service';
import { ParametersService } from '../platform/parameters.service';
import { BillingModule } from '../billing/billing.module';
import { BillingService } from '../billing/billing.service';
import { MasterApiModule } from '../master-api/master-api.module';
import { MasterOpsService } from '../master-api/master-ops.service';
import { MastersModule, MastersService } from '../masters/masters.module';
import { OrdersModule } from '../orders/orders.module';
import { OrdersService } from '../orders/orders.service';
import type { OrderRecord } from '../orders/order.repository';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { SchedulingService } from '../scheduling/scheduling.service';
import { WebCardLinksService } from './web-card-links.service';
import { actPage, donePage, estimatePage, expiredPage, ratePage, statusPage } from './web-card.view';

/**
 * Веб-карточка заявки (W-01…W-05, F-56).
 *
 * Половина клиентов приходит по телефону и приложение не ставит. До этой
 * поверхности они не могли ни подтвердить смету, ни увидеть акт, ни оплатить —
 * всё это делал за них диспетчер голосом, и в аудите оставалось «подтверждено
 * по телефону» без следа самого клиента.
 *
 * Доступ — по одноразовой ссылке из SMS: ни регистрации, ни пароля. Токен
 * привязан к заявке и живёт неделю; истёк или подделан — одинаковый ответ,
 * не раскрывающий, существует ли заявка.
 */

const STEPS: Array<{ status: string; label: string }> = [
  { status: 'new', label: 'Заявка принята' },
  { status: 'estimated', label: 'Стоимость посчитана' },
  { status: 'assigned', label: 'Мастер назначен' },
  { status: 'master_departed', label: 'Мастер в пути' },
  { status: 'in_progress', label: 'Работа идёт' },
  { status: 'completed', label: 'Работа выполнена' },
  { status: 'closed', label: 'Заявка закрыта' },
];

const STATUS_LABEL: Record<string, string> = {
  new: 'Принята',
  estimated: 'Оценена',
  pending_approval: 'Ждёт утверждения',
  approved: 'Утверждена',
  assigned: 'Мастер назначен',
  master_departed: 'Мастер в пути',
  in_progress: 'В работе',
  addwork_approval: 'Ждёт вашего решения',
  completed: 'Выполнена',
  verified: 'Проверена',
  awaiting_payment: 'Ждёт оплаты',
  closed: 'Закрыта',
  rated: 'Закрыта',
  cancelled: 'Отменена',
  dispute: 'Спор',
};

@Controller('w')
export class WebCardController {
  constructor(
    private readonly orders: OrdersService,
    private readonly ops: MasterOpsService,
    private readonly masters: MastersService,
    private readonly sched: SchedulingService,
    private readonly billing: BillingService,
    private readonly audit: AuditService,
    private readonly params: ParametersService,
    private readonly links: WebCardLinksService,
  ) {}

  private get dispatcherPhone(): string {
    return this.params.text(200, '+998712000000');
  }

  /**
   * Заявка по коду ссылки.
   *
   * `null` вместо исключения: любая причина отказа — истёкший код, отозванная
   * ссылка, удалённая заявка — должна выглядеть одинаково. Иначе перебор
   * кодов расскажет, какие заявки существуют.
   */
  private async orderOf(code: string): Promise<OrderRecord | null> {
    const link = this.links.resolve(code);
    if (!link) return null;
    const order = await this.orders.record('t0', link.orderId).catch(() => null);
    if (!order || order.clientPhone !== link.clientPhone) return null;
    return order;
  }

  /**
   * Токен для картинок и печатного акта.
   *
   * Короткий код в адресе страницы — наш собственный, а фото и документы
   * отдаются по общему для платформы JWT. Выписываем его на время просмотра
   * страницы, не пуская наружу код ссылки.
   */
  private mediaToken(order: OrderRecord): string {
    return signJwt({ sub: order.clientPhone, phone: order.clientPhone, roles: ['web_card'] }, 3600);
  }

  private html(res: Response, body: string): void {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // Ссылка личная: ни кэшам, ни поисковикам её содержимое не нужно
    res.setHeader('Cache-Control', 'no-store');
    res.send(body);
  }

  private log(order: OrderRecord, action: string, payload: Record<string, unknown> = {}): void {
    this.audit.write({
      actorPhone: order.clientPhone,
      action: `web_card.${action}`,
      entity: 'Order',
      entityId: order.id,
      payload: { number: order.number, ...payload },
    });
  }

  private steps(order: OrderRecord) {
    const passed = new Set(order.statusLog.map((l) => l.to));
    const idx = STEPS.findIndex((s) => s.status === order.status);
    return STEPS.map((s, i) => ({
      label: s.label,
      done: passed.has(s.status as never) || (idx >= 0 && i < idx),
      current: s.status === order.status,
    }));
  }

  private windowText(order: OrderRecord): string | null {
    const b = this.sched.bookingFor(order.id);
    if (!b?.date || b.startMin == null) return null;
    const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const [from, to] = b.clientWindow ?? [b.startMin, b.endMin];
    return `Окно приезда ${b.date}, ${hhmm(from)}–${hhmm(to)}`;
  }

  private etaText(order: OrderRecord): string | null {
    if (order.status !== 'master_departed') return null;
    const b = this.sched.bookingFor(order.id);
    if (!b?.date || b.startMin == null) return 'Мастер в пути';
    const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    return `Мастер в пути, будет к ${hhmm(b.startMin)}`;
  }

  // ---------- W-01 ----------

  @Get(':code')
  async status(@Param('code') code: string, @Res() res: Response) {
    const order = await this.orderOf(code);
    if (!order) return this.html(res, expiredPage(this.dispatcherPhone));

    // Заявка дошла до итога — показываем акт, а не трекер: человек открыл
    // ссылку, чтобы заплатить или посмотреть, что сделали
    if (['completed', 'verified', 'awaiting_payment', 'closed', 'rated'].includes(order.status)) {
      return this.html(res, this.renderAct(order, code));
    }

    const master = order.masterId ? this.masters.list().find((m) => m.id === order.masterId) : undefined;
    const rec = this.ops.recommendations.find((r) => r.orderId === order.id && r.status === 'sent');
    /**
     * Смета ждёт подтверждения ровно тогда же, когда и в приложении: мастер
     * на месте, точная сумма названа, санкции клиента ещё нет. В статусе
     * «Оценена» подтверждать нечего — там предварительная вилка, а не смета.
     */
    const needsEstimate = order.status === 'in_progress' && !order.quotes.some((q) => q.kind === 'approved');

    // Счётчик открытий — единственный признак, что SMS дошла: провайдер
    // сообщает о доставке сообщения, а не о том, что человек по нему перешёл
    this.links.touchOpen(code);
    this.log(order, 'opened', { status: order.status });
    return this.html(
      res,
      statusPage({
        number: order.number,
        statusLabel: STATUS_LABEL[order.status] ?? order.status,
        steps: this.steps(order),
        master: master
          ? { name: master.fullName, rating: master.rating ?? null, jobsDone: null }
          : order.masterName
            ? { name: order.masterName, rating: null, jobsDone: null }
            : null,
        etaText: this.etaText(order),
        windowText: this.windowText(order),
        lines: order.lines.map((l) => ({ name: l.name, qty: l.qty, priceFromTiyin: l.priceFromTiyin })),
        totalFromTiyin: order.totalFromTiyin,
        totalToTiyin: order.totalToTiyin,
        recommendation: rec
          ? {
              id: rec.id,
              title: rec.lines[0]?.name ?? 'Рекомендация мастера',
              text: rec.comment ?? 'Мастер заметил, что стоит сделать дополнительно',
              amountTiyin: rec.lines.reduce((s, l) => s + l.amountTiyin, 0),
            }
          : null,
        needsEstimate,
        token: code,
        dispatcherPhone: this.dispatcherPhone,
        appInvite: order.statusLog.some((l) => l.to === 'closed'),
      }),
    );
  }

  // ---------- W-02 ----------

  @Get(':code/estimate')
  async estimate(@Param('code') code: string, @Res() res: Response) {
    const order = await this.orderOf(code);
    if (!order) return this.html(res, expiredPage(this.dispatcherPhone));
    return this.html(res, this.renderEstimate(order, code));
  }

  private renderEstimate(order: OrderRecord, code: string): string {
    return estimatePage({
      number: order.number,
      lines: order.lines.map((l) => ({ name: l.name, qty: l.qty, priceFromTiyin: l.priceFromTiyin })),
      totalFromTiyin: order.totalFromTiyin,
      totalToTiyin: order.totalToTiyin,
      alreadyApproved: order.quotes.some((q) => q.kind === 'approved'),
      token: code,
      dispatcherPhone: this.dispatcherPhone,
    });
  }

  @Post(':code/estimate')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async decideEstimate(@Param('code') code: string, @Body() b: { decision?: string }, @Res() res: Response) {
    const order = await this.orderOf(code);
    if (!order) return this.html(res, expiredPage(this.dispatcherPhone));

    // Повторное нажатие не создаёт второго подтверждения: человек мог нажать
    // дважды на плохой связи, и второе «согласен» не должно ничего менять
    if (order.quotes.some((q) => q.kind === 'approved')) {
      return this.html(res, this.renderEstimate(order, code));
    }
    if (order.status !== 'in_progress') {
      // Подтверждать пока нечего: мастер ещё не назвал точную сумму
      return this.html(res, this.renderEstimate(order, code));
    }

    if (b?.decision === 'decline') {
      await this.orders.transition(
        't0',
        order.id,
        { action: 'cancel', version: order.version, reason: 'Клиент отказался от работ после сметы' } as never,
        order.clientPhone,
      );
      this.log(order, 'estimate_declined');
      return this.html(
        res,
        donePage({
          title: 'Заявка отменена',
          text: 'Работы не начнутся. Оплачивается выезд и диагностика.',
          token: code,
          dispatcherPhone: this.dispatcherPhone,
        }),
      );
    }

    await this.orders.transition(
      't0',
      order.id,
      {
        action: 'confirm_estimate',
        version: order.version,
        payload: { amountTiyin: order.totalFromTiyin, via: 'web_card' },
      } as never,
      order.clientPhone,
    );
    this.log(order, 'estimate_approved', { amountTiyin: order.totalFromTiyin });
    return this.html(
      res,
      donePage({
        title: 'Стоимость подтверждена',
        text: 'Мастер приступает к работе.',
        token: code,
        dispatcherPhone: this.dispatcherPhone,
      }),
    );
  }

  // ---------- Рекомендация прямо на W-01 ----------

  @Post(':code/recommendation')
  async decideRecommendation(@Param('code') code: string, @Body() b: { decision?: string }, @Res() res: Response) {
    const order = await this.orderOf(code);
    if (!order) return this.html(res, expiredPage(this.dispatcherPhone));
    const rec = this.ops.recommendations.find((r) => r.orderId === order.id && r.status === 'sent');
    if (!rec) return this.status(code, res);

    const decision = b?.decision === 'accept' ? 'accepted' : b?.decision === 'postpone' ? 'postponed' : 'declined';
    this.ops.resolveRecommendation(rec.id, decision);
    this.log(order, 'recommendation_decided', { decision });
    return this.html(
      res,
      donePage({
        title: decision === 'accepted' ? 'Передали мастеру' : decision === 'postponed' ? 'Отложили' : 'Отказ принят',
        text:
          decision === 'accepted'
            ? 'Мастер посчитает работы и согласует с вами стоимость.'
            : decision === 'postponed'
              ? 'Напомним при следующем обращении.'
              : 'На текущую работу это не влияет.',
        token: code,
        dispatcherPhone: this.dispatcherPhone,
      }),
    );
  }

  // ---------- W-03 ----------

  private renderAct(order: OrderRecord, code: string): string {
    const media = this.mediaToken(order);
    const paid = order.payment?.status === 'succeeded';
    const warranty = order.statusLog.find((l) => l.to === 'closed')?.at;
    const until = warranty ? new Date(new Date(warranty).getTime() + 30 * 86_400_000) : null;
    return actPage({
      number: order.number,
      photos: order.photos
        .filter((p) => p.file)
        .slice(0, 6)
        .map((p) => ({ url: `/v1/photos/${p.file}?token=${encodeURIComponent(media)}`, stage: p.stage })),
      lines: order.lines.map((l) => ({ name: l.name, qty: l.qty, priceFromTiyin: l.priceFromTiyin })),
      materials: order.materials.map((m) => ({ name: m.name, amountTiyin: m.amountTiyin })),
      worksTiyin: order.totalFromTiyin,
      materialsTiyin: order.totalMaterialTiyin,
      totalTiyin: order.totalFromTiyin + order.totalMaterialTiyin,
      paid,
      paidNote: paid
        ? order.payment?.provider === 'cash'
          ? 'Оплачено наличными мастеру'
          : 'Оплата прошла онлайн'
        : null,
      warrantyUntil: until ? until.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : null,
      actUrl: `/v1/documents/orders/${order.id}/act?token=${encodeURIComponent(media)}`,
      token: code,
      dispatcherPhone: this.dispatcherPhone,
    });
  }

  @Post(':code/pay')
  async pay(@Param('code') code: string, @Body() b: { provider?: string }, @Res() res: Response) {
    const order = await this.orderOf(code);
    if (!order) return this.html(res, expiredPage(this.dispatcherPhone));
    if (order.payment?.status === 'succeeded') return this.html(res, this.renderAct(order, code));

    const provider = (b?.provider ?? 'payme') as NonNullable<OrderRecord['payment']>['provider'];
    const amountTiyin = order.totalFromTiyin + order.totalMaterialTiyin;

    if (provider === 'cash') {
      order.payment = { provider, amountTiyin, status: 'pending', at: new Date().toISOString() };
      this.orders.touchOrder();
      this.log(order, 'payment_cash_chosen');
      return this.html(
        res,
        donePage({
          title: 'Хорошо',
          text: 'Передайте наличные мастеру — он зафиксирует оплату.',
          token: code,
          dispatcherPhone: this.dispatcherPhone,
        }),
      );
    }

    // TODO(интеграция): здесь редирект в чекаут мерчанта и ожидание вебхука.
    // Пока проводим платёж сразу — иначе экран оплаты нечем проверить
    order.payment = { provider, amountTiyin, status: 'succeeded', at: new Date().toISOString() };
    order.acceptance ??= {
      method: 'client_app',
      signerName: order.clientName || order.clientPhone,
      note: 'Приёмка зафиксирована оплатой в веб-карточке',
      at: new Date().toISOString(),
    };
    this.orders.touchOrder();
    this.log(order, 'payment_succeeded', { provider, amountTiyin });
    return this.html(
      res,
      donePage({
        title: 'Оплата прошла',
        text: 'Спасибо! Осталось оценить работу мастера.',
        token: code,
        dispatcherPhone: this.dispatcherPhone,
      }),
    );
  }

  // ---------- W-04 ----------

  @Get(':code/rate')
  async rateForm(@Param('code') code: string, @Res() res: Response) {
    const order = await this.orderOf(code);
    if (!order) return this.html(res, expiredPage(this.dispatcherPhone));
    return this.html(res, this.renderRate(order, code));
  }

  private renderRate(order: OrderRecord, code: string): string {
    const closedAt = order.statusLog.find((l) => l.to === 'closed')?.at;
    return ratePage({
      number: order.number,
      masterName: order.masterName ?? null,
      alreadyRated: typeof order.rating === 'number',
      // Окно оценки — 72 часа после закрытия (ТЗ 4.1)
      windowClosed: !!closedAt && Date.now() - new Date(closedAt).getTime() > 72 * 3_600_000,
      tipPresets: [1_000_000, 2_000_000, 5_000_000],
      token: code,
      dispatcherPhone: this.dispatcherPhone,
    });
  }

  @Post(':code/rate')
  async rate(@Param('code') code: string, @Body() b: { rating?: string; comment?: string }, @Res() res: Response) {
    const order = await this.orderOf(code);
    if (!order) return this.html(res, expiredPage(this.dispatcherPhone));
    if (typeof order.rating === 'number') return this.html(res, this.renderRate(order, code));

    const rating = Math.max(1, Math.min(5, Number(b?.rating) || 0));
    if (!rating) return this.html(res, this.renderRate(order, code));

    await this.orders.transition(
      't0',
      order.id,
      { action: 'rate', version: order.version, payload: { rating, comment: b?.comment } } as never,
      order.clientPhone,
    );
    this.log(order, 'rating_submitted', { rating, comment: b?.comment ?? null });
    return this.html(
      res,
      donePage({
        title: 'Спасибо!',
        text:
          rating <= 2
            ? 'Мы разберёмся и перезвоним в течение двух часов.'
            : 'Ваша оценка помогает мастерам расти в грейде.',
        token: code,
        dispatcherPhone: this.dispatcherPhone,
      }),
    );
  }

  @Post(':code/tip')
  async tip(@Param('code') code: string, @Body() b: { tipTiyin?: string }, @Res() res: Response) {
    const order = await this.orderOf(code);
    if (!order) return this.html(res, expiredPage(this.dispatcherPhone));
    const tip = Math.max(0, Number(b?.tipTiyin) || 0);
    if (tip > 0 && order.masterId) {
      order.tipTiyin = (order.tipTiyin ?? 0) + tip;
      this.orders.touchOrder();
      this.billing.tip({
        orderId: order.id,
        orderNumber: order.number,
        masterId: order.masterId,
        masterName: order.masterName,
        amountTiyin: tip,
      });
      this.log(order, 'tip_sent', { tipTiyin: tip });
    }
    return this.html(
      res,
      donePage({
        title: tip > 0 ? 'Спасибо!' : 'Хорошо',
        text: tip > 0 ? 'Чаевые уйдут мастеру целиком.' : 'Оценка всё равно помогает — спасибо.',
        token: code,
        dispatcherPhone: this.dispatcherPhone,
      }),
    );
  }
}

/**
 * Выдача ссылки. Дёргает диспетчерская, когда отправляет клиенту SMS.
 *
 * Отдельным контроллером под админским префиксом: ссылку выдаёт сотрудник,
 * а не тот, кто её открывает.
 */
@Controller('dispatch/web-card')
@UseGuards(AuthGuard)
export class WebCardIssueController {
  constructor(
    private readonly orders: OrdersService,
    private readonly audit: AuditService,
    private readonly links: WebCardLinksService,
    private readonly params: ParametersService,
  ) {}

  /**
   * Все выданные ссылки.
   *
   * Счётчик открытий — единственный способ узнать, дошла ли SMS: провайдер
   * рапортует о доставке сообщения, а не о том, что человек по ссылке перешёл.
   * Ноль открытий через сутки — повод позвонить, а не ждать.
   *
   * Объявлен до `:orderId`, иначе Nest примет «all» за идентификатор заявки.
   */
  @Get('all')
  @Roles('dispatcher', 'admin')
  all() {
    const rows = this.links.all().map((l) => ({
      ...l,
      expired: new Date(l.expiresAt).getTime() < Date.now(),
      neverOpened: l.opens === 0,
    }));
    return {
      links: rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      neverOpened: rows.filter((r) => r.neverOpened && !r.expired && !r.revokedAt).length,
    };
  }

  @Get(':orderId')
  @Roles('dispatcher', 'admin')
  list(@Param('orderId') orderId: string) {
    return { links: this.links.forOrder(orderId) };
  }

  @Post(':orderId')
  @Roles('dispatcher', 'admin')
  async issue(@Param('orderId') orderId: string, @Body() b: { ttlDays?: number }, @Req() req: { auth: JwtClaims }) {
    const order = await this.orders.record('t0', orderId);
    const link = this.links.issue(order.id, order.clientPhone, Math.min(Math.max(Number(b?.ttlDays) || 7, 1), 30));
    this.audit.write({
      actorPhone: req.auth.phone,
      action: 'web_card.link_issued',
      entity: 'Order',
      entityId: order.id,
      payload: { number: order.number, code: link.code },
    });
    const base = this.params.text(201, 'https://sozo.uz');
    const url = `${base}/w/${link.code}`;
    return {
      code: link.code,
      url,
      expiresAt: link.expiresAt,
      // Текст помещается в одну SMS: короткий код и есть весь смысл затеи
      smsText: `SOZO: заявка ${order.number}. Статус и оплата: ${url}`,
    };
  }

  @Post(':orderId/revoke')
  @Roles('dispatcher', 'admin')
  revoke(@Param('orderId') orderId: string, @Body() b: { code?: string }, @Req() req: { auth: JwtClaims }) {
    for (const l of this.links.forOrder(orderId)) {
      if (b?.code && l.code !== b.code) continue;
      this.links.revoke(l.code);
    }
    this.audit.write({
      actorPhone: req.auth.phone,
      action: 'web_card.link_revoked',
      entity: 'Order',
      entityId: orderId,
      payload: { code: b?.code ?? 'все' },
    });
    return { ok: true, message: 'Ссылка больше не откроется' };
  }
}

@Module({
  imports: [OrdersModule, MastersModule, SchedulingModule, MasterApiModule, BillingModule],
  controllers: [WebCardController, WebCardIssueController],
  providers: [WebCardLinksService],
})
export class WebCardModule {}
