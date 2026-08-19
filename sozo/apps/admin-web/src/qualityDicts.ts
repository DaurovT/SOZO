/**
 * Словари качества: жалобы D-10 (ТЗ 17.10) и споры D-11 (ТЗ 4.2).
 * Подписи те же, что в диспетчерской: регистрация и резолюция живут там,
 * админка показывает срез, SLA и паттерны.
 */

type BadgeVariant = 'success' | 'warning' | 'error' | 'muted' | 'accent';

const COMPLAINT_TYPE_LABELS: Record<string, string> = {
  quality: 'Качество работ',
  behavior: 'Поведение мастера',
  deadline: 'Сроки',
  money: 'Деньги',
  service: 'Сервис и диспетчер',
  app: 'Приложение',
  other: 'Другое',
};

export function complaintTypeLabel(type: string): string {
  return COMPLAINT_TYPE_LABELS[type] ?? type;
}

const COMPLAINT_STATUS_LABELS: Record<string, string> = {
  new: 'Новая',
  in_progress: 'В работе',
  resolved: 'Решена',
  rejected: 'Отклонена',
};

export function complaintStatusLabel(status: string): string {
  return COMPLAINT_STATUS_LABELS[status] ?? status;
}

export function complaintStatusVariant(status: string): BadgeVariant {
  switch (status) {
    case 'resolved':
      return 'success';
    case 'in_progress':
      return 'warning';
    case 'new':
      return 'accent';
    default:
      return 'muted';
  }
}

/** Плейбук методов резолюции — резолюция обязана ссылаться на метод (ТЗ 17.10). */
const PLAYBOOK_LABELS: Record<string, string> = {
  apology_vip: 'Извинение + VIP-контроль',
  redo: 'Переделка',
  partial_refund: 'Частичный возврат',
  full_refund: 'Полный возврат',
  master_change: 'Замена мастера',
  b2b_call: 'Звонок руководству',
};

export function playbookLabel(code: string): string {
  return PLAYBOOK_LABELS[code] ?? code;
}

const DISPUTE_STATUS_LABELS: Record<string, string> = {
  open: 'Открыт',
  escalated: 'Эскалирован',
  resolved: 'Решён',
};

export function disputeStatusLabel(status: string): string {
  return DISPUTE_STATUS_LABELS[status] ?? status;
}

export function disputeStatusVariant(status: string): BadgeVariant {
  switch (status) {
    case 'resolved':
      return 'success';
    case 'escalated':
      return 'error';
    case 'open':
      return 'warning';
    default:
      return 'muted';
  }
}

const DISPUTE_ROLE_LABELS: Record<string, string> = {
  client: 'клиент',
  dispatcher: 'диспетчер',
};

export function disputeRoleLabel(role: string): string {
  return DISPUTE_ROLE_LABELS[role] ?? role;
}

const DISPUTE_RESOLUTION_LABELS: Record<string, string> = {
  for_client: 'В пользу клиента',
  for_master: 'В пользу мастера',
  compromise: 'Компромисс',
};

export function disputeResolutionLabel(resolution: string): string {
  return DISPUTE_RESOLUTION_LABELS[resolution] ?? resolution;
}

/** Причины упущенного спроса (F-003) — почему клиент не получил окно. */
const DEMAND_MISS_REASON_LABELS: Record<string, string> = {
  no_windows: 'нет свободных окон',
  window_taken: 'окно заняли',
  out_of_zone: 'адрес вне зоны',
};

export function demandMissReasonLabel(reason: string): string {
  return DEMAND_MISS_REASON_LABELS[reason] ?? reason;
}
