import type { ConnectionStatus, Health, PermitStatus } from '../types';

/** Маппинг статусов на цвета живёт здесь одним местом (DEV-06 §4.3). */

const CONNECTION: Record<ConnectionStatus, { label: string; cls: string }> = {
  unmanaged: { label: 'Не подключён', cls: 'chip--neutral' },
  claimed: { label: 'Заявлен', cls: 'chip--neutral' },
  verified: { label: 'Проверен', cls: 'chip--neutral' },
  active: { label: 'Активен', cls: 'chip--success' },
  degraded: { label: 'Ограничен', cls: 'chip--error' },
};

export function ConnectionBadge({ status }: { status: ConnectionStatus }) {
  const s = CONNECTION[status];
  return <span className={`chip ${s.cls}`}>{s.label}</span>;
}

const PERMIT: Record<PermitStatus, { label: string; cls: string }> = {
  draft: { label: 'Черновик', cls: 'chip--neutral' },
  requested: { label: 'Ждёт решения', cls: 'chip--warning' },
  approved: { label: 'Согласован', cls: 'chip--success' },
  rescheduled: { label: 'Предложено другое время', cls: 'chip--warning' },
  rejected: { label: 'Отклонён', cls: 'chip--error' },
  scheduled: { label: 'Запланирован', cls: 'chip--success' },
  opened: { label: 'Зона вскрыта', cls: 'chip--warning' },
  closed: { label: 'Закрыт', cls: 'chip--neutral' },
  expired: { label: 'Просрочен', cls: 'chip--error' },
  cancelled: { label: 'Аннулирован', cls: 'chip--neutral' },
};

export function PermitBadge({ status }: { status: PermitStatus }) {
  const s = PERMIT[status];
  return <span className={`chip ${s.cls}`}>{s.label}</span>;
}

const HEALTH: Record<Health, string> = {
  red: 'var(--error)',
  amber: 'var(--warning)',
  green: 'var(--success)',
};

/** Точка светофора объекта. Красный — требует действия сегодня. */
export function HealthDot({ health }: { health: Health }) {
  return (
    <span
      style={{
        display: 'block', width: 10, height: 10,
        borderRadius: 'var(--radius-chip)', background: HEALTH[health],
      }}
    />
  );
}
