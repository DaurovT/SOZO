// Словари конвейера заявок (DEV-10 / PRD-03). Только русский язык.

import type { ComplaintType, DisputeResolution } from './types';

/** Порядок и русские имена 12 колонок Kanban (D-02). */
export const KANBAN_STATUSES: { status: string; label: string }[] = [
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
  { status: 'dispute', label: 'Спор' },
];

const STATUS_LABELS: Record<string, string> = {
  ...Object.fromEntries(KANBAN_STATUSES.map((s) => [s.status, s.label])),
  closed: 'Закрыта',
  cancelled: 'Отменена',
  canceled: 'Отменена',
  rated: 'Оценена клиентом',
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/** Тон бейджа — совпадает с классами `.badge--*`. */
export type BadgeTone = 'success' | 'warning' | 'error' | 'muted' | 'accent';

type BadgeVariant = 'success' | 'warning' | 'error' | 'muted';

export function statusVariant(status: string): BadgeVariant {
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

/** Терминальные статусы (архив). */
export const TERMINAL_STATUSES = new Set(['closed', 'cancelled', 'canceled', 'rated']);

export const GRAPH_TYPE_LABELS: Record<string, string> = {
  b2c: 'B2C',
  b2b: 'B2B',
  emergency: 'Аварийная',
};

export function graphTypeLabel(graphType: string): string {
  return GRAPH_TYPE_LABELS[graphType] ?? graphType.toUpperCase();
}

export const URGENCY_LABELS: Record<string, string> = {
  normal: 'Обычная',
  urgent: 'Срочно +30%',
  emergency: 'АВАРИЙНАЯ',
};

/** Действия, выводимые кнопками в модале карточки (D-06). */
export const ACTION_LABELS: Record<string, string> = {
  estimate: 'Оценить',
  assign: 'Назначить мастера',
  depart: 'Мастер выехал',
  start: 'Приступил (фото «до»)',
  complete: 'Выполнена',
  verify: 'Проверена (модерация ок)',
  close: 'Закрыть',
  await_payment: 'Отпустить без оплаты',
  cancel: 'Отменить',
  open_dispute: 'Открыть спор',
  resolve_dispute: 'Резолюция спора',
  return_to_work: 'Вернуть в работу',
};

/** Русские подписи действий для журнала переходов (включая не выводимые кнопками). */
export const LOG_ACTION_LABELS: Record<string, string> = {
  ...ACTION_LABELS,
  create: 'Создана',
  rate: 'Оценка клиента',
  confirm_estimate: 'Смета подтверждена',
  request_addwork: 'Запрошены доп-работы',
  resolve_addwork: 'Доп-работы согласованы',
  pause: 'Пауза',
  resume: 'Возобновлена',
  complete_stage: 'Этап завершён',
  reassign: 'Переназначение',
};

// ---------- Словари вкладок карточки D-06 ----------

/** Вкладка «Смета» (ТЗ 4.6): русские имена типов смет. */
export const QUOTE_KIND_LABELS: Record<string, string> = {
  initial: 'Первичная вилка',
  approved: 'Утверждена клиентом',
  additional_forced: 'Доп-смета (вынужденная)',
  additional_upsell: 'Апсейл',
  conservation: 'Консервация',
};

/** Канал санкции клиента (ТЗ 4.6). */
export const APPROVED_VIA_LABELS: Record<string, string> = {
  app: 'приложение',
  phone_dispatcher: 'озвучено по телефону',
  offline_signature: 'подпись офлайн',
};

/** Вкладка «Фото»: стадии. */
export const PHOTO_STAGE_LABELS: Record<string, string> = {
  before: 'До',
  during: 'В процессе',
  after: 'После',
  receipt: 'Чек',
};

/** Акт выполненных работ печатается после выполнения работ (PRD-05 §13). */
export const ACT_STATUSES = new Set([
  'completed',
  'verified',
  'awaiting_payment',
  'closed',
  'rated',
]);

/** Вкладка «Материалы» (ТЗ 8.4). */
export const MATERIAL_KIND_LABELS: Record<string, string> = {
  spare_part: 'Запчасть',
  consumable: 'Расходник «сумки»',
};

export const MATERIAL_SOURCE_LABELS: Record<string, string> = {
  master_own: 'Мастер за свои',
  partner_store: 'Партнёрский магазин',
  client_self: 'Клиент сам',
  company_stock: 'Склад компании',
};

/** Вилка цены запчасти дороже 200 000 сум (ТЗ 8.4.3). */
export const PRICE_TIER_LABELS: Record<string, string> = {
  economy: 'Эконом',
  standard: 'Стандарт',
  premium: 'Премиум',
};

/** Переназначение мастера доступно на статусах 5–8 (ТЗ 4.5, D-15). */
export const REASSIGNABLE_STATUSES = new Set([
  'assigned',
  'master_departed',
  'in_progress',
  'addwork_approval',
]);

/** Флаги dev-симуляции мобильного приложения: действие → релевантные флаги payload. */
export const ACTION_FLAGS: Record<string, string[]> = {
  start: ['photosBefore'],
  complete: [
    'photosAfter',
    'totalEqualsSanctioned',
    'paymentCollected',
    'acceptanceFixed',
    'dispatcherSanction',
  ],
  verify: ['moderationPassed'],
  close: ['billingPosted', 'paymentConfirmed'],
  await_payment: ['dispatcherSanction'],
  assign: ['withinOrderLimit', 'monthlyLimitOk', 'prepaymentMarked'],
};

export const FLAG_LABELS: Record<string, string> = {
  photosBefore: 'Фото «до» загружены',
  photosAfter: 'Фото «после» загружены',
  totalEqualsSanctioned: 'Сумма равна санкционированной',
  paymentCollected: 'Оплата получена мастером',
  moderationPassed: 'Модерация фото пройдена',
  billingPosted: 'Проводки биллинга созданы',
  paymentConfirmed: 'Оплата подтверждена',
  acceptanceFixed: 'Приёмка клиентом зафиксирована',
  dispatcherSanction: 'Санкция диспетчера получена',
  withinOrderLimit: 'В пределах лимита заявки',
  monthlyLimitOk: 'Месячный лимит не превышен',
  prepaymentMarked: 'Предоплата отмечена',
};

// ---------- Планировщик: ленты D-05, ёмкость D-04, лист ожидания D-18 ----------

/** Параметры планировщика — те же числа, что проверяет бэкенд (ТЗ 17.3, параметры №27–29). */
export const SLOT_MINUTES = 30;
export const ROAD_BUFFER_PERCENT = 20;
/** План дня ≤ 80% смены — остальное резерв под аварии (параметр №28). */
export const DAY_PLAN_CAP = 0.8;
/** Ближайшие 2 часа ленты заморожены для автоматики (параметр №29). */
export const FREEZE_MINUTES = 120;
/** Ночь 22:00–07:00 — плановые заявки не бронируются. */
export const NIGHT_END_MIN = 7 * 60;
export const NIGHT_START_MIN = 22 * 60;

/** Цвет точки/брони: те же тона, что у приоритетов очереди. */
export type Tone = 'error' | 'accent' | 'warning' | 'success' | 'muted';

/**
 * Активные ограничения планировщика — панель правил над лентами (D-05).
 * Диспетчер должен видеть их до действия, а не только в тексте ошибки.
 */
export const SCHEDULING_RULES: { text: string; tone: Tone }[] = [
  { text: `Слот ${SLOT_MINUTES} мин`, tone: 'accent' },
  { text: `Дорожный буфер +${ROAD_BUFFER_PERCENT}% к нормо-часам`, tone: 'accent' },
  { text: `План дня ≤${Math.round(DAY_PLAN_CAP * 100)}% смены — резерв под аварии`, tone: 'error' },
  {
    text: `Заморозка ближайших ${FREEZE_MINUTES / 60} часов (правка только с подтверждением)`,
    tone: 'muted',
  },
  { text: 'Ночь 22:00–07:00 — плановые не бронируются', tone: 'muted' },
  { text: 'Дежурным плановые не назначаются', tone: 'warning' },
];

/** Остаток ёмкости ленты до потолка 80% смены, в минутах (≤0 — потолок достигнут). */
export function laneCapacityLeftMin(lane: {
  shift: { startMin: number; endMin: number };
  bookings: { startMin: number; endMin: number }[];
}): number {
  const shiftMin = lane.shift.endMin - lane.shift.startMin;
  const busyMin = lane.bookings.reduce((sum, b) => sum + (b.endMin - b.startMin), 0);
  return Math.round(shiftMin * DAY_PLAN_CAP - busyMin);
}

/** Очередь доступа к слотам — 8 приоритетов (ТЗ 17.3). */
export const PRIORITY_LABELS: Record<number, string> = {
  1: 'Аварийная',
  2: 'B2B в окне',
  3: 'Гарантийная',
  4: 'Продолжение этапной',
  5: 'Срочная',
  6: 'B2C бронь',
  7: 'Лист ожидания',
  8: 'Осмотр',
};

export function priorityLabel(priority: number): string {
  return PRIORITY_LABELS[priority] ?? `приоритет ${priority}`;
}

/** Развёрнутые названия уровней очереди — блок «Приоритеты очереди» на экране ёмкости. */
export const QUEUE_LEVELS: { priority: number; label: string }[] = [
  { priority: 1, label: 'Аварийные' },
  { priority: 2, label: 'B2B в договорном окне' },
  { priority: 3, label: 'Гарантийные' },
  { priority: 4, label: 'Продолжения этапных' },
  { priority: 5, label: 'Срочные' },
  { priority: 6, label: 'Брони B2C' },
  { priority: 7, label: 'Лист ожидания' },
  { priority: 8, label: 'Плановые осмотры (фоновый демпфер)' },
];

/** Цвет брони в ленте: авария — красная, B2B — акцент, гарантия и срочная — предупреждение. */
export function priorityTone(priority: number): 'error' | 'accent' | 'warning' | 'success' {
  if (priority === 1) return 'error';
  if (priority === 2) return 'accent';
  if (priority === 3 || priority === 5) return 'warning';
  return 'success';
}

/** Числовые флаги payload (счётчик фото), остальные — булевы. */
export const NUMERIC_FLAGS = new Set(['photosBefore', 'photosAfter']);

// ---------- Операции смены: замены D-12, инциденты D-13, передача смены D-17 ----------

/**
 * Цель протокола замены — новый мастер за 15 минут (ТЗ 17.3).
 * После этого срока диспетчер звонит клиенту и согласует сдвиг или перенос.
 */
export const REPLACEMENT_TARGET_MIN = 15;

/** Причины срыва на языке диспетчера. */
export const REPLACEMENT_REASON_LABELS: Record<string, string> = {
  no_departure: 'не нажал «Выехал»',
  geo_stale: 'гео не обновляется',
  declined: 'мастер отказался',
  manual: 'решение диспетчера',
};

export function replacementReasonLabel(reason: string): string {
  return REPLACEMENT_REASON_LABELS[reason] ?? reason;
}

/** Этапы протокола замены: подпись и тон бейджа. */
export const REPLACEMENT_STAGES: Record<string, { label: string; tone: BadgeTone }> = {
  detected: { label: 'Обнаружено', tone: 'warning' },
  broadcast: { label: 'Бродкаст', tone: 'accent' },
  assigned: { label: 'Замена назначена', tone: 'success' },
  escalated: { label: 'Эскалация', tone: 'error' },
  closed: { label: 'Закрыт', tone: 'muted' },
};

export function replacementStageLabel(stage: string): string {
  return REPLACEMENT_STAGES[stage]?.label ?? stage;
}

export function replacementStageTone(stage: string): BadgeTone {
  return REPLACEMENT_STAGES[stage]?.tone ?? 'muted';
}

/** Квалификация невыхода при закрытии протокола (ТЗ 17.3). */
export const SANCTION_OPTIONS: { value: 'none' | 'warning' | 'no_show' | 'blocked'; label: string }[] = [
  { value: 'none', label: 'Без санкции' },
  { value: 'warning', label: 'Предупреждение' },
  { value: 'no_show', label: 'Невыход' },
  { value: 'blocked', label: 'Блокировка' },
];

/** Зоны детекта массовых инцидентов — те же районы, что распознаёт бэкенд. */
export const INCIDENT_ZONES = [
  'Чиланзар',
  'Юнусабад',
  'Мирабад',
  'Яккасарай',
  'Сергели',
  'Мирзо-Улугбек',
];

/** Категории массового инцидента (D-13). */
export const INCIDENT_CATEGORIES: { value: string; label: string }[] = [
  { value: 'water_supply', label: 'Водоснабжение' },
  { value: 'power', label: 'Электроснабжение' },
  { value: 'heating', label: 'Отопление' },
  { value: 'sewerage', label: 'Канализация' },
  { value: 'gas', label: 'Газоснабжение' },
  { value: 'other', label: 'Другое' },
];

export function incidentCategoryLabel(category: string): string {
  return INCIDENT_CATEGORIES.find((c) => c.value === category)?.label ?? category;
}

// ---------- Качество: жалобы D-10, споры D-11 (ТЗ 17.10, 4.2) ----------

/** Типы жалоб на языке диспетчера; «деньги» и «приложение» — сложные, резолюция ≤72 ч. */
export const COMPLAINT_TYPE_OPTIONS: { value: ComplaintType; label: string }[] = [
  { value: 'quality', label: 'Качество работ' },
  { value: 'behavior', label: 'Поведение мастера' },
  { value: 'deadline', label: 'Сроки' },
  { value: 'money', label: 'Деньги' },
  { value: 'service', label: 'Сервис и диспетчер' },
  { value: 'app', label: 'Приложение' },
  { value: 'other', label: 'Другое' },
];

export function complaintTypeLabel(type: string): string {
  return COMPLAINT_TYPE_OPTIONS.find((t) => t.value === type)?.label ?? type;
}

/** Статусы жалобы: подпись и тон бейджа. */
export const COMPLAINT_STATUSES: Record<string, { label: string; tone: BadgeTone }> = {
  new: { label: 'Новая', tone: 'warning' },
  in_progress: { label: 'В работе', tone: 'accent' },
  resolved: { label: 'Подтверждена', tone: 'success' },
  rejected: { label: 'Отклонена', tone: 'muted' },
};

export function complaintStatusLabel(status: string): string {
  return COMPLAINT_STATUSES[status]?.label ?? status;
}

export function complaintStatusTone(status: string): BadgeTone {
  return COMPLAINT_STATUSES[status]?.tone ?? 'muted';
}

/** SLA жалоб (ТЗ 17.10) — те же числа считает бэкенд. */
export const COMPLAINT_SLA_NOTE =
  'SLA: первый ответ ≤2 ч в окне 8:00–22:00 (ночная жалоба стартует таймер с 8:00), ' +
  'резолюция ≤24 ч, сложные (деньги, приложение) ≤72 ч. ' +
  'Резолюция обязана ссылаться на метод плейбука (ТЗ 17.10).';

/** Статусы спора: подпись и тон бейджа. */
export const DISPUTE_STATUSES: Record<string, { label: string; tone: BadgeTone }> = {
  open: { label: 'Открыт', tone: 'warning' },
  escalated: { label: 'Эскалирован', tone: 'error' },
  resolved: { label: 'Решён', tone: 'success' },
};

export function disputeStatusLabel(status: string): string {
  return DISPUTE_STATUSES[status]?.label ?? status;
}

export function disputeStatusTone(status: string): BadgeTone {
  return DISPUTE_STATUSES[status]?.tone ?? 'muted';
}

/** Кто инициировал спор. */
export const DISPUTE_ROLE_LABELS: Record<string, string> = {
  client: 'клиент',
  dispatcher: 'диспетчер',
};

export function disputeRoleLabel(role: string): string {
  return DISPUTE_ROLE_LABELS[role] ?? role;
}

/** Варианты резолюции спора; возврат обязателен для клиента и компромисса. */
export const DISPUTE_RESOLUTION_OPTIONS: {
  value: DisputeResolution;
  label: string;
  needsRefund: boolean;
}[] = [
  { value: 'for_client', label: 'В пользу клиента', needsRefund: true },
  { value: 'for_master', label: 'В пользу мастера', needsRefund: false },
  { value: 'compromise', label: 'Компромисс', needsRefund: true },
];

export function disputeResolutionLabel(resolution: string): string {
  return DISPUTE_RESOLUTION_OPTIONS.find((r) => r.value === resolution)?.label ?? resolution;
}

/** Окно спора — 72 ч после «Выполнена»: раньше этого статуса спорить не о чем (ТЗ 4.2). */
export const DISPUTABLE_STATUSES = new Set([
  'completed',
  'verified',
  'awaiting_payment',
  'closed',
  'rated',
]);

/** Виды хвостов в журнале передачи смены (D-17). */
export const HANDOVER_KIND_LABELS: Record<string, string> = {
  replacement: 'Замена',
  incident: 'Инцидент',
  blocked: 'Заблокировано',
  dispute: 'Спор',
  complaint: 'Жалоба',
  awaiting_payment: 'Ожидает оплаты',
  approval: 'Ждёт утверждения',
};

export function handoverKindLabel(kind: string): string {
  return HANDOVER_KIND_LABELS[kind] ?? kind;
}

export function handoverKindTone(kind: string): BadgeTone {
  switch (kind) {
    case 'incident':
    case 'dispute':
    case 'complaint':
      return 'error';
    case 'replacement':
    case 'blocked':
      return 'warning';
    case 'awaiting_payment':
    case 'approval':
      return 'accent';
    default:
      return 'muted';
  }
}
