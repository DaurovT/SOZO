/**
 * Проверка контекста RLS со стороны приложения.
 *
 * `SET LOCAL` живёт только внутри транзакции. Ошибиться здесь легко и дорого:
 * забытая транзакция не падает, а возвращает пустой результат — то есть
 * пользователь видит не чужие данные, а никаких, и это выглядит как баг
 * выборки, а не как дыра в изоляции. Поэтому семантику проверяем явно.
 *
 * Запуск: npm run db:up && npm run db:check:rls
 */
import { PrismaClient } from '@prisma/client';

// По умолчанию — роль приложения, а не владельца: владелец суперпользователь
// и обходит RLS, поэтому проверка под ним показывала бы изоляцию там, где её
// нет. Именно так дыра и прожила до сих пор
const url = process.env.DATABASE_URL ?? 'postgresql://sozo_app:sozo_app@127.0.0.1:5432/sozo';
const prisma = new PrismaClient({ datasources: { db: { url } } });

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

const TENANT = '00000000-0000-0000-0000-000000000001';

console.log(`\nКонтекст RLS: ${url.replace(/:\/\/.*@/, '://***@')}\n${'='.repeat(60)}\n`);

// 1. Внутри транзакции контекст виден
const inside = await prisma.$transaction(async (tx) => {
  await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${TENANT}'`);
  await tx.$executeRawUnsafe(`SET LOCAL app.role = 'operator'`);
  const r = await tx.$queryRawUnsafe(
    `SELECT current_setting('app.tenant_id', true) AS t, current_setting('app.role', true) AS r`,
  );
  return r[0];
});
check('внутри транзакции tenant_id виден', inside.t === TENANT, String(inside.t));
check('внутри транзакции роль видна', inside.r === 'operator', String(inside.r));

// 2. Снаружи — уже нет: соединение вернулось в пул чистым
const outside = await prisma.$queryRawUnsafe(
  `SELECT current_setting('app.tenant_id', true) AS t`,
);
check(
  'после транзакции контекст не протекает в следующий запрос',
  !outside[0].t,
  `осталось: ${JSON.stringify(outside[0].t)}`,
);

// 3. Две транзакции подряд не видят контекст друг друга
const second = await prisma.$transaction(async (tx) => {
  const r = await tx.$queryRawUnsafe(`SELECT current_setting('app.tenant_id', true) AS t`);
  return r[0];
});
check('новая транзакция начинается с пустым контекстом', !second.t, `осталось: ${JSON.stringify(second.t)}`);

// ---------------------------------------------------------------------------
// 4. Изоляция арендаторов на самом деле, а не на словах.
//
// Проверки выше говорят только о том, что контекст живёт внутри транзакции.
// Это не то же самое, что «чужие строки не видны»: политика может быть
// не создана вовсе, и все три проверки останутся зелёными. Обнаружилось
// ровно так — политики стояли на пятнадцати таблицах из ста пятнадцати,
// а документация говорила про изоляцию всей схемы.
//
// Поэтому здесь пишутся строки от имени двух арендаторов и проверяется, что
// каждый видит только своё. Проверяются три уровня вложенности: таблица со
// своим tenant_id, дочерняя (арендатор у родителя) и внучатая (два перехода).
// ---------------------------------------------------------------------------

const OTHER = '00000000-0000-0000-0000-0000000000ff';
const uuid = () => crypto.randomUUID();

async function asTenant(tenant, fn) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenant}'`);
    await tx.$executeRawUnsafe(`SET LOCAL app.role = 'platform'`);
    return fn(tx);
  });
}

const ids = { a: {}, b: {} };
for (const [key, tenant] of [['a', TENANT], ['b', OTHER]]) {
  ids[key] = { offer: uuid(), variant: uuid(), line: uuid() };
  await asTenant(tenant, async (tx) => {
    await tx.$executeRawUnsafe(
      `INSERT INTO addwork_offer (id, tenant_id, order_id, master_id, photo_count, status, created_at)
       VALUES ('${ids[key].offer}', '${tenant}', '${uuid()}', 'm-rls', 1, 'sent', now())`,
    );
    await tx.$executeRawUnsafe(
      `INSERT INTO addwork_variant (id, offer_id, kind, title, total_tiyin)
       VALUES ('${ids[key].variant}', '${ids[key].offer}', 'minimal', 'проверка', 1000)`,
    );
    await tx.$executeRawUnsafe(
      `INSERT INTO addwork_line (id, variant_id, name, amount_tiyin, qty)
       VALUES ('${ids[key].line}', '${ids[key].variant}', 'строка', 1000, 1)`,
    );
  });
}

const seen = await asTenant(TENANT, async (tx) => ({
  offers: await tx.$queryRawUnsafe(`SELECT id FROM addwork_offer WHERE id IN ('${ids.a.offer}', '${ids.b.offer}')`),
  variants: await tx.$queryRawUnsafe(`SELECT id FROM addwork_variant WHERE id IN ('${ids.a.variant}', '${ids.b.variant}')`),
  lines: await tx.$queryRawUnsafe(`SELECT id FROM addwork_line WHERE id IN ('${ids.a.line}', '${ids.b.line}')`),
}));

check('свою строку арендатор видит', seen.offers.some((r) => r.id === ids.a.offer));
check('чужую — нет', !seen.offers.some((r) => r.id === ids.b.offer), 'видна чужая запись');
check('дочерняя таблица закрыта арендатором родителя', seen.variants.length === 1 && seen.variants[0].id === ids.a.variant,
  JSON.stringify(seen.variants));
check('внучатая тоже — через два перехода', seen.lines.length === 1 && seen.lines[0].id === ids.a.line,
  JSON.stringify(seen.lines));

// Запись под чужим арендатором должна быть отбита, а не записана молча
let blocked = false;
try {
  await asTenant(TENANT, async (tx) => {
    await tx.$executeRawUnsafe(
      `INSERT INTO addwork_offer (id, tenant_id, order_id, master_id, photo_count, status, created_at)
       VALUES ('${uuid()}', '${OTHER}', '${uuid()}', 'm-rls', 1, 'sent', now())`,
    );
  });
} catch {
  blocked = true;
}
check('запись под чужого арендатора отбита', blocked, 'строка записалась');

// Уборка: тестовые строки не должны остаться в базе разработчика
for (const [, tenant] of [['a', TENANT], ['b', OTHER]]) {
  await asTenant(tenant, async (tx) => {
    await tx.$executeRawUnsafe(`DELETE FROM addwork_offer WHERE master_id = 'm-rls'`);
  });
}

// Проверка охвата: таблица без политики — это не «пока не дошли руки», а
// дыра, которая не проявляет себя, пока арендатор один
const uncovered = await prisma.$queryRawUnsafe(`
  SELECT c.relname AS t FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
`);
check('политики стоят на всех таблицах', uncovered.length === 0, uncovered.map((r) => r.t).join(', '));

console.log(`\n${'='.repeat(60)}\nПройдено: ${passed}   Провалено: ${failed}`);
await prisma.$disconnect();
process.exit(failed ? 1 : 0);
