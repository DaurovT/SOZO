/**
 * Словари конвейера заявок. Русские имена статусов, типов и стадий — те же, что
 * в диспетчерской (dispatcher-web/src/dicts.ts): один конвейер, одни подписи.
 * Админка использует их только для чтения — управление конвейером в PRD-03.
 */

/** Порядок статусов совпадает с движением заявки по конвейеру (DEV-10). */
export const ORDER_STATUSES: { status: string; label: string }[] = [
  { status: 'new', label: 'Новая' },
  { status: 'estimated', label: 'Оценена' },
  { status: 'pending_approval', label: 'На утверждении' },
  { status: 'approved', label: 'Утверждена' },
  { status: 'assigned', label: 'Назначена' },
  { status: 'master_departed', label: 'Мастер выехал' },
  { status: 'in_progress', label: 'В работе' },
  { status: 'addwork_approval', label: 'Доп-согласование' },
  { status: 'completed', label: 'Выполнена' },
  { status: 'verified', label: 'Проверена' },
  { status: 'awaiting_payment', label: 'Ожидает оплаты' },
  { status: 'closed', label: 'Закрыта' },
  { status: 'rated', label: 'Оценена клиентом' },
  { status: 'cancelled', label: 'Отменена' },
  { status: 'dispute', label: 'Спор' },
];

const ORDER_STATUS_LABELS: Record<string, string> = {
  ...Object.fromEntries(ORDER_STATUSES.map((s) => [s.status, s.label])),
  canceled: 'Отменена',
};

export function orderStatusLabel(status: string): string {
  return ORDER_STATUS_LABELS[status] ?? status;
}

type BadgeVariant = 'success' | 'warning' | 'error' | 'muted' | 'accent';

export function orderStatusVariant(status: string): BadgeVariant {
  switch (status) {
    case 'closed':
    case 'verified':
    case 'rated':
      return 'success';
    case 'pending_approval':
    case 'addwork_approval':
    case 'awaiting_payment':
    case 'completed':
      return 'warning';
    case 'dispute':
    case 'cancelled':
    case 'canceled':
      return 'error';
    default:
      return 'muted';
  }
}

/** Заявка ушла из работы: закрыта, оценена клиентом или отменена. */
export const TERMINAL_STATUSES = new Set(['closed', 'rated', 'cancelled', 'canceled']);

export const CANCELLED_STATUSES = new Set(['cancelled', 'canceled']);

/** Акт выполненных работ печатается после выполнения работ (PRD-05 §13). */
export const ACT_STATUSES = new Set([
  'completed',
  'verified',
  'awaiting_payment',
  'closed',
  'rated',
]);

export const GRAPH_TYPES: { graphType: string; label: string }[] = [
  { graphType: 'b2c', label: 'B2C' },
  { graphType: 'b2b', label: 'B2B' },
  { graphType: 'emergency', label: 'Аварийная' },
  { graphType: 'warranty', label: 'Гарантийная' },
  { graphType: 'from_defect', label: 'Из дефекта' },
  { graphType: 'inspection', label: 'Осмотр' },
];

const GRAPH_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  GRAPH_TYPES.map((t) => [t.graphType, t.label]),
);

export function graphTypeLabel(graphType: string): string {
  return GRAPH_TYPE_LABELS[graphType] ?? graphType;
}

export function graphTypeVariant(graphType: string): BadgeVariant {
  switch (graphType) {
    case 'b2b':
      return 'accent';
    case 'emergency':
      return 'error';
    case 'warranty':
      return 'warning';
    default:
      return 'muted';
  }
}

export const URGENCY_LABELS: Record<string, string> = {
  normal: 'Обычная',
  urgent: 'Срочно',
  emergency: 'Аварийная',
};

export const SOURCE_LABELS: Record<string, string> = {
  phone: 'Телефон',
  app: 'Приложение',
  landing: 'Лендинг',
};

/** Типы смет (ТЗ 4.6). */
export const QUOTE_KIND_LABELS: Record<string, string> = {
  initial: 'Первичная вилка',
  approved: 'Утверждена клиентом',
  additional_forced: 'Доп-смета (вынужденная)',
  additional_upsell: 'Апсейл',
  conservation: 'Консервация',
};

export const APPROVED_VIA_LABELS: Record<string, string> = {
  app: 'приложение',
  phone_dispatcher: 'озвучено по телефону',
  offline_signature: 'подпись офлайн',
};

export const PHOTO_STAGE_LABELS: Record<string, string> = {
  before: 'До',
  during: 'В процессе',
  after: 'После',
  receipt: 'Чек',
};

/** Материалы (ТЗ 8.4). */
export const MATERIAL_KIND_LABELS: Record<string, string> = {
  spare_part: 'Запчасть',
  consumable: 'Расходник',
};

export const MATERIAL_SOURCE_LABELS: Record<string, string> = {
  master_own: 'Мастер за свои',
  partner_store: 'Партнёрский магазин',
  client_self: 'Клиент сам',
  company_stock: 'Склад компании',
};

/** Русские подписи действий для журнала переходов. */
export const LOG_ACTION_LABELS: Record<string, string> = {
  create: 'Создана',
  estimate: 'Оценить',
  assign: 'Назначить мастера',
  reassign: 'Переназначение',
  depart: 'Мастер выехал',
  start: 'Приступил',
  complete: 'Выполнена',
  complete_stage: 'Этап завершён',
  verify: 'Проверена',
  close: 'Закрыть',
  await_payment: 'Отпустить без оплаты',
  cancel: 'Отменить',
  open_dispute: 'Открыть спор',
  resolve_dispute: 'Резолюция спора',
  return_to_work: 'Вернуть в работу',
  rate: 'Оценка клиента',
  confirm_estimate: 'Смета подтверждена',
  request_addwork: 'Запрошены доп-работы',
  resolve_addwork: 'Доп-работы согласованы',
  pause: 'Пауза',
  resume: 'Возобновлена',
};

export function logActionLabel(action: string): string {
  return LOG_ACTION_LABELS[action] ?? action;
}

/** Адрес диспетчерской: управление конвейером живёт там (PRD-03). */
export const DISPATCHER_URL = 'https://dispatch.sozo.uz';
