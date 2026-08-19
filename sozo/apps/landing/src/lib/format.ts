const NBSP = ' ';

/** 1 500 000 → «1 500 000» (неразрывные пробелы, чтобы сумма не рвалась на 360px). */
export function formatSum(sum: number): string {
  const whole = Math.round(sum);
  const s = String(Math.abs(whole));
  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    if (i > 0 && (s.length - i) % 3 === 0) out += NBSP;
    out += s[i];
  }
  return (whole < 0 ? '-' : '') + out;
}

/**
 * Тийины → «1 500 000 сум». 1 сум = 100 тийин.
 * Разряды склеены неразрывными пробелами, а перед «сум» — обычный, чтобы
 * длинные суммы могли переноситься и не рвали вёрстку на 360px.
 */
export function formatTiyin(tiyin: number): string {
  return `${formatSum(tiyin / 100)} сум`;
}

export function tiyinToSum(tiyin: number): number {
  return tiyin / 100;
}

/** Число заявок/дней и т.п. с правильным окончанием. */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/**
 * SLA обратного звонка словами. Бэкенд отдаёт slaMinutes: 10 (B2C), 240 (B2B), 2880 (кандидат).
 */
export function formatSla(slaMinutes: number | undefined, fallback: string): string {
  if (slaMinutes === undefined) return fallback;
  if (slaMinutes < 60) {
    return `${slaMinutes} ${plural(slaMinutes, 'минуты', 'минут', 'минут')}`;
  }
  if (slaMinutes < 60 * 24) {
    const h = Math.round(slaMinutes / 60);
    return `${h} ${plural(h, 'рабочего часа', 'рабочих часов', 'рабочих часов')}`;
  }
  const d = Math.round(slaMinutes / (60 * 24));
  return `${d} ${plural(d, 'рабочего дня', 'рабочих дней', 'рабочих дней')}`;
}
