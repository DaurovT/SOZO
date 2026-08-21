/**
 * Сборка русского словаря лендинга из фрагментов `src/i18n/ru/*.ts`.
 *
 * Фрагменты — рабочий формат: строки вынимали из страниц по одной странице
 * за раз, и складывать их в общий файл значило бы драться за него. Итог —
 * один плоский `dict.ru.ts`: по нему переводят остальные девять языков и его
 * же читает сверялка `check-dicts.mjs`, которой нужен предсказуемый формат
 * «ключ: значение» по строке на пару.
 *
 * Запуск: node tools/build-ru-dict.mjs
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const SRC = join(ROOT, 'apps/landing/src/i18n/ru');
const OUT = join(ROOT, 'apps/landing/src/i18n/dict.ru.ts');

/** Фрагмент — обычный объектный литерал; читаем его как данные, а не как текст:
 *  значения переносятся на вторую строку, и регулярное выражение их потеряло бы */
function readFragment(path) {
  const text = readFileSync(path, 'utf8');
  const start = text.indexOf('{', text.indexOf('export const'));
  const end = text.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error(`${path}: не найден объект`);
  return new Function(`return (${text.slice(start, end + 1)})`)();
}

const files = readdirSync(SRC)
  .filter((f) => f.endsWith('.ts'))
  .sort();

const parts = [];
const seen = new Map();
let total = 0;

for (const f of files) {
  const obj = readFragment(join(SRC, f));
  const lines = [];
  for (const [k, v] of Object.entries(obj)) {
    if (seen.has(k)) throw new Error(`ключ '${k}' задан дважды: ${seen.get(k)} и ${f}`);
    seen.set(k, f);
    lines.push(`  '${k}': ${JSON.stringify(v)},`);
    total += 1;
  }
  parts.push(`  // ---------- ${f.replace(/\.ts$/, '')} ----------\n${lines.join('\n')}`);
}

const header = `/**
 * Русский словарь лендинга — язык-основа.
 *
 * Собирается скриптом \`tools/build-ru-dict.mjs\` из фрагментов
 * \`src/i18n/ru/*.ts\` (по файлу на страницу). Править руками этот файл
 * бессмысленно: следующая сборка сотрёт правку. Меняйте фрагмент.
 *
 * Остальные девять языков повторяют этот набор ключей ключ в ключ; пропуск
 * показывает русскую строку, а не пустоту (см. \`src/i18n/index.tsx\`).
 */
import type { Dict } from './index';

export const ruDict: Dict = {
`;

writeFileSync(OUT, `${header}${parts.join('\n\n')}\n};\n\nexport default ruDict;\n`);
console.log(`dict.ru.ts — ${total} ключей из ${files.length} фрагментов`);
