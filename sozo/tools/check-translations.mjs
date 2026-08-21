/**
 * Проверка качества переводов — то, чего не ловит сверка ключей.
 *
 * `check-dicts.mjs` отвечает на вопрос «все ли ключи на месте». Ключи могут
 * быть на месте все до одного, а страница при этом читаться как машинный
 * перевод: строка осталась русской, плейсхолдер прилип к слову, в файле
 * битые байты. Здесь ловим ровно это — и в лендинге, и в приложении, и в
 * серверных строках: писали их одни и те же руки, и ошибаются они одинаково.
 *
 * Запуск: node tools/check-translations.mjs
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALLOWED, PROPER_NAMES, TG_SAME_AS_RU } from './locale-exceptions.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const DIR = join(ROOT, 'apps/landing/src/i18n');

function parse(p) {
  const s = readFileSync(p, 'utf8');
  const out = new Map();
  const re = /^\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")\s*:\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")\s*,/gm;
  let m;
  while ((m = re.exec(s)) !== null) out.set(m[1] ?? m[2], (m[3] ?? m[4]).replace(/\\"/g, '"'));
  return out;
}

const ru = parse(join(DIR, 'dict.ru.ts'));

/** Кириллица допустима у таджикского: он на ней и пишется */
const CYR = /[А-Яа-яЁёІіЇїЄє]/;

/** Символ замены — след потерянной кодировки. В переводе ему взяться неоткуда */
const MOJIBAKE = /�/;

/**
 * Плейсхолдер, прилипший к букве.
 *
 * `{sum}сум` вместо `{sum} сум` — верный признак, что строку прогнали через
 * машинный перевод: он съедает пробелы вокруг непонятной ему скобки. На
 * странице это видно как «240000сум».
 */
function gluedHolders(ruVal, val, holders) {
  const bad = [];
  for (const m of val.matchAll(holders)) {
    const before = val[m.index - 1];
    const after = val[m.index + m[0].length];
    const ruAt = ruVal.indexOf(m[0]);
    if (ruAt < 0) continue;
    const ruBefore = ruVal[ruAt - 1];
    const ruAfter = ruVal[ruAt + m[0].length];
    // Сравниваем с оригиналом: если в русском вокруг был пробел, а здесь
    // буква — пробел потеряли. Языки без пробелов (zh, ko) сюда не попадают,
    // им отдельная поблажка ниже
    // Прилипшей считаем только букву или цифру. Знак вплотную — не ошибка:
    // по-турецки процент пишется перед числом («%{share}»), а по-китайски
    // вставка обычно и стоит без пробела
    const letter = /[\p{L}\p{N}]/u;
    if (before && letter.test(before) && ruBefore && /\s/.test(ruBefore)) bad.push(m[0]);
    else if (after && letter.test(after) && ruAfter && /\s/.test(ruAfter)) bad.push(m[0]);
  }
  return bad;
}

let failed = 0;

/**
 * Один набор словарей: эталон и переводы к нему.
 *
 * `holders` — вид плейсхолдера: на лендинге и в приложении это `{имя}`,
 * на сервере `{0}`. Разный синтаксис — разное регулярное выражение, иначе
 * серверные вставки просто не нашлись бы и проверка молчала бы впустую.
 */
function audit(title, base, entries, { holders }) {
  console.log(`\n${title}`);
  for (const { code, dict } of entries) {
    const cyrillicOk = code === 'tg';
    // В китайском и корейском пробелов вокруг вставок нет по правилам письма
    const spacingOk = code === 'zh' || code === 'ko';

    const same = [];
    const cyr = [];
    const moji = [];
    const glued = [];

    for (const [k, v] of dict) {
      const orig = base.get(k);
      if (orig === undefined) continue;
      if (ALLOWED.has(k)) continue;
      // Имя собственное или таджикское заимствование, совпавшее с оригиналом, —
      // верный перевод, а не пропущенный. Битые байты в них ловим по-прежнему
      const sameByDesign = PROPER_NAMES.test(k) || (code === 'tg' && TG_SAME_AS_RU.has(k));
      if (v === orig && CYR.test(orig) && !sameByDesign) same.push(k);
      else if (v === orig && CYR.test(orig)) { /* совпало по делу */ }
      else if (!cyrillicOk && CYR.test(v)) cyr.push(k);
      if (MOJIBAKE.test(v)) moji.push(k);
      if (!spacingOk && gluedHolders(orig, v, holders).length) glued.push(k);
    }

    const problems = [];
    if (same.length) problems.push(`${same.length} строк остались русскими (${same.slice(0, 3).join(', ')})`);
    if (cyr.length) problems.push(`${cyr.length} строк с кириллицей (${cyr.slice(0, 3).join(', ')})`);
    if (moji.length) problems.push(`${moji.length} строк с битыми байтами (${moji.slice(0, 3).join(', ')})`);
    if (glued.length) problems.push(`${glued.length} строк с прилипшим плейсхолдером (${glued.slice(0, 3).join(', ')})`);

    if (problems.length) {
      failed += 1;
      console.log(`  ✗ ${code}`);
      for (const p of problems) console.log(`      ${p}`);
    } else {
      console.log(`  ✓ ${code} — ${dict.size} строк`);
    }
  }
}

const NAMED = /\{[a-zA-Z][\w]*\}/g;
const NUMBERED = /\{\d+\}/g;

/* ---------- Лендинг ---------- */
audit(
  'Лендинг',
  ru,
  readdirSync(join(DIR, 'locales'))
    .filter((f) => /^[a-z]{2}\.ts$/.test(f))
    .sort()
    .map((f) => ({ code: f.slice(0, 2), dict: parse(join(DIR, 'locales', f)) })),
  { holders: NAMED },
);

/* ---------- Приложение «Клиент» ---------- */
{
  const dartDir = join(ROOT, 'apps/client-app/lib/i18n');
  const serverDir = join(ROOT, 'apps/api/src/i18n');
  const base = parse(join(dartDir, 'dict_ru.dart'));
  const entries = [];
  for (const f of readdirSync(dartDir).sort()) {
    const code = f.match(/^dict_([a-z]{2})\.dart$/)?.[1];
    if (code && code !== 'ru') entries.push({ code, dict: parse(join(dartDir, f)) });
  }
  for (const f of readdirSync(serverDir).sort()) {
    const code = f.match(/^client-([a-z]{2})\.ts$/)?.[1];
    if (code) entries.push({ code, dict: parse(join(serverDir, f)) });
  }
  audit('Приложение «Клиент»', base, entries, { holders: NAMED });
}

/* ---------- Серверные строки ---------- */
{
  const dir = join(ROOT, 'apps/api/src/common');
  // Ключ здесь — сама русская строка, поэтому эталон строится из ключей
  const entries = [];
  for (const f of readdirSync(dir).filter((x) => /^locale-[a-z]{2}\.ts$/.test(x)).sort()) {
    entries.push({ code: f.slice(7, 9), dict: parse(join(dir, f)) });
  }
  const base = new Map();
  for (const e of entries) for (const k of e.dict.keys()) base.set(k, k);
  audit('Серверные строки', base, entries, { holders: NUMBERED });
}

console.log(failed ? `\nСловарей с замечаниями: ${failed}` : '\nЗамечаний нет');
process.exit(failed ? 1 : 0);
