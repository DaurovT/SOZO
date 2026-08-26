/**
 * Графы переходов по типам заявок — код 1:1 с DEV-10 §4–5 (обязательное приложение к контракту).
 * Менять только синхронно с DEV-10 и PRD-05 §1.4.
 */
import type { GraphType, OrderStatus } from '@sozo/contracts';
import type { Graph, TransitionDef } from '../state-machine.js';

// Наложенные правила DEV-10 §3: действуют во всех графах
const CANCELLABLE: OrderStatus[] = [
  'new',
  'estimated',
  'pending_approval',
  'approved',
  'assigned',
  'master_departed',
  'in_progress',
  'addwork_approval',
];
/**
 * Откуда можно открыть спор.
 *
 * `rated` добавлен: оценка не должна закрывать окно спора досрочно. Клиент,
 * поставивший звёзды на второй день, терял оставшиеся 70 часов из своих 72 —
 * а оценка и претензия про разное: первая про впечатление, вторая про деньги
 * и качество. Само окно по-прежнему считает guard `within_72h_after_completed`.
 */
const DISPUTABLE: OrderStatus[] = ['completed', 'verified', 'awaiting_payment', 'closed', 'rated'];

function overlays(): TransitionDef[] {
  return [
    ...CANCELLABLE.map<TransitionDef>((from) => ({
      from,
      to: 'cancelled',
      action: 'cancel',
      guards: ['reason_from_dictionary'], // деньги — матрица ТЗ 4.4, считает биллинг
    })),
    ...DISPUTABLE.map<TransitionDef>((from) => ({
      from,
      to: 'dispute',
      action: 'open_dispute',
      guards: ['within_72h_after_completed'],
    })),
    { from: 'dispute', to: 'closed', action: 'resolve_dispute', guards: ['reason_from_dictionary'] },
    { from: 'completed', to: 'in_progress', action: 'return_to_work', guards: ['reason_from_dictionary'] },
    { from: 'verified', to: 'in_progress', action: 'return_to_work', guards: ['reason_from_dictionary'] },
    // Паузы — суб-состояния in_progress (поле pause), статус не меняют
    { from: 'in_progress', to: 'in_progress', action: 'pause', internal: true },
    { from: 'in_progress', to: 'in_progress', action: 'resume', internal: true },
  ];
}

// Цикл сессий этапной работы (DEV-10 §4.7) — доступен в обоих каналах
function stagedCycle(): TransitionDef[] {
  return [
    {
      from: 'in_progress',
      to: 'in_progress',
      action: 'complete_stage',
      internal: true,
      guards: ['stage_chain_confirmed'], // этап 1 не стартует без слотов всех этапов; сессии без оплаты
    },
  ];
}

const b2c: Graph = {
  type: 'b2c',
  transitions: [
    { from: null, to: 'new', action: 'create' },
    { from: 'new', to: 'estimated', action: 'estimate' },
    { from: 'estimated', to: 'assigned', action: 'assign' },
    { from: 'assigned', to: 'master_departed', action: 'depart' },
    { from: 'master_departed', to: 'in_progress', action: 'start', guards: ['photo_before_min1'] },
    { from: 'in_progress', to: 'in_progress', action: 'confirm_estimate', internal: true },
    { from: 'in_progress', to: 'addwork_approval', action: 'request_addwork', guards: ['photo_evidence'] },
    { from: 'addwork_approval', to: 'in_progress', action: 'resolve_addwork' },
    {
      from: 'in_progress',
      to: 'completed',
      action: 'complete',
      guards: [
        'photo_after_min1',
        'materials_receipts_complete',
        'total_equals_sanctioned',
        'payment_collected_or_dispatcher_sanction',
      ],
    },
    { from: 'completed', to: 'verified', action: 'verify', guards: ['moderation_passed'] },
    { from: 'verified', to: 'awaiting_payment', action: 'await_payment', guards: ['dispatcher_sanction_with_reason'] },
    { from: 'verified', to: 'closed', action: 'close', guards: ['billing_posted'] },
    { from: 'awaiting_payment', to: 'closed', action: 'close', guards: ['payment_confirmed', 'billing_posted'] },
    { from: 'closed', to: 'rated', action: 'rate', guards: ['within_72h_after_close'] },
    ...stagedCycle(),
    ...overlays(),
  ],
};

const b2b: Graph = {
  type: 'b2b',
  transitions: [
    { from: null, to: 'new', action: 'create' },
    { from: 'new', to: 'estimated', action: 'estimate' },
    // авто-старт в лимитах (матрица ТЗ 5.1); B2B разовая без договора — гейт предоплаты
    {
      from: 'estimated',
      to: 'assigned',
      action: 'assign',
      guards: ['within_order_limit', 'monthly_limit_ok', 'not_from_inspection', 'not_upsell', 'prepayment_if_no_contract'],
    },
    { from: 'estimated', to: 'pending_approval', action: 'request_approval' },
    { from: 'pending_approval', to: 'approved', action: 'approve' }, // пороги + step-up — на слое identity
    { from: 'pending_approval', to: 'cancelled', action: 'cancel', guards: ['reason_from_dictionary'] }, // молчание T+72
    { from: 'approved', to: 'assigned', action: 'assign' },
    { from: 'assigned', to: 'master_departed', action: 'depart' },
    { from: 'master_departed', to: 'in_progress', action: 'start', guards: ['photo_before_or_restricted_site'] },
    { from: 'in_progress', to: 'addwork_approval', action: 'request_addwork', guards: ['photo_evidence'] }, // всегда через утверждающего
    { from: 'addwork_approval', to: 'in_progress', action: 'resolve_addwork' },
    {
      from: 'in_progress',
      to: 'completed',
      action: 'complete',
      guards: ['photo_after_or_restricted_site', 'materials_receipts_complete', 'acceptance_fixed'],
    },
    { from: 'completed', to: 'verified', action: 'verify', guards: ['moderation_passed'] },
    { from: 'verified', to: 'closed', action: 'close', guards: ['billing_posted'] }, // awaiting_payment пропускается
    { from: 'closed', to: 'rated', action: 'rate', guards: ['within_72h_after_close'] },
    ...stagedCycle(),
    ...overlays(),
  ],
};

const emergency: Graph = {
  type: 'emergency',
  transitions: [
    { from: null, to: 'new', action: 'create' },
    { from: 'new', to: 'assigned', action: 'assign' }, // минуя оценку; аварийный резерв
    { from: 'assigned', to: 'master_departed', action: 'depart' }, // SLA 60/120 мин — таймер
    { from: 'master_departed', to: 'in_progress', action: 'start' }, // фото «до» желательно, не блокирует
    // локализация: позиция «Аварийный выезд» всегда без утверждения — side-effect биллинга
    { from: 'in_progress', to: 'in_progress', action: 'confirm_estimate', internal: true },
    { from: 'in_progress', to: 'pending_approval', action: 'request_approval' }, // восстановление сверх лимита
    { from: 'pending_approval', to: 'in_progress', action: 'approve' },
    { from: 'pending_approval', to: 'completed', action: 'complete', guards: ['restoration_declined'] }, // оплата локализации
    { from: 'in_progress', to: 'completed', action: 'complete', guards: ['photo_after_min1', 'payment_collected_or_dispatcher_sanction'] },
    { from: 'completed', to: 'verified', action: 'verify', guards: ['moderation_passed'] },
    { from: 'verified', to: 'closed', action: 'close', guards: ['billing_posted'] },
    { from: 'closed', to: 'rated', action: 'rate', guards: ['within_72h_after_close'] },
    ...overlays(),
  ],
};

const inspection: Graph = {
  type: 'inspection',
  transitions: [
    { from: null, to: 'new', action: 'create' },
    { from: 'new', to: 'assigned', action: 'assign' }, // приоритет 8, фоновый демпфер
    { from: 'assigned', to: 'master_departed', action: 'depart' },
    { from: 'master_departed', to: 'in_progress', action: 'start' },
    {
      from: 'in_progress',
      to: 'completed',
      action: 'complete',
      guards: ['checklist_filled', 'representative_fixed'], // чек-лист вместо фото-цикла (ТЗ 9.3)
    },
    { from: 'completed', to: 'verified', action: 'verify', guards: ['moderation_passed'] },
    { from: 'verified', to: 'closed', action: 'close', guards: ['billing_posted'] }, // списание резерва — первоочерёдное
    ...overlays(),
  ],
};

const warranty: Graph = {
  type: 'warranty',
  transitions: [
    { from: null, to: 'new', action: 'create' }, // в гарантийном сроке — проверка на создании
    { from: 'new', to: 'assigned', action: 'assign' }, // приоритет 3; по умолчанию виновный мастер
    { from: 'assigned', to: 'master_departed', action: 'depart' },
    { from: 'master_departed', to: 'in_progress', action: 'start', guards: ['photo_before_min1'] },
    { from: 'in_progress', to: 'completed', action: 'complete', guards: ['photo_after_min1'] }, // смета клиенту = 0
    { from: 'completed', to: 'verified', action: 'verify', guards: ['moderation_passed'] },
    { from: 'verified', to: 'closed', action: 'close', guards: ['fault_qualified', 'billing_posted'] }, // 0/50/100%
    { from: 'closed', to: 'rated', action: 'rate', guards: ['within_72h_after_close'] },
    ...overlays(),
  ],
};

const fromDefect: Graph = {
  type: 'from_defect',
  transitions: [
    // Заявка из УТВЕРЖДЁННОГО дефекта создаётся сразу в «Утверждена» (DEV-10 §4.6);
    // машина самого дефекта — в модуле field, утверждение всегда явное (ТЗ 5.1)
    { from: null, to: 'approved', action: 'create', guards: ['defect_estimate_fresh'] },
    ...b2b.transitions.filter((t) => t.from !== null && t.from !== 'new' && t.from !== 'estimated'),
  ],
};

export const GRAPHS: ReadonlyMap<GraphType, Graph> = new Map<GraphType, Graph>([
  ['b2c', b2c],
  ['b2b', b2b],
  ['emergency', emergency],
  ['inspection', inspection],
  ['warranty', warranty],
  ['from_defect', fromDefect],
]);
// Этапная и парная — не отдельные графы, а вариации канала (DEV-10 §4.7–4.8):
// цикл сессий включён в b2c/b2b (complete_stage), роли парной работы — на слое assignment.
