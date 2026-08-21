/**
 * Перенос словарей приложения «Клиент» на сервер.
 *
 * Русский, узбекский и английский остаются в сборке приложения — это языки
 * Ташкента, и человек, открывший приложение впервые, должен увидеть его на
 * своём языке сразу, без сети. Остальные семь весят вместе больше самого
 * приложения и нужны единицам, поэтому лежат на сервере и приезжают по
 * требованию (см. `L10n.set` и `lib/i18n.dart`).
 *
 * Скрипт разовый: он перевёл готовые `dict_*.dart` в модули сервера. Держим
 * его в репозитории, чтобы следующий язык добавлялся тем же путём, а не
 * переписыванием восьми тысяч строк руками.
 *
 * Запуск: node tools/build-client-locales.mjs
 */
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const DART = join(ROOT, 'apps/client-app/lib/i18n');
const OUT = join(ROOT, 'apps/api/src/i18n');

/** Языки, которые приезжают с сервера. ru/uz/en остаются в приложении. */
const REMOTE = ['tr', 'tg', 'ar', 'fr', 'de', 'zh', 'ko'];

const NAMES = {
  tr: 'Турецкий',
  tg: 'Таджикский',
  ar: 'Арабский',
  fr: 'Французский',
  de: 'Немецкий',
  zh: 'Китайский',
  ko: 'Корейский',
};

/** `'ключ': "значение",` — с учётом экранирования в обоих видах кавычек */
function parseDart(text) {
  const out = {};
  const re = /^\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")\s*:\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")\s*,/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    const key = m[1] ?? m[2];
    // Dart-экранирование снимаем: в JSON доллар и кавычки живут по своим правилам
    const raw = m[3] ?? m[4];
    out[key] = raw
      .replace(/\\\$/g, '$')
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/\\n/g, '\n')
      .replace(/\\\\/g, '\\');
  }
  return out;
}

let moved = 0;
for (const code of REMOTE) {
  const src = join(DART, `dict_${code}.dart`);
  if (!existsSync(src)) {
    console.log(`  · dict_${code}.dart уже перенесён`);
    continue;
  }
  const dict = parseDart(readFileSync(src, 'utf8'));
  const count = Object.keys(dict).length;
  if (!count) throw new Error(`dict_${code}.dart пуст — перенос отменён`);

  const body = Object.entries(dict)
    .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
    .join('\n');

  writeFileSync(
    join(OUT, `client-${code}.ts`),
    `/**
 * ${NAMES[code]} словарь приложения «Клиент» — ${count} строк.
 *
 * Живёт на сервере, а не в приложении: язык редкий, и держать его в каждой
 * установке ради единиц людей значит утяжелять сборку для всех остальных.
 * Приложение скачивает словарь при выборе языка и кладёт в свой кеш.
 *
 * Ключи — те же, что в \`apps/client-app/lib/i18n/dict_ru.dart\`. Пропущенный
 * ключ приложение покажет по-русски, а не пустотой.
 */
export const CLIENT_${code.toUpperCase()}: Record<string, string> = {
${body}
};
`,
  );
  unlinkSync(src);
  moved += 1;
  console.log(`  ✓ client-${code}.ts — ${count} строк, dict_${code}.dart удалён`);
}

console.log(moved ? `Перенесено языков: ${moved}` : 'Переносить нечего');
