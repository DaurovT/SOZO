import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { ruDict } from './dict.ru';

/**
 * Локализация лендинга (PRD-06 §5.3, требование F-16).
 *
 * Язык живёт в адресе, а не в localStorage: hreflang, индексация и просто
 * пересланная другу ссылка требуют, чтобы у французской страницы был свой
 * URL. Русский остался в корне — на него ведут визитки, наклейки в подъездах
 * и QR-коды мастеров, и ломать их ради единообразия нельзя.
 *
 *   /order        — русский
 *   /fr/order     — французский
 *   /ar/order     — арабский, справа налево
 *
 * Префикс снимает `basename` роутера, поэтому во всём остальном коде ссылки
 * пишутся как раньше — `<Link to="/order">`, и react-router сам подставит
 * язык. Из-за этого же переключение языка — переход по адресу с перезагрузкой,
 * а не смена состояния: basename задаётся один раз при старте.
 */

export interface Locale {
  code: string;
  /** Подпись в переключателе — на самом языке: свой язык ищут глазами */
  name: string;
  dir: 'ltr' | 'rtl';
  /** Значение для атрибута hreflang и `<html lang>` */
  tag: string;
}

export const LOCALES: readonly Locale[] = [
  { code: 'ru', name: 'Русский', dir: 'ltr', tag: 'ru' },
  { code: 'uz', name: 'Oʻzbekcha', dir: 'ltr', tag: 'uz' },
  { code: 'en', name: 'English', dir: 'ltr', tag: 'en' },
  { code: 'tr', name: 'Türkçe', dir: 'ltr', tag: 'tr' },
  { code: 'tg', name: 'Тоҷикӣ', dir: 'ltr', tag: 'tg' },
  { code: 'ar', name: 'العربية', dir: 'rtl', tag: 'ar' },
  { code: 'fr', name: 'Français', dir: 'ltr', tag: 'fr' },
  { code: 'de', name: 'Deutsch', dir: 'ltr', tag: 'de' },
  { code: 'zh', name: '中文', dir: 'ltr', tag: 'zh-Hans' },
  { code: 'ko', name: '한국어', dir: 'ltr', tag: 'ko' },
];

export const DEFAULT_LOCALE = 'ru';

const BY_CODE = new Map(LOCALES.map((l) => [l.code, l]));

export type Dict = Record<string, string>;

/** Словари, кроме русского, грузятся отдельным файлом — по одному на язык.
 *
 * Русский подключён статически: он и язык большинства визитов, и запасной
 * вариант для пропущенного ключа. Остальные девять лежат в `locales/` и в
 * главный бандл не попадают — иначе каждый посетитель тянул бы девять чужих
 * словарей, а PRD-06 §5.2 требует LCP меньше 2.5 s на мобильном.
 *
 * Отдельная папка, а не `./dict.*.ts` рядом: под такой шаблон подпадал и
 * русский словарь, и сборщик предупреждал, что модуль импортирован и
 * статически, и динамически — то есть в отдельный чанк он не уедет. */
const loaders = import.meta.glob<{ default: Dict }>('./locales/*.ts');

/** Код языка из адреса. `/fr/order` → `fr`, `/order` → null (русский) */
export function localeFromPath(pathname: string): string | null {
  const first = pathname.split('/')[1] ?? '';
  if (first === DEFAULT_LOCALE) return null; // /ru/... в адресах не заводим
  return BY_CODE.has(first) ? first : null;
}

/** Текущий язык — читается из адреса один раз за загрузку страницы */
export function currentLocale(): Locale {
  const code = localeFromPath(window.location.pathname) ?? DEFAULT_LOCALE;
  return BY_CODE.get(code) ?? BY_CODE.get(DEFAULT_LOCALE)!;
}

/** Префикс для `basename` роутера: '/fr' либо пустая строка для русского */
export function localeBasename(): string {
  const code = localeFromPath(window.location.pathname);
  return code ? `/${code}` : '';
}

/** Адрес внутри языка → полный адрес сайта: ('fr', '/order') → '/fr/order' */
export function withLocale(code: string, bare: string): string {
  const path = bare.startsWith('/') ? bare : `/${bare}`;
  if (code === DEFAULT_LOCALE) return path;
  return `/${code}${path === '/' ? '' : path}`;
}

/** Путь без языкового префикса: '/fr/order' → '/order' */
export function stripLocale(pathname: string): string {
  const current = localeFromPath(pathname);
  return current ? pathname.slice(current.length + 1) || '/' : pathname;
}

/** Тот же адрес на другом языке — для переключателя и для hreflang */
export function pathForLocale(code: string, pathname = window.location.pathname): string {
  return withLocale(code, stripLocale(pathname));
}

/** Загрузка словаря языка. Русский уже в бандле, остальные — отдельным чанком */
export async function loadDict(code: string): Promise<Dict> {
  if (code === DEFAULT_LOCALE) return ruDict;
  const load = loaders[`./locales/${code}.ts`];
  if (!load) return ruDict;
  try {
    const mod = await load();
    return mod.default;
  } catch {
    // Сеть подвела на середине загрузки: лучше русская страница, чем пустая
    return ruDict;
  }
}

interface I18nValue {
  locale: Locale;
  dict: Dict;
  t: (key: string, params?: Record<string, string | number>) => string;
  /** Форма слова по числу: `tn('calc.points', 3)` → «3 точки» / «3 points» */
  tn: (key: string, n: number, params?: Record<string, string | number>) => string;
}

const Ctx = createContext<I18nValue | null>(null);

export function I18nProvider(props: { locale: Locale; dict: Dict; children: ReactNode }) {
  const { locale, dict } = props;

  const value = useMemo<I18nValue>(() => {
    // Пропущенный ключ отдаёт русскую строку, а не пустоту и не сам ключ:
    // незнакомое слово человек хотя бы узнает по виду, «home.heroTitle» — нет
    const t = (key: string, params?: Record<string, string | number>) => {
      let s = dict[key] ?? ruDict[key] ?? key;
      if (params) {
        for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
      }
      return s;
    };
    /**
     * Множественное число. У русского три формы, у арабского шесть, у
     * китайского и корейского одна — своей функцией это не выразить, поэтому
     * категорию спрашиваем у `Intl.PluralRules`, а формы лежат в словаре
     * отдельными ключами: `calc.points.one`, `calc.points.few`, …
     *
     * Ключ `.other` обязателен у всех языков — он же и запасной вариант,
     * если переводчик не завёл нужную категорию.
     */
    const rules = new Intl.PluralRules(locale.tag);
    const tn = (key: string, n: number, params?: Record<string, string | number>) => {
      const cat = rules.select(n);
      const exact = `${key}.${cat}`;
      const use = dict[exact] !== undefined ? exact : `${key}.other`;
      return t(use, { n, ...params });
    };

    return { locale, dict, t, tn };
  }, [locale, dict]);

  useEffect(() => {
    document.documentElement.lang = locale.tag;
    document.documentElement.dir = locale.dir;
  }, [locale]);

  // Заголовок и описание страницы переводятся тоже: в выдаче и в ссылке,
  // отправленной в мессенджере, видно именно их, а не текст страницы
  useEffect(() => {
    document.title = value.t('meta.title');
    const desc = document.querySelector('meta[name="description"]');
    if (desc) desc.setAttribute('content', value.t('meta.description'));
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) ogTitle.setAttribute('content', value.t('meta.ogTitle'));
    const ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogDesc) ogDesc.setAttribute('content', value.t('meta.ogDescription'));
  }, [value]);

  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
}

export function useI18n(): I18nValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n вне I18nProvider');
  return v;
}

/** Короткая форма для разметки: `const t = useT()` → `t('home.title')` */
export function useT() {
  return useI18n().t;
}

export function useLocale(): Locale {
  return useI18n().locale;
}

/**
 * Теги hreflang и canonical для текущего адреса (PRD-06 §5.3).
 *
 * Ставим из JavaScript, потому что страница одна на все языки и заранее в
 * `index.html` их не пропишешь. Поисковики давно исполняют JS, но чтобы им
 * не пришлось угадывать, теги переписываются на каждом переходе — иначе на
 * второй странице остались бы ссылки с первой.
 */
export function useHreflang(bare: string): void {
  useEffect(() => {
    const origin = window.location.origin;
    const self = currentLocale().code;
    const head = document.head;
    for (const el of head.querySelectorAll('link[data-i18n]')) el.remove();

    const add = (rel: string, href: string, hreflang?: string) => {
      const link = document.createElement('link');
      link.rel = rel;
      link.href = href;
      if (hreflang) link.hreflang = hreflang;
      link.dataset.i18n = 'yes';
      head.appendChild(link);
    };

    // `bare` приходит из роутера и языкового префикса не содержит — роутер
    // снял его вместе с basename. Полный адрес собираем сами, иначе на
    // французской странице все alternate указывали бы на русские
    for (const l of LOCALES) add('alternate', origin + withLocale(l.code, bare), l.tag);
    // x-default — русская версия: она в корне, на неё ведут наклейки и QR
    add('alternate', origin + withLocale(DEFAULT_LOCALE, bare), 'x-default');
    add('canonical', origin + withLocale(self, bare));
  }, [bare]);
}

/** Формы слова по числу — см. `tn` в провайдере */
export function useTn() {
  return useI18n().tn;
}
