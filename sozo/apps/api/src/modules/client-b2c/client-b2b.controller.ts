import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuditService } from '../platform/audit.service';
import { BillingService } from '../billing/billing.service';
import { CrmService, type LocationRec, type OrganizationRec, type RepresentativeRec } from '../crm/crm.service';
import { FieldService } from '../field/field.service';
import { LoyaltyService } from '../loyalty/loyalty.module';
import { MasterOpsService } from '../master-api/master-ops.service';
import { OrdersService } from '../orders/orders.service';
import { ParametersService } from '../platform/parameters.service';
import type { OrderRecord } from '../orders/order.repository';
import { AppGuard, type AppRequest } from './app.guard';
import { ClientPhotoService } from './client-photo.service';
import { ClientViewService } from './client-view.service';

/** Роль в точке выводится из карточки, а не из JWT: уволили — доступ исчез (A-09) */
type SiteRole = 'staff' | 'site_manager' | 'org_manager';

/**
 * Роль на точке — из права утверждать, а не из признака «основной».
 *
 * Раньше руководителем считался тот, у кого стоял флаг `primary`. Но главный
 * на точке ровно один — это адресат актов, — а руководителей на точке бывает
 * двое: две смены, подмена в отпуске. Второй с тем же порогом в 1 000 000 сум
 * молча становился сотрудником: ни утверждений, ни сумм на экране, ни людей.
 * Порог утверждения — то самое, что договор и выдаёт вместе с ролью.
 */
function roleOf(rep: RepresentativeRec): SiteRole {
  if (rep.approvalLimitTiyin === null) return 'org_manager';
  return rep.approvalLimitTiyin > 0 ? 'site_manager' : 'staff';
}

const ACTIVE = [
  'new',
  'estimated',
  'pending_approval',
  'approved',
  'assigned',
  'master_departed',
  'in_progress',
  'addwork_approval',
  'completed',
  'verified',
  'awaiting_payment',
];

/**
 * B2B-контуры приложения «Клиент» (DEV-08 §3.5–3.7): сотрудник точки,
 * руководитель точки, руководитель организации.
 *
 * Отличие от B2C не косметическое: сотрудник не видит денег (настройка
 * договора), руководитель точки утверждает в пределах лимита, а всё, что выше,
 * уходит уровнем выше. Поэтому суммы вырезаются на сервере, а не прячутся
 * на экране — иначе они всё равно уедут в приложение и утекут в логах.
 */
@Controller('app/b2b')
@UseGuards(AppGuard)
export class ClientB2BController {
  constructor(
    private readonly crm: CrmService,
    private readonly orders: OrdersService,
    private readonly field: FieldService,
    private readonly billing: BillingService,
    private readonly loyalty: LoyaltyService,
    private readonly ops: MasterOpsService,
    private readonly view: ClientViewService,
    private readonly photos: ClientPhotoService,
    private readonly audit: AuditService,
    private readonly params: ParametersService,
  ) {}

  private phone(req: AppRequest): string {
    return req.clientPhone!;
  }

  // ---------- Команда: приглашения (руководитель заводит своих сам) ----------

  /**
   * Кого руководитель может позвать и на какие точки.
   *
   * Отдаём заранее, а не проверяем при отправке: форма, которая позволяет
   * выбрать точку и получить отказ, — это форма, которую заполнили зря.
   */
  @Get('team')
  team(@Req() req: AppRequest) {
    const phone = this.phone(req);
    const sites = this.crm.locationsForPhone(phone);
    const orgManager = sites.some((s) => roleOf(s.rep) === 'org_manager');
    // Приглашать вправе тот, кто вправе утверждать: право заводить людей идёт
    // за ответственностью за деньги точки, а не за адресом рассылки актов
    const canInviteAt = sites.filter((s) => roleOf(s.rep) !== 'staff');
    return {
      canInvite: canInviteAt.length > 0,
      /** Потолок приглашённого не может быть выше вашего — кроме руководителя организации */
      maxLimitTiyin: orgManager ? null : Math.max(0, ...sites.map((s) => s.rep.approvalLimitTiyin ?? 0)),
      locations: canInviteAt.map((s) => ({
        id: s.loc.id,
        name: s.loc.name,
        address: s.loc.address,
        organizationName: s.org.name,
        roles: s.org.terms.approvalThresholds.map((t) => ({ role: t.role, limitTiyin: t.limitTiyin })),
        people: (s.loc.representatives ?? []).map((r) => ({
          id: r.id,
          fullName: r.fullName,
          phone: r.phone,
          role: r.role,
          position: r.position ?? null,
          approvalLimitTiyin: r.approvalLimitTiyin,
          primary: r.primary,
        })),
      })),
      invites: this.crm.invitesForPhone(phone).map((i) => ({
        id: i.id,
        code: i.code,
        locationId: i.locationId,
        fullName: i.fullName,
        role: i.role,
        position: i.position ?? null,
        approvalLimitTiyin: i.approvalLimitTiyin,
        expiresAt: i.expiresAt,
        usedAt: i.usedAt ?? null,
        usedByPhone: i.usedByPhone ?? null,
        revokedAt: i.revokedAt ?? null,
      })),
    };
  }

  @Post('team/invites')
  invite(
    @Body() b: { locationId?: string; fullName?: string; role?: string; position?: string; approvalLimitTiyin?: number | null; primary?: boolean },
    @Req() req: AppRequest,
  ) {
    if (!b?.locationId) throw new BadRequestException({ code: 'LOCATION_REQUIRED' });
    const inv = this.crm.issueInvite(this.phone(req), {
      locationId: b.locationId,
      fullName: b.fullName,
      role: b.role ?? 'Сотрудник',
      position: b.position,
      // `undefined` — это «поле не прислали», а не «без потолка»: null здесь
      // означает уровень организации, и путать их нельзя
      approvalLimitTiyin: b.approvalLimitTiyin === undefined ? 0 : b.approvalLimitTiyin,
      primary: b.primary,
    });
    this.audit.write({
      actorPhone: this.phone(req),
      action: 'b2b.invite_issued',
      entity: 'Location',
      entityId: inv.locationId,
      payload: { code: inv.code, role: inv.role, approvalLimitTiyin: inv.approvalLimitTiyin },
    });
    // `id` нужен приложению, чтобы код можно было отозвать сразу после выдачи,
    // не перечитывая весь список команды
    return { id: inv.id, code: inv.code, expiresAt: inv.expiresAt };
  }

  @Post('team/invites/:id/revoke')
  revokeInvite(@Param('id') id: string, @Req() req: AppRequest) {
    const inv = this.crm.revokeInvite(this.phone(req), id);
    this.audit.write({
      actorPhone: this.phone(req),
      action: 'b2b.invite_revoked',
      entity: 'Location',
      entityId: inv.locationId,
      payload: { code: inv.code },
    });
    return { revoked: true };
  }

  /** Точка, закреплённая за этим телефоном. Чужая — 403. */
  private site(req: AppRequest, locationId: string): { org: OrganizationRec; loc: LocationRec; rep: RepresentativeRec; role: SiteRole } {
    const found = this.crm.locationsForPhone(this.phone(req)).find((s) => s.loc.id === locationId);
    if (!found) {
      throw new ForbiddenException({ code: 'FOREIGN_LOCATION', message: 'Эта точка не закреплена за вами' });
    }
    return { ...found, role: roleOf(found.rep) };
  }

  /**
   * Второй фактор на крупных утверждениях (F-42).
   *
   * Вход в приложение — по SMS на номер, а номер можно перевыпустить в салоне
   * связи по копии паспорта. Для обычной заявки этого риска достаточно, для
   * счёта на несколько миллионов — нет. Порог: половина личного потолка.
   *
   * Код — четыре последние цифры собственного номера. Это не криптография,
   * а проверка «телефон у того же человека»: настоящий PIN с хранением и
   * восстановлением — отдельная работа, и делать его наполовину хуже, чем
   * не делать. Заглушка честно названа заглушкой и живёт в одном месте.
   */
  private requireConfirmation(rep: RepresentativeRec, amountTiyin: number, code?: string): void {
    const threshold = rep.approvalLimitTiyin === null ? 1_000_000_000 : Math.floor(rep.approvalLimitTiyin / 2);
    if (amountTiyin < threshold) return;
    const expected = rep.phone.slice(-4);
    if (code !== expected) {
      throw new ForbiddenException({
        code: 'CONFIRMATION_REQUIRED',
        message: 'Сумма крупная — подтвердите, что это вы: введите последние 4 цифры своего номера',
        thresholdTiyin: threshold,
        amountTiyin,
      });
    }
  }

  /** Все точки телефона — для дашборда организации */
  private mySites(req: AppRequest) {
    return this.crm.locationsForPhone(this.phone(req)).map((s) => ({ ...s, role: roleOf(s.rep) }));
  }

  private async ordersOf(locationIds: Set<string>): Promise<OrderRecord[]> {
    const all = await this.orders.list('t0');
    return all
      .filter((o) => o.locationId && locationIds.has(o.locationId))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /**
   * Карточка заявки для точки. Суммы вырезаются, если организация не разрешила
   * показывать их сотрудникам — вырезаются здесь, а не на экране.
   */
  private card(order: OrderRecord, showMoney: boolean) {
    const c = this.view.card(order);
    if (showMoney) return c;
    return { ...c, totalFromTiyin: 0, totalToTiyin: 0, moneyHidden: true };
  }

  // ==================== C-31 / C-35. Точка ====================

  /** Главный экран сотрудника и лента заявок руководителя точки */
  @Get('site/:locationId')
  async site_(@Param('locationId') locationId: string, @Query('filter') filter: string | undefined, @Req() req: AppRequest) {
    const { org, loc, rep, role } = this.site(req, locationId);
    // Сотруднику суммы показываем только если организация это разрешила (ТЗ 5.2)
    const showMoney = role !== 'staff' || org.terms.showMoneyToEmployees;

    let list = await this.ordersOf(new Set([locationId]));
    if (filter === 'active') list = list.filter((o) => ACTIVE.includes(o.status));
    if (filter === 'closed') list = list.filter((o) => ['closed', 'rated'].includes(o.status));
    if (filter === 'approval') list = list.filter((o) => o.status === 'pending_approval');
    // «Мои» — то, о чём сообщил сам этот человек. На большой точке в общей
    // ленте своя заявка теряется среди чужих, а следит человек за своей
    if (filter === 'mine') list = list.filter((o) => o.clientPhone === this.phone(req));

    const toAccept = list.filter((o) => o.acceptanceRequest?.pending && !o.acceptance);
    const monthSpent = list
      .filter((o) => ['closed', 'rated'].includes(o.status) && this.sameMonth(o.createdAt))
      .reduce((s, o) => s + o.totalFromTiyin + o.totalMaterialTiyin, 0);

    const account = this.loyalty.accounts.get(this.phone(req));

    return {
      location: { id: loc.id, name: loc.name, address: loc.address },
      organization: { id: org.id, name: org.name, status: org.status },
      role,
      showMoney,
      orders: list.map((o) => this.card(o, showMoney)),
      // Карточка кода приёмки на C-31 — заявка ждёт подтверждения работ
      awaitingAcceptance: toAccept.map((o) => ({ id: o.id, number: o.number, address: o.address })),
      pendingApproval: list.filter((o) => o.status === 'pending_approval').length,
      limits: {
        orderLimitTiyin: loc.orderLimitTiyin,
        monthlyLimitTiyin: loc.monthlyLimitTiyin,
        monthSpentTiyin: monthSpent,
        myApprovalLimitTiyin: rep.approvalLimitTiyin,
      },
      // Программа баллов — только с согласия организации (ТЗ 17.14)
      loyalty: org.terms.loyaltyEnabled
        ? { enabled: true, balanceTiyin: account?.balanceTiyin ?? 0 }
        : { enabled: false, balanceTiyin: 0 },
      empty: 'Заявок нет',
    };
  }

  private sameMonth(date: Date | string): boolean {
    const d = new Date(date);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }

  // ==================== C-32. Сообщить о поломке ====================

  @Post('site/:locationId/report')
  async report(
    @Param('locationId') locationId: string,
    @Body()
    b: {
      description?: string;
      category?: string;
      photos?: string[];
      urgency?: 'normal' | 'urgent' | 'emergency';
      needRiser?: boolean;
      needCommonArea?: boolean;
      accessConfirmed?: boolean;
      accessAt?: string;
    },
    @Req() req: AppRequest,
  ) {
    const { org, loc, rep } = this.site(req, locationId);
    const description = b?.description?.trim();
    if (!description) {
      throw new BadRequestException({ code: 'DESCRIPTION_REQUIRED', message: 'Опишите, что случилось' });
    }
    const order = await this.orders.create(
      't0',
      {
        clientPhone: this.phone(req),
        clientName: rep.fullName,
        address: loc.address,
        lat: loc.lat ?? undefined,
        lng: loc.lng ?? undefined,
        description: b.category ? `${b.category}: ${description}` : description,
        urgency: b.urgency ?? 'normal',
        source: 'app',
        organizationId: org.id,
        locationId: loc.id,
        commonAreaAccess:
          b.needRiser || b.needCommonArea
            ? {
                needRiser: !!b.needRiser,
                needCommonArea: !!b.needCommonArea,
                confirmed: b.accessConfirmed,
                confirmedAt: b.accessAt,
              }
            : undefined,
      },
      this.phone(req),
    );
    this.photos.saveMany(order, b?.photos);
    this.audit.write({
      actorPhone: this.phone(req),
      action: 'client.site_issue_reported',
      entity: 'Order',
      entityId: order.id,
      payload: { number: order.number, locationId, urgency: order.urgency },
    });
    return {
      id: order.id,
      number: order.number,
      urgency: order.urgency,
      // Анти-дробление: механику проверки сотруднику не объясняем (PRD-01)
      message:
        order.urgency === 'emergency'
          ? 'Аварийная заявка принята — мастер выедет немедленно'
          : 'Заявка принята, ищем мастера',
      emergency: order.urgency === 'emergency',
    };
  }

  /** C-33. Что делать при аварии — экран кешируется целиком, авария бывает без сети */
  @Get('site/:locationId/emergency')
  emergency(@Param('locationId') locationId: string, @Req() req: AppRequest) {
    const { org, loc } = this.site(req, locationId);
    const access = loc.access;
    const [dayMin, nightMin] = org.terms.slaEmergencyMin;
    const hour = new Date().getHours();
    const isNight = hour < 7 || hour >= 22;
    return {
      dispatcherPhone: this.params.text(200, '+998712000000'),
      // Срок из договора, а не из головы: организация подписывала именно его
      slaMinutes: isNight ? nightMin : dayMin,
      slaNote: isNight
        ? `Ночью бригада выезжает в течение ${nightMin} мин по договору`
        : `Днём бригада выезжает в течение ${dayMin} мин по договору`,
      kinds: [
        {
          kind: 'water',
          title: 'Вода',
          steps: [
            { text: 'Перекройте кран холодной воды', hint: access?.waterShutoff ?? null },
            { text: 'Уберите технику и провода из воды', hint: null },
            { text: 'Позвоните диспетчеру', hint: null },
          ],
        },
        {
          kind: 'electricity',
          title: 'Электрика',
          steps: [
            { text: 'Отключите автомат в щитке', hint: access?.electricalPanel ?? null },
            { text: 'Не трогайте оголённые провода', hint: null },
            { text: 'Позвоните диспетчеру', hint: null },
          ],
        },
        {
          kind: 'gas',
          title: 'Газ',
          steps: [
            { text: 'Перекройте кран', hint: access?.gasValve ?? null },
            { text: 'Откройте окна, не включайте свет', hint: null },
            { text: 'Позвоните 104, затем диспетчеру', hint: null },
          ],
        },
      ],
    };
  }

  /**
   * Вызвать аварийную бригаду на точку.
   *
   * До этого экран «Авария» был памяткой с телефоном: перекройте кран, потом
   * звоните. Звонок остаётся — он быстрее любого приложения, — но заявка
   * теперь заводится сразу, чтобы событие было в системе, а срок по договору
   * начал идти с этой минуты, а не с того момента, когда диспетчер поднимет
   * трубку и всё запишет.
   */
  @Post('site/:locationId/emergency')
  async callEmergency(
    @Param('locationId') locationId: string,
    @Body() b: { kind?: string; description?: string },
    @Req() req: AppRequest,
  ) {
    const { org, loc, rep } = this.site(req, locationId);
    const kindTitle =
      b?.kind === 'water' ? 'Вода' : b?.kind === 'electricity' ? 'Электрика' : b?.kind === 'gas' ? 'Газ' : 'Авария';
    const [dayMin, nightMin] = org.terms.slaEmergencyMin;
    const hour = new Date().getHours();
    const slaMinutes = hour < 7 || hour >= 22 ? nightMin : dayMin;

    const order = await this.orders.create(
      't0',
      {
        clientPhone: this.phone(req),
        clientName: rep.fullName,
        address: loc.address,
        lat: loc.lat ?? undefined,
        lng: loc.lng ?? undefined,
        description: `${kindTitle}: ${b?.description?.trim() || 'аварийный вызов из приложения'}`,
        urgency: 'emergency',
        source: 'app',
        organizationId: org.id,
        locationId: loc.id,
      },
      this.phone(req),
    );
    // Срок по договору живёт на заявке: иначе о нём знает только PDF-отчёт
    order.slaDueAt = new Date(Date.now() + slaMinutes * 60_000).toISOString();
    this.orders.touchOrder();

    this.audit.write({
      actorPhone: this.phone(req),
      action: 'client.emergency_called',
      entity: 'Order',
      entityId: order.id,
      payload: { number: order.number, kind: b?.kind ?? null, slaMinutes },
    });
    return {
      ok: true,
      orderId: order.id,
      number: order.number,
      slaMinutes,
      dispatcherPhone: this.params.text(200, '+998712000000'),
      message: `Заявка ${order.number} принята. Бригада выезжает в течение ${slaMinutes} мин — если ситуация опасная, звоните диспетчеру не дожидаясь`,
    };
  }

  // ==================== C-34. Приёмка работ ====================

  @Get('orders/:id/acceptance')
  async acceptanceInfo(@Param('id') id: string, @Req() req: AppRequest) {
    const order = await this.orders.record('t0', id);
    if (!order.locationId) throw new BadRequestException({ code: 'NOT_B2B' });
    const { org, role } = this.site(req, order.locationId);
    if (!order.acceptanceCode) {
      order.acceptanceCode = String(Math.floor(1000 + Math.random() * 9000));
      this.orders.touchOrder();
    }
    return {
      id: order.id,
      number: order.number,
      code: order.acceptanceCode,
      requested: !!order.acceptanceRequest?.pending,
      accepted: !!order.acceptance,
      rejections: order.acceptanceRequest?.rejections ?? [],
      // Фото «после» — беглая проверка перед подтверждением
      photos: order.photos
        .filter((p) => p.stage === 'after' && p.file)
        .map((p) => ({ url: `/v1/photos/${p.file}?token=`, at: p.at })),
      showMoney: role !== 'staff' || org.terms.showMoneyToEmployees,
    };
  }

  @Post('orders/:id/acceptance')
  async accept(@Param('id') id: string, @Body() b: { note?: string; accept?: boolean; reason?: string }, @Req() req: AppRequest) {
    const order = await this.orders.record('t0', id);
    if (!order.locationId) throw new BadRequestException({ code: 'NOT_B2B' });
    const { rep } = this.site(req, order.locationId);
    if (!order.acceptanceRequest?.pending) {
      throw new BadRequestException({ code: 'ACCEPTANCE_NOT_REQUESTED', message: 'Мастер ещё не отправил работу на приёмку' });
    }
    if (order.acceptance) throw new BadRequestException({ code: 'ALREADY_ACCEPTED', message: 'Работа уже принята' });

    if (b?.accept === false) {
      const reason = b?.reason?.trim();
      if (!reason) throw new BadRequestException({ code: 'REASON_REQUIRED', message: 'Укажите, что именно не принято' });
      order.acceptanceRequest.rejections ??= [];
      order.acceptanceRequest.rejections.push({ at: new Date().toISOString(), reason, by: rep.fullName });
      // Мастер доделывает и отправляет заново — заявка остаётся в работе
      order.acceptanceRequest.pending = false;
      this.orders.touchOrder();
      this.audit.write({ actorPhone: this.phone(req), action: 'client.work_rejected', entity: 'Order', entityId: id, payload: { reason } });
      return { ok: true, accepted: false, message: 'Передали диспетчеру — он свяжется с вами' };
    }

    order.acceptance = {
      method: 'client_app',
      signerName: rep.fullName,
      note: b?.note?.trim() || undefined,
      at: new Date().toISOString(),
    };
    this.orders.touchOrder();
    this.audit.write({ actorPhone: this.phone(req), action: 'client.work_accepted', entity: 'Order', entityId: id, payload: { note: b?.note ?? null } });
    return { ok: true, accepted: true, message: 'Приёмка подтверждена' };
  }

  // ==================== C-36 / C-41. Утверждения ====================

  /** Центр утверждений: сметы и доп-сметы, отсортированные по срочности */
  @Get('approvals')
  async approvals(@Req() req: AppRequest) {
    // Сотруднику точки утверждения не показываем вовсе (DEV-08 C-31):
    // список, в котором ничего нельзя сделать, — это не информация, а раздражение
    const sites = this.mySites(req).filter((s) => s.role !== 'staff');
    const byLoc = new Map(sites.map((s) => [s.loc.id, s]));
    const list = await this.ordersOf(new Set(byLoc.keys()));

    const items = list
      .filter((o) => o.status === 'pending_approval' || o.status === 'addwork_approval')
      .map((o) => {
        const site = byLoc.get(o.locationId!)!;
        const addwork = this.ops.addworkFor(o.id);
        const limit = site.rep.approvalLimitTiyin;
        const amount = addwork
          ? Math.max(...addwork.variants.map((v) => v.totalTiyin))
          : o.totalFromTiyin;
        return {
          orderId: o.id,
          number: o.number,
          locationId: o.locationId,
          locationName: site.loc.name,
          // Тип задаёт тон экрана: вынужденная — красная и блокирующая
          kind: addwork ? 'forced' : 'estimate',
          title: addwork ? 'Вынужденная доп-работа' : 'Смета по заявке',
          amountTiyin: amount,
          description: o.description,
          variants: addwork?.variants ?? null,
          waitingHours: Math.floor((Date.now() - new Date(o.createdAt).getTime()) / 3_600_000),
          // Выше своего потолка решение не принимается — уходит уровнем выше (ТЗ 5.2)
          aboveMyLimit: limit !== null && amount > limit,
          myLimitTiyin: limit,
        };
      })
      // Вынужденные и «выше лимита» — всегда сверху
      .sort((a, b) => (a.kind === b.kind ? b.waitingHours - a.waitingHours : a.kind === 'forced' ? -1 : 1));

    return { items, total: items.length, empty: 'Всё решено' };
  }

  @Post('approvals/:orderId')
  async decide(
    @Param('orderId') orderId: string,
    @Body() b: { approve?: boolean; variant?: 'minimal' | 'full'; reason?: string; confirmationCode?: string },
    @Req() req: AppRequest,
  ) {
    const order = await this.orders.record('t0', orderId);
    if (!order.locationId) throw new BadRequestException({ code: 'NOT_B2B' });
    const { rep, role } = this.site(req, order.locationId);
    const addwork = this.ops.addworkFor(order.id);
    const amount = addwork ? Math.max(...addwork.variants.map((v) => v.totalTiyin)) : order.totalFromTiyin;

    // Нулевой потолок — это «утверждать нельзя», а не «можно утверждать ноль».
    // Заявка описанием имеет сумму 0, и без этой проверки её утвердил бы кто угодно.
    if (role === 'staff' || rep.approvalLimitTiyin === 0) {
      throw new ForbiddenException({
        code: 'APPROVAL_FORBIDDEN',
        message: 'Утверждение сметы не входит в ваши права — решение принимает руководитель',
      });
    }
    if (rep.approvalLimitTiyin !== null && amount > rep.approvalLimitTiyin && b?.approve !== false) {
      throw new BadRequestException({
        code: 'APPROVAL_LIMIT_EXCEEDED',
        message: 'Сумма выше вашего лимита — решение принимает уровень выше',
        limit: rep.approvalLimitTiyin,
        amount,
      });
    }

    // Крупная сумма подтверждается вторым фактором (F-42): SIM могли подменить,
    // и тогда чужой человек в приложении утверждает счёт от имени руководителя.
    // Порог — половина потолка человека: ниже риск не стоит лишнего шага
    if (b?.approve !== false) this.requireConfirmation(rep, amount, b?.confirmationCode);

    if (addwork) {
      if (b?.approve === false) {
        this.ops.resolveAddwork(addwork.id, 'declined');
        if (order.status === 'addwork_approval') {
          await this.orders.transition('t0', orderId, { action: 'resolve_addwork', version: order.version } as never, this.phone(req));
        }
        this.audit.write({ actorPhone: this.phone(req), action: 'client.addwork_declined', entity: 'Order', entityId: orderId });
        return { ok: true, message: 'Отклонено. Мастер выполнит консервацию, позиция уйдёт в техдолг точки' };
      }
      if (!b?.variant) throw new BadRequestException({ code: 'VARIANT_REQUIRED', message: 'Выберите вариант работ' });
      this.ops.resolveAddwork(addwork.id, 'approved', b.variant);
      if (order.status === 'addwork_approval') {
        await this.orders.transition('t0', orderId, { action: 'resolve_addwork', version: order.version } as never, this.phone(req));
      }
      this.audit.write({
        actorPhone: this.phone(req),
        action: 'client.addwork_approved',
        entity: 'Order',
        entityId: orderId,
        payload: { variant: b.variant, amountTiyin: amount },
      });
      return { ok: true, message: 'Доп-смета утверждена' };
    }

    if (b?.approve === false) {
      const reason = b?.reason?.trim() || 'Отклонено утверждающим';
      await this.orders.transition('t0', orderId, { action: 'cancel', version: order.version, reason } as never, this.phone(req));
      this.audit.write({ actorPhone: this.phone(req), action: 'client.estimate_declined', entity: 'Order', entityId: orderId, payload: { reason } });
      return { ok: true, message: 'Отклонено' };
    }
    await this.orders.transition('t0', orderId, { action: 'approve', version: order.version } as never, this.phone(req));
    this.audit.write({
      actorPhone: this.phone(req),
      action: 'client.estimate_approved',
      entity: 'Order',
      entityId: orderId,
      payload: { amountTiyin: amount },
    });
    return { ok: true, message: 'Смета утверждена' };
  }

  // ==================== C-37. Техдолг точки ====================

  /**
   * Техдолг — это дефекты из актов осмотра, по которым решения нет или был отказ.
   * Считаем по актам, а не по отдельному реестру: акт и есть источник дефекта.
   */
  @Get('site/:locationId/debt')
  debt(@Param('locationId') locationId: string, @Req() req: AppRequest) {
    this.site(req, locationId);
    const acts = this.field.list({ locationId });
    const items = acts.flatMap((a) =>
      a.items
        .filter((i) => i.decision !== 'accepted')
        .map((i) => ({
          id: i.id,
          actId: a.id,
          actNumber: a.number,
          category: i.category,
          description: i.description,
          severity: i.severity,
          estimateTiyin: i.estimateTiyin,
          declined: i.decision === 'declined',
          declineReason: i.declineReason ?? null,
          ageDays: Math.floor((Date.now() - new Date(a.createdAt).getTime()) / 86_400_000),
          createdAt: a.createdAt,
        })),
    );
    const sum = (sev: string) =>
      items.filter((i) => i.severity === sev).reduce((s, i) => s + (i.estimateTiyin ?? 0), 0);
    return {
      items: items.sort((a, b) => b.ageDays - a.ageDays),
      totalTiyin: items.reduce((s, i) => s + (i.estimateTiyin ?? 0), 0),
      bySeverity: { high: sum('high'), medium: sum('medium'), low: sum('low') },
      // Оценка старше 30 дней требует переоценки (параметр 30)
      staleDays: 30,
      empty: 'Дефектов нет',
    };
  }

  // ==================== C-38. Лимиты и доступ ====================

  @Get('site/:locationId/limits')
  async limits(@Param('locationId') locationId: string, @Req() req: AppRequest) {
    const { org, loc, rep, role } = this.site(req, locationId);
    const list = await this.ordersOf(new Set([locationId]));
    const monthSpent = list
      .filter((o) => this.sameMonth(o.createdAt) && !['cancelled'].includes(o.status))
      .reduce((s, o) => s + o.totalFromTiyin + o.totalMaterialTiyin, 0);
    return {
      orderLimitTiyin: loc.orderLimitTiyin,
      monthlyLimitTiyin: loc.monthlyLimitTiyin,
      monthSpentTiyin: monthSpent,
      myApprovalLimitTiyin: rep.approvalLimitTiyin,
      access: loc.access,
      passport: loc.passport,
      // Нужен приложению, чтобы собрать ссылку на печатный отчёт по точке
      organizationId: org.id,
      // Лимиты меняет руководитель организации — здесь только просмотр
      editable: role === 'org_manager',
      note: 'Лимиты задаются договором и меняются руководителем организации',
      thresholds: org.terms.approvalThresholds,
    };
  }

  // ==================== C-39 / C-47. Отчёты ====================

  @Get('reports')
  async reports(@Query('locationId') locationId: string | undefined, @Req() req: AppRequest) {
    const sites = this.mySites(req);
    const scope = locationId ? sites.filter((s) => s.loc.id === locationId) : sites;
    if (!scope.length) throw new ForbiddenException({ code: 'FOREIGN_LOCATION' });
    const list = await this.ordersOf(new Set(scope.map((s) => s.loc.id)));

    const byMonth = new Map<string, OrderRecord[]>();
    for (const o of list) {
      const key = new Date(o.createdAt).toISOString().slice(0, 7);
      byMonth.set(key, [...(byMonth.get(key) ?? []), o]);
    }
    const months = [...byMonth.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([month, orders]) => ({
        month,
        ordersTotal: orders.length,
        emergencies: orders.filter((o) => o.urgency === 'emergency').length,
        worksTiyin: orders.reduce((s, o) => s + o.totalFromTiyin, 0),
        materialsTiyin: orders.reduce((s, o) => s + o.totalMaterialTiyin, 0),
        closed: orders.filter((o) => ['closed', 'rated'].includes(o.status)).length,
      }));

    const debtTotal = scope
      .flatMap((s) => this.field.list({ locationId: s.loc.id }))
      .flatMap((a) => a.items)
      .filter((i) => i.decision !== 'accepted')
      .reduce((s, i) => s + (i.estimateTiyin ?? 0), 0);

    return {
      scope: locationId ? scope[0].loc.name : scope[0]?.org.name ?? '',
      locations: sites.map((s) => ({ id: s.loc.id, name: s.loc.name })),
      months,
      techDebtTiyin: debtTotal,
      // PDF формирует модуль документов; здесь отдаём цифры, из которых он строится
      pdfAvailable: false,
      empty: 'Отчёт появится после первого месяца работы',
    };
  }

  // ==================== C-40. Дашборд организации ====================

  @Get('org/:orgId')
  async org(@Param('orgId') orgId: string, @Req() req: AppRequest) {
    const sites = this.mySites(req).filter((s) => s.org.id === orgId);
    if (!sites.length) throw new ForbiddenException({ code: 'FOREIGN_ORG' });
    const org = sites[0].org;
    const list = await this.ordersOf(new Set(sites.map((s) => s.loc.id)));

    const tiles = sites.map((s) => {
      const mine = list.filter((o) => o.locationId === s.loc.id);
      const emergency = mine.some((o) => o.urgency === 'emergency' && ACTIVE.includes(o.status));
      const approval = mine.filter((o) => ['pending_approval', 'addwork_approval'].includes(o.status)).length;
      const active = mine.filter((o) => ACTIVE.includes(o.status)).length;
      // Светофор дублируется подписью: цвет без текста недоступен (чек-лист §6 п.6)
      const state = emergency ? 'error' : approval > 0 ? 'error' : active > 0 ? 'warning' : 'success';
      return {
        id: s.loc.id,
        name: s.loc.name,
        address: s.loc.address,
        state,
        label: emergency
          ? 'Авария'
          : approval > 0
            ? 'Ждёт утверждения'
            : active > 0
              ? `Заявки в работе (${active})`
              : 'Всё в порядке',
        activeOrders: active,
        pendingApproval: approval,
      };
    });

    const invoices = this.billing.invoicesList().filter((i) => i.organizationId === orgId);
    const unpaid = invoices.filter((i) => i.status === 'issued');
    const debtTotal = sites
      .flatMap((s) => this.field.list({ locationId: s.loc.id }))
      .flatMap((a) => a.items)
      .filter((i) => i.decision !== 'accepted')
      .reduce((s, i) => s + (i.estimateTiyin ?? 0), 0);

    // Деньги в сводке — те же, что в разделе финансов, который сотруднику
    // закрыт. Настройка договора «не показывать суммы сотрудникам» соблюдалась
    // в ленте заявок и в финансах, а сводку по сети отдавали всем: экрана у
    // сотрудника нет, но токен лежит у него в телефоне
    const showMoney = sites.some((s) => roleOf(s.rep) !== 'staff') || org.terms.showMoneyToEmployees;

    return {
      organization: { id: org.id, name: org.name, status: org.status },
      // Приостановка — не косметика: доступны только аварийные заявки
      suspended: org.status !== 'active',
      tiles,
      showMoney,
      summary: {
        pendingApproval: tiles.reduce((s, t) => s + t.pendingApproval, 0),
        ...(showMoney
          ? {
              subscriptionTiyin: org.subscriptionTiyin,
              unpaidInvoices: unpaid.length,
              unpaidTiyin: unpaid.reduce((s, i) => s + i.amountTiyin, 0),
              techDebtTiyin: debtTotal,
            }
          : {}),
      },
    };
  }

  // ==================== C-44. Финансы организации ====================

  @Get('org/:orgId/finance')
  async org_finance(@Param('orgId') orgId: string, @Req() req: AppRequest) {
    const sites = this.mySites(req).filter((s) => s.org.id === orgId);
    if (!sites.length) throw new ForbiddenException({ code: 'FOREIGN_ORG' });
    const org = sites[0].org;
    // Проверяем все роли человека в организации, а не первую попавшуюся точку:
    // один и тот же телефон может быть сотрудником на одной точке
    // и руководителем сети на другой
    if (!sites.some((s) => s.role === 'org_manager')) {
      throw new ForbiddenException({ code: 'ROLE_FORBIDDEN', message: 'Финансы видит руководитель организации' });
    }
    const invoices = this.billing.invoicesList().filter((i) => i.organizationId === orgId);
    const unpaid = invoices.filter((i) => i.status === 'issued');
    // Дунинг: T+3 — предупреждение, T+7 — приостановка обслуживания
    const oldestUnpaidDays = unpaid.length
      ? Math.max(...unpaid.map((i) => Math.floor((Date.now() - new Date(i.issuedAt).getTime()) / 86_400_000)))
      : 0;
    return {
      organization: { id: org.id, name: org.name, status: org.status },
      contract: {
        type: org.contractType,
        kind: org.contractKind,
        subscriptionTiyin: org.subscriptionTiyin,
        pricesFrozen: org.contractKind === 'annual',
        penaltyEnabled: org.terms.penaltyEnabled,
        carryoverPercent: org.terms.carryoverPercent,
      },
      invoices: invoices
        .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))
        .map((i) => ({
          id: i.id,
          number: i.number,
          kind: i.kind,
          amountTiyin: i.amountTiyin,
          status: i.status,
          issuedAt: i.issuedAt,
          paidAt: i.paidAt ?? null,
          // НДС внутри суммы — бухгалтерии организации он нужен всегда
          vatTiyin: i.vatTiyin ?? 0,
          vatRatePercent: i.vatRatePercent ?? 0,
        })),
      // Пени: показываем расчёт, а не выставленный счёт. Клиент должен видеть,
      // во что обходится просрочка, до того как ему это предъявят
      penalty: this.billing.penaltyFor(orgId),
      /**
       * Реквизиты обеих сторон и способ расчёта.
       *
       * Бухгалтерия спрашивает это первым делом, а видела только суммы:
       * свои ИНН и тип договора приходилось искать в бумажном экземпляре,
       * а реквизиты для оплаты — звонить и спрашивать.
       */
      requisites: {
        organization: {
          name: org.name,
          inn: org.inn,
          vatPayer: org.vatPayer,
          contractType: org.contractType === 'subscription' ? 'Абонентское обслуживание' : 'Разовые заявки',
          contractKind: org.contractKind === 'annual' ? 'Годовой' : 'Месячный',
          status: org.status,
        },
        // Абонентка платится по счёту с отсрочкой, разовые — предоплатой:
        // это не настройка, а следствие типа договора
        settlement:
          org.contractType === 'subscription'
            ? 'Оплата по счёту, банковским переводом. Обслуживание приостанавливается на 7-й день просрочки'
            : 'Предоплата по счёту до выезда мастера',
        payTo: this.params.text(202, ''),
      },
      // Остаток абонентки и прогноз (F-50). До этого экран показывал сумму
      // договора и счета, но не расход — а руководителя интересует ровно одно:
      // хватит ли до конца месяца
      balance: await this.subscriptionBalance(org),
      dunning: oldestUnpaidDays >= 7 ? 'suspend' : oldestUnpaidDays >= 3 ? 'warn' : null,
      oldestUnpaidDays,
      empty: 'Счетов пока нет',
    };
  }

  /**
   * Сколько абонентки оплачено, сколько израсходовано и на сколько хватит.
   *
   * Расход считаем по закрытым заявкам организации: пока заявка не закрыта,
   * её сумма ещё может измениться, и вычитать её из остатка — обещать клиенту
   * то, чего не было. Прогноз — линейный от среднего расхода с начала месяца:
   * точнее сказать нечем, и делать вид, что можем, не стоит.
   */
  private async subscriptionBalance(org: OrganizationRec) {
    const all = await this.orders.list('t0');
    const paid = this.billing
      .invoicesList()
      .filter((i) => i.organizationId === org.id && i.kind === 'subscription' && i.status === 'paid')
      .reduce((s, i) => s + i.amountTiyin, 0);
    const consumed = all
      .filter((o) => o.organizationId === org.id && ['closed', 'rated'].includes(o.status))
      .reduce((s, o) => s + o.totalFromTiyin, 0);
    const balance = paid - consumed;
    const dayOfMonth = new Date().getDate();
    const burnPerDay = dayOfMonth > 0 ? consumed / dayOfMonth : 0;
    const carryover = Math.max(0, Math.floor((balance * org.terms.carryoverPercent) / 100));
    return {
      paidTiyin: paid,
      consumedTiyin: consumed,
      balanceTiyin: balance,
      overlimit: balance < 0,
      // «Хватит примерно до N числа» — понятнее, чем «осталось 1 200 000»
      forecastDay: burnPerDay > 0 && balance > 0 ? Math.min(31, Math.floor(dayOfMonth + balance / burnPerDay)) : null,
      // Условие договора наконец во что-то превращается: видно, сколько
      // неизрасходованного перейдёт на следующий период
      carryoverPercent: org.terms.carryoverPercent,
      carryoverTiyin: org.terms.carryoverPercent > 0 ? carryover : 0,
      note:
        balance < 0
          ? 'Сверхлимит: превышение выставляется отдельным счётом по разовым ценам'
          : org.terms.carryoverPercent > 0
            ? `Неизрасходованное переносится на следующий период на ${org.terms.carryoverPercent}%`
            : 'Неизрасходованный остаток на следующий период не переносится',
    };
  }

  // ==================== C-45. Лимиты и пользователи ====================

  /**
   * Люди на точках и выданные коды приглашений.
   *
   * Раздел был закрыт всем, кроме руководителя организации, — при том что
   * руководитель точки по правилам заводит сотрудников и выдаёт коды на своей
   * точке. Право у него было, экрана не было. Теперь он видит только свои
   * точки, а `canManage` говорит приложению, что на этой точке ему позволено.
   */
  @Get('org/:orgId/users')
  org_users(@Param('orgId') orgId: string, @Req() req: AppRequest) {
    const sites = this.mySites(req).filter((s) => s.org.id === orgId);
    if (!sites.length) throw new ForbiddenException({ code: 'FOREIGN_ORG' });
    const managing = sites.filter((s) => s.role === 'org_manager' || s.role === 'site_manager');
    if (!managing.length) {
      throw new ForbiddenException({ code: 'ROLE_FORBIDDEN', message: 'Раздел доступен руководителям' });
    }
    const org = sites[0].org;
    const isOrgManager = managing.some((s) => s.role === 'org_manager');
    // Руководителю организации — все точки сети, руководителю точки — его
    const visible = isOrgManager ? org.locations : org.locations.filter((l) => managing.some((s) => s.loc.id === l.id));
    const invites = this.crm.invitesOfOrg(org.id).filter((i) => visible.some((l) => l.id === i.locationId));
    return {
      organization: { id: org.id, name: org.name },
      showMoneyToEmployees: org.terms.showMoneyToEmployees,
      locations: visible.map((l) => ({
        id: l.id,
        name: l.name,
        orderLimitTiyin: l.orderLimitTiyin,
        monthlyLimitTiyin: l.monthlyLimitTiyin,
        // Что можно на этой точке: руководитель точки заводит только
        // сотрудников без права утверждения, менять чужие пороги ему нельзя
        canManage: isOrgManager ? 'all' : 'staff_only',
        users: l.representatives.map((r) => ({
          id: r.id,
          fullName: r.fullName,
          phone: r.phone,
          role: roleOf(r),
          roleTitle: r.role,
          position: r.position ?? null,
          approvalLimitTiyin: r.approvalLimitTiyin,
          primary: r.primary,
        })),
        // Выданные и ещё живые коды: без них код исчезал вместе с диалогом,
        // в котором его показали, — ни посмотреть, ни отозвать
        invites: invites
          .filter((i) => i.locationId === l.id && !i.usedAt && !i.revokedAt)
          .map((i) => ({
            id: i.id,
            code: i.code,
            position: i.position ?? null,
            role: i.role,
            approvalLimitTiyin: i.approvalLimitTiyin,
            expiresAt: i.expiresAt,
          })),
      })),
      thresholds: org.terms.approvalThresholds,
      note: 'Пороги утверждения задаются договором и меняются через SOZO',
    };
  }

  // ==================== Управление людьми на точке (F-52) ====================

  /**
   * Кто вправе заводить и снимать людей.
   *
   * Руководитель организации — кого угодно на своих точках. Руководитель точки —
   * только сотрудников без права утверждения на своей точке: иначе он выпишет
   * себе второго себя и обойдёт потолок, заданный договором.
   */
  private canManage(role: SiteRole, limitTiyin: number | null): void {
    if (role === 'org_manager') return;
    if (role === 'site_manager' && limitTiyin === 0) return;
    throw new ForbiddenException({
      code: 'ROLE_FORBIDDEN',
      message:
        role === 'site_manager'
          ? 'Руководитель точки заводит только сотрудников без права утверждения — остальное через руководителя организации'
          : 'Раздел доступен руководителю',
    });
  }

  @Post('site/:locationId/users')
  addUser(
    @Param('locationId') locationId: string,
    @Body() b: { fullName?: string; phone?: string; roleTitle?: string; position?: string; approvalLimitTiyin?: number | null },
    @Req() req: AppRequest,
  ) {
    const { org, loc, role } = this.site(req, locationId);
    const limit = b?.approvalLimitTiyin === undefined ? 0 : b.approvalLimitTiyin;
    this.canManage(role, limit);
    if (!b?.fullName?.trim()) throw new BadRequestException({ code: 'NAME_REQUIRED', message: 'Укажите имя' });

    const rec = this.crm.addRepresentative(org.id, loc.id, {
      fullName: b.fullName.trim(),
      phone: (b.phone ?? '').trim(),
      role: b.roleTitle?.trim() || 'Сотрудник',
      position: b.position?.trim() || undefined,
      approvalLimitTiyin: limit,
      primary: false,
    });
    this.audit.write({
      actorPhone: this.phone(req),
      action: 'client.site_user_added',
      entity: 'Representative',
      entityId: rec.id,
      payload: { locationId: loc.id, phone: rec.phone, limit },
    });
    return {
      ok: true,
      user: { id: rec.id, fullName: rec.fullName, phone: rec.phone, roleTitle: rec.role, approvalLimitTiyin: rec.approvalLimitTiyin },
      message: `${rec.fullName} получит доступ, войдя в приложение по своему номеру`,
    };
  }

  @Post('site/:locationId/users/:repId')
  updateUser(
    @Param('locationId') locationId: string,
    @Param('repId') repId: string,
    @Body() b: { roleTitle?: string; approvalLimitTiyin?: number | null; primary?: boolean },
    @Req() req: AppRequest,
  ) {
    const { org, loc, rep, role } = this.site(req, locationId);
    this.canManage(role, b?.approvalLimitTiyin === undefined ? 0 : b.approvalLimitTiyin);
    if (rep.id === repId && b?.approvalLimitTiyin !== undefined) {
      throw new ForbiddenException({
        code: 'SELF_LIMIT_FORBIDDEN',
        message: 'Свой потолок утверждения менять нельзя — он задан договором',
      });
    }
    const updated = this.crm.updateRepresentative(org.id, loc.id, repId, {
      role: b?.roleTitle?.trim() || undefined,
      approvalLimitTiyin: b?.approvalLimitTiyin,
      primary: b?.primary,
    });
    this.audit.write({
      actorPhone: this.phone(req),
      action: 'client.site_user_updated',
      entity: 'Representative',
      entityId: repId,
      payload: { locationId: loc.id, limit: updated.approvalLimitTiyin, primary: updated.primary },
    });
    return { ok: true, user: updated };
  }

  @Delete('site/:locationId/users/:repId')
  removeUser(@Param('locationId') locationId: string, @Param('repId') repId: string, @Req() req: AppRequest) {
    const { org, loc, rep, role } = this.site(req, locationId);
    this.canManage(role, 0);
    if (rep.id === repId) {
      throw new BadRequestException({ code: 'SELF_REMOVE_FORBIDDEN', message: 'Себя снять нельзя' });
    }
    this.crm.removeRepresentative(org.id, loc.id, repId);
    this.audit.write({
      actorPhone: this.phone(req),
      action: 'client.site_user_removed',
      entity: 'Representative',
      entityId: repId,
      payload: { locationId: loc.id },
    });
    return { ok: true, message: 'Доступ снят' };
  }

  // ==================== C-42. Пакет дефектов из акта осмотра ====================

  /** Акты, ждущие решения ответственного: из них собирается пакет дефектов */
  @Get('acts')
  acts(@Req() req: AppRequest) {
    this.field.expireOverdue();
    const mine = this.mySites(req).map((s) => s.loc.id);
    const acts = this.field
      .list()
      .filter((a) => mine.includes(a.locationId) && ['sent', 'decided'].includes(a.status));
    return {
      acts: acts.map((a) => ({
        id: a.id,
        number: a.number,
        locationId: a.locationId,
        locationName: a.locationName,
        masterName: a.masterName,
        status: a.status,
        createdAt: a.createdAt,
        expiresAt: a.expiresAt ?? null,
        checklist: a.checklist,
        items: a.items.map((i) => ({
          id: i.id,
          category: i.category,
          description: i.description,
          severity: i.severity,
          estimateTiyin: i.estimateTiyin,
          decision: i.decision,
          orderId: i.orderId ?? null,
        })),
        totalTiyin: a.items.reduce((s, i) => s + (i.estimateTiyin ?? 0), 0),
        pending: a.items.filter((i) => i.decision === 'pending').length,
      })),
      empty: 'Актов осмотра пока нет',
    };
  }

  /**
   * Пакетное решение по дефектам. Из принятых сразу заводятся заявки —
   * подпись под позицией и есть согласие на её выполнение, второй раз
   * подтверждать нечего (ТЗ 9.3).
   */
  @Post('acts/:id/decide')
  async decideAct(
    @Param('id') id: string,
    @Body() b: { accepted?: string[]; declined?: string[]; declineReason?: string },
    @Req() req: AppRequest,
  ) {
    const act = this.field.get(id);
    const { org, loc, rep, role } = this.site(req, act.locationId);
    if (role === 'staff') {
      throw new ForbiddenException({ code: 'APPROVAL_FORBIDDEN', message: 'Решение по акту принимает руководитель' });
    }
    const accepted = b?.accepted ?? [];
    const acceptedSum = act.items
      .filter((i) => accepted.includes(i.id))
      .reduce((s, i) => s + (i.estimateTiyin ?? 0), 0);
    if (rep.approvalLimitTiyin !== null && acceptedSum > rep.approvalLimitTiyin) {
      throw new BadRequestException({
        code: 'APPROVAL_LIMIT_EXCEEDED',
        message: 'Сумма выбранных позиций выше вашего лимита — уберите часть или передайте выше',
        limit: rep.approvalLimitTiyin,
        acceptedSum,
      });
    }
    const decisions = [
      ...accepted.map((itemId) => ({ itemId, decision: 'accepted' as const })),
      ...(b?.declined ?? []).map((itemId) => ({
        itemId,
        decision: 'declined' as const,
        declineReason: b?.declineReason,
      })),
    ];
    this.field.decide(id, { id: rep.id, fullName: rep.fullName, phone: rep.phone }, decisions);

    const created: string[] = [];
    for (const item of this.field.acceptedPending(id)) {
      const order = await this.orders.create(
        't0',
        {
          clientPhone: this.phone(req),
          clientName: rep.fullName,
          address: loc.address,
          lat: loc.lat ?? undefined,
          lng: loc.lng ?? undefined,
          description: `${item.category}: ${item.description} (акт ${act.number})`,
          organizationId: org.id,
          locationId: loc.id,
          source: 'app',
          fromDefect: { actId: id, itemId: item.id },
        },
        this.phone(req),
      );
      this.field.linkOrder(id, item.id, order.id);
      created.push(order.number);
    }
    this.audit.write({
      actorPhone: this.phone(req),
      action: 'client.act_decided',
      entity: 'InspectionAct',
      entityId: id,
      payload: { accepted: accepted.length, declined: (b?.declined ?? []).length, created: created.length },
    });
    return {
      ok: true,
      createdOrders: created,
      message: created.length
        ? `${created.length} заявок передано диспетчеру`
        : 'Решение записано',
    };
  }

  // ==================== C-43. Техдолг организации ====================

  @Get('org/:orgId/debt')
  orgDebt(@Param('orgId') orgId: string, @Req() req: AppRequest) {
    const sites = this.mySites(req).filter((s) => s.org.id === orgId);
    if (!sites.length) throw new ForbiddenException({ code: 'FOREIGN_ORG' });

    const byLocation = sites.map((s) => {
      // Возраст дефекта берём у акта: у позиции своей даты нет, а «висит
      // третий месяц» — это про акт, в котором её зафиксировали
      const items = this.field.list({ locationId: s.loc.id }).flatMap((a) =>
        a.items
          .filter((i) => i.decision !== 'accepted')
          .map((i) => ({ ...i, ageDays: Math.floor((Date.now() - new Date(a.createdAt).getTime()) / 86_400_000) })),
      );
      const sum = (sev: string) =>
        items.filter((i) => i.severity === sev).reduce((x, i) => x + (i.estimateTiyin ?? 0), 0);
      return {
        id: s.loc.id,
        name: s.loc.name,
        totalTiyin: items.reduce((x, i) => x + (i.estimateTiyin ?? 0), 0),
        count: items.length,
        bySeverity: { high: sum('high'), medium: sum('medium'), low: sum('low') },
        // Старше 60 дней — отдельная строка отчёта (DEV-08 C-43)
        olderThan60: items.filter((i) => i.ageDays > 60).length,
        olderThan60Tiyin: items.filter((i) => i.ageDays > 60).reduce((x, i) => x + (i.estimateTiyin ?? 0), 0),
      };
    });
    const total = byLocation.reduce((s, l) => s + l.totalTiyin, 0);
    return {
      totalTiyin: total,
      // Тренд считаем от закрытых из дефектов заявок: сколько уже устранено
      locations: byLocation.sort((a, b) => b.totalTiyin - a.totalTiyin),
      bySeverity: {
        high: byLocation.reduce((s, l) => s + l.bySeverity.high, 0),
        medium: byLocation.reduce((s, l) => s + l.bySeverity.medium, 0),
        low: byLocation.reduce((s, l) => s + l.bySeverity.low, 0),
      },
      empty: 'Техдолга нет',
    };
  }

  // ==================== C-46. График осмотров ====================

  /**
   * Плановые осмотры. Отдельного планировщика обходов в системе нет,
   * поэтому ближайшая дата считается от последнего акта и периодичности
   * договора — это честная оценка, а не выдуманный график.
   */
  @Get('org/:orgId/inspections')
  inspections(@Param('orgId') orgId: string, @Req() req: AppRequest) {
    const sites = this.mySites(req).filter((s) => s.org.id === orgId);
    if (!sites.length) throw new ForbiddenException({ code: 'FOREIGN_ORG' });
    const periodDays = 90; // квартальный обход — типовая периодичность договора

    const upcoming = sites.map((s) => {
      const acts = this.field.list({ locationId: s.loc.id }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const last = acts[0];
      const base = last ? new Date(last.createdAt) : new Date();
      const next = new Date(base.getTime() + periodDays * 86_400_000);
      return {
        locationId: s.loc.id,
        locationName: s.loc.name,
        lastAt: last?.createdAt ?? null,
        lastDefects: last?.items.length ?? 0,
        nextAt: next.toISOString(),
        periodicity: 'раз в квартал',
        overdue: next < new Date(),
      };
    });
    const history = sites
      .flatMap((s) => this.field.list({ locationId: s.loc.id }).map((a) => ({ site: s.loc.name, act: a })))
      .sort((a, b) => b.act.createdAt.localeCompare(a.act.createdAt))
      .map(({ site, act }) => ({
        id: act.id,
        locationName: site,
        number: act.number,
        at: act.createdAt,
        defects: act.items.length,
        status: act.status,
      }));
    return {
      suspended: sites[0].org.status !== 'active',
      upcoming: upcoming.sort((a, b) => a.nextAt.localeCompare(b.nextAt)),
      history,
      empty: 'Осмотры появятся по графику договора',
    };
  }

  // ==================== C-49. Баллы и ваучеры ====================

  @Get('points')
  points(@Req() req: AppRequest) {
    const phone = this.phone(req);
    const sites = this.mySites(req);
    const enabled = sites.some((s) => s.org.terms.loyaltyEnabled);
    const account = this.loyalty.accounts.get(phone);
    const vouchers = this.loyalty.vouchers.filter((v) => v.issuedToPhone === phone);
    // Порог следующего ваучера — минимальный свободный номинал
    const free = this.loyalty.vouchers.filter((v) => v.status === 'free').map((v) => v.nominalTiyin);
    const nextThreshold = free.length ? Math.min(...free) : null;
    const balance = account?.balanceTiyin ?? 0;
    return {
      enabled,
      balanceTiyin: balance,
      nextThresholdTiyin: nextThreshold,
      toNextTiyin: nextThreshold === null ? null : Math.max(0, nextThreshold - balance),
      vouchers: vouchers.map((v) => ({
        id: v.id,
        code: v.code,
        nominalTiyin: v.nominalTiyin,
        expiresAt: v.expiresAt,
        expired: v.expiresAt < new Date().toISOString().slice(0, 10),
      })),
      history: (account?.history ?? []).slice().reverse(),
      rules: 'Баллы начисляются за заявки, оформленные через приложение: 1% от стоимости работ',
      empty: 'Баллов пока нет — сообщайте о поломках через приложение',
    };
  }
}
