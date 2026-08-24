/**
 * Презентация на трёх языках: ключи разметки и словарей обязаны совпадать.
 *
 * Русский текст живёт в самой разметке `apps/deck/index.html`, узбекский и
 * английский — в `apps/deck/i18n.js`. Это удобно для правки и опасно для
 * расхождения: добавил абзац по-русски перед встречей — и на двух других
 * языках его просто нет, а заметит это гость на экране.
 *
 * Поэтому проверка сравнивает три набора ключей и падает на любом перекосе:
 *   · ключ есть в разметке, но нет в словаре — непереведённый кусок;
 *   · ключ есть в словаре, но нет в разметке — мёртвый перевод;
 *   · значение пустое — забытая строка, которая выглядит как дыра.
 *
 * Ещё проверяется разметка внутри значений: если по-русски в строке есть
 * <strong> или <span class="mark">, а в переводе его нет, перевод потеряет
 * выделение — на слайде это видно сразу, в словаре нет.
 *
 *   node tools/check-deck.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'apps/deck/index.html'), 'utf8');
const dictSrc = readFileSync(join(root, 'apps/deck/i18n.js'), 'utf8');

const window = {};
new Function('window', dictSrc)(window);
const DICT = window.DECK_I18N;

let failed = 0;
const bad = (msg) => { failed += 1; console.log(`  ✗ ${msg}`); };
const ok = (msg) => console.log(`  ✓ ${msg}`);

/** Ключи и русские значения прямо из разметки — источник правды */
const RU = {};
const attrs = [
  ['data-t', (tag, key) => innerOf(tag, key)],
  ['data-t-alt', (tag) => attrValue(tag, 'alt')],
  ['data-t-label', (tag) => attrValue(tag, 'data-label')],
  ['data-t-content', (tag) => attrValue(tag, 'content')],
];
function attrValue(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? m[1] : '';
}
function innerOf(tag, key) {
  const at = html.indexOf(tag);
  const name = tag.match(/^<(\w+)/)[1];
  let i = at + tag.length, depth = 1;
  const re = new RegExp(`</?${name}\\b`, 'g');
  re.lastIndex = i;
  let m;
  while ((m = re.exec(html))) {
    if (html[m.index + 1] === '/') depth -= 1; else depth += 1;
    if (depth === 0) return html.slice(i, m.index).replace(/\s+/g, ' ').trim();
  }
  return '';
}
for (const [attr, read] of attrs) {
  for (const m of html.matchAll(new RegExp(`<\\w+[^>]*\\b${attr}="([^"]+)"[^>]*>`, 'g'))) {
    RU[m[1]] = read(m[0], m[1]);
  }
}
RU['meta.title'] = (html.match(/<title>([^<]*)<\/title>/) || [, ''])[1];

console.log(`Презентация (apps/deck)\n  эталон — разметка index.html: ${Object.keys(RU).length} ключей`);

const empty = Object.entries(RU).filter(([, v]) => !v.trim()).map(([k]) => k);
if (empty.length) bad(`в разметке пустые значения: ${empty.join(', ')}`);

for (const code of Object.keys(DICT)) {
  const d = DICT[code];
  const missing = Object.keys(RU).filter((k) => d[k] == null);
  const extra = Object.keys(d).filter((k) => RU[k] == null);
  const blank = Object.keys(d).filter((k) => !String(d[k]).trim());
  // Разметка внутри строки: потерянный <strong> не ломает страницу, но
  // убирает акцент ровно там, где он поставлен намеренно
  const tagless = Object.keys(d).filter((k) => {
    const src = RU[k] || '';
    if (!/<(strong|span|br)\b/.test(src)) return false;
    const need = (src.match(/<(strong|span|br)\b/g) || []).length;
    const have = (String(d[k]).match(/<(strong|span|br)\b/g) || []).length;
    return need !== have;
  });

  if (missing.length) bad(`${code}: нет ${missing.length} ключей — ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ' …' : ''}`);
  if (extra.length) bad(`${code}: лишние ключи (${extra.length}) — ${extra.slice(0, 5).join(', ')}${extra.length > 5 ? ' …' : ''}`);
  if (blank.length) bad(`${code}: пустые строки — ${blank.join(', ')}`);
  if (tagless.length) bad(`${code}: потеряна разметка в значениях — ${tagless.join(', ')}`);
  if (!missing.length && !extra.length && !blank.length && !tagless.length) {
    ok(`${code} — ${Object.keys(d).length} ключей`);
  }
}

console.log(`\nПроблем: ${failed}`);
process.exit(failed ? 1 : 0);
