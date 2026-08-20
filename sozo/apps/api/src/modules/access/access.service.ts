import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createPermitStateMachine, uuidv7, type PermitContext } from '@sozo/kernel';
import type { PermitAction } from '@sozo/contracts';
import { EventBus } from '../../common/event-bus';
import { BuildingsService } from '../buildings/buildings.service';
import { PermitLinksService } from './permit-links.service';
import { InMemoryPermitRepository, type PermitRecord, type PassRecord, type ShutdownRecord } from './permit.repository';
import type { ResourceType } from '@sozo/contracts';

/** Срок публикации планового отключения — таймер 62 (PRD-05 §8.2) */
const NOTICE_HOURS = 24;

/** SLA согласования по типу заявки — таймеры 55–57 (PRD-05 §8.2) */
const SLA_MINUTES = { planned: 4 * 60, urgent: 60, emergency: 15 } as const;

export interface CreatePermitDto {
  orderId: string;
  buildingId: string;
  zoneTypes: string[];
  requiresShutdown?: boolean;
  riserIds?: string[];
  windowFrom?: string;
  windowTo?: string;
  isEmergency?: boolean;
  masterId?: string;
  masterIsPlatform?: boolean;
  qualificationOk?: boolean;
  operatorSelfDeclared?: boolean;
  urgency?: keyof typeof SLA_MINUTES;
}

/**
 * Модуль access (DEV-07 §2.1, правило 6): единственная точка смены статуса наряда-допуска.
 * Граф исполняет PermitStateMachine из kernel по DEV-10 §7 — здесь только сбор контекста,
 * побочные эффекты и события. Бизнес-правила в этом файле не дублируются.
 */
@Injectable()
export class AccessService {
  private readonly sm = createPermitStateMachine();

  constructor(
    private readonly repo: InMemoryPermitRepository,
    private readonly buildings: BuildingsService,
    private readonly links: PermitLinksService,
    private readonly bus: EventBus,
  ) {}

  /** Собрать контекст перехода из записи наряда (kernel не знает о БД) */
  private context(p: PermitRecord, over: Partial<PermitContext> = {}, at?: Date): PermitContext {
    const now = at ?? new Date();
    const activePass = p.masterId
      ? this.repo.activePassFor(p.tenantId, p.orderId, p.masterId)
      : undefined;
    return {
      now,
      status: p.status,
      version: p.version,
      hasCriticalZone: p.hasCriticalZone,
      hasLicensedZone: p.hasLicensedZone,
      masterIsPlatform: p.masterIsPlatform,
      qualificationOk: p.qualificationOk,
      operatorSelfDeclared: p.operatorSelfDeclared,
      windowSelected: Boolean(p.windowFrom && p.windowTo),
      zonesSelected: p.zoneTypes.length > 0,
      approverAssigned: this.buildings.approvers(p.tenantId, p.buildingId).length > 0,
      slaDeadlineSet: p.slaDeadline !== null,
      slaExpired: p.slaDeadline !== null && Date.parse(p.slaDeadline) <= now.getTime(),
      escalationChainExhausted: false,
      operatorActive: this.buildings.get(p.tenantId, p.buildingId).connectionStatus === 'active',
      actorIsOperatorApprover: false,
      actorScopedToBuilding: false,
      alternativeWindowValid: false,
      clientOrDispatcherConfirmed: false,
      bookingWithinPermitWindow: true,
      buildingWorkHoursRespected: true,
      photoBeforeOpening: false,
      photoAfterRestore: false,
      activeVisitPass: Boolean(activePass),
      withinPermitWindow:
        p.windowFrom !== null &&
        p.windowTo !== null &&
        now.getTime() >= Date.parse(p.windowFrom) &&
        now.getTime() <= Date.parse(p.windowTo),
      dispatcherOverride: false,
      shutdownScheduledIfRequired: true,
      requiresShutdown: p.requiresShutdown,
      resourceRestored: false,
      zoneSecuredConfirmed: false,
      permitWindowPassed: p.windowTo !== null && Date.parse(p.windowTo) < now.getTime(),
      reasonFromDictionary: false,
      ...over,
    };
  }

  /**
   * Создание наряда. Аварийная заявка (DEV-15 §4.5) создаёт наряд сразу открытым,
   * минуя submit/approve: жизнь важнее процедуры. Обязательные побочные эффекты —
   * уведомление аварийного телефона и жителей зоны влияния — публикуются событием.
   */
  create(tenantId: string, dto: CreatePermitDto, actorPhone: string): PermitRecord {
    const building = this.buildings.get(tenantId, dto.buildingId);
    const zones = this.buildings.zonesByTypes(tenantId, dto.buildingId, dto.zoneTypes);
    const hasCriticalZone = zones.some((z) => z.isCritical);
    const hasLicensedZone = zones.some((z) => z.isLicensed);
    const masterIsPlatform = dto.masterIsPlatform ?? true;

    const affected = dto.requiresShutdown
      ? this.buildings.affectedUnits(tenantId, dto.buildingId, dto.riserIds ?? []).map((u) => u.id)
      : [];

    const urgency = dto.urgency ?? (dto.isEmergency ? 'emergency' : 'planned');
    const slaDeadline = new Date(Date.now() + SLA_MINUTES[urgency] * 60_000).toISOString();

    const rec: PermitRecord = {
      id: uuidv7(),
      tenantId,
      orderId: dto.orderId,
      buildingId: dto.buildingId,
      requestedByPhone: actorPhone,
      status: 'draft',
      version: 0,
      zoneTypes: dto.zoneTypes,
      hasCriticalZone,
      hasLicensedZone,
      requiresShutdown: dto.requiresShutdown ?? false,
      affectedUnitIds: affected,
      windowFrom: dto.windowFrom ?? null,
      windowTo: dto.windowTo ?? null,
      approverName: null,
      approvedAt: null,
      approvalKind: null,
      rejectReason: null,
      openedAt: null,
      closedAt: null,
      slaDeadline,
      isEmergency: dto.isEmergency ?? false,
      masterIsPlatform,
      masterId: dto.masterId ?? null,
      operatorSelfDeclared: dto.operatorSelfDeclared ?? false,
      qualificationOk: dto.qualificationOk ?? false,
    };

    const res = this.sm.validate(null, 'create', this.context(rec, { operatorActive: building.connectionStatus === 'active' }));
    if (!res.ok) {
      // Лицензируемая зона мастеру платформы — запрещено всегда (ТЗ 17.8)
      throw new ForbiddenException({ code: res.violation.guard ?? res.violation.code, message: res.violation.message });
    }

    if (rec.isEmergency) {
      // Аварийное вскрытие без согласования: наряд сразу opened, всё остальное — постфактум
      rec.status = 'opened';
      rec.approvalKind = 'emergency_override';
      rec.openedAt = new Date().toISOString();
      this.repo.save(rec);
      this.bus.publish('permit.opened', {
        permitId: rec.id,
        buildingId: rec.buildingId,
        emergency: true,
        affectedUnitIds: rec.affectedUnitIds,
        emergencyPhone: building.emergencyPhone,
      });
      return rec;
    }

    this.repo.save(rec);
    return rec;
  }

  get(tenantId: string, id: string): PermitRecord {
    const p = this.repo.get(tenantId, id);
    if (!p) throw new NotFoundException('Наряд-допуск не найден');
    return p;
  }

  /**
   * Переход по графу. Идемпотентность по clientOpUuid — повтор офлайн-синка мастера
   * возвращает исходный результат и не меняет состояние (DEV-10 §7.6 п.7).
   */
  transition(
    tenantId: string,
    id: string,
    req: { action: PermitAction; clientOpUuid: string; reason?: string; windowFrom?: string; windowTo?: string; photoId?: string },
    actor: { phone: string; isApprover: boolean; scopedToBuilding: boolean; isDispatcher?: boolean },
    at?: Date,
  ): PermitRecord {
    const opKey = `${id}:${req.action}:${req.clientOpUuid}`;
    const seen = this.repo.recallOp(opKey);
    if (seen) return this.get(tenantId, seen);

    const p = this.get(tenantId, id);
    const ctx = this.context(p, {
      actorIsOperatorApprover: actor.isApprover,
      actorScopedToBuilding: actor.scopedToBuilding,
      alternativeWindowValid: Boolean(req.windowFrom && req.windowTo),
      clientOrDispatcherConfirmed: true,
      reasonFromDictionary: Boolean(req.reason),
      photoBeforeOpening: req.action === 'open' ? Boolean(req.photoId) : false,
      photoAfterRestore: req.action === 'close' ? Boolean(req.photoId) : false,
      resourceRestored: req.action === 'close',
      zoneSecuredConfirmed: req.action === 'close',
      dispatcherOverride: actor.isDispatcher ?? false,
      escalationChainExhausted: req.action === 'auto_approve',
    }, at);

    const res = this.sm.validate(p.status, req.action, ctx);
    if (!res.ok) {
      const v = res.violation;
      if (v.code === 'STATE_MACHINE_VIOLATION') {
        throw new ConflictException({ code: 'StateMachineViolation', from: v.from, action: v.action, message: v.message });
      }
      throw new BadRequestException({ code: v.guard ?? v.code, message: v.message });
    }

    const prev = p.status;
    p.status = res.def.to;
    p.version += 1;
    this.applyEffects(p, req, actor);
    this.repo.save(p);
    this.repo.rememberOp(opKey, p.id);
    this.bus.publish(`permit.${res.def.to}`, { permitId: p.id, orderId: p.orderId, buildingId: p.buildingId, from: prev });
    return p;
  }

  /** Побочные эффекты перехода — то, чего kernel знать не должен */
  private applyEffects(
    p: PermitRecord,
    req: { action: PermitAction; reason?: string; windowFrom?: string; windowTo?: string },
    actor: { phone: string },
  ): void {
    const now = new Date().toISOString();
    switch (req.action) {
      case 'approve':
        p.approverName = actor.phone;
        p.approvedAt = now;
        p.approvalKind = 'manual';
        break;
      case 'auto_approve':
        p.approvedAt = now;
        p.approvalKind = 'auto_silence';
        // просрочка согласования — счётчик деградации объекта (DEV-15 §9.3)
        this.buildings.bumpPermitCounters(p.tenantId, p.buildingId, true, p.isEmergency);
        break;
      case 'reject':
      case 'decline_window':
        p.rejectReason = req.reason ?? null;
        break;
      case 'submit': {
        // Ссылка каждому согласующему: основному и резервному. Требовать от них
        // кабинет нельзя — согласование должно делаться из SMS в один тап (W-06).
        const approvers = this.buildings.approvers(p.tenantId, p.buildingId);
        for (const a of approvers) {
          const link = this.links.issue(
            p.id,
            p.buildingId,
            a.userPhone,
            p.slaDeadline ?? new Date(Date.now() + 4 * 3_600_000).toISOString(),
          );
          this.bus.publish('permit.link_issued', {
            permitId: p.id,
            buildingId: p.buildingId,
            approverPhone: a.userPhone,
            approverName: a.fullName,
            code: link.code,
            isBackup: a.isBackup,
          });
        }
        break;
      }
      case 'propose_window':
        p.windowFrom = req.windowFrom ?? p.windowFrom;
        p.windowTo = req.windowTo ?? p.windowTo;
        break;
      case 'open':
        p.openedAt = now;
        break;
      case 'cancel':
      case 'expire':
        // Ссылка на отменённый наряд не должна открываться: согласующий
        // подтвердит доступ, которого уже нет
        this.links.revokeForPermit(p.id);
        break;
      case 'close':
        p.closedAt = now;
        break;
      default:
        break;
    }
    if (req.action === 'approve') {
      this.buildings.bumpPermitCounters(p.tenantId, p.buildingId, false, false);
    }
  }

  /** Очередь согласования оператора (U-02) и диспетчера (D-21) */
  queue(tenantId: string, buildingIds: string[], onlyOverdue = false): PermitRecord[] {
    return this.repo.queue(tenantId, buildingIds, onlyOverdue);
  }

  /**
   * Воркер авто-согласия молчанием (таймеры 55–57). Критичные зоны пропускаются —
   * guard zone_not_critical отклонит переход, и наряд останется ждать человека.
   */
  autoApproveExpired(
    tenantId: string,
    now = new Date(),
  ): { approved: string[]; skippedCritical: string[]; failed: Array<{ permitId: string; reason: string }> } {
    const approved: string[] = [];
    const skippedCritical: string[] = [];
    const failed: Array<{ permitId: string; reason: string }> = [];
    for (const p of this.repo.overdueRequested(tenantId, now)) {
      // Критичные зоны не согласуются молчанием никогда (DEV-15 §9.3): выходим до графа,
      // чтобы отличить сознательный пропуск от сбоя — иначе оба выглядят одинаково в логах.
      if (p.hasCriticalZone) {
        skippedCritical.push(p.id);
        continue;
      }
      try {
        // Момент времени прокидывается и в выборку, и в контекст перехода: guard sla_expired
        // обязан считаться по той же оси, иначе воркер сам себе противоречит.
        this.transition(
          tenantId,
          p.id,
          { action: 'auto_approve', clientOpUuid: uuidv7() },
          { phone: 'system', isApprover: false, scopedToBuilding: false },
          now,
        );
        approved.push(p.id);
      } catch (e) {
        failed.push({ permitId: p.id, reason: e instanceof Error ? e.message : String(e) });
      }
    }
    return { approved, skippedCritical, failed };
  }

  /** Выпуск пропуска при назначении мастера (DEV-15 §6) */
  issuePass(tenantId: string, dto: Omit<PassRecord, 'id' | 'tenantId' | 'status' | 'qrToken' | 'fallbackCode'>): PassRecord {
    const rec: PassRecord = {
      id: uuidv7(),
      tenantId,
      qrToken: uuidv7().replace(/-/g, ''),
      fallbackCode: String(Math.floor(100_000 + Math.random() * 899_999)),
      status: 'active',
      ...dto,
    };
    this.repo.savePass(rec);
    this.bus.publish('pass.issued', { passId: rec.id, orderId: rec.orderId, masterId: rec.masterId });
    return rec;
  }

  /** Блокировка мастера аннулирует все его активные пропуска немедленно */
  revokePassesOfMaster(tenantId: string, masterId: string): number {
    const n = this.repo.revokePassesOfMaster(tenantId, masterId);
    if (n) this.bus.publish('pass.revoked', { masterId, count: n });
    return n;
  }

  /**
   * Гейт заявки: можно ли переводить в «В работе» (DEV-10 §3 правило 9).
   * Для аварийной — правило снято.
   */
  canStartOrder(tenantId: string, orderId: string): { ok: boolean; reason?: string } {
    const permits = this.repo.byOrder(tenantId, orderId);
    if (!permits.length) return { ok: true };
    const blocking = permits.filter((p) => !p.isEmergency && p.status !== 'opened' && p.status !== 'closed');
    if (!blocking.length) return { ok: true };
    return { ok: false, reason: `AccessPermitRequired: наряд в статусе ${blocking[0].status}` };
  }

  // ============================================================
  // Отключения ресурсов (DEV-15 §5)
  // ============================================================

  /**
   * Создание отключения. Зона влияния считается по стоякам, а не задаётся руками:
   * ошибиться в списке помещений легко, а цена ошибки — жители без предупреждения.
   */
  createShutdown(
    tenantId: string,
    dto: {
      buildingId: string;
      resourceType: ResourceType;
      scope?: ShutdownRecord['scope'];
      riserId?: string;
      plannedFrom: string;
      plannedTo: string;
      reason: string;
      initiator?: ShutdownRecord['initiator'];
      orderId?: string;
      isEmergency?: boolean;
    },
  ): ShutdownRecord & { notifiedUnits: number } {
    this.buildings.get(tenantId, dto.buildingId);
    if (Date.parse(dto.plannedTo) <= Date.parse(dto.plannedFrom)) {
      throw new BadRequestException('Окно отключения задано неверно: конец не позже начала');
    }

    const riserId = dto.riserId ?? null;
    const conflict = this.repo.overlappingShutdown(
      tenantId,
      dto.buildingId,
      riserId,
      dto.plannedFrom,
      dto.plannedTo,
    );
    if (conflict) {
      // Инвариант DEV-02 §4.4 п.9 — защита от двух бригад на одном стояке
      throw new ConflictException({
        code: 'ShutdownRiserOverlap',
        message: `На стояке ${riserId} уже запланировано отключение ${conflict.plannedFrom}…${conflict.plannedTo}`,
        conflictId: conflict.id,
      });
    }

    const affected = this.buildings
      .affectedUnits(tenantId, dto.buildingId, riserId ? [riserId] : [])
      .map((u) => u.id);

    const isEmergency = dto.isEmergency ?? false;
    const hoursAhead = (Date.parse(dto.plannedFrom) - Date.now()) / 3_600_000;

    const rec: ShutdownRecord = {
      id: uuidv7(),
      tenantId,
      buildingId: dto.buildingId,
      resourceType: dto.resourceType,
      scope: dto.scope ?? (riserId ? 'riser' : 'building'),
      riserId,
      affectedUnitIds: affected,
      plannedFrom: dto.plannedFrom,
      plannedTo: dto.plannedTo,
      actualFrom: null,
      actualTo: null,
      reason: dto.reason,
      initiator: dto.initiator ?? 'operator',
      orderId: dto.orderId ?? null,
      status: 'scheduled',
      notifiedAt: new Date().toISOString(),
      // плановое отключение позже срока публикации — метка для индикатора объекта,
      // а не запрет: запрещать поздно созданное отключение вреднее, чем его пометить
      lateNotice: !isEmergency && hoursAhead < NOTICE_HOURS,
      isEmergency,
    };
    this.repo.saveShutdown(rec);

    // Оповещение зоны влияния. Профиль «массовое оповещение по объекту» (PRD-05 §6.3 п.8):
    // push тем, у кого есть приложение, SMS остальным — решает движок уведомлений.
    this.bus.publish('shutdown.scheduled', {
      shutdownId: rec.id,
      buildingId: rec.buildingId,
      resourceType: rec.resourceType,
      plannedFrom: rec.plannedFrom,
      plannedTo: rec.plannedTo,
      affectedUnitIds: rec.affectedUnitIds,
      emergency: rec.isEmergency,
      lateNotice: rec.lateNotice,
    });

    return { ...rec, notifiedUnits: affected.length };
  }

  listShutdowns(tenantId: string, buildingId: string): ShutdownRecord[] {
    return this.repo.listShutdowns(tenantId, buildingId);
  }

  /** Фактическое отключение — отметка мастера с экрана M-45 */
  startShutdown(tenantId: string, id: string): ShutdownRecord {
    const x = this.repo.getShutdown(tenantId, id);
    if (!x) throw new NotFoundException('Отключение не найдено');
    x.status = 'active';
    x.actualFrom = new Date().toISOString();
    this.repo.saveShutdown(x);
    this.bus.publish('shutdown.started', { shutdownId: x.id, affectedUnitIds: x.affectedUnitIds });
    return x;
  }

  /**
   * Восстановление ресурса. Если фактическое окно вышло за плановое — жители получают
   * новый прогноз отдельным событием: тишина при просрочке хуже самой просрочки (ТЗ 17.3).
   */
  restoreShutdown(tenantId: string, id: string): ShutdownRecord & { overranMin: number } {
    const x = this.repo.getShutdown(tenantId, id);
    if (!x) throw new NotFoundException('Отключение не найдено');
    x.status = 'restored';
    x.actualTo = new Date().toISOString();
    this.repo.saveShutdown(x);
    const overranMin = Math.max(0, Math.round((Date.parse(x.actualTo) - Date.parse(x.plannedTo)) / 60_000));
    this.bus.publish('shutdown.restored', {
      shutdownId: x.id,
      affectedUnitIds: x.affectedUnitIds,
      overranMin,
    });
    return { ...x, overranMin };
  }

  /** Наряды заявки — карточка мастера кладёт их в устройство вместе с заявкой */
  permitsOfOrder(tenantId: string, orderId: string) {
    return this.repo.byOrder(tenantId, orderId);
  }

  /** Действующий пропуск мастера по заявке */
  passOfOrder(tenantId: string, orderId: string, masterId: string) {
    return this.repo.activePassFor(tenantId, orderId, masterId);
  }

  /** Отключение, связанное с заявкой */
  shutdownOfOrder(tenantId: string, orderId: string) {
    return this.repo
      .listShutdowns(tenantId, '')
      .find((x) => x.orderId === orderId) ?? this.findShutdownByOrder(tenantId, orderId);
  }

  private findShutdownByOrder(tenantId: string, orderId: string) {
    for (const b of this.buildings.listBuildings(tenantId)) {
      const hit = this.repo.listShutdowns(tenantId, b.id).find((x) => x.orderId === orderId);
      if (hit) return hit;
    }
    return undefined;
  }

  /** Короткая справка об объекте — правила пропуска для экрана мастера */
  buildingBrief(tenantId: string, buildingId: string) {
    const b = this.buildings.get(tenantId, buildingId);
    return {
      name: b.name,
      dispatchPhone: b.dispatchPhone,
      emergencyPhone: b.emergencyPhone,
      parkingRules: b.parkingRules,
      hasServiceLift: b.hasServiceLift,
      noiseFrom: b.noiseFrom,
      noiseTo: b.noiseTo,
    };
  }

  /**
   * Журнал доступа объекта (U-10): кто, когда и в какую зону заходил.
   * Для бизнес-центра это самостоятельная ценность — доказательство перед
   * арендатором и службой безопасности, а не служебный лог.
   */
  accessJournal(tenantId: string, buildingId: string) {
    const rows: Array<{
      at: string;
      kind: 'zone_opened' | 'zone_closed' | 'pass_issued' | 'pass_revoked';
      permitId?: string;
      zones?: string[];
      masterId?: string | null;
      passType?: string;
      status?: string;
    }> = [];

    for (const p of this.repo.permitsByBuilding(tenantId, buildingId)) {
      if (p.openedAt) rows.push({ at: p.openedAt, kind: 'zone_opened', permitId: p.id, zones: p.zoneTypes, masterId: p.masterId });
      if (p.closedAt) rows.push({ at: p.closedAt, kind: 'zone_closed', permitId: p.id, zones: p.zoneTypes, masterId: p.masterId });
    }
    for (const x of this.repo.passesByBuilding(tenantId, buildingId)) {
      rows.push({ at: x.validFrom, kind: 'pass_issued', masterId: x.masterId, passType: x.passType, status: x.status });
      if (x.status === 'revoked') {
        rows.push({ at: x.validTo, kind: 'pass_revoked', masterId: x.masterId, passType: x.passType, status: x.status });
      }
    }
    return rows.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  }

  /** Ссылки согласования, выданные по наряду — для кабинета и разбора у диспетчера */
  permitLinks(permitId: string) {
    return this.links.listForPermit(permitId);
  }
}
