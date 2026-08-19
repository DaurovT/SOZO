import { AsyncLocalStorage } from 'node:async_hooks';
import { UZ, VALUES } from './locale-uz';
import { EN, VALUES_EN } from './locale-en';

/**
 * Язык ответа сервера.
 *
 * Интерфейс приложения мастера переведён на узбекский полностью, но половина
 * того, что он показывает, приходит с сервера: причины отказа, вопросы
 * экзамена, сообщения об ошибках, уведомления. Без этого узбекский мастер
 * видит узбекские кнопки и русские тексты между ними.
 *
 * Ключ словаря — сам русский текст, а не выдуманный идентификатор. Так:
 *  - в коде остаётся читаемая русская строка, и её видно при чтении логики;
 *  - пропущенный перевод отдаёт русский вариант, а не пустоту или ключ;
 *  - переводить можно и то, что уже лежит в базе по-русски (уведомления
 *    хранятся русскими, переводятся при выдаче) — без миграции данных.
 *
 * Локаль живёт в AsyncLocalStorage, а не в аргументах: сообщения об ошибках
 * рождаются в глубине сервисов, и тащить `req` через пять слоёв ради строки
 * — дороже, чем хранить её в контексте запроса.
 */

const storage = new AsyncLocalStorage<'ru' | 'uz' | 'en'>();

/**
 * Строки, которые ведёт админ, а не разработчик: названия позиций прайса.
 *
 * Отдельно от статического словаря, потому что меняются при жизни системы —
 * владелец правит каталог, и перевод обязан ехать следом без пересборки.
 * Механизм тот же: ключ — русское название, значение — узбекское, и потому
 * позиция переводится всюду, где её видно, включая смету и текст оффера.
 */
const catalog = new Map<string, string>();

export function registerCatalogNames(pairs: Iterable<[string, string]>): void {
  catalog.clear();
  for (const [ru, uz] of pairs) if (ru && uz) catalog.set(ru, uz);
}

export type Locale = 'ru' | 'uz' | 'en';

/** Разбор Accept-Language. Русский — язык по умолчанию и запасной вариант */
export function localeOf(header: string | undefined): Locale {
  if (!header) return 'ru';
  const first = header.split(',')[0]?.trim().toLowerCase() ?? '';
  if (first.startsWith('uz')) return 'uz';
  if (first.startsWith('en')) return 'en';
  return 'ru';
}

export function runWithLocale<T>(locale: Locale, fn: () => T): T {
  return storage.run(locale, fn);
}

export function currentLocale(): Locale {
  return storage.getStore() ?? 'ru';
}

/**
 * Перевод с подстановкой: tr('Осталось {0} попыток', left).
 *
 * Подстановка нужна там, где раньше стояла шаблонная строка: словарь не может
 * знать заранее вставленное число, а разрезать фразу на куски нельзя — в
 * узбекском другой порядок слов.
 */
export function tr(ru: string, ...args: (string | number)[]): string {
  const locale = currentLocale();
  const dict = locale === 'uz' ? UZ : locale === 'en' ? EN : null;
  // Каталог позиций прайса ведёт админ, и узбекская колонка у него есть.
  // Английской колонки в прайсе пока нет — на английском названия работ
  // остаются русскими, и это видно, а не спрятано под пустой строкой
  const base = dict ? (dict[ru] ?? (locale === 'uz' ? catalog.get(ru) : undefined) ?? ru) : ru;
  return args.length === 0 ? base : base.replace(/\{(\d+)\}/g, (m, i) => String(args[Number(i)] ?? m));
}

/**
 * Перевод значения справочника: навык, район, тип техники, единица измерения.
 *
 * Отдельно от `tr` намеренно. Эти слова приложение отправляет обратно на
 * сервер — если бы они лежали в общем словаре, интерцептор перевёл бы и поле
 * `skill` в ответе, а следующий запрос ушёл бы с «santexnika», которую сервер
 * не знает. Поэтому переводим их только там, где слово попадает внутрь фразы
 * и назад уже не вернётся.
 */
export function trValue(v: string): string {
  const locale = currentLocale();
  if (locale === 'uz') return VALUES[v] ?? v;
  if (locale === 'en') return VALUES_EN[v] ?? v;
  return v;
}

/** Перевести массив объектов по одному текстовому полю: причины, документы, модули */
export function trList<T, K extends keyof T>(list: readonly T[], field: K): T[] {
  return list.map((item) => ({ ...item, [field]: tr(String(item[field])) }));
}
