type Variant = 'success' | 'warning' | 'error' | 'muted';

/** Единая функция статусных цветов (README admin-web). */
export function statusVariant(status: string): Variant {
  switch (status) {
    case 'active':
      return 'success';
    case 'draft':
    case 'scheduled':
    case 'candidate':
    case 'checking':
    case 'training':
    case 'suspended':
    case 'offboarding':
      return 'warning';
    case 'blocked':
    case 'terminated':
      return 'error';
    default:
      return 'muted';
  }
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Активен',
  draft: 'Черновик',
  scheduled: 'Запланирован',
  archived: 'Архив',
  suspended: 'Приостановлен',
  terminated: 'Расторгнут',
  candidate: 'Кандидат',
  checking: 'Проверка',
  training: 'Обучение',
  blocked: 'Заблокирован',
  offboarding: 'Офбординг',
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge--${statusVariant(status)}`}>{statusLabel(status)}</span>;
}
