/**
 * Справочники лендинга и их подписи на языке страницы.
 *
 * Значение и подпись здесь — разные вещи. Категория, район и навык уезжают в
 * API русской строкой из активного прайса: отправь мы «Plumbing», сервер её не
 * узнает. Поэтому массивы остаются русскими, а переводится только то, что
 * человек видит, — через ключ словаря, найденный по этой же русской строке.
 *
 * Категорию, которой нет в таблице, показываем как есть: прайс ведёт админ, он
 * может завести новую позицию в любой день, и лучше русское название, чем
 * пустая плитка или сырой ключ.
 */

export type T = (key: string, params?: Record<string, string | number>) => string;

/**
 * Резервный список категорий — ТОЛЬКО для деградации, когда /v1/public/prices недоступен
 * (PRD-06 §3, L-01: «плитки без цен»). Цены здесь не хранятся: единственный источник
 * цен — публичный API, синхронизированный с релизом прайс-листа.
 */
export const FALLBACK_CATEGORIES: string[] = [
  'ВЫЕЗД И ДИАГНОСТИКА',
  'САНТЕХНИКА',
  'ЭЛЕКТРИКА',
  'ДЕМОНТАЖ, БУРЕНИЕ, ШТРОБЛЕНИЕ',
  'СВАРОЧНЫЕ РАБОТЫ',
  'КОНДИЦИОНЕРЫ И ВЕНТИЛЯЦИЯ',
  'БЫТОВАЯ ТЕХНИКА (мелкий ремонт)',
  'МАЛЯРНЫЕ И ОТДЕЛОЧНЫЕ РАБОТЫ',
  'ПОЛЫ И ПОТОЛКИ',
  'ОКНА, ДВЕРИ, БАЛКОНЫ',
  'СЛАБОТОЧКА, ИНТЕРНЕТ, БЕЗОПАСНОСТЬ',
  'УНИВЕРСАЛЬНЫЕ РАБОТЫ (МУЖ НА ЧАС)',
  'СЕРВИСНЫЕ УСЛУГИ',
];

/** Русское название категории → ключ словаря. Порядок — как в прайсе. */
const CATEGORY_KEYS: Record<string, string> = {
  'ВЫЕЗД И ДИАГНОСТИКА': 'catalog.visit',
  САНТЕХНИКА: 'catalog.plumbing',
  ЭЛЕКТРИКА: 'catalog.electric',
  'ДЕМОНТАЖ, БУРЕНИЕ, ШТРОБЛЕНИЕ': 'catalog.demolition',
  'СВАРОЧНЫЕ РАБОТЫ': 'catalog.welding',
  'КОНДИЦИОНЕРЫ И ВЕНТИЛЯЦИЯ': 'catalog.climate',
  'БЫТОВАЯ ТЕХНИКА (мелкий ремонт)': 'catalog.appliances',
  'МАЛЯРНЫЕ И ОТДЕЛОЧНЫЕ РАБОТЫ': 'catalog.painting',
  'ПОЛЫ И ПОТОЛКИ': 'catalog.floors',
  'ОКНА, ДВЕРИ, БАЛКОНЫ': 'catalog.windows',
  'СЛАБОТОЧКА, ИНТЕРНЕТ, БЕЗОПАСНОСТЬ': 'catalog.lowvoltage',
  'УНИВЕРСАЛЬНЫЕ РАБОТЫ (МУЖ НА ЧАС)': 'catalog.handyman',
  'СЕРВИСНЫЕ УСЛУГИ': 'catalog.service',
};

/** «САНТЕХНИКА» → «Сантехника»: прайс приходит капсом, показываем обычным видом */
function sentenceCase(category: string): string {
  const lower = category.toLocaleLowerCase('ru');
  return lower.charAt(0).toLocaleUpperCase('ru') + lower.slice(1);
}

/**
 * Название категории для показа. В API всегда уходит исходная русская строка,
 * а незнакомая категория показывается по-русски — это видно, а не спрятано.
 */
export function displayCategory(category: string, t: T): string {
  const key = CATEGORY_KEYS[category.trim()];
  return key ? t(key) : sentenceCase(category);
}

/** Грейды мастера (для L-07). Ключи — как их отдаёт бэкенд. */
export function gradeLabel(grade: string, t: T): string {
  const known = ['bronze', 'silver', 'gold', 'platinum'];
  return known.includes(grade) ? t(`grade.${grade}`) : grade;
}

/**
 * Резервные названия типов объектов — только чтобы форма КП работала, когда
 * /v1/public/object-type-rates недоступен. Ставки при этом не показываем.
 */
export const FALLBACK_OBJECT_TYPES: string[] = [
  'Офис',
  'Аптека / магазин',
  'Кафе / салон',
  'Ресторан / гостиница',
];

const OBJECT_TYPE_KEYS: Record<string, string> = {
  Офис: 'objectType.office',
  'Аптека / магазин': 'objectType.shop',
  'Кафе / салон': 'objectType.cafe',
  'Ресторан / гостиница': 'objectType.hotel',
};

export function objectTypeLabel(objectType: string, t: T): string {
  const key = OBJECT_TYPE_KEYS[objectType.trim()];
  return key ? t(key) : objectType;
}

/** Районы Ташкента для анкеты кандидата (L-06). */
export const ZONES: string[] = [
  'Чиланзар',
  'Юнусабад',
  'Мирабад',
  'Яккасарай',
  'Сергели',
  'Мирзо-Улугбек',
];

const ZONE_KEYS: Record<string, string> = {
  Чиланзар: 'zone.chilanzar',
  Юнусабад: 'zone.yunusabad',
  Мирабад: 'zone.mirabad',
  Яккасарай: 'zone.yakkasaray',
  Сергели: 'zone.sergeli',
  'Мирзо-Улугбек': 'zone.mirzoUlugbek',
};

/** Район города — имя собственное: на каждом языке пишется своей графикой */
export function zoneLabel(zone: string, t: T): string {
  const key = ZONE_KEYS[zone.trim()];
  return key ? t(key) : zone;
}

/** Skill-категории кандидата (L-06). */
export const SKILLS: string[] = [
  'Сантехника',
  'Электрика',
  'Кондиционеры',
  'Мебель',
  'Отделка',
  'Слаботочка',
];

const SKILL_KEYS: Record<string, string> = {
  Сантехника: 'skill.plumbing',
  Электрика: 'skill.electric',
  Кондиционеры: 'skill.climate',
  Мебель: 'skill.furniture',
  Отделка: 'skill.finishing',
  Слаботочка: 'skill.lowvoltage',
};

export function skillLabel(skill: string, t: T): string {
  const key = SKILL_KEYS[skill.trim()];
  return key ? t(key) : skill;
}
