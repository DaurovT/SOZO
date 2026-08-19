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

/** Русское склонение: plural(123, 'параметр', 'параметра', 'параметров') → «123 параметра». */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word =
    mod10 === 1 && mod100 !== 11
      ? one
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? few
        : many;
  return `${n} ${word}`;
}

export function formatDate(iso: string | undefined | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ru-RU');
}
