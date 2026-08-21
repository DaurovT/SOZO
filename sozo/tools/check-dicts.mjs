/**
 * Сверка словарей локализации: набор ключей и синтаксис строковых литералов.
 *
 * Dart и Flutter на этой машине не установлены, а десять словарей на два
 * приложения руками не сверить. Скрипт ловит ровно то, чем ломается перевод:
 * пропущенный ключ (экран покажет русскую строку посреди корейской), лишний
 * ключ (перевели то, чего в коде нет), неэкранированный `$` в Dart (строка
 * молча превратится в интерполяцию) и потерянный плейсхолдер `{p1}` — без
 * него во фразу не подставится номер квартиры или сумма.
 *
 * Запуск: node tools/check-dicts.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { collectLocaleKeys } from './locale-keys.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

let failed = 0;
const problem = (m) => {
  failed += 1;
  console.log(`  ✗ ${m}`);
};

/** Разбор `'key': 'value',` / `"key": "value",` с учётом экранирования */
function parseDart(text) {
  const out = new Map();
  const re = /^\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")\s*:\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")\s*,/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    const key = m[1] ?? m[2];
    const value = m[3] ?? m[4];
    out.set(key, value);
  }
  return out;
}

/** Строки словаря, которые парсер не разобрал, — почти всегда сломанный литерал */
function unparsedLines(text) {
  return text
    .split('\n')
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => {
      const s = l.trim();
      if (!s || s.startsWith('//') || s.startsWith('/*') || s.startsWith('*')) return false;
      if (s === '};' || s.startsWith('const ') || s.startsWith('///')) return false;
      return !/^\s*(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")\s*:\s*(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")\s*,\s*$/.test(l);
    });
}

/** Плейсхолдеры вида {p1}, {sum} — их набор обязан совпасть с эталоном */
const holders = (s) => (s.match(/\{[a-zA-Z0-9][a-zA-Z0-9_]*\}/g) ?? []).sort().join(',');

/** Неэкранированный `$` в Dart — это интерполяция, а не знак доллара */
const badDollar = (s) => /(^|[^\\])\$/.test(s);

function compare(label, base, dict, { checkDollar, optional = () => false }) {
  const missing = [...base.keys()].filter((k) => !dict.has(k) && !optional(k));
  const extra = [...dict.keys()].filter((k) => !base.has(k) && !optional(k));
  if (missing.length) problem(`${label}: нет ${missing.length} ключей — ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ' …' : ''}`);
  if (extra.length) problem(`${label}: лишние ключи (${extra.length}) — ${extra.slice(0, 5).join(', ')}${extra.length > 5 ? ' …' : ''}`);

  const holderBad = [];
  const dollarBad = [];
  const empty = [];
  for (const [k, v] of dict) {
    if (!base.has(k)) continue;
    if (holders(base.get(k)) !== holders(v)) holderBad.push(k);
    if (checkDollar && badDollar(v)) dollarBad.push(k);
    if (!v.trim()) empty.push(k);
  }
  if (holderBad.length) problem(`${label}: расходятся плейсхолдеры в ${holderBad.length} ключах — ${holderBad.slice(0, 5).join(', ')}`);
  if (dollarBad.length) problem(`${label}: неэкранированный \\$ в ${dollarBad.length} ключах — ${dollarBad.slice(0, 5).join(', ')}`);
  if (empty.length) problem(`${label}: пустое значение в ${empty.length} ключах — ${empty.slice(0, 5).join(', ')}`);
  if (!missing.length && !extra.length && !holderBad.length && !dollarBad.length && !empty.length) {
    console.log(`  ✓ ${label} — ${dict.size} ключей`);
  }
}

/* ---------- Клиентское приложение ---------- */
//
// Словари живут в двух местах, и это не беспорядок: ru/uz/en собраны внутрь
// приложения (`lib/i18n/dict_*.dart`), остальные семь лежат на сервере
// (`apps/api/src/i18n/client-*.ts`) и приезжают по требованию. Сверять их
// нужно одинаково — набор ключей общий, где бы файл ни лежал.
console.log('\nКлиентское приложение (Flutter)');
{
  const dartDir = join(ROOT, 'apps/client-app/lib/i18n');
  const serverDir = join(ROOT, 'apps/api/src/i18n');
  const base = parseDart(readFileSync(join(dartDir, 'dict_ru.dart'), 'utf8'));
  console.log(`  эталон ru — ${base.size} ключей`);

  for (const f of readdirSync(dartDir).sort()) {
    const code = f.match(/^dict_([a-z]{2})\.dart$/)?.[1];
    if (!code || code === 'ru') continue;
    const text = readFileSync(join(dartDir, f), 'utf8');
    const bad = unparsedLines(text);
    if (bad.length) problem(`client ${code}: ${bad.length} строк не разобраны, первая — ${bad[0][0]}: ${bad[0][1].trim().slice(0, 70)}`);
    compare(`client ${code} (в сборке)`, base, parseDart(text), { checkDollar: true });
  }

  for (const f of readdirSync(serverDir).sort()) {
    const code = f.match(/^client-([a-z]{2})\.ts$/)?.[1];
    if (!code) continue;
    // На сервере словарь лежит уже в JSON-виде: доллар там обычный символ
    compare(`client ${code} (с сервера)`, base, parseDart(readFileSync(join(serverDir, f), 'utf8')), {
      checkDollar: false,
    });
  }
}

/* ---------- Сервер: apps/api/src/common/locale-*.ts ---------- */
console.log('\nСервер (API)');
{
  const dir = join(ROOT, 'apps/api/src/common');
  // Эталон — не узбекская колонка, а набор строк, которые сервер отдаёт:
  // вызовы tr()/trValue() в коде плюс то, что уже лежит в готовых колонках
  const { text: TEXT, values: VALUES } = collectLocaleKeys();
  const textSet = new Set(TEXT);
  const valueSet = new Set(VALUES);
  console.log(`  эталон — ${TEXT.length} строк и ${VALUES.length} значений справочников`);

  for (const f of readdirSync(dir).filter((x) => /^locale-[a-z]{2}\.ts$/.test(x)).sort()) {
    const code = f.slice(7, 9);
    const src = readFileSync(join(dir, f), 'utf8');
    const cut = src.indexOf('VALUES');
    const head = cut > 0 ? src.slice(0, cut) : src;
    const tail = cut > 0 ? src.slice(cut) : '';
    const dict = parseDart(head);
    const vals = parseDart(tail);

    const missing = TEXT.filter((k) => !dict.has(k));
    const missingVals = VALUES.filter((k) => !vals.has(k));
    // Ключ здесь — сама русская строка: опечатка в нём не ломает сборку, но
    // навсегда отключает перевод, поэтому лишний ключ важнее пропущенного
    const extra = [...dict.keys()].filter((k) => !textSet.has(k));
    const extraVals = [...vals.keys()].filter((k) => !valueSet.has(k));
    const holderBad = [...dict.keys()].filter((k) => textSet.has(k) && holders(k) !== holders(dict.get(k)));

    if (extra.length) problem(`api ${code}: ${extra.length} строк нет в эталоне (опечатка в оригинале?) — ${JSON.stringify(extra[0])}`);
    if (extraVals.length) problem(`api ${code}: ${extraVals.length} значений нет в эталоне — ${JSON.stringify(extraVals[0])}`);
    if (missing.length) problem(`api ${code}: не переведено ${missing.length} из ${TEXT.length} строк — ${JSON.stringify(missing[0])}`);
    if (missingVals.length) problem(`api ${code}: не переведено ${missingVals.length} из ${VALUES.length} значений — ${JSON.stringify(missingVals[0])}`);
    if (holderBad.length) problem(`api ${code}: расходятся плейсхолдеры в ${holderBad.length} строках — ${JSON.stringify(holderBad[0])}`);
    if (!extra.length && !extraVals.length && !missing.length && !missingVals.length && !holderBad.length) {
      console.log(`  ✓ api ${code} — ${dict.size} строк, ${vals.size} значений`);
    }
  }
}

/* ---------- Лендинг: src/i18n/locales/*.ts ---------- */
console.log('\nЛендинг (React)');
{
  const dir = join(ROOT, 'apps/landing/src/i18n');
  const base = parseDart(readFileSync(join(dir, 'dict.ru.ts'), 'utf8'));
  console.log(`  эталон dict.ru.ts — ${base.size} ключей`);

  // Ключи, на которые ссылается разметка. Ловим `t('…')` и `tn('…')`, а также
  // поля вида `titleKey: '…'` — страницы держат ключи в массивах данных
  const used = new Set();
  const srcDir = join(ROOT, 'apps/landing/src');
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) {
        if (e !== 'i18n') walk(p);
      } else if (/\.tsx?$/.test(p)) {
        const src = readFileSync(p, 'utf8');
        for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z][\w.]*)'/g)) used.add(m[1]);
        for (const m of src.matchAll(/\btn\(\s*'([a-zA-Z][\w.]*)'/g)) {
          for (const c of ['one', 'few', 'many', 'other']) used.add(`${m[1]}.${c}`);
        }
        for (const m of src.matchAll(/[Kk]ey:?\s*'([a-z][\w]*\.[\w.]+)'/g)) used.add(m[1]);
      }
    }
  };
  walk(srcDir);

  // `.one/.few/.many` есть не у всех языков — у китайского одна форма. Требуем
  // только `.other`: он же запасной вариант в `tn`
  const optional = (k) => /\.(one|two|few|many|zero)$/.test(k);
  const unknown = [...used].filter((k) => !base.has(k) && !optional(k));
  if (unknown.length) {
    problem(`landing ru: разметка зовёт ${unknown.length} ключей, которых нет в словаре — ${unknown.slice(0, 5).join(', ')}`);
  }
  const unused = [...base.keys()].filter((k) => !used.has(k));
  if (unused.length) console.log(`  · в словаре ${unused.length} ключей, которых разметка не зовёт (${unused.slice(0, 3).join(', ')}…)`);

  let files = [];
  try {
    files = readdirSync(join(dir, 'locales')).filter((f) => /^[a-z]{2}\.ts$/.test(f)).sort();
  } catch {
    /* папки ещё нет */
  }
  if (!files.length) console.log('  · переводов ещё нет');
  for (const f of files) {
    compare(`landing ${f.slice(0, 2)}`, base, parseDart(readFileSync(join(dir, 'locales', f), 'utf8')), {
      checkDollar: false,
      optional,
    });
  }
}

console.log(failed ? `\nПроблем: ${failed}` : '\nВсё сходится');
process.exit(failed ? 1 : 0);
