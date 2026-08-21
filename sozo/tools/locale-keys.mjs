/**
 * Канонический набор серверных строк, подлежащих переводу.
 *
 * Узбекская колонка эталоном быть не может: в английской нашлись десять
 * строк, которых в ней нет, — значит, переводили в разное время и по разным
 * поводам. Настоящий источник — вызовы `tr(...)` и `trValue(...)` в коде плюс
 * то, что уже лежит в готовых колонках: часть строк приходит из базы и в
 * коде литералом не встречается.
 *
 * Запуск: node tools/locale-keys.mjs [--json путь]
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const SRC = join(ROOT, 'apps/api/src');
const COMMON = join(SRC, 'common');

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** Первый аргумент `tr('…')` — только строковый литерал: `tr(x)` статически не виден */
function fromCode() {
  const text = new Set();
  const values = new Set();
  for (const f of walk(SRC)) {
    if (f.includes('/common/locale')) continue;
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\btr\(\s*'((?:[^'\\]|\\.)*)'/g)) text.add(m[1].replace(/\\'/g, "'"));
    for (const m of src.matchAll(/\btr\(\s*"((?:[^"\\]|\\.)*)"/g)) text.add(m[1].replace(/\\"/g, '"'));
    for (const m of src.matchAll(/\btrValue\(\s*'((?:[^'\\]|\\.)*)'/g)) values.add(m[1].replace(/\\'/g, "'"));
  }
  return { text, values };
}

/** Ключи уже собранной колонки: `'ключ': 'значение',` — ключ может быть на своей строке */
function fromDict(file, name) {
  const src = readFileSync(join(COMMON, file), 'utf8');
  const start = src.indexOf('{', src.indexOf(`export const ${name}`));
  const body = src.slice(start, src.indexOf('\n};', start));
  const out = new Set();
  for (const m of body.matchAll(/^\s*'((?:[^'\\]|\\.)*)'\s*:/gm)) out.add(m[1].replace(/\\'/g, "'"));
  for (const m of body.matchAll(/^\s*"((?:[^"\\]|\\.)*)"\s*:/gm)) out.add(m[1].replace(/\\"/g, '"'));
  return out;
}

export function collectLocaleKeys() {
  const code = fromCode();
  const uzText = fromDict('locale-uz.ts', 'UZ');
  const text = new Set([...code.text, ...uzText, ...fromDict('locale-en.ts', 'EN')]);
  const values = new Set([
    ...code.values,
    ...fromDict('locale-uz.ts', 'VALUES'),
    ...fromDict('locale-en.ts', 'VALUES_EN'),
  ]);

  // Значение справочника переводится отдельно и в общий словарь попадать не должно
  for (const v of values) text.delete(v);

  return { text: [...text].sort(), values: [...values].sort() };
}

// Запуск из командной строки: показать счётчики, при --json — выгрузить набор
if (process.argv[1] && process.argv[1].endsWith('locale-keys.mjs')) {
  const result = collectLocaleKeys();
  const jsonAt = process.argv.indexOf('--json');
  if (jsonAt > 0 && process.argv[jsonAt + 1]) {
    writeFileSync(process.argv[jsonAt + 1], JSON.stringify(result, null, 2));
    console.log(`записано: ${process.argv[jsonAt + 1]}`);
  }
  console.log(`строк: ${result.text.length}, значений справочников: ${result.values.length}`);
}
