/**
 * Возврат пробелов вокруг плейсхолдеров в переводах.
 *
 * Машинный перевод съедает пробел вокруг `{sla}` — скобка ему непонятна, и он
 * приклеивает её к соседнему слову. На странице это видно сразу: «©2026SOZO»
 * вместо «© 2026 SOZO». Правка механическая и потому скриптом: смотрим, что
 * стояло вокруг плейсхолдера в русском оригинале, и восстанавливаем это же в
 * переводе. Смысл слов при этом не меняется, поэтому вычитки не требует.
 *
 * Китайский и корейский не трогаем: там пробелов вокруг вставок нет по
 * правилам письма, и «добавить как в русском» испортило бы строку.
 *
 * Проходим три набора: лендинг (`{имя}`), словари приложения (`{имя}`) и
 * серверные строки (`{0}`). Ключ серверного словаря — сама русская строка,
 * поэтому эталон там берётся из ключа, а не из отдельного файла.
 *
 * Запуск: node tools/fix-holder-spacing.mjs
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALLOWED } from './locale-exceptions.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const DIR = join(ROOT, 'apps/landing/src/i18n');
const SKIP = new Set(['zh', 'ko']);

function parse(text) {
  const out = new Map();
  const re = /^\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")\s*:\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")\s*,/gm;
  let m;
  while ((m = re.exec(text)) !== null) out.set(m[1] ?? m[2], m[3] ?? m[4]);
  return out;
}

const ru = parse(readFileSync(join(DIR, 'dict.ru.ts'), 'utf8'));

let total = 0;

/**
 * Правка одного файла: у каждого ключа смотрим, что стояло вокруг
 * плейсхолдера в оригинале, и восстанавливаем это же в переводе.
 *
 * `origOf` отвечает, где взять оригинал: в лендинге и приложении это
 * русский словарь по тому же ключу, на сервере — сам ключ.
 */
function fixFile(path, origOf) {
  let text = readFileSync(path, 'utf8');
  let fixed = 0;

  text = text.replace(
    /^(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")\s*:\s*)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')(,)$/gm,
    (line, head, k1, k2, quoted, tail) => {
      const key = (k1 ?? k2).replace(/\\'/g, "'").replace(/\\"/g, '"');
      const orig = origOf(key);
      if (orig === undefined || ALLOWED.has(key)) return line;
      const q = quoted[0];
      let value = quoted.slice(1, -1);
      const before = value;

      for (const m of orig.matchAll(/\{[a-zA-Z0-9][\w]*\}/g)) {
        const h = m[0];
        const inner = h.slice(1, -1);
        const ruBefore = orig[m.index - 1];
        const ruAfter = orig[m.index + h.length];
        // Пробел ставим только там, где он был в оригинале: в «{sum}/мес»
        // его не было, и добавлять его — такая же порча, как потерять.
        // Прилипшей считаем букву или цифру: знак вплотную бывает верным
        // («%{share}» по-турецки, «و{0}» по-арабски)
        if (ruBefore && /\s/.test(ruBefore)) {
          value = value.replace(new RegExp(`([\\p{L}\\p{N}])\\{${inner}\\}`, 'gu'), `$1 ${h}`);
        }
        if (ruAfter && /\s/.test(ruAfter)) {
          value = value.replace(new RegExp(`\\{${inner}\\}([\\p{L}\\p{N}])`, 'gu'), `${h} $1`);
        }
      }
      if (value === before) return line;
      fixed += 1;
      return `${head}${q}${value}${q}${tail}`;
    },
  );

  if (fixed) writeFileSync(path, text);
  return fixed;
}

function report(label, fixed) {
  total += fixed;
  console.log(`  ${label}: ${fixed ? `восстановлено пробелов в ${fixed} строках` : 'пробелы на месте'}`);
}

/* ---------- Лендинг ---------- */
console.log('Лендинг');
{
  const ru = parse(readFileSync(join(DIR, 'dict.ru.ts'), 'utf8'));
  for (const f of readdirSync(join(DIR, 'locales')).filter((x) => /^[a-z]{2}\.ts$/.test(x)).sort()) {
    const code = f.slice(0, 2);
    if (SKIP.has(code)) continue;
    report(code, fixFile(join(DIR, 'locales', f), (k) => ru.get(k)));
  }
}

/* ---------- Приложение «Клиент» ---------- */
console.log('\nПриложение «Клиент»');
{
  const dartDir = join(ROOT, 'apps/client-app/lib/i18n');
  const serverDir = join(ROOT, 'apps/api/src/i18n');
  const ru = parse(readFileSync(join(dartDir, 'dict_ru.dart'), 'utf8'));
  const get = (k) => ru.get(k);
  for (const f of readdirSync(dartDir).sort()) {
    const code = f.match(/^dict_([a-z]{2})\.dart$/)?.[1];
    if (!code || code === 'ru' || SKIP.has(code)) continue;
    report(code, fixFile(join(dartDir, f), get));
  }
  for (const f of readdirSync(serverDir).sort()) {
    const code = f.match(/^client-([a-z]{2})\.ts$/)?.[1];
    if (!code || SKIP.has(code)) continue;
    report(code, fixFile(join(serverDir, f), get));
  }
}

/* ---------- Серверные строки ---------- */
console.log('\nСерверные строки');
{
  const dir = join(ROOT, 'apps/api/src/common');
  // Оригинал — сам ключ: словарь построен на русских строках
  for (const f of readdirSync(dir).filter((x) => /^locale-[a-z]{2}\.ts$/.test(x)).sort()) {
    const code = f.slice(7, 9);
    if (SKIP.has(code)) continue;
    report(code, fixFile(join(dir, f), (k) => k));
  }
}

console.log(total ? `\nВсего строк исправлено: ${total}` : '\nПравить нечего');
