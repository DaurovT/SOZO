import { BadRequestException, Body, Controller, Get, Module, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, Roles } from '../identity/auth.guard';
import { DispatchOpsService } from './dispatch-ops.service';
import { MasterApiModule } from '../master-api/master-api.module';
import { MasterOpsService } from '../master-api/master-ops.service';
import { OrdersModule } from '../orders/orders.module';
import { OrdersService } from '../orders/orders.service';
import { MastersModule, MastersService } from '../masters/masters.module';
import { AssignmentModule } from '../assignment/assignment.module';
import { AssignmentService } from '../assignment/assignment.module';
import { AuditService } from '../platform/audit.service';
import type { JwtClaims } from '../../common/jwt';

/** D-12 замена, D-13 инциденты, D-17 handover, D-01 сводка смены (PRD-03) */
@Controller('dispatch/ops')
@UseGuards(AuthGuard)
@Roles('dispatcher', 'admin')
class DispatchOpsController {
  constructor(
    private readonly ops: DispatchOpsService,
    private readonly orders: OrdersService,
    private readonly masters: MastersService,
    private readonly assignment: AssignmentService,
    private readonly audit: AuditService,
    private readonly masterOps: MasterOpsService,
  ) {}

  // ---------- D-12 ----------

  /**
   * Детект кандидатов на замену (ТЗ 17.3): не нажал «Выехал» за 30 мин до окна,
   * гео не приближается 15+ мин, явный отказ. Dev-версия: по возрасту статуса.
   */
  @Get('replacements/detect')
  async detect() {
    const all = await this.orders.list('t0');
    const now = Date.now();
    const risky = all
      .filter((o) => ['assigned', 'master_departed'].includes(o.status))
      .map((o) => {
        const since = new Date(o.statusLog.at(-1)?.at ?? o.createdAt).getTime();
        const minutes = Math.floor((now - since) / 60_000);
        const reason: 'no_departure' | 'geo_stale' | null =
          o.status === 'assigned' && minutes >= 30 ? 'no_departure' : o.status === 'master_departed' && minutes >= 45 ? 'geo_stale' : null;
        return reason ? { orderId: o.id, orderNumber: o.number, masterId: o.masterId, masterName: o.masterName, status: o.status, minutes, reason } : null;
      })
      .filter(Boolean);
    return { candidates: risky, active: this.ops.activeReplacements() };
  }

  @Get('replacements')
  replacements() {
    return this.ops.replacements.slice().reverse();
  }

  @Post('replacements')
  async open(@Body() b: { orderId: string; reason?: ReplacementReason }, @Req() req: { auth: JwtClaims }) {
    const order = await this.orders.get('t0', b.orderId);
    const rec = this.ops.openReplacement({
      orderId: order.id,
      orderNumber: order.number,
      reason: b.reason ?? 'manual',
      fromMasterId: order.masterId,
      fromMasterName: order.masterName,
    });
    this.audit.write({ actorPhone: req.auth.phone, action: 'replacement.opened', entity: 'Order', entityId: order.id, payload: { reason: rec.reason } });
    return rec;
  }

  /** Кандидаты на замену: те же правила 7.3, но приоритет дежурному и свободным */
  @Get('replacements/:id/candidates')
  async candidates(@Param('id') id: string) {
    const rec = this.ops.get(id);
    const res = await this.assignment.candidates(rec.orderId, new Date().toISOString().slice(0, 10));
    return {
      replacement: rec,
      // исключаем мастера, которого меняем
      candidates: res.candidates.filter((c) => c.masterId !== rec.fromMasterId),
      rejected: res.rejected,
    };
  }

  @Post('replacements/:id/broadcast')
  broadcast(@Param('id') id: string, @Req() req: { auth: JwtClaims }) {
    const rec = this.ops.startBroadcast(id);
    this.audit.write({ actorPhone: req.auth.phone, action: 'replacement.broadcast', entity: 'Order', entityId: rec.orderId, payload: { seconds: rec.broadcastSeconds } });
    return rec;
  }

  /** Назначение замены: меняет мастера в заявке и закрывает протокол */
  @Post('replacements/:id/assign')
  async assign(@Param('id') id: string, @Body() b: { masterId: string; reason?: string }, @Req() req: { auth: JwtClaims }) {
    const rec = this.ops.get(id);
    const master = this.masters.list().find((m) => m.id === b.masterId);
    if (!master) throw new BadRequestException({ code: 'MASTER_NOT_FOUND' });
    await this.orders.reassign('t0', rec.orderId, master.id, master.fullName, b.reason ?? 'Протокол замены D-12', req.auth.phone);
    const updated = this.ops.assign(id, master.id, master.fullName);
    this.audit.write({ actorPhone: req.auth.phone, action: 'replacement.assigned', entity: 'Order', entityId: rec.orderId, payload: { to: master.fullName } });
    return updated;
  }

  @Post('replacements/:id/escalate')
  escalate(@Param('id') id: string, @Body() b: { note?: string }, @Req() req: { auth: JwtClaims }) {
    const rec = this.ops.escalate(id, b?.note ?? 'Замена не найдена за 15 минут — звонок клиенту: сдвиг или перенос');
    this.audit.write({ actorPhone: req.auth.phone, action: 'replacement.escalated', entity: 'Order', entityId: rec.orderId });
    return rec;
  }

  /** Квалификация невыхода с санкцией (ТЗ 17.3) */
  @Post('replacements/:id/close')
  close(@Param('id') id: string, @Body() b: { sanction?: 'none' | 'warning' | 'no_show' | 'blocked'; note?: string }, @Req() req: { auth: JwtClaims }) {
    const rec = this.ops.close(id, b?.sanction ?? 'none', b?.note);
    const count = rec.fromMasterId ? this.ops.noShowCount(rec.fromMasterId) : 0;
    // 2-й невыход за 90 дней — снятие с линии, 3-й — блокировка
    if (rec.fromMasterId && (b?.sanction === 'no_show' || b?.sanction === 'blocked')) {
      if (count >= 3) this.masters.update(rec.fromMasterId, { status: 'blocked' });
      else if (count >= 2) this.masters.update(rec.fromMasterId, { status: 'checking' });
    }
    this.audit.write({ actorPhone: req.auth.phone, action: 'replacement.closed', entity: 'Order', entityId: rec.orderId, payload: { sanction: rec.sanction, noShowCount: count } });
    return { ...rec, noShowCount: count, autoSanction: count >= 3 ? 'блокировка' : count >= 2 ? 'снятие с линии и разбор' : 'предупреждение' };
  }

  // ---------- D-13 инциденты ----------

  @Get('incidents')
  incidents() {
    return this.ops.incidents.slice().reverse();
  }

  @Post('incidents')
  openIncident(@Body() b: { title: string; zone: string; category: string; orderIds?: string[] }, @Req() req: { auth: JwtClaims }) {
    const inc = this.ops.openIncident({ ...b, openedBy: req.auth.phone });
    this.audit.write({ actorPhone: req.auth.phone, action: 'incident.opened', entity: 'Incident', entityId: inc.id, payload: { title: b.title, zone: b.zone } });
    return inc;
  }

  @Post('incidents/:id/attach')
  attach(@Param('id') id: string, @Body() b: { orderId: string }) {
    return this.ops.attachToIncident(id, b.orderId);
  }

  @Post('incidents/:id/close')
  closeIncident(@Param('id') id: string, @Body() b: { note?: string }, @Req() req: { auth: JwtClaims }) {
    const inc = this.ops.closeIncident(id, b?.note);
    this.audit.write({ actorPhone: req.auth.phone, action: 'incident.closed', entity: 'Incident', entityId: id });
    return inc;
  }

  /** Детект кластера: >N заявок одной категории из района за час (ТЗ 17.3) */
  @Get('incidents/detect')
  async detectIncident() {
    const all = await this.orders.list('t0');
    const hourAgo = Date.now() - 3_600_000;
    const recent = all.filter((o) => new Date(o.createdAt).getTime() >= hourAgo);
    const byZone = new Map<string, number>();
    for (const o of recent) {
      const zone = o.address.match(/Чиланзар|Юнусабад|Мирабад|Яккасарай|Сергели|Мирзо-Улугбек/i)?.[0] ?? 'прочее';
      byZone.set(zone, (byZone.get(zone) ?? 0) + 1);
    }
    const threshold = 3; // параметр
    return {
      windowHours: 1,
      threshold,
      clusters: [...byZone.entries()].map(([zone, count]) => ({ zone, count, suspicious: count >= threshold })),
    };
  }

  // ---------- D-17 handover ----------

  /** Автосборка журнала передачи смены из незакрытого (PRD-03 D-17) */
  @Get('handover/draft')
  async draft() {
    const all = await this.orders.list('t0');
    const items: Array<{ kind: string; title: string; detail: string }> = [];
    for (const r of this.ops.activeReplacements()) {
      items.push({ kind: 'replacement', title: `Замена по ${r.orderNumber}`, detail: `этап: ${r.stage}, причина: ${r.reason}` });
    }
    for (const inc of this.ops.incidents.filter((i) => !i.closedAt)) {
      items.push({ kind: 'incident', title: `Инцидент: ${inc.title}`, detail: `зона ${inc.zone}, заявок ${inc.orderIds.length}` });
    }
    for (const o of all.filter((x) => x.status === 'awaiting_payment')) {
      items.push({ kind: 'awaiting_payment', title: `Ожидает оплаты ${o.number}`, detail: `${o.clientPhone}, ${o.address}` });
    }
    for (const o of all.filter((x) => x.status === 'pending_approval')) {
      items.push({ kind: 'approval', title: `Ждёт утверждения ${o.number}`, detail: `${o.address}` });
    }
    for (const o of all.filter((x) => x.status === 'dispute')) {
      items.push({ kind: 'dispute', title: `Спор по ${o.number}`, detail: `${o.clientPhone}` });
    }
    // Паузы «Заблокировано третьей стороной» появятся с суб-состояниями заявки (DEV-10 §1)
    for (const o of all.filter((x) => x.statusLog.some((l) => l.action === 'pause'))) {
      items.push({ kind: 'blocked', title: `Пауза по ${o.number}`, detail: o.address });
    }
    return { items, current: this.ops.currentHandover() };
  }

  @Get('handover')
  handover() {
    return this.ops.currentHandover();
  }

  @Post('handover')
  start(@Body() b: { items?: Array<{ kind: string; title: string; detail: string }> }, @Req() req: { auth: JwtClaims }) {
    const rec = this.ops.startHandover(req.auth.phone, b?.items ?? []);
    this.audit.write({ actorPhone: req.auth.phone, action: 'handover.started', entity: 'Handover', entityId: rec.id, payload: { items: rec.items.length } });
    return rec;
  }

  @Post('handover/:id/items/:itemId/accept')
  acceptItem(@Param('id') id: string, @Param('itemId') itemId: string, @Req() req: { auth: JwtClaims }) {
    return this.ops.acceptItem(id, itemId, req.auth.phone);
  }

  @Post('handover/:id/accept')
  accept(@Param('id') id: string, @Req() req: { auth: JwtClaims }) {
    const rec = this.ops.acceptHandover(id, req.auth.phone);
    this.audit.write({ actorPhone: req.auth.phone, action: 'handover.accepted', entity: 'Handover', entityId: id });
    return rec;
  }

  // ---------- Обращения клиентов из приложения ----------

  /**
   * Что клиент попросил и чего ждёт: перенос, разбор низкой оценки, сообщение.
   * Всё в одном списке — иначе диспетчеру пришлось бы обходить три экрана,
   * чтобы понять, не ждёт ли кто-то ответа.
   */
  @Get('client-requests')
  clientRequests() {
    const now = Date.now();
    return this.ops.openClientRequests().map((r) => ({
      ...r,
      overdue: !!r.dueAt && new Date(r.dueAt).getTime() < now,
    }));
  }

  @Post('client-requests/:id/take')
  takeClientRequest(@Param('id') id: string, @Req() req: { auth: JwtClaims }) {
    const rec = this.ops.takeClientRequest(id, req.auth.phone);
    this.audit.write({ actorPhone: req.auth.phone, action: 'dispatch.client_request_taken', entity: 'ClientRequest', entityId: id, payload: { kind: rec.kind } });
    return rec;
  }

  @Post('client-requests/:id/close')
  closeClientRequest(@Param('id') id: string, @Body() body: { resolution?: string }, @Req() req: { auth: JwtClaims }) {
    const rec = this.ops.closeClientRequest(id, req.auth.phone, body?.resolution ?? '');
    this.audit.write({ actorPhone: req.auth.phone, action: 'dispatch.client_request_closed', entity: 'ClientRequest', entityId: id, payload: { kind: rec.kind, resolution: rec.resolution } });
    return rec;
  }

  /**
   * Что клиенты выбрали и никто ещё не купил.
   *
   * Диспетчеру это нужнее, чем мастеру: он видит все заявки сразу и может
   * перекинуть покупку тому, кто и так едет мимо магазина. Пока список не
   * пуст, кто-то приедет к клиенту без детали.
   */
  @Get('procurement')
  procurement() {
    const rows = this.masterOps.toProcure().map((s) => ({
      id: s.id,
      orderId: s.orderId,
      masterId: s.masterId,
      partName: s.partName,
      tier: s.chosenTier,
      amountTiyin: s.variants.find((v) => v.tier === s.chosenTier)?.amountTiyin ?? 0,
      chosenAt: s.chosenAt,
      waitingHours: s.chosenAt ? Math.floor((Date.now() - new Date(s.chosenAt).getTime()) / 3_600_000) : 0,
    }));
    return { items: rows, totalTiyin: rows.reduce((s, r) => s + r.amountTiyin, 0) };
  }

  // ---------- D-19 KPI ----------

  @Get('kpi')
  async kpi() {
    const all = await this.orders.list('t0');
    const closed = all.filter((o) => ['closed', 'rated'].includes(o.status));
    const toAssignedMin = all
      .map((o) => {
        const created = new Date(o.createdAt).getTime();
        const assigned = o.statusLog.find((l) => l.to === 'assigned');
        return assigned ? (new Date(assigned.at).getTime() - created) / 60_000 : null;
      })
      .filter((v): v is number => v !== null);
    const avg = (arr: number[]) => (arr.length ? Math.round(arr.reduce((s, x) => s + x, 0) / arr.length) : 0);
    return {
      newToAssignedAvgMin: avg(toAssignedMin),
      ordersTotal: all.length,
      closedTotal: closed.length,
      cancelledTotal: all.filter((o) => o.status === 'cancelled').length,
      activeReplacements: this.ops.activeReplacements().length,
      replacementsTotal: this.ops.replacements.length,
      replacementsResolved: this.ops.replacements.filter((r) => r.stage === 'assigned' || r.stage === 'closed').length,
      openIncidents: this.ops.incidents.filter((i) => !i.closedAt).length,
      moderationQueue: all.filter((o) => o.status === 'completed').length,
      partsToBuy: this.masterOps.toProcure().length,
      clientRequestsOpen: this.ops.openClientRequests().length,
      clientRequestsOverdue: this.ops.openClientRequests().filter((r) => !!r.dueAt && new Date(r.dueAt).getTime() < Date.now()).length,
      emergenciesActive: all.filter((o) => o.urgency === 'emergency' && !['closed', 'rated', 'cancelled'].includes(o.status)).length,
      // Срыв срока выезда по договору — то, за что организация вправе спросить
      emergenciesOverdue: all.filter(
        (o) =>
          o.slaDueAt &&
          new Date(o.slaDueAt).getTime() < Date.now() &&
          !['in_progress', 'completed', 'verified', 'closed', 'rated', 'cancelled'].includes(o.status),
      ).length,
    };
  }
}

type ReplacementReason = 'no_departure' | 'declined' | 'geo_stale' | 'manual';

@Module({
  imports: [OrdersModule, MastersModule, AssignmentModule, MasterApiModule],
  controllers: [DispatchOpsController],
  providers: [DispatchOpsService],
  exports: [DispatchOpsService],
})
export class DispatchOpsModule {}
