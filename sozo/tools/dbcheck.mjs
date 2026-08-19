/**
 * Проверка схемы и миграций на настоящем PostgreSQL без установки сервера (PGlite, WASM).
 * Проверяем не «применяется ли SQL», а то, что инварианты БД реально держат:
 * изоляция арендаторов через RLS и CHECK-и, которые в коде продублированы и потому
 * могут разойтись с базой незаметно.
 *
 * Запуск: node tools/dbcheck.mjs
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, existsSync } from 'node:fs';

let passed = 0, failed = 0;
const fails = [];
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
async function fails_with(db, sql, params = []) {
  try { await db.query(sql, params); return null; } catch (e) { return e.message; }
}

const db = await PGlite.create();
console.log(`\nПроверка БД на ${(await db.query('select version()')).rows[0].version.split(',')[0]}\n${'='.repeat(60)}`);

console.log('\n1. Применение миграций');
await db.exec(readFileSync('prisma/migrations/000_init/migration.sql', 'utf8'));
const tables = (await db.query(`select count(*)::int n from information_schema.tables where table_schema='public'`)).rows[0].n;
check('структурная миграция применилась', tables >= 37, `${tables} таблиц`);

await db.exec(readFileSync('prisma/migrations/m7_buildings_rls/migration.sql', 'utf8'));
const pol = (await db.query('select count(*)::int n from pg_policies')).rows[0].n;
const rlsOn = (await db.query('select count(*)::int n from pg_class where relrowsecurity')).rows[0].n;
check('политики RLS созданы', pol >= 15, `${pol} политик`);
check('RLS включён на таблицах контура', rlsOn >= 15, `${rlsOn} таблиц`);

const exclPath = 'prisma/migrations/m7_shutdown_exclusion/migration.sql';
let exclApplied = false;
if (existsSync(exclPath)) {
  try { await db.exec(readFileSync(exclPath, 'utf8')); exclApplied = true; } catch { /* нет btree_gist */ }
}
console.log(exclApplied
  ? '  ✓ exclusion-ограничение на стояки применено'
  : '  · exclusion на стояки пропущен: в PGlite нет btree_gist — в проде применяется отдельной миграцией');

console.log('\n2. Инварианты DEV-02 §4.4');
const T = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
await db.query(`insert into building (id,tenant_id,city_id,name,address,connection_status,service_fee_bps,updated_at)
                values ($1,$2,$3,'Тест','Адрес','unmanaged',500,now())`, [B, T, T]);

check('п.14: ставка сбора выше 10% отклоняется',
  Boolean(await fails_with(db, `update building set service_fee_bps=1500 where id=$1`, [B])));
check('п.14: ставка в границах принимается',
  !(await fails_with(db, `update building set service_fee_bps=700 where id=$1`, [B])));
check('п.10: active без аварийного телефона отклоняется',
  Boolean(await fails_with(db, `update building set connection_status='active' where id=$1`, [B])));
await db.query(`update building set emergency_phone='+998711234567' where id=$1`, [B]);
check('п.10: active с телефоном принимается',
  !(await fails_with(db, `update building set connection_status='active' where id=$1`, [B])));

const REL = '33333333-3333-3333-3333-333333333333';
await db.query(`insert into price_list_release (id,tenant_id,number,status,updated_at) values ($1,$2,1,'active',now())`, [REL, T]);
const insOrder = (scope, fee) => db.query(
  `insert into "order" (id,tenant_id,number,type,payment_channel,price_list_release_id,order_scope,service_fee_tiyin,updated_at)
   values ($1,$2,$3,'b2c','online',$4,$5,$6,now())`,
  [crypto.randomUUID(), T, 'Z-' + Math.random().toString(36).slice(2, 8), REL, scope, fee]);

check('п.7: сбор на общем имуществе отклоняется',
  Boolean(await insOrder('common_area', 5000).then(() => null).catch((e) => e.message)));
check('п.7: общее имущество с нулевым сбором принимается',
  await insOrder('common_area', 0).then(() => true).catch(() => false));
check('п.7: сбор на частной заявке принимается',
  await insOrder('private', 5000).then(() => true).catch(() => false));

console.log('\n3. Изоляция арендаторов (RLS)');
await db.exec(`
  create role app_user nologin;
  grant usage on schema public to app_user;
  grant select, insert, update on all tables in schema public to app_user;
`);
const OP1 = '44444444-4444-4444-4444-444444444444';
const OP2 = '55555555-5555-5555-5555-555555555555';
for (const [id, name] of [[OP1, 'УК Сокол'], [OP2, 'УК Чинор']]) {
  await db.query(
    `insert into organization (id,tenant_id,name,inn,contract_type,updated_at) values ($1,$2,$3,$4,'subscription',now())`,
    [id, T, name, id.slice(0, 9)],
  );
}
await db.query(`update building set operator_org_id=$1 where id=$2`, [OP1, B]);

// SET LOCAL действует ТОЛЬКО внутри транзакции — ровно поэтому пулер обязан работать
// в transaction mode (DEV-07 §8 п.4). Здесь это проверяется, а не предполагается.
async function countAs(role, orgId) {
  await db.exec('begin');
  await db.exec(`set local role app_user`);
  await db.exec(`set local app.tenant_id = '${T}'`);
  await db.exec(`set local app.operator_org_id = '${orgId}'`);
  await db.exec(`set local app.role = '${role}'`);
  const r = await db.query('select count(*)::int n from building');
  await db.exec('commit');
  return r.rows[0].n;
}
const own = await countAs('operator', OP1);
const foreign = await countAs('operator', OP2);
const platform = await countAs('platform_admin', '');

check('оператор видит свой объект', own === 1, `видно ${own}`);
check('чужой оператор не видит объект', foreign === 0, `видно ${foreign}`);
check('роль платформы видит объект', platform === 1, `видно ${platform}`);

console.log(`\n${'='.repeat(60)}`);
console.log(`Пройдено: ${passed}   Провалено: ${failed}`);
if (failed) { console.log('\nНе прошло:'); fails.forEach(f => console.log('  · ' + f)); }
process.exit(failed ? 1 : 0);
