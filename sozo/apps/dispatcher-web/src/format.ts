/** Деньги на бэкенде — в тийинах (1 сум = 100 тийин). */
export function formatSoums(tiyin: number): string {
  const soums = Math.round(tiyin / 100);
  const sign = soums < 0 ? '-' : '';
  const digits = Math.abs(soums)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${sign}${digits} сум`;
}

/** Ввод в формах — в сумах; на бэкенд отправляем тийины. */
export function soumsToTiyin(soums: number): number {
  return Math.round(soums * 100);
}

export function formatDateTime(iso: string | undefined | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Планировщик считает время в минутах от полуночи: 570 → «09:30». */
export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Длительность в минутах → «5 ч 30 мин» (остаток ёмкости ленты). */
export function formatDuration(min: number): string {
  const total = Math.max(0, Math.round(min));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} мин`;
  if (m === 0) return `${h} ч`;
  return `${h} ч ${m} мин`;
}

/** Обратный отсчёт бродкаст-оффера: секунды → «01:23». */
export function formatSeconds(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Минуты, прошедшие с отметки времени — живые счётчики протоколов (D-12). */
export function minutesSince(iso: string, nowMs: number = Date.now()): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((nowMs - t) / 60_000));
}

/**
 * Минуты до дедлайна; отрицательное значение — просрочка (SLA жалоб D-10).
 * Отдельно от minutesSince: тот обрезает отрицательные значения нулём.
 */
export function minutesUntil(iso: string, nowMs: number = Date.now()): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.round((t - nowMs) / 60_000);
}

/** Только время «14:35» — отметки протоколов и передачи смены. */
export function formatTime(iso: string | undefined | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

/** Русское склонение слова «слот»: 1 слот, 3 слота, 5 слотов. */
export function slotsWord(count: number): string {
  const n = Math.abs(count) % 100;
  const last = n % 10;
  if (n > 10 && n < 20) return 'слотов';
  if (last === 1) return 'слот';
  if (last >= 2 && last <= 4) return 'слота';
  return 'слотов';
}

/** Значение input[type=time] («09:30») → минуты от полуночи. */
export function minutesFromTime(value: string): number {
  const [h, m] = value.split(':');
  return (Number(h) || 0) * 60 + (Number(m) || 0);
}

/** «Сегодня» в формате API (YYYY-MM-DD) — тот же срез, что берёт бэкенд. */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Сдвиг даты YYYY-MM-DD на N суток («завтра» на панели планировщика). */
export function plusDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function formatDate(iso: string | undefined | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ru-RU');
}
