import { BadRequestException, Body, Controller, Get, Module, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, Roles } from '../identity/auth.guard';
import { QualityService, PLAYBOOK, COMPLAINT_TYPES, type ComplaintType } from './quality.service';
import { OrdersModule } from '../orders/orders.module';
import { OrdersService } from '../orders/orders.service';
import { BillingModule } from '../billing/billing.module';
import { BillingService } from '../billing/billing.service';
import { MastersModule, MastersService } from '../masters/masters.module';
import { AuditService } from '../platform/audit.service';
import type { JwtClaims } from '../../common/jwt';

/** D-10 жалобы, D-11 споры (PRD-03); дашборд жалоб F-006 отдаётся в админку */
@Controller('dispatch/quality')
@UseGuards(AuthGuard)
@Roles('dispatcher', 'admin')
class QualityController {
  constructor(
    private readonly quality: QualityService,
    private readonly orders: OrdersService,
    private readonly billing: BillingService,
    private readonly masters: MastersService,
    private readonly audit: AuditService,
  ) {}

  @Get('playbook')
  playbook() {
    return { playbook: PLAYBOOK, types: COMPLAINT_TYPES };
  }

  // ---------- Жалобы (D-10) ----------

  @Get('complaints')
  complaints() {
    return { items: this.quality.complaints.slice().reverse(), stats: this.quality.complaintStats() };
  }

  @Post('complaints')
  async file(@Body() b: { orderId?: string; complainantPhone?: string; complainantName?: string; isOrgManager?: boolean; type?: ComplaintType; text?: string }, @Req() req: { auth: JwtClaims }) {
    let orderNumber: string | undefined;
    let masterId: string | undefined;
    let masterName: string | undefined;
    let phone = b.complainantPhone;
    if (b.orderId) {
      const o = await this.orders.get('t0', b.orderId);
      orderNumber = o.number;
      masterId = o.masterId;
      masterName = o.masterName;
      phone = phone ?? o.clientPhone;
    }
    if (!phone) throw new BadRequestException({ code: 'PHONE_REQUIRED' });
    const rec = this.quality.fileComplaint({
      orderId: b.orderId,
      orderNumber,
      complainantPhone: phone,
      complainantName: b.complainantName,
      isOrgManager: b.isOrgManager,
      type: b.type ?? 'other',
      text: b.text ?? '',
      masterId,
      masterName,
    });
    this.audit.write({
      actorPhone: req.auth.phone,
      action: 'complaint.filed',
      entity: 'Complaint',
      entityId: rec.id,
      payload: { type: rec.type, order: orderNumber, escalated: rec.isOrgManager ? 'жалоба руководителя организации — сразу старшему смены' : undefined },
    });
    return rec;
  }

  @Post('complaints/:id/respond')
  respond(@Param('id') id: string, @Req() req: { auth: JwtClaims }) {
    const rec = this.quality.respond(id);
    this.audit.write({ actorPhone: req.auth.phone, action: 'complaint.first_response', entity: 'Complaint', entityId: id });
    return rec;
  }

  /**
   * Резолюция: обязательный метод плейбука. Подтверждённая жалоба на качество/поведение
   * = событие уровня «оценка 1» в рейтинге — ПОСЛЕ резолюции (ТЗ 17.10).
   */
  @Post('complaints/:id/resolve')
  resolve(@Param('id') id: string, @Body() b: { playbookCode?: string; resolution?: string; confirmed?: boolean }, @Req() req: { auth: JwtClaims }) {
    const rec = this.quality.resolve(id, b.playbookCode ?? '', b.resolution ?? '', !!b.confirmed);
    if (rec.confirmed && rec.masterId && (rec.type === 'quality' || rec.type === 'behavior')) {
      const m = this.masters.list().find((x) => x.id === rec.masterId);
      if (m) {
        // влияние на рейтинг — только после подтверждения (ТЗ 17.10)
        this.masters.update(m.id, { rating: Math.max(0, m.rating - 5) });
      }
    }
    const patterns = this.quality.patternCheck();
    this.audit.write({
      actorPhone: req.auth.phone,
      action: rec.confirmed ? 'complaint.confirmed' : 'complaint.rejected',
      entity: 'Complaint',
      entityId: id,
      payload: { playbook: rec.playbookCode, ratingAffected: rec.confirmed && (rec.type === 'quality' || rec.type === 'behavior') },
    });
    return { ...rec, patterns };
  }

  // ---------- Споры (D-11) ----------

  @Get('disputes')
  disputes() {
    return this.quality.disputes.slice().reverse();
  }

  @Post('disputes')
  async open(@Body() b: { orderId?: string; reason?: string; openedByRole?: 'client' | 'dispatcher' }, @Req() req: { auth: JwtClaims }) {
    if (!b.orderId) throw new BadRequestException({ code: 'ORDER_REQUIRED' });
    const o = await this.orders.get('t0', b.orderId);
    const completedAt = o.statusLog.find((l) => l.to === 'completed')?.at;
    const rec = this.quality.openDispute({
      orderId: o.id,
      orderNumber: o.number,
      openedByPhone: req.auth.phone,
      openedByRole: b.openedByRole ?? 'dispatcher',
      reason: b.reason ?? '',
      amountTiyin: o.totalFromTiyin,
      completedAt: completedAt ? new Date(completedAt).toISOString() : undefined,
    });
    this.audit.write({ actorPhone: req.auth.phone, action: 'dispute.opened', entity: 'Order', entityId: o.id, payload: { reason: rec.reason, shareBlocked: true } });
    return rec;
  }

  @Post('disputes/:id/escalate')
  escalate(@Param('id') id: string, @Body() b: { reason?: string }, @Req() req: { auth: JwtClaims }) {
    const rec = this.quality.escalate(
      id,
      b?.reason ?? 'Диспетчер не судит собственные заявки — передано старшему смены (ТЗ 4.2)',
      req.auth.phone,
    );
    this.audit.write({ actorPhone: req.auth.phone, action: 'dispute.escalated', entity: 'Order', entityId: rec.orderId });
    return rec;
  }

  /**
   * Резолюция спора: возврат проводится через refund-провайдера сторнирующей проводкой
   * (ТЗ 4.2 — возвраты только через refund-API, наличные возвращает компания).
   */
  @Post('disputes/:id/resolve')
  resolveDispute(
    @Body() b: { resolution?: 'for_client' | 'for_master' | 'compromise'; refundSoums?: number; comment?: string },
    @Param('id') id: string,
    @Req() req: { auth: JwtClaims },
  ) {
    const before = this.quality.dispute(id);
    /**
     * Самосуд запрещён и после эскалации.
     *
     * Раньше проверка снималась любым статусом «эскалирован», а эскалация не
     * смотрела на актора вовсе: тот же диспетчер эскалировал спор и тут же
     * его разрешал. Теперь эскалацию делает кто-то другой, и его телефон
     * записан — значит открывший спор не может быть его судьёй ни на каком
     * маршруте.
     */
    if (before.openedByPhone === req.auth.phone && before.openedByRole === 'dispatcher') {
      throw new BadRequestException({
        code: 'SELF_JUDGE_FORBIDDEN',
        message: 'Диспетчер не судит собственные заявки — эскалируйте старшему смены (ТЗ 4.2)',
      });
    }
    const rec = this.quality.resolveDispute(id, {
      resolution: b.resolution ?? 'for_master',
      refundTiyin: b.refundSoums ? Math.round(b.refundSoums * 100) : undefined,
      comment: b.comment ?? '',
      handledByPhone: req.auth.phone,
    });
    if (rec.refundTiyin && rec.refundTiyin > 0) {
      // возврат клиенту: сторнирующая проводка выручки + движение денег (ТЗ 8.1)
      this.billing.post([
        { type: 'dispute.refund', debit: 'revenue', credit: 'settlement', amountTiyin: rec.refundTiyin, orderId: rec.orderId, comment: `Возврат по спору ${rec.orderNumber} (refund-API)` },
      ]);
    }
    this.audit.write({
      actorPhone: req.auth.phone,
      action: 'dispute.resolved',
      entity: 'Order',
      entityId: rec.orderId,
      payload: { resolution: rec.resolution, refundTiyin: rec.refundTiyin, comment: rec.comment },
    });
    return rec;
  }
}

/** F-006: дашборд жалоб в админке (PRD-04) */
@Controller('admin/quality')
@UseGuards(AuthGuard)
@Roles('admin', 'accountant')
class AdminQualityController {
  constructor(private readonly quality: QualityService) {}

  @Get('complaints')
  complaints() {
    return { items: this.quality.complaints.slice().reverse(), stats: this.quality.complaintStats() };
  }

  @Get('disputes')
  disputes() {
    const all = this.quality.disputes;
    return {
      items: all.slice().reverse(),
      stats: {
        total: all.length,
        open: all.filter((d) => d.status !== 'resolved').length,
        refundTotalTiyin: all.reduce((s, d) => s + (d.refundTiyin ?? 0), 0),
        byResolution: ['for_client', 'for_master', 'compromise'].map((r) => ({ resolution: r, count: all.filter((d) => d.resolution === r).length })),
      },
    };
  }
}

@Module({
  imports: [OrdersModule, BillingModule, MastersModule],
  controllers: [QualityController, AdminQualityController],
  providers: [QualityService],
  exports: [QualityService],
})
export class QualityModule {}
