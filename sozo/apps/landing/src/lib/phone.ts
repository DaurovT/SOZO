/**
 * Маска +998. В поле всегда отрисован префикс «+998», поэтому из сырой строки
 * ведущие «998» всегда принадлежат префиксу и снимаются однозначно.
 */

export const NATIONAL_LENGTH = 9;

/** Сырая строка поля → 9 национальных цифр. */
export function extractDigits(raw: string): string {
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('998')) d = d.slice(3);
  return d.slice(0, NATIONAL_LENGTH);
}

/** 901234567 → «+998 90 123-45-67» */
export function formatPhone(digits: string): string {
  const a = digits.slice(0, 2);
  const b = digits.slice(2, 5);
  const c = digits.slice(5, 7);
  const d = digits.slice(7, 9);
  let out = '+998';
  if (a) out += ` ${a}`;
  if (b) out += ` ${b}`;
  if (c) out += `-${c}`;
  if (d) out += `-${d}`;
  return out;
}

export function isPhoneValid(digits: string): boolean {
  return digits.length === NATIONAL_LENGTH;
}

/** 901234567 → «+998901234567» (формат, который ждёт бэкенд). */
export function toE164(digits: string): string {
  return `+998${digits}`;
}
