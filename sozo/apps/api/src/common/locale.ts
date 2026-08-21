import { AsyncLocalStorage } from 'node:async_hooks';
import { UZ, VALUES } from './locale-uz';
import { EN, VALUES_EN } from './locale-en';
import { AR, VALUES_AR } from './locale-ar';
import { DE, VALUES_DE } from './locale-de';
import { FR, VALUES_FR } from './locale-fr';
import { KO, VALUES_KO } from './locale-ko';
import { TG, VALUES_TG } from './locale-tg';
import { TR, VALUES_TR } from './locale-tr';
import { ZH, VALUES_ZH } from './locale-zh';

/**
 * Язык ответа сервера.
 *
 * Интерфейс приложений переведён целиком, но половина того, что они
 * показывают, приходит с сервера: причины отказа, вопросы экзамена,
 * сообщения об ошибках, уведомления. Без этого корейский клиент видит
 * корейские кнопки и русские тексты между ними.
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

export type Locale = 'ru' | 'uz' | 'en' | 'tr' | 'tg' | 'ar' | 'fr' | 'de' | 'zh' | 'ko';

const storage = new AsyncLocalStorage<Locale>();

/**
 * Словари по языкам. Русского здесь нет намеренно: ключ словаря — сама
 * русская строка, поэтому «перевод на русский» — это возврат ключа.
 *
 * Пара «текст + справочник» лежит вместе, потому что расходится только
 * применением: `text` подставляется во фразы, `values` переводит слова,
 * которые приложение отправит обратно (см. `trValue`).
 */
const DICTS: Record<Exclude<Locale, 'ru'>, { text: Record<string, string>; values: Record<string, string> }> = {
  uz: { text: UZ, values: VALUES },
  en: { text: EN, values: VALUES_EN },
  tr: { text: TR, values: VALUES_TR },
  tg: { text: TG, values: VALUES_TG },
  ar: { text: AR, values: VALUES_AR },
  fr: { text: FR, values: VALUES_FR },
  de: { text: DE, values: VALUES_DE },
  zh: { text: ZH, values: VALUES_ZH },
  ko: { text: KO, values: VALUES_KO },
};

const CODES = Object.keys(DICTS) as Exclude<Locale, 'ru'>[];

/**
 * Строки, которые ведёт админ, а не разработчик: названия позиций прайса.
 *
 * Отдельно от статического словаря, потому что меняются при жизни системы —
 * владелец правит каталог, и перевод обязан ехать следом без пересборки.
 * Механизм тот же: ключ — русское название, значение — узбекское, и потому
 * позиция переводится всюду, где её видно, включая смету и текст оффера.
 *
 * **Карта одна на процесс и тенанта не различает.** Наполняет её
 * `syncCatalogNames()` (pricing.service.ts), а он берёт `releases.find(r =>
 * r.status === 'active')` — первый активный релиз в плоском массиве, чей бы
 * он ни был. При нескольких тенантах узбекские названия позиций приедут не от
 * того владельца. Чинить это здесь бессмысленно: карта лишь отражает то, что
 * ей передали, а выбор релиза не скоупится во всём `pricing.service` — там
 * и `get`, и `list`, и `active` читают без фильтра. Правка ждёт вместе с
 * изоляцией тенантов; на русском и на девяти статических словарях это не
 * сказывается — они от каталога не зависят.
 */
const catalog = new Map<string, string>();

export function registerCatalogNames(pairs: Iterable<[string, string]>): void {
  catalog.clear();
  for (const [ru, uz] of pairs) if (ru && uz) catalog.set(ru, uz);
}

/**
 * Разбор Accept-Language. Русский — язык по умолчанию и запасной вариант.
 *
 * Сравниваем по началу строки, а не по точному совпадению: браузер шлёт
 * «fr-CA», «zh-Hans-CN», «ar-AE» — регион нам безразличен, словарь один.
 */
export function localeOf(header: string | undefined): Locale {
  if (!header) return 'ru';
  const first = header.split(',')[0]?.trim().toLowerCase() ?? '';
  return CODES.find((c) => first.startsWith(c)) ?? 'ru';
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
  const dict = locale === 'ru' ? null : DICTS[locale].text;
  // Каталог позиций прайса ведёт админ, и узбекская колонка у него есть.
  // Колонок под остальные языки в прайсе нет — там названия работ остаются
  // русскими, и это видно, а не спрятано под пустой строкой
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
  if (locale === 'ru') return v;
  return DICTS[locale].values[v] ?? v;
}

/** Перевести массив объектов по одному текстовому полю: причины, документы, модули */
export function trList<T, K extends keyof T>(list: readonly T[], field: K): T[] {
  return list.map((item) => ({ ...item, [field]: tr(String(item[field])) }));
}
