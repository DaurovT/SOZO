/**
 * StateMachine — исполнитель графов статусных переходов DEV-10.
 * Единственная точка валидации перехода (PRD-05 §1.1): модуль orders вызывает
 * validate() перед записью; переход вне графа → STATE_MACHINE_VIOLATION (API отвечает 409).
 * Kernel не знает о БД и модулях — контекст собирает вызывающий слой.
 */
import type { GraphType, OrderStatus, TransitionAction, StateMachineViolation } from '@sozo/contracts';

export type ActionOrCreate = TransitionAction | 'create';

export interface TransitionDef {
  from: OrderStatus | null; // null — создание заявки
  to: OrderStatus;
  action: ActionOrCreate;
  /** Коды guard-проверок из DEV-10 §5; выполняются все */
  guards?: string[];
  /** Внутреннее действие (confirm_estimate, complete_stage, pause/resume) — статус не меняется */
  internal?: boolean;
}

export interface Graph {
  type: GraphType;
  transitions: TransitionDef[];
}

/** Снимок заявки и обстоятельств перехода — собирает сервисный слой (orders) */
export interface TransitionContext {
  now: Date;
  status: OrderStatus;
  version: number;
  photosBefore: number;
  photosAfter: number;
  materialsWithoutReceipt: number; // запчасти без чека (расходники «сумки» чека не требуют)
  totalEqualsSanctioned: boolean;
  paymentCollected: boolean;
  dispatcherSanction: boolean; // «отпустить без оплаты» / особые санкции
  billingPosted: boolean;
  paymentConfirmed: boolean;
  moderationPassed: boolean;
  restrictedSite: boolean; // режимный объект: код+подпись вместо фото (ТЗ 4.1)
  acceptanceFixed: boolean; // онлайн-платёж / код / «принято без кода»+фото
  withinOrderLimit: boolean;
  monthlyLimitOk: boolean;
  fromInspection: boolean;
  isUpsell: boolean;
  prepaymentMarked: boolean; // B2B разовая без договора (ТЗ 8.3)
  restorationDeclined: boolean; // аварийная: отказ от восстановления
  checklistFilled: boolean; // осмотр
  representativeFixed: boolean; // осмотр: код/подпись/«отсутствовал»+фото
  faultQualified: boolean; // гарантийная: вина квалифицирована 0/50/100%
  defectEstimateFresh: boolean; // из дефекта: оценке < 30 дней
  stageChainConfirmed: boolean; // этапная: слоты всех этапов подтверждены до этапа 1
  isLastSession: boolean;
  completedAt?: Date;
  closedAt?: Date;
  reason?: string;
}

export type GuardFn = (ctx: TransitionContext) => true | string; // string — машиночитаемая причина отказа

export type ValidationResult =
  | { ok: true; def: TransitionDef }
  | { ok: false; violation: StateMachineViolation };

export class OrderStateMachine {
  constructor(
    private readonly graphs: ReadonlyMap<GraphType, Graph>,
    private readonly guards: Readonly<Record<string, GuardFn>>,
  ) {}

  graph(type: GraphType): Graph {
    const g = this.graphs.get(type);
    if (!g) throw new Error(`Unknown graph type: ${type}`);
    return g;
  }

  find(type: GraphType, from: OrderStatus | null, action: ActionOrCreate): TransitionDef | undefined {
    return this.graph(type).transitions.find((t) => t.from === from && t.action === action);
  }

  /** Полная проверка: ребро графа + все guards. Идемпотентность и версия — на слое orders (БД). */
  validate(type: GraphType, action: ActionOrCreate, ctx: TransitionContext): ValidationResult {
    const from = action === 'create' ? null : ctx.status;
    const def = this.find(type, from, action);
    if (!def) {
      return {
        ok: false,
        violation: {
          code: 'STATE_MACHINE_VIOLATION',
          orderType: type,
          from: ctx.status,
          action: action as TransitionAction,
          message: `Переход «${action}» из статуса «${ctx.status}» не определён графом типа «${type}» (DEV-10)`,
        },
      };
    }
    for (const code of def.guards ?? []) {
      const guard = this.guards[code];
      if (!guard) throw new Error(`Guard не зарегистрирован: ${code}`);
      const res = guard(ctx);
      if (res !== true) {
        return {
          ok: false,
          violation: {
            code: 'GUARD_FAILED',
            orderType: type,
            from: ctx.status,
            action: action as TransitionAction,
            failedGuard: code,
            message: res,
          },
        };
      }
    }
    return { ok: true, def };
  }

  /** Для контрактного теста DEV-10 §6.1: все допустимые действия из статуса */
  allowedActions(type: GraphType, from: OrderStatus): ActionOrCreate[] {
    return this.graph(type)
      .transitions.filter((t) => t.from === from)
      .map((t) => t.action);
  }
}
