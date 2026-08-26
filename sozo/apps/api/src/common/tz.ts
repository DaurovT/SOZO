/**
 * Местное время платформы.
 *
 * Сервер живёт в UTC (`timedatectl` → Etc/UTC, `TZ` не задан ни в deploy/, ни
 * в main.ts, ни в package.json), а вся логика рабочих часов была написана
 * через `getHours()` — то есть считала UTC местным. Ташкент — UTC+5, и сдвиг
 * на пять часов проходил через весь продукт:
 *
 *   · срочный вызов был недоступен клиенту с 07:00 до 12:00 по Ташкенту и
 *     доступен в 02:00 ночи;
 *   · окно права первой руки «8–20» означало 13:00–01:00;
 *   · заморозка «горячей зоны» не отсекала ничего: в полдень клиент бронировал
 *     уже прошедшее окно;
 *   · напоминание «уточните подъезд» уходило через час после приезда мастера.
 *
 * Просто выставить `TZ=Asia/Tashkent` было нельзя: код смешивает конвенции —
 * `toISOString().slice(0,10)` даёт UTC-дату, `getHours()` местные часы, и они
 * стоят в одном выражении. С 00:00 до 05:00 «сегодня» стало бы вчерашним днём.
 * Поэтому местное время выражено явно и в одном месте: обе конвенции здесь
 * называются своими именами, а вызывающий выбирает нужную осознанно.
 *
 * Часовой пояс — параметр окружения: платформа обслуживает Ташкент, но
 * зашивать это в двадцати файлах значит однажды не найти все двадцать.
 */
export const APP_TZ = process.env.APP_TZ ?? 'Asia/Tashkent';

const PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TZ,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  weekday: 'short',
});

const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 — воскресенье, как у Date.getDay() */
  weekday: number;
}

function asDate(v: Date | string | number): Date | null {
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

/** Разбор момента на местные составляющие. null — если момент не разобрался */
export function localParts(v: Date | string | number): LocalParts | null {
  const d = asDate(v);
  if (!d) return null;
  const out: Record<string, string> = {};
  for (const p of PARTS.formatToParts(d)) out[p.type] = p.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour === '24' ? '0' : out.hour),
    minute: Number(out.minute),
    second: Number(out.second),
    weekday: WEEKDAY[out.weekday] ?? 0,
  };
}

/** Местный час 0–23. Замена `new Date().getHours()` в логике рабочих часов */
export function localHour(v: Date | string | number = new Date()): number {
  return localParts(v)?.hour ?? 0;
}

/** Минуты от местной полуночи — для сравнения с окнами вида «08:00–20:00» */
export function localMinutesOfDay(v: Date | string | number): number | null {
  const p = localParts(v);
  return p ? p.hour * 60 + p.minute : null;
}

/**
 * Местная дата «YYYY-MM-DD».
 *
 * Именно её ждут все ключи расписания и лимитов. `toISOString().slice(0,10)`
 * возвращает UTC-дату и с 00:00 до 05:00 по Ташкенту показывает вчера.
 */
export function localDateKey(v: Date | string | number = new Date()): string {
  const p = localParts(v);
  if (!p) return '';
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Местный месяц «YYYY-MM» — период учёта и лимитов */
export function localMonthKey(v: Date | string | number = new Date()): string {
  return localDateKey(v).slice(0, 7);
}

/** Смещение пояса от UTC в минутах на этот момент (Ташкент — +300, без перехода на летнее) */
export function offsetMinutes(v: Date | string | number = new Date()): number {
  const d = asDate(v);
  const p = localParts(v);
  if (!d || !p) return 0;
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - d.getTime()) / 60_000);
}

/**
 * Момент по местной дате и минутам от полуночи.
 *
 * Обратная операция к `localDateKey` + `localMinutesOfDay`: из «2026-08-24» и
 * 540 минут получается 09:00 по Ташкенту, а не 09:00 UTC.
 */
export function fromLocal(dateKey: string, minutesOfDay = 0): Date {
  const [y, m, d] = dateKey.split('-').map(Number);
  if (!y || !m || !d) return new Date(NaN);
  // Смещение берётся на предполагаемый момент, затем уточняется: пояса без
  // перехода на летнее время сходятся за одну итерацию, с переходом — за две
  let guess = Date.UTC(y, m - 1, d, 0, minutesOfDay);
  for (let i = 0; i < 2; i++) {
    guess = Date.UTC(y, m - 1, d, 0, minutesOfDay) - offsetMinutes(new Date(guess)) * 60_000;
  }
  return new Date(guess);
}

/** Начало местных суток как момент времени */
export function localDayStart(v: Date | string | number = new Date()): Date {
  return fromLocal(localDateKey(v), 0);
}
