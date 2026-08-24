/**
 * Импорт реестра помещений и жителей (DEV-15 §14.1, экран U-06).
 *
 * Самая дорогая часть подключения дома — не настройка, а перенос реестра:
 * у оператора он лежит в Excel, вёлся годами разными людьми и содержит
 * ровно то, что содержит любая такая таблица — пустые строки, дубли, «кв.
 * 12а» рядом с «12А», телефоны в пяти форматах. Два-восемь часов на объект
 * (§14.1), и делает их сегодня никто.
 *
 * Поэтому здесь не «прочитать файл», а разобрать его так, чтобы человек
 * увидел свои ошибки до того, как они попадут в базу:
 *
 *   · строка с ошибкой не отменяет весь файл — она называется по номеру,
 *     остальные грузятся. Импорт «всё или ничего» на реестре в тысячу
 *     строк означает, что оператор не загрузит его никогда;
 *   · дубли внутри файла и совпадения с уже заведёнными помещениями —
 *     разные вещи и показываются отдельно: первое исправляют в файле,
 *     второе означает повторный импорт;
 *   · телефон приводится к +998XXXXXXXXX, но неузнанный формат не
 *     «исправляется» молча, а называется ошибкой. Молчаливая правка
 *     телефона означает, что оповещение об отключении уйдёт не туда.
 *
 * Разбор живёт в общем пакете, а не в кабинете: тем же кодом пользуются
 * тесты, и правило «12а и 12А — одно помещение» не должно существовать в
 * двух редакциях.
 */

/** Строка таблицы после разбора файла: значения ячеек в порядке колонок */
export type RawRow = string[];

export interface UnitImportRow {
  /** Номер строки в исходном файле, считая шапку — им человек её и найдёт */
  line: number;
  number: string;
  entrance: string | null;
  floor: number | null;
  unitType: 'apartment' | 'office' | 'storage' | 'parking';
  riserIds: string[];
  residentPhone: string | null;
  residentName: string | null;
  residentRole: 'owner' | 'tenant' | 'family';
}

export interface UnitImportProblem {
  line: number;
  /** Что именно не так — код, а не текст: перевод живёт в интерфейсе */
  code:
    | 'NUMBER_REQUIRED'
    | 'PHONE_INVALID'
    | 'FLOOR_INVALID'
    | 'ROLE_UNKNOWN'
    | 'TYPE_UNKNOWN'
    | 'DUPLICATE_IN_FILE'
    | 'ALREADY_EXISTS';
  /** Значение, из-за которого строка не прошла — чтобы найти его глазами */
  value: string;
}

export interface UnitImportResult {
  rows: UnitImportRow[];
  problems: UnitImportProblem[];
  /** Сколько помещений будет заведено, сколько жителей привязано */
  willCreateUnits: number;
  willCreateResidents: number;
  /** Строки, которые повторяют уже заведённое помещение */
  alreadyExists: number;
}

/* ------------------------------------------------------------------ разбор */

/**
 * Разделитель угадывается, а не задаётся.
 *
 * Excel с русской локалью сохраняет CSV через точку с запятой, с
 * английской — через запятую, выгрузка из 1С часто идёт табуляцией.
 * Спрашивать это у оператора бессмысленно: он не знает ответа.
 */
function detectDelimiter(head: string): string {
  const counts = [';', '\t', ','].map((d) => [d, head.split(d).length] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 1 ? counts[0][0] : ';';
}

/** CSV с кавычками и переносами внутри ячеек */
export function parseDelimited(text: string): RawRow[] {
  // BOM: Excel ставит его в «CSV UTF-8», и без снятия первая колонка
  // перестаёт узнаваться по имени
  const src = text.replace(/^﻿/, '');
  const delim = detectDelimiter(src.slice(0, src.indexOf('\n') + 1 || src.length));
  const rows: RawRow[] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === delim) { row.push(cell); cell = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  // Пустые строки в конце файла — обычное дело для выгрузок, ошибкой не считаем
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

/* ---------------------------------------------------------------- колонки */

/**
 * Имена колонок на трёх языках: шаблон мы даём, но оператор пришлёт свой
 * файл — тот, что вёлся годами. Узнать «Квартира» и «Xonа» дешевле, чем
 * заставлять переименовывать шапку.
 */
const COLUMNS: Record<keyof Omit<UnitImportRow, 'line'>, string[]> = {
  number: ['номер', 'помещение', 'квартира', 'кв', 'raqam', 'xona', 'kvartira', 'number', 'unit', 'apartment'],
  entrance: ['подъезд', 'подъезд №', 'parada', 'podyezd', 'entrance', 'block'],
  floor: ['этаж', 'qavat', 'floor'],
  unitType: ['тип', 'тип помещения', 'turi', 'type'],
  riserIds: ['стояк', 'стояки', 'quvur', 'riser', 'risers'],
  residentPhone: ['телефон', 'телефон жителя', 'тел', 'telefon', 'phone'],
  residentName: ['фио', 'имя', 'житель', 'собственник', 'ism', 'name', 'resident'],
  residentRole: ['роль', 'статус', 'rol', 'role'],
};

const norm = (s: string) => s.trim().toLowerCase().replace(/[.№()]/g, '').replace(/\s+/g, ' ').trim();

/** Сопоставление колонок файла с полями. `-1` — колонки нет */
export function mapHeader(header: RawRow): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [field, names] of Object.entries(COLUMNS)) {
    out[field] = header.findIndex((h) => names.includes(norm(h)));
  }
  return out;
}

/**
 * Похожа ли первая строка на шапку.
 *
 * Судим по первой ячейке, а не по числу совпадений во всей строке. Слова
 * колонок и слова значений пересекаются: «Квартира» — и имя колонки, и тип
 * помещения, «Собственник» — и имя колонки, и роль жителя. Строка данных
 * «12;1;4;Квартира;R1;…;Собственник» набирает два совпадения и по счётчику
 * выглядела бы шапкой — а это первая квартира реестра, и потерять её
 * значит потерять её молча.
 *
 * Шапка же всегда начинается с имени колонки: таблицы, где первый столбец
 * без заголовка, а остальные с ним, не бывает.
 */
export function looksLikeHeader(row: RawRow): boolean {
  if (!row.length) return false;
  const all = Object.values(COLUMNS).flat();
  return all.includes(norm(row[0]));
}

/* -------------------------------------------------------------- нормализация */

const ROLES: Record<string, UnitImportRow['residentRole']> = {
  'собственник': 'owner', 'владелец': 'owner', 'egasi': 'owner', 'mulkdor': 'owner', 'owner': 'owner',
  'арендатор': 'tenant', 'наниматель': 'tenant', 'ijarachi': 'tenant', 'tenant': 'tenant',
  'член семьи': 'family', 'семья': 'family', 'oila': 'family', 'family': 'family',
};

const TYPES: Record<string, UnitImportRow['unitType']> = {
  'квартира': 'apartment', 'kvartira': 'apartment', 'apartment': 'apartment', 'жилое': 'apartment',
  'офис': 'office', 'ofis': 'office', 'office': 'office', 'нежилое': 'office', 'коммерция': 'office',
  'кладовая': 'storage', 'кладовка': 'storage', 'ombor': 'storage', 'storage': 'storage',
  'паркинг': 'parking', 'машиноместо': 'parking', 'parking': 'parking',
};

/**
 * Телефон к +998XXXXXXXXX.
 *
 * Принимаются формы, в которых его действительно записывают: с +998, с 998,
 * с 8 в начале и просто девять цифр. Всё остальное — ошибка строки, а не
 * повод угадать: по этому номеру уйдёт оповещение об отключении воды.
 */
export function normalizePhone(raw: string): string | null {
  const d = raw.replace(/\D/g, '');
  if (d.length === 9) return `+998${d}`;
  if (d.length === 12 && d.startsWith('998')) return `+${d}`;
  if (d.length === 10 && d.startsWith('8')) return `+998${d.slice(1)}`;
  return null;
}

/** «12а», «12А», « 12 а » — одно помещение. Ключ сравнения, не отображение */
export function unitKey(number: string): string {
  return number.trim().toLowerCase().replace(/\s+/g, '').replace(/[.,]/g, '');
}

/* ---------------------------------------------------------------- проверка */

export function buildImport(rows: RawRow[], existingNumbers: string[] = []): UnitImportResult {
  const problems: UnitImportProblem[] = [];
  const out: UnitImportRow[] = [];
  if (!rows.length) return { rows: [], problems: [], willCreateUnits: 0, willCreateResidents: 0, alreadyExists: 0 };

  const hasHeader = looksLikeHeader(rows[0]);
  const col = hasHeader
    ? mapHeader(rows[0])
    // Без шапки читаем по порядку колонок шаблона: номер, подъезд, этаж,
    // тип, стояки, телефон, ФИО, роль
    : { number: 0, entrance: 1, floor: 2, unitType: 3, riserIds: 4, residentPhone: 5, residentName: 6, residentRole: 7 };
  const body = hasHeader ? rows.slice(1) : rows;
  const at = (r: RawRow, f: string) => (col[f] >= 0 ? (r[col[f]] ?? '').trim() : '');

  const existing = new Set(existingNumbers.map(unitKey));
  const seen = new Map<string, number>();
  let already = 0;

  body.forEach((r, i) => {
    const line = i + (hasHeader ? 2 : 1);
    const number = at(r, 'number');
    if (!number) { problems.push({ line, code: 'NUMBER_REQUIRED', value: r.join(' ') }); return; }

    const key = unitKey(number);
    if (seen.has(key)) { problems.push({ line, code: 'DUPLICATE_IN_FILE', value: `${number} — уже в строке ${seen.get(key)}` }); return; }
    seen.set(key, line);
    if (existing.has(key)) { already += 1; problems.push({ line, code: 'ALREADY_EXISTS', value: number }); return; }

    const floorRaw = at(r, 'floor');
    let floor: number | null = null;
    if (floorRaw) {
      const n = Number(floorRaw.replace(',', '.'));
      if (!Number.isFinite(n) || !Number.isInteger(n)) { problems.push({ line, code: 'FLOOR_INVALID', value: floorRaw }); return; }
      floor = n;
    }

    const typeRaw = at(r, 'unitType');
    let unitType: UnitImportRow['unitType'] = 'apartment';
    if (typeRaw) {
      const t = TYPES[norm(typeRaw)];
      if (!t) { problems.push({ line, code: 'TYPE_UNKNOWN', value: typeRaw }); return; }
      unitType = t;
    }

    const phoneRaw = at(r, 'residentPhone');
    let residentPhone: string | null = null;
    if (phoneRaw) {
      residentPhone = normalizePhone(phoneRaw);
      if (!residentPhone) { problems.push({ line, code: 'PHONE_INVALID', value: phoneRaw }); return; }
    }

    const roleRaw = at(r, 'residentRole');
    let residentRole: UnitImportRow['residentRole'] = 'owner';
    if (roleRaw) {
      const role = ROLES[norm(roleRaw)];
      if (!role) { problems.push({ line, code: 'ROLE_UNKNOWN', value: roleRaw }); return; }
      residentRole = role;
    }

    out.push({
      line,
      number,
      entrance: at(r, 'entrance') || null,
      floor,
      unitType,
      riserIds: at(r, 'riserIds').split(/[,;/]/).map((s) => s.trim()).filter(Boolean),
      residentPhone,
      residentName: at(r, 'residentName') || null,
      residentRole,
    });
  });

  return {
    rows: out,
    problems,
    willCreateUnits: out.length,
    willCreateResidents: out.filter((r) => r.residentPhone).length,
    alreadyExists: already,
  };
}

/** Шаблон для оператора: та же шапка, что читает `mapHeader`, и пример */
export const UNIT_IMPORT_TEMPLATE = [
  'Номер;Подъезд;Этаж;Тип;Стояки;Телефон;ФИО;Роль',
  '12;1;4;Квартира;R1;+998901234567;Иванов Иван;Собственник',
  '12а;1;4;Квартира;R1;;;',
  '101;2;1;Офис;R2;998907654321;ООО «Ромашка»;Арендатор',
].join('\r\n');
