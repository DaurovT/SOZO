/**
 * PermitStateMachine — исполнитель графа наряда-допуска DEV-10 §7.
 * Отдельная машина, а не ветка OrderStateMachine: наряд — самостоятельная сущность
 * со своим словарём статусов (DEV-15 §4). Единственная точка валидации перехода:
 * модуль `access` вызывает validate() перед записью; переход вне графа → 409.
 * Kernel не знает о БД и модулях — контекст собирает вызывающий слой.
 */
import type { PermitStatus, PermitAction } from '@sozo/contracts';

export interface PermitTransitionDef {
  from: PermitStatus | null; // null — создание наряда
  to: PermitStatus;
  action: PermitAction | 'create';
  /** Коды guard-проверок из DEV-10 §7.5; выполняются все */
  guards?: string[];
}

/** Снимок наряда и обстоятельств перехода — собирает сервисный слой (модуль access) */
export interface PermitContext {
  now: Date;
  status: PermitStatus;
  version: number;
  /** Хотя бы одна зона наряда помечена критичной (A-41) — запрещает auto_approve всегда */
  hasCriticalZone: boolean;
  /** Хотя бы одна зона лицензируемая (газ, лифты) — мастеру платформы наряд не создаётся (ТЗ 17.8) */
  hasLicensedZone: boolean;
  /** Исполнитель — мастер платформы (true) или штатный мастер оператора (false) */
  masterIsPlatform: boolean;
  /** Квалификация исполнителя покрывает все зоны наряда (для платформы — проверено, для оператора — самодекларация) */
  qualificationOk: boolean;
  /** Оператор задекларировал соответствие квалификации своего мастера (DEV-15 §7.1.2) */
  operatorSelfDeclared: boolean;
  windowSelected: boolean;
  zonesSelected: boolean;
  approverAssigned: boolean;
  slaDeadlineSet: boolean;
  slaExpired: boolean;
  escalationChainExhausted: boolean;
  operatorActive: boolean;
  actorIsOperatorApprover: boolean;
  actorScopedToBuilding: boolean;
  alternativeWindowValid: boolean;
  clientOrDispatcherConfirmed: boolean;
  bookingWithinPermitWindow: boolean;
  buildingWorkHoursRespected: boolean;
  photoBeforeOpening: boolean;
  photoAfterRestore: boolean;
  activeVisitPass: boolean;
  withinPermitWindow: boolean;
  dispatcherOverride: boolean;
  shutdownScheduledIfRequired: boolean;
  requiresShutdown: boolean;
  resourceRestored: boolean;
  zoneSecuredConfirmed: boolean;
  permitWindowPassed: boolean;
  reasonFromDictionary: boolean;
}

export type PermitGuard = (ctx: PermitContext) => boolean;

export interface PermitViolation {
  code: 'STATE_MACHINE_VIOLATION' | 'GUARD_FAILED' | 'VERSION_CONFLICT';
  from: PermitStatus;
  action: PermitAction | 'create';
  guard?: string;
  message: string;
}

export type PermitValidateResult =
  | { ok: true; def: PermitTransitionDef }
  | { ok: false; violation: PermitViolation };

/** Граф DEV-10 §7.5 — код 1:1 с YAML. Менять только синхронно с документом. */
const CANCELLABLE: PermitStatus[] = ['draft', 'requested', 'rescheduled', 'approved', 'scheduled'];

export const PERMIT_GRAPH: PermitTransitionDef[] = [
  { from: null, to: 'draft', action: 'create', guards: ['order_has_permit_required_item', 'building_active', 'licensed_zone_not_for_platform_master'] },
  { from: 'draft', to: 'requested', action: 'submit', guards: ['window_selected', 'zones_selected', 'approver_assigned', 'sla_deadline_set'] },
  { from: 'requested', to: 'approved', action: 'approve', guards: ['actor_is_operator_approver', 'actor_scoped_to_building'] },
  { from: 'requested', to: 'approved', action: 'auto_approve', guards: ['sla_expired', 'escalation_chain_exhausted', 'zone_not_critical', 'operator_active'] },
  { from: 'requested', to: 'rejected', action: 'reject', guards: ['reason_from_dictionary'] },
  { from: 'requested', to: 'rescheduled', action: 'propose_window', guards: ['alternative_window_valid'] },
  { from: 'rescheduled', to: 'approved', action: 'accept_window', guards: ['client_or_dispatcher_confirmed'] },
  { from: 'rescheduled', to: 'rejected', action: 'decline_window', guards: ['reason_from_dictionary'] },
  { from: 'approved', to: 'scheduled', action: 'schedule', guards: ['booking_created_within_permit_window', 'master_qualified_for_zones', 'building_work_hours_respected'] },
  { from: 'scheduled', to: 'opened', action: 'open', guards: ['photo_before_opening_min1_camera_only', 'active_visit_pass_for_master', 'within_permit_window_or_dispatcher_override', 'shutdown_scheduled_if_required'] },
  { from: 'opened', to: 'closed', action: 'close', guards: ['photo_after_restore_min1', 'resource_restored_if_shutdown', 'zone_secured_confirmed'] },
  { from: 'scheduled', to: 'expired', action: 'expire', guards: ['permit_window_passed'] },
  ...CANCELLABLE.map<PermitTransitionDef>((from) => ({
    from,
    to: 'cancelled' as PermitStatus,
    action: 'cancel' as PermitAction,
    guards: ['reason_from_dictionary'],
  })),
];

/** Guard-проверки DEV-10 §7.5 guard_notes */
export const PERMIT_GUARDS: Record<string, PermitGuard> = {
  order_has_permit_required_item: () => true, // проверяет вызывающий слой по позициям заявки
  building_active: (c) => c.operatorActive,
  // ТЗ 17.8: в лицензируемые зоны мастерам платформы наряд не создаётся НИКОГДА
  licensed_zone_not_for_platform_master: (c) => !(c.hasLicensedZone && c.masterIsPlatform),
  window_selected: (c) => c.windowSelected,
  zones_selected: (c) => c.zonesSelected,
  approver_assigned: (c) => c.approverAssigned,
  sla_deadline_set: (c) => c.slaDeadlineSet,
  actor_is_operator_approver: (c) => c.actorIsOperatorApprover,
  actor_scoped_to_building: (c) => c.actorScopedToBuilding,
  sla_expired: (c) => c.slaExpired,
  escalation_chain_exhausted: (c) => c.escalationChainExhausted,
  // Авто-согласие молчанием запрещено для критичных зон — без исключений (DEV-15 §9.3)
  zone_not_critical: (c) => !c.hasCriticalZone,
  operator_active: (c) => c.operatorActive,
  reason_from_dictionary: (c) => c.reasonFromDictionary,
  alternative_window_valid: (c) => c.alternativeWindowValid,
  client_or_dispatcher_confirmed: (c) => c.clientOrDispatcherConfirmed,
  booking_created_within_permit_window: (c) => c.bookingWithinPermitWindow,
  // Мастер платформы: квалификация проверяется. Мастер оператора: достаточно самодекларации.
  master_qualified_for_zones: (c) => (c.masterIsPlatform ? c.qualificationOk : c.operatorSelfDeclared),
  building_work_hours_respected: (c) => c.buildingWorkHoursRespected,
  photo_before_opening_min1_camera_only: (c) => c.photoBeforeOpening,
  active_visit_pass_for_master: (c) => c.activeVisitPass,
  within_permit_window_or_dispatcher_override: (c) => c.withinPermitWindow || c.dispatcherOverride,
  shutdown_scheduled_if_required: (c) => !c.requiresShutdown || c.shutdownScheduledIfRequired,
  photo_after_restore_min1: (c) => c.photoAfterRestore,
  resource_restored_if_shutdown: (c) => !c.requiresShutdown || c.resourceRestored,
  zone_secured_confirmed: (c) => c.zoneSecuredConfirmed,
  permit_window_passed: (c) => c.permitWindowPassed,
};

export class PermitStateMachine {
  constructor(
    private readonly graph: PermitTransitionDef[] = PERMIT_GRAPH,
    private readonly guards: Record<string, PermitGuard> = PERMIT_GUARDS,
  ) {}

  private find(from: PermitStatus | null, action: PermitAction | 'create') {
    return this.graph.find((t) => t.from === from && t.action === action);
  }

  /** Разрешённые действия из статуса — для UI (U-02, M-43, W-06) */
  allowedActions(from: PermitStatus): Array<PermitAction | 'create'> {
    return this.graph.filter((t) => t.from === from).map((t) => t.action);
  }

  validate(
    from: PermitStatus | null,
    action: PermitAction | 'create',
    ctx: PermitContext,
  ): PermitValidateResult {
    const def = this.find(from, action);
    if (!def) {
      return {
        ok: false,
        violation: {
          code: 'STATE_MACHINE_VIOLATION',
          from: (from ?? 'draft') as PermitStatus,
          action,
          message: `Переход ${from ?? 'null'} --${action}--> вне графа DEV-10 §7`,
        },
      };
    }
    for (const name of def.guards ?? []) {
      const guard = this.guards[name];
      if (!guard) {
        throw new Error(`Guard ${name} не реализован (DEV-10 §7.5)`);
      }
      if (!guard(ctx)) {
        return {
          ok: false,
          violation: {
            code: 'GUARD_FAILED',
            from: (from ?? 'draft') as PermitStatus,
            action,
            guard: name,
            message: `Условие ${name} не выполнено`,
          },
        };
      }
    }
    return { ok: true, def };
  }
}

/** Аварийное исключение DEV-15 §4.5: наряд создаётся сразу открытым, минуя submit/approve. */
export function emergencyPermitStatus(): PermitStatus {
  return 'opened';
}
