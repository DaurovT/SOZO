/**
 * Офлайн-очередь мастера: что сервер умеет принять и что делает с цепочкой.
 *
 * Две вещи, которые в проекте не проверял никто, и обе стоили мастеру дня
 * работы:
 *
 *   · **виды операций.** Экраны кладут в очередь два десятка видов, а
 *     `/master/sync` знал восемь. Остальное получало `KIND_UNKNOWN`, вставало
 *     с ошибкой и глушило всю дальнейшую цепочку по заявке — а единственной
 *     кнопкой в приложении было «убрать из очереди», то есть удалить данные.
 *     Проверка статическая: читаем `outbox.enqueue(kind: '…')` прямо из
 *     исходников приложения и сверяем со списком контроллера. Пять строк,
 *     которые ловят расхождение навсегда — включая то, которое появится
 *     завтра вместе с новым экраном;
 *
 *   · **цепочка с протухшей версией.** Офлайн заявка не обновляется — ответа
 *     нет, — поэтому «Выехал», «Начал» и «Завершил» несут ОДИН номер версии.
 *     Раньше применялось первое, второе падало конфликтом версий, третье
 *     пропускалось как заблокированное. Проверяем, что доезжают все три.
 *
 *   node apps/api/test/master-sync-e2e.mjs [http://localhost:3000]
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.argv[2] ?? 'http://localhost:3000';
const BASE = `${ROOT}/v1`;
const ADMIN = '+998900000000';
const MASTER = '+998900000777';

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
};
const group = (t) => console.log(`\n${t}`);

async function call(path, { method = 'POST', body, token } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {} };
}

async function login(phone) {
  await call('/auth/request-otp', { body: { phone } });
  return (await call('/auth/verify', { body: { phone, code: '00000' } })).body.accessToken;
}

const PIXEL_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/**
 * Виды, которые приложение кладёт в очередь — читаем из его исходников.
 *
 * Шаблоны раскрываются по источникам значений, а не сворачиваются в
 * «префикс со звёздочкой»: два вида собираются интерполяцией, и проверка
 * «есть хоть что-то с этим префиксом» пропускает ровно тот случай, ради
 * которого писалась — `branch_noAccess` прошёл бы мимо, потому что рядом
 * есть `branch_unsafe`. `branch_${kind.name}` даёт четыре имени по
 * `enum BranchKind`, `permit_$action` — два по действиям наряда.
 */
function kindsFromApp() {
  const dir = join(HERE, '../../master-app/lib/screens');
  const files = readdirSync(dir).filter((x) => x.endsWith('.dart'));
  const read = (f) => readFileSync(join(dir, f), 'utf8');
  const kinds = new Set();

  // Значения enum BranchKind — источник имён для 'branch_${widget.kind.name}'
  const branchEnum = /enum\s+BranchKind\s*\{([^}]*)\}/.exec(read('branch_screens.dart'));
  const branchKinds = branchEnum ? branchEnum[1].split(',').map((x) => x.trim()).filter(Boolean) : [];

  for (const f of files) {
    const src = read(f);
    // Литералы: kind: 'photo'
    for (const m of src.matchAll(/kind:\s*'([A-Za-z_]+)'/g)) kinds.add(m[1]);
    // Тернарные: kind: started ? 'shutdown_restore' : 'shutdown_start'
    for (const m of src.matchAll(/kind:\s*[^,\n]*\?\s*'([A-Za-z_]+)'\s*:\s*'([A-Za-z_]+)'/g)) {
      kinds.add(m[1]);
      kinds.add(m[2]);
    }
    // Интерполяции: раскрываем известные шаблоны поимённо
    for (const m of src.matchAll(/kind:\s*'([a-z_]+)_\$\{?([^'}]+)\}?'/g)) {
      const prefix = m[1];
      const expr = m[2];
      if (expr.includes('kind.name')) for (const k of branchKinds) kinds.add(`${prefix}_${k}`);
      else if (expr.includes('action')) for (const a of ['open', 'close']) kinds.add(`${prefix}_${a}`);
      else kinds.add(`${prefix}_?`); // незнакомый шаблон — пусть проверка покраснеет
    }
  }
  return kinds;
}

/** Мастер для прогона: заводим один раз, доступ открывает админ */
async function ensureMaster(admin) {
  const masters = (await call('/dispatch/masters', { method: 'GET', token: admin })).body;
  let m = (Array.isArray(masters) ? masters : []).find((x) => x.phone === MASTER);
  if (!m) {
    m = (await call('/admin/masters', { token: admin, body: { fullName: 'Мастер офлайн', phone: MASTER, taxMode: 'gph' } })).body;
    await call(`/admin/masters/${m.id}/access`, { token: admin, body: { open: true } });
  }
  masterId = m.id;
  return login(MASTER);
}

let masterId = '';

async function main() {
  const admin = await login(ADMIN);

  group('Виды очереди приложения совпадают со списком сервера');
  const masterToken = await ensureMaster(admin);
  const serverKinds = new Set((await call('/master/sync-kinds', { method: 'GET', token: masterToken })).body.kinds ?? []);
  check('сервер отдаёт список видов', serverKinds.size > 0, `видов: ${serverKinds.size}`);
  const appKinds = kindsFromApp();
  check('в исходниках приложения виды нашлись', appKinds.size > 0, `видов: ${appKinds.size}`);
  const missing = [...appKinds].filter((k) => !serverKinds.has(k));
  check(
    'сервер знает все виды, которые кладёт приложение',
    missing.length === 0,
    missing.length ? `не знает: ${missing.join(', ')}` : '',
  );

  group('Офлайн-цепочка по одной заявке доезжает целиком');
  const items = (await call('/dispatch/price-items', { method: 'GET', token: admin })).body.items ?? [];
  const order = (
    await call('/dispatch/orders', {
      token: admin,
      body: {
        clientPhone: '+998901234511',
        clientName: 'Клиент офлайн',
        address: 'Ташкент, офлайн-синк',
        description: 'Цепочка из подвала',
        items: items[0] ? [{ priceItemId: items[0].id, qty: 1 }] : [],
      },
    })
  ).body;
  const m = { id: masterId };
  const step = async (action, extra = {}) => {
    const v = (await call(`/dispatch/orders/${order.id}`, { method: 'GET', token: admin })).body.version;
    return call(`/dispatch/orders/${order.id}/transitions`, { token: admin, body: { action, version: v, ...extra } });
  };
  await step('estimate');
  await step('assign', { masterId: m.id });
  const staleVersion = (await call(`/dispatch/orders/${order.id}`, { method: 'GET', token: admin })).body.version;

  /**
   * Порядок как в жизни: мастер отметил задержку, выехал, снял фото, начал.
   * Все четыре операции несут ОДНУ версию — ту, что была в момент постановки
   * в очередь, потому что офлайн обновить её неоткуда.
   */
  const ops = [
    { clientOpUuid: randomUUID(), orderId: order.id, kind: 'delay', payload: { minutes: 30 }, deviceTime: new Date().toISOString() },
    { clientOpUuid: randomUUID(), orderId: order.id, kind: 'action', payload: { action: 'depart', version: staleVersion }, deviceTime: new Date().toISOString() },
    { clientOpUuid: randomUUID(), orderId: order.id, kind: 'photo', payload: { stage: 'before', data: PIXEL_PNG }, deviceTime: new Date().toISOString() },
    { clientOpUuid: randomUUID(), orderId: order.id, kind: 'action', payload: { action: 'start', version: staleVersion }, deviceTime: new Date().toISOString() },
  ];
  const sync = await call('/master/sync', { token: masterToken, body: { ops } });
  const byUuid = new Map((sync.body.results ?? []).map((r) => [r.clientOpUuid, r]));
  check('«Задерживаюсь» применён, а не KIND_UNKNOWN', byUuid.get(ops[0].clientOpUuid)?.status === 'applied', JSON.stringify(byUuid.get(ops[0].clientOpUuid)));
  check('«Выехал» применён', byUuid.get(ops[1].clientOpUuid)?.status === 'applied', JSON.stringify(byUuid.get(ops[1].clientOpUuid)));
  check('фото принято ключом data', byUuid.get(ops[2].clientOpUuid)?.status === 'applied', JSON.stringify(byUuid.get(ops[2].clientOpUuid)));
  check(
    '«Начал» применён на той же протухшей версии',
    byUuid.get(ops[3].clientOpUuid)?.status === 'applied',
    JSON.stringify(byUuid.get(ops[3].clientOpUuid)),
  );
  const afterChain = (await call(`/dispatch/orders/${order.id}`, { method: 'GET', token: admin })).body;
  check('заявка доехала до «В работе»', afterChain.status === 'in_progress', afterChain.status);

  group('Повторная выгрузка того же пакета ничего не задваивает');
  const again = await call('/master/sync', { token: masterToken, body: { ops } });
  const dup = (again.body.results ?? []).filter((r) => r.status === 'duplicate').length;
  check('все операции опознаны как повтор', dup === ops.length, `повторов: ${dup} из ${ops.length}`);
  const afterRepeat = (await call(`/dispatch/orders/${order.id}`, { method: 'GET', token: admin })).body;
  check('версия заявки не выросла от повтора', afterRepeat.version === afterChain.version, `${afterChain.version} → ${afterRepeat.version}`);
  check(
    'второго снимка «до» не появилось',
    afterRepeat.photos.filter((p) => p.stage === 'before').length === 1,
    String(afterRepeat.photos.filter((p) => p.stage === 'before').length),
  );

  console.log(`\nПройдено: ${passed}, провалено: ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
