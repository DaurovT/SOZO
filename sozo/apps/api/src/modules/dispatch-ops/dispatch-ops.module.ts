import { BadRequestException, Body, Controller, Get, Module, NotFoundException, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, Roles } from '../identity/auth.guard';
import { DispatchOpsService } from './dispatch-ops.service';
import { MasterApiModule } from '../master-api/master-api.module';
import { PublicApiModule } from '../public-api/public-api.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { AccessModule } from '../access/access.module';
import { BuildingsModule } from '../buildings/buildings.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { PublicLeadsService } from '../public-api/public-api.module';
import { SchedulingService } from '../scheduling/scheduling.service';
import { AccessService } from '../access/access.service';
import { BuildingsService } from '../buildings/buildings.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { RatingService } from '../master-api/rating.service';
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
    private readonly calls: PublicLeadsService,
    private readonly scheduling: SchedulingService,
    private readonly access: AccessService,
    private readonly buildings: BuildingsService,
    private readonly subs: SubscriptionsService,
    private readonly rating: RatingService,
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

  /**
   * D-07: очередь проверки фото и чеков.
   *
   * Модерация «Выполнено»: мастер закрыл работу, и до оплаты кто-то должен
   * посмотреть, что на фото действительно сделано, а чек приложен. Гейты
   * приложения проверяют наличие снимка, а не его содержание — это единственный
   * контроль качества, который без человека не работает.
   *
   * Запчасть без чека выделена отдельно: по ТЗ 8.4 она не принимается вовсе,
   * и это не придирка — по чеку клиент видит, что деталь куплена, а не снята
   * со склада мастера по цене магазина.
   */
  @Get('photo-review')
  async photoReview() {
    const all = await this.orders.list('t0');
    const pending = all.filter((o) => ['completed', 'verified', 'awaiting_payment'].includes(o.status));
    const rows = pending.map((o) => {
      const after = o.photos.filter((p) => p.stage === 'after');
      const receipts = o.photos.filter((p) => p.stage === 'receipt');
      const partsWithoutReceipt = o.materials.filter((m) => m.kind === 'spare_part' && !m.hasReceipt);
      return {
        id: o.id,
        number: o.number,
        status: o.status,
        masterName: o.masterName ?? null,
        address: o.address,
        totalMaterialTiyin: o.totalMaterialTiyin,
        photosAfter: after.length,
        // Снимок без файла — отметка диспетчера с телефона, а не фотография.
        // Проверять там нечего, и путать это с настоящим фото нельзя
        photosAfterWithFile: after.filter((p) => p.file).length,
        receipts: receipts.length,
        partsWithoutReceipt: partsWithoutReceipt.length,
        geoMissing: o.photos.some((p) => p.geoMissing),
        completedAt: o.statusLog.filter((l) => l.to === 'completed').at(-1)?.at ?? null,
      };
    });
    return {
      total: rows.length,
      // Порядок: сначала то, где проверять нечего или нечем — эти заявки
      // нельзя закрывать деньгами
      needsAttention: rows.filter((r) => r.photosAfterWithFile === 0 || r.partsWithoutReceipt > 0).length,
      rows: rows.sort(
        (a, b) =>
          Number(b.partsWithoutReceipt > 0) - Number(a.partsWithoutReceipt > 0) ||
          a.photosAfterWithFile - b.photosAfterWithFile,
      ),
    };
  }

  /**
   * D-09: очередь «Позвонить».
   *
   * Все голосовые контакты в одном месте: лид с лендинга, заявка B2B,
   * кандидат в мастера. Сроки у них разные, и просроченный звонок — это не
   * «неудобство», а потерянные деньги: лид остывает за часы.
   */
  @Get('call-queue')
  callQueue() {
    const now = Date.now();
    const open = this.calls.open();
    const rows = open.map((t) => ({
      id: t.id,
      kind: t.kind,
      title: t.title,
      phone: t.phone,
      source: t.source,
      dueAt: t.dueAt,
      overdue: Date.parse(t.dueAt) < now,
      minutesLeft: Math.round((Date.parse(t.dueAt) - now) / 60_000),
      createdAt: t.createdAt,
      payload: t.payload,
    }));
    return {
      total: rows.length,
      overdue: rows.filter((r) => r.overdue).length,
      byKind: rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.kind]: (acc[r.kind] ?? 0) + 1 }), {}),
      rows,
    };
  }

  @Post('call-queue/:id/done')
  closeCall(@Param('id') id: string, @Body() body: { result?: string }, @Req() req: { auth: JwtClaims }) {
    if (!body?.result?.trim()) {
      throw new BadRequestException({
        code: 'RESULT_REQUIRED',
        message: 'Итог звонка обязателен: «обзвонили» без результата неотличимо от «закрыли, чтобы не мозолило»',
      });
    }
    const t = this.calls.complete(id, body.result.trim());
    if (!t) throw new NotFoundException({ code: 'CALL_TASK_NOT_FOUND' });
    this.audit.write({ actorPhone: req.auth.phone, action: 'call_task.done', entity: 'CallTask', payload: { result: body.result } });
    return t;
  }

  /**
   * D-14: расписание мастеров.
   *
   * Смены, отпуска и больничные в одном ответе, потому что вопрос один: кто
   * завтра выйдет. Отпуск, о котором знает только кадровик, — это смена,
   * поставленная на человека, которого не будет.
   */
  @Get('schedule')
  schedule(@Query('date') date?: string) {
    const day = date ?? new Date().toISOString().slice(0, 10);
    const shifts = this.scheduling.listShifts(day);
    const lanes = this.scheduling.lanes(day);
    const active = this.masters.list().filter((m) => m.status === 'active');
    // Отсутствия на эту дату: заявка на отпуск перекрывает день целиком
    const away = this.masterOps.timeOff.filter(
      (t) => t.status === 'approved' && t.from <= day && t.to >= day,
    );
    const awayIds = new Set(away.map((t) => t.masterId));
    return {
      date: day,
      mastersTotal: active.length,
      withShift: shifts.length,
      away: away.map((t) => ({
        masterId: t.masterId,
        masterName: active.find((m) => m.id === t.masterId)?.fullName ?? null,
        kind: t.kind,
        from: t.from,
        to: t.to,
      })),
      // Смена на отсутствующего — прямая ошибка расписания: заявка встанет на
      // человека, которого в этот день нет
      conflicts: shifts.filter((s) => awayIds.has(s.masterId)).map((s) => ({ masterId: s.masterId, masterName: s.masterName })),
      // Кто активен, но без смены: их планировщик просто не увидит
      withoutShift: active
        .filter((m) => !shifts.some((s) => s.masterId === m.id) && !awayIds.has(m.id))
        .map((m) => ({ masterId: m.id, fullName: m.fullName })),
      lanes,
      pendingTimeOff: this.masterOps.timeOff.filter((t) => t.status === 'pending'),
    };
  }

  @Post('time-off/:id/decide')
  decideTimeOff(
    @Param('id') id: string,
    @Body() body: { approve: boolean; reason?: string },
    @Req() req: { auth: JwtClaims },
  ) {
    const t = this.masterOps.timeOff.find((x) => x.id === id);
    if (!t) throw new NotFoundException({ code: 'TIME_OFF_NOT_FOUND' });
    if (!body.approve && !body.reason?.trim()) {
      throw new BadRequestException({
        code: 'REASON_REQUIRED',
        message: 'Отказ по отпуску объясняется: иначе мастер не знает, подавать ли заново',
      });
    }
    t.status = body.approve ? 'approved' : 'rejected';
    if (!body.approve) t.reason = body.reason!.trim();
    this.masterOps.touch();
    this.audit.write({
      actorPhone: req.auth.phone,
      action: body.approve ? 'time_off.approved' : 'time_off.rejected',
      entity: 'MasterTimeOff',
      entityId: id,
      payload: { masterId: t.masterId, from: t.from, to: t.to },
    });
    return t;
  }

  /**
   * D-16: заблокировано третьей стороной.
   *
   * Работа стоит не по вине мастера: не пустили в квартиру, нет доступа к
   * стояку, клиент не отвечает, объект законсервирован. Отдельный экран
   * нужен потому, что такие заявки не двигаются сами и не попадают ни в одну
   * очередь: в kanban они висят в том же статусе, что и работающие.
   */
  @Get('blocked')
  async blocked() {
    const blocking = ['no_access', 'client_unavailable', 'unsafe_abort', 'cant_go', 'conservation'];
    const open = this.masterOps.branches.filter((b) => b.status === 'open' && blocking.includes(b.kind));
    const all = await this.orders.list('t0');
    const now = Date.now();
    const rows = open.map((b) => {
      const o = all.find((x) => x.id === b.orderId);
      return {
        branchId: b.id,
        orderId: b.orderId,
        number: o?.number ?? null,
        address: o?.address ?? null,
        status: o?.status ?? null,
        masterName: o?.masterName ?? null,
        kind: b.kind,
        reasonCode: b.reasonCode ?? null,
        comment: b.comment ?? null,
        since: b.createdAt,
        hoursStuck: Math.round((now - Date.parse(b.createdAt)) / 3_600_000),
      };
    });
    return {
      total: rows.length,
      // Сутки без движения — это уже не «ждём клиента», а забытая заявка
      stale: rows.filter((r) => r.hoursStuck >= 24).length,
      rows: rows.sort((a, b) => b.hoursStuck - a.hoursStuck),
    };
  }

  /**
   * D-20: апелляции мастеров.
   *
   * Мастер оспаривает оценку, удержание или санкцию. Экран нужен не ради
   * вежливости: удержание — это деньги человека, и решение по нему обязано
   * приниматься кем-то, а не истекать по умолчанию.
   */
  @Get('appeals')
  appeals() {
    const all = this.rating.appeals;
    const masters = this.masters.list();
    const rows = all.map((a) => ({
      ...a,
      masterName: masters.find((m) => m.id === a.masterId)?.fullName ?? null,
      daysOpen: Math.round((Date.now() - Date.parse(a.createdAt)) / 86_400_000),
    }));
    return {
      total: rows.length,
      open: rows.filter((r) => r.status === 'open').length,
      rows: rows.sort((a, b) => Number(b.status === 'open') - Number(a.status === 'open') || b.daysOpen - a.daysOpen),
    };
  }

  @Post('appeals/:id/decide')
  decideAppeal(
    @Param('id') id: string,
    @Body() body: { accept: boolean; resolution?: string },
    @Req() req: { auth: JwtClaims },
  ) {
    const a = this.rating.appeals.find((x) => x.id === id);
    if (!a) throw new NotFoundException({ code: 'APPEAL_NOT_FOUND' });
    if (!body.resolution?.trim()) {
      throw new BadRequestException({
        code: 'RESOLUTION_REQUIRED',
        message: 'Решение по апелляции объясняется — его читает человек, которого оно касается',
      });
    }
    a.status = body.accept ? 'accepted' : 'rejected';
    a.resolution = body.resolution.trim();
    a.resolvedAt = new Date().toISOString();
    this.rating.touch();
    this.audit.write({
      actorPhone: req.auth.phone,
      action: body.accept ? 'appeal.accepted' : 'appeal.rejected',
      entity: 'MasterAppeal',
      entityId: id,
      payload: { masterId: a.masterId, subject: a.subject },
    });
    return a;
  }

  /**
   * D-22: отключения ресурсов — календарь по всем объектам.
   *
   * У оператора этот экран про его дом, у диспетчера — про все сразу:
   * отключение воды на стояке означает, что заявки в этих квартирах сегодня
   * не выполнить, и узнать об этом надо до выезда, а не на месте.
   */
  @Get('shutdowns')
  shutdowns(@Query('days') days?: string) {
    const horizon = Math.min(Math.max(Number(days) || 14, 1), 60);
    const until = Date.now() + horizon * 86_400_000;
    const rows = this.buildings
      .listBuildings('t0')
      .flatMap((b) =>
        this.access
          .listShutdowns('t0', b.id)
          .filter((s) => Date.parse(s.plannedFrom) <= until && s.status !== 'cancelled')
          .map((s) => ({
            id: s.id,
            buildingId: b.id,
            buildingName: b.name,
            address: b.address,
            resourceType: s.resourceType,
            scope: s.scope,
            riserId: s.riserId,
            affectedUnits: s.affectedUnitIds.length,
            plannedFrom: s.plannedFrom,
            plannedTo: s.plannedTo,
            status: s.status,
            isEmergency: s.isEmergency,
            lateNotice: s.lateNotice,
            notifiedAt: s.notifiedAt,
          })),
      )
      .sort((a, b) => a.plannedFrom.localeCompare(b.plannedFrom));
    return {
      horizonDays: horizon,
      total: rows.length,
      active: rows.filter((r) => r.status === 'active').length,
      // Жители не предупреждены — по таймеру 62 это отдельная беда объекта
      notNotified: rows.filter((r) => !r.notifiedAt).length,
      rows,
    };
  }

  /**
   * D-23: реестр объектов и операторов.
   *
   * Диспетчеру он нужен ради одного вопроса: можно ли вообще отправлять
   * работу на этот адрес. Неподключённый объект означает, что общего
   * имущества как контура нет, деградированный — что оператор не тянет, и
   * заявку придётся вести иначе.
   */
  @Get('registry')
  registry() {
    const buildings = this.buildings.listBuildings('t0');
    const byOperator = new Map<string, { orgId: string; plan: string | null; buildings: number; degraded: number }>();
    const rows = buildings.map((b) => {
      const overdueShare = b.permitsTotal30d ? b.permitsOverdue30d / b.permitsTotal30d : 0;
      if (b.operatorOrgId) {
        const rec = byOperator.get(b.operatorOrgId) ?? {
          orgId: b.operatorOrgId,
          plan: this.subs.get('t0', b.operatorOrgId)?.plan ?? null,
          buildings: 0,
          degraded: 0,
        };
        rec.buildings += 1;
        if (b.connectionStatus === 'degraded') rec.degraded += 1;
        byOperator.set(b.operatorOrgId, rec);
      }
      return {
        id: b.id,
        name: b.name,
        address: b.address,
        connectionStatus: b.connectionStatus,
        operatorOrgId: b.operatorOrgId ?? null,
        emergencyPhone: b.emergencyPhone ?? null,
        permitsOverdue30d: b.permitsOverdue30d,
        permitsTotal30d: b.permitsTotal30d,
        overduePercent: Math.round(overdueShare * 100),
        readinessGaps: this.buildings.readinessGaps('t0', b),
      };
    });
    return {
      total: rows.length,
      active: rows.filter((r) => r.connectionStatus === 'active').length,
      degraded: rows.filter((r) => r.connectionStatus === 'degraded').length,
      operators: [...byOperator.values()],
      rows,
    };
  }

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
  imports: [
    OrdersModule,
    MastersModule,
    AssignmentModule,
    MasterApiModule,
    // Экраны D-07…D-23 собирают то, что уже лежит в других модулях: очередь
    // обзвона, расписание, отключения, реестр объектов. Данные были, экранов
    // не было — диспетчер их не видел
    PublicApiModule,
    SchedulingModule,
    AccessModule,
    BuildingsModule,
    SubscriptionsModule,
  ],
  controllers: [DispatchOpsController],
  providers: [DispatchOpsService],
  exports: [DispatchOpsService],
})
export class DispatchOpsModule {}
