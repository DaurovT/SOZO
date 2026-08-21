import { createHash } from 'node:crypto';
import { CLIENT_AR } from './client-ar';
import { CLIENT_DE } from './client-de';
import { CLIENT_FR } from './client-fr';
import { CLIENT_KO } from './client-ko';
import { CLIENT_TG } from './client-tg';
import { CLIENT_TR } from './client-tr';
import { CLIENT_ZH } from './client-zh';

/**
 * Догружаемые словари приложения «Клиент».
 *
 * Русский, узбекский и английский собраны внутрь приложения: это языки
 * Ташкента, и первый экран обязан открыться на своём языке без сети.
 * Остальные семь весят вместе больше, чем весь остальной код приложения, а
 * нужны единицам — поэтому лежат здесь и приезжают по требованию.
 *
 * `rev` — отпечаток содержимого. Приложение хранит его вместе с кешем и
 * повторно скачивает словарь, только когда отпечаток изменился: перевод
 * правят раз в месяц, а приложение открывают каждый день.
 */
const DICTS: Record<string, Record<string, string>> = {
  tr: CLIENT_TR,
  tg: CLIENT_TG,
  ar: CLIENT_AR,
  fr: CLIENT_FR,
  de: CLIENT_DE,
  zh: CLIENT_ZH,
  ko: CLIENT_KO,
};

export interface ClientLocale {
  code: string;
  rev: string;
  strings: Record<string, string>;
}

/** Отпечаток считаем один раз при старте: словарь неизменяем */
const REVS = new Map<string, string>(
  Object.entries(DICTS).map(([code, dict]) => [
    code,
    createHash('sha256').update(JSON.stringify(dict)).digest('hex').slice(0, 12),
  ]),
);

export const REMOTE_LOCALE_CODES = Object.keys(DICTS);

export function clientLocale(code: string): ClientLocale | null {
  const dict = DICTS[code];
  if (!dict) return null;
  return { code, rev: REVS.get(code)!, strings: dict };
}

/** Список доступных языков с отпечатками — приложение сверяет свой кеш одним запросом */
export function clientLocaleIndex(): { code: string; rev: string; strings: number }[] {
  return REMOTE_LOCALE_CODES.map((code) => ({
    code,
    rev: REVS.get(code)!,
    strings: Object.keys(DICTS[code]).length,
  }));
}
