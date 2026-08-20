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

const url = process.env.DATABASE_URL ?? 'postgresql://sozo:sozo@127.0.0.1:5432/sozo';
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

console.log(`\n${'='.repeat(60)}\nПройдено: ${passed}   Провалено: ${failed}`);
await prisma.$disconnect();
process.exit(failed ? 1 : 0);
