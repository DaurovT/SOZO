import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuditService } from '../platform/audit.service';
import { CrmService } from '../crm/crm.service';
import { FieldService, type ActPartyRec } from '../field/field.service';
import { OrdersService } from '../orders/orders.service';
import { ClientGuard, type ClientRequest } from './client.guard';

/**
 * Клиентское приложение B2B (ответственный на точке).
 *
 * Здесь ровно две вещи, которые нельзя делегировать SOZO: подписать заключение
 * мастера по точке и принять выполненную работу. Всё остальное — чтение.
 */
@Controller('client')
@UseGuards(ClientGuard)
export class ClientApiController {
  constructor(
    private readonly crm: CrmService,
    private readonly field: FieldService,
    private readonly orders: OrdersService,
    private readonly audit: AuditService,
  ) {}

  private party(req: ClientRequest, locationId: string): ActPartyRec {
    const site = req.client!.sites.find((s) => s.loc.id === locationId);
    if (!site) {
      throw new BadRequestException({ code: 'FOREIGN_LOCATION', message: 'Эта точка не закреплена за вами' });
    }
    return { id: site.rep.id, fullName: site.rep.fullName, phone: site.rep.phone };
  }

  /** Профиль и мои точки — стартовый экран приложения */
  @Get('me')
  me(@Req() req: ClientRequest) {
    const c = req.client!;
    const primary = c.sites.find((s) => s.rep.primary) ?? c.sites[0];
    return {
      phone: c.phone,
      fullName: primary.rep.fullName,
      role: primary.rep.role,
      organization: { id: primary.org.id, name: primary.org.name, status: primary.org.status },
      sites: c.sites.map((s) => ({
        id: s.loc.id,
        name: s.loc.name,
        address: s.loc.address,
        organizationId: s.org.id,
        organizationName: s.org.name,
        role: s.rep.role,
        primary: s.rep.primary,
        approvalLimitTiyin: s.rep.approvalLimitTiyin,
        photoForbidden: s.loc.photoForbidden,
      })),
    };
  }

  // ---------- Акты осмотра ----------

  /** Лента актов. pending=1 — только ждущие решения: это и есть «пришло на подпись» */
  @Get('acts')
  acts(@Req() req: ClientRequest, @Query('pending') pending?: string) {
    this.field.expireOverdue();
    return this.field.forPhone(req.client!.phone, pending === '1' || pending === 'true');
  }

  @Get('acts/:id')
  act(@Param('id') id: string, @Req() req: ClientRequest) {
    const act = this.field.get(id);
    this.party(req, act.locationId); // чужой акт не покажем
    return act;
  }

  /**
   * Решение по акту. Позиции проходят построчно: принять всё, часть или ничего.
   * Из принятых сразу заводятся заявки — второй раз подтверждать работу не надо,
   * подпись под позицией и есть согласие на её выполнение.
   */
  @Post('acts/:id/decide')
  async decide(
    @Param('id') id: string,
    @Body()
    body: {
      decisions?: Array<{ itemId: string; decision: 'accepted' | 'declined'; declineReason?: string }>;
      rejectionReason?: string;
    },
    @Req() req: ClientRequest,
  ) {
    const act = this.field.get(id);
    const by = this.party(req, act.locationId);
    const site = req.client!.sites.find((s) => s.loc.id === act.locationId)!;

    // Лимит утверждения: суммой принятых позиций нельзя перепрыгнуть свой уровень (ТЗ 5.2)
    const decisions = body?.decisions ?? [];
    const acceptedSum = act.items
      .filter((i) => decisions.find((d) => d.itemId === i.id && d.decision === 'accepted'))
      .reduce((s, i) => s + (i.estimateTiyin ?? 0), 0);
    const limit = site.rep.approvalLimitTiyin;
    if (limit !== null && acceptedSum > limit) {
      throw new BadRequestException({
        code: 'APPROVAL_LIMIT_EXCEEDED',
        message: `Сумма принятых позиций выше вашего лимита утверждения — требуется решение уровня выше`,
        acceptedSum,
        limit,
      });
    }

    const decided = this.field.decide(id, by, decisions, body?.rejectionReason);
    this.audit.write({
      actorPhone: by.phone,
      action: 'client.act_decided',
      entity: 'InspectionAct',
      entityId: id,
      payload: { status: decided.status, accepted: decided.items.filter((i) => i.decision === 'accepted').length },
    });

    // Заявки из принятых позиций — граф from_defect, стартуют сразу «Утверждена»
    const created: string[] = [];
    for (const item of this.field.acceptedPending(id)) {
      const order = await this.orders.create(
        't0',
        {
          clientPhone: by.phone,
          clientName: by.fullName,
          address: site.loc.address,
          lat: site.loc.lat ?? undefined,
          lng: site.loc.lng ?? undefined,
          description: `${item.category}: ${item.description} (акт ${decided.number})`,
          organizationId: site.org.id,
          locationId: site.loc.id,
          source: 'app',
          fromDefect: { actId: id, itemId: item.id },
        },
        by.phone,
      );
      this.field.linkOrder(id, item.id, order.id);
      created.push(order.number);
    }
    return { act: this.field.get(id), createdOrders: created };
  }

  // ---------- Заявки и приёмка ----------

  @Get('orders')
  async ordersList(@Req() req: ClientRequest) {
    const locIds = new Set(req.client!.sites.map((s) => s.loc.id));
    const all = await this.orders.list('t0');
    return all
      .filter((o) => o.locationId && locIds.has(o.locationId))
      .map((o) => ({
        id: o.id,
        number: o.number,
        status: o.status,
        graphType: o.graphType,
        address: o.address,
        description: o.description,
        totalFromTiyin: o.totalFromTiyin,
        masterName: o.masterName ?? null,
        acceptanceRequested: !!o.acceptanceRequest?.pending && !o.acceptance,
        acceptance: o.acceptance ?? null,
        createdAt: o.createdAt,
      }))
      .reverse();
  }

  /** Что ждёт моего действия прямо сейчас — бейдж на иконке приложения */
  @Get('inbox')
  async inbox(@Req() req: ClientRequest) {
    this.field.expireOverdue();
    const acts = this.field.forPhone(req.client!.phone, true);
    const locIds = new Set(req.client!.sites.map((s) => s.loc.id));
    const all = await this.orders.list('t0');
    const toAccept = all.filter((o) => o.locationId && locIds.has(o.locationId) && o.acceptanceRequest?.pending && !o.acceptance);
    return {
      acts: acts.length,
      acceptances: toAccept.length,
      total: acts.length + toAccept.length,
      items: [
        ...acts.map((a) => ({ kind: 'act' as const, id: a.id, title: `Акт осмотра ${a.number}`, subtitle: a.locationName })),
        ...toAccept.map((o) => ({ kind: 'acceptance' as const, id: o.id, title: `Приёмка работ ${o.number}`, subtitle: o.address })),
      ],
    };
  }

  /**
   * Приёмка работ. Замечания не блокируют приёмку — они пишутся в акт;
   * если работу принимать нельзя, есть отдельная кнопка возврата.
   */
  @Post('orders/:id/accept')
  async accept(@Param('id') id: string, @Body() body: { note?: string }, @Req() req: ClientRequest) {
    const order = await this.orders.record('t0', id);
    if (!order.locationId) throw new BadRequestException({ code: 'NOT_B2B', message: 'Заявка не привязана к точке' });
    const by = this.party(req, order.locationId);
    if (!order.acceptanceRequest?.pending) {
      throw new BadRequestException({ code: 'ACCEPTANCE_NOT_REQUESTED', message: 'Мастер ещё не отправил работу на приёмку' });
    }
    if (order.acceptance) {
      throw new BadRequestException({ code: 'ALREADY_ACCEPTED', message: 'Работа уже принята' });
    }
    order.acceptance = {
      method: 'client_app',
      signerName: by.fullName,
      note: body?.note?.trim() || undefined,
      at: new Date().toISOString(),
    };
    this.orders.touchOrder();
    this.audit.write({ actorPhone: by.phone, action: 'client.work_accepted', entity: 'Order', entityId: id, payload: { note: body?.note ?? null } });
    return { ok: true, acceptance: order.acceptance };
  }

  /** Не принимаю: заявка остаётся в работе, мастер и диспетчер видят причину */
  @Post('orders/:id/reject')
  async reject(@Param('id') id: string, @Body() body: { reason?: string }, @Req() req: ClientRequest) {
    const reason = body?.reason?.trim();
    if (!reason) throw new BadRequestException({ code: 'REASON_REQUIRED', message: 'Укажите, что именно не принято' });
    const order = await this.orders.record('t0', id);
    if (!order.locationId) throw new BadRequestException({ code: 'NOT_B2B' });
    const by = this.party(req, order.locationId);
    if (order.acceptance) throw new BadRequestException({ code: 'ALREADY_ACCEPTED', message: 'Работа уже принята' });
    if (!order.acceptanceRequest?.pending) {
      throw new BadRequestException({ code: 'ACCEPTANCE_NOT_REQUESTED', message: 'Мастер ещё не отправил работу на приёмку' });
    }
    order.acceptanceRequest.rejections ??= [];
    order.acceptanceRequest.rejections.push({ at: new Date().toISOString(), reason, by: by.fullName });
    order.acceptanceRequest.pending = false; // мастер доделывает и отправляет заново
    this.orders.touchOrder();
    this.audit.write({ actorPhone: by.phone, action: 'client.work_rejected', entity: 'Order', entityId: id, payload: { reason } });
    return { ok: true, rejections: order.acceptanceRequest.rejections };
  }
}
