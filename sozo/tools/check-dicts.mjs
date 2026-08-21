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
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

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
const holders = (s) => (s.match(/\{[a-zA-Z][a-zA-Z0-9_]*\}/g) ?? []).sort().join(',');

/** Неэкранированный `$` в Dart — это интерполяция, а не знак доллара */
const badDollar = (s) => /(^|[^\\])\$/.test(s);

function compare(label, base, dict, { checkDollar }) {
  const missing = [...base.keys()].filter((k) => !dict.has(k));
  const extra = [...dict.keys()].filter((k) => !base.has(k));
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

/* ---------- Клиентское приложение: lib/i18n/dict_*.dart ---------- */
console.log('\nКлиентское приложение (Flutter)');
{
  const dir = join(ROOT, 'apps/client-app/lib/i18n');
  const read = (code) => readFileSync(join(dir, `dict_${code}.dart`), 'utf8');
  const base = parseDart(read('ru'));
  console.log(`  эталон ru — ${base.size} ключей`);
  for (const f of readdirSync(dir).sort()) {
    const code = f.match(/^dict_([a-z]{2})\.dart$/)?.[1];
    if (!code || code === 'ru') continue;
    const text = read(code);
    const bad = unparsedLines(text);
    if (bad.length) problem(`client ${code}: ${bad.length} строк не разобраны, первая — ${bad[0][0]}: ${bad[0][1].trim().slice(0, 70)}`);
    compare(`client ${code}`, base, parseDart(text), { checkDollar: true });
  }
}

/* ---------- Сервер: apps/api/src/common/locale-*.ts ---------- */
console.log('\nСервер (API)');
{
  const dir = join(ROOT, 'apps/api/src/common');
  const files = readdirSync(dir).filter((f) => /^locale-[a-z]{2}\.ts$/.test(f)).sort();
  const uz = readFileSync(join(dir, 'locale-uz.ts'), 'utf8');
  const baseKeys = parseDart(uz); // ключ словаря — русская строка
  console.log(`  эталон locale-uz.ts — ${baseKeys.size} ключей`);
  for (const f of files) {
    if (f === 'locale-uz.ts') continue;
    const dict = parseDart(readFileSync(join(dir, f), 'utf8'));
    const missing = [...baseKeys.keys()].filter((k) => !dict.has(k));
    console.log(`  ${missing.length ? '·' : '✓'} ${f} — ${dict.size} ключей${missing.length ? `, из uz-набора не покрыто ${missing.length}` : ''}`);
  }
}

/* ---------- Лендинг: src/i18n/*.ts ---------- */
console.log('\nЛендинг (React)');
{
  const dir = join(ROOT, 'apps/landing/src/i18n');
  let files;
  try {
    files = readdirSync(dir).filter((f) => /^dict\.[a-z]{2}\.ts$/.test(f)).sort();
  } catch {
    console.log('  · словарей ещё нет');
    files = [];
  }
  if (files.length) {
    const base = parseDart(readFileSync(join(dir, 'dict.ru.ts'), 'utf8'));
    console.log(`  эталон dict.ru.ts — ${base.size} ключей`);
    for (const f of files) {
      if (f === 'dict.ru.ts') continue;
      compare(`landing ${f.slice(5, 7)}`, base, parseDart(readFileSync(join(dir, f), 'utf8')), { checkDollar: false });
    }
  }
}

console.log(failed ? `\nПроблем: ${failed}` : '\nВсё сходится');
process.exit(failed ? 1 : 0);
