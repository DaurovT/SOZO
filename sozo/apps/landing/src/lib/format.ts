/**
 * Числа и суммы на языке страницы.
 *
 * Разделитель разрядов — не украшение, а часть языка: «1 500 000» по-русски,
 * «1.500.000» по-немецки, «1,500,000» по-английски. Поэтому форматируем через
 * `Intl`, а не руками — свой цикл по цифрам всегда писал бы русский вариант.
 */

/** 1500000 → «1 500 000» / «1.500.000» / «1,500,000» — по правилам языка */
export function formatSum(sum: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.round(sum));
}

/**
 * Тийины → «1 500 000 сум». 1 сум = 100 тийин.
 *
 * Название валюты берётся из словаря: это слово переводится («sum», «so‘m»,
 * «苏姆»), а вот сама валюта — нет, суммы везде в узбекских сумах.
 */
export function formatTiyin(tiyin: number, locale: string, unit: string): string {
  return `${formatSum(tiyin / 100, locale)} ${unit}`;
}

export function tiyinToSum(tiyin: number): number {
  return tiyin / 100;
}
