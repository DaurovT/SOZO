/**
 * Доступ мастера к заявкам без воронки онбординга.
 *
 * Приложение мастера воронку больше не показывает: кого система не пропустила
 * сама, пропускает администратор кнопкой «Открыть доступ». Проверяем ровно те
 * границы, на которых это ломается незаметно:
 *
 *   · заведённый, но не допущенный мастер получает 403 с понятной причиной,
 *     а не пустой экран и не анкету;
 *   · «Открыть доступ» действительно открывает — карточка и лента дня отвечают;
 *   · «Закрыть доступ» закрывает и говорит, кто закрыл;
 *   · приложение получает телефон диспетчерской и период выплат — обе строки
 *     показываются мастеру и обе легко потерять при рефакторинге ответа.
 *
 *   node apps/api/test/master-access-e2e.mjs [http://localhost:3000]
 */

const ROOT = process.argv[2] ?? 'http://localhost:3000';
const BASE = `${ROOT}/v1`;
const ADMIN = '+998900000000';
const NEWBIE = '+998900000911';

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

const errCode = (b) => b?.code ?? b?.message?.code ?? '';
const errMessage = (b) => b?.message?.message ?? (typeof b?.message === 'string' ? b.message : '');

async function main() {
  const admin = await login(ADMIN);

  group('Мастер заведён, но доступ не открыт');
  const created = (
    await call('/admin/masters', {
      token: admin,
      body: { fullName: 'Новичок Тестов', phone: NEWBIE, skillTags: ['сантехника'], taxMode: 'self_employed' },
    })
  ).body;
  check('карточка создана', !!created.id, JSON.stringify(created).slice(0, 120));
  check('стартовый статус — кандидат', created.status === 'candidate', created.status);

  const newbie = await login(NEWBIE);
  const denied = await call('/master/me', { method: 'GET', token: newbie });
  check('лента закрыта с 403', denied.status === 403, `${denied.status}`);
  check('код причины — ACCESS_NOT_OPEN', errCode(denied.body) === 'ACCESS_NOT_OPEN', errCode(denied.body));
  check(
    'в тексте нет анкеты и экзамена — воронки в приложении нет',
    !/анкет|экзамен/i.test(errMessage(denied.body)),
    errMessage(denied.body),
  );

  group('Админ открывает доступ');
  const opened = await call(`/admin/masters/${created.id}/access`, { token: admin, body: { open: true } });
  check('эндпоинт ответил', opened.status === 200 || opened.status === 201, `${opened.status}`);
  check('статус стал active', opened.body.status === 'active', opened.body.status);

  const me = await call('/master/me', { method: 'GET', token: newbie });
  check('мастер видит свою карточку', me.status === 200, `${me.status}`);
  const today = await call('/master/today', { method: 'GET', token: newbie });
  check('лента дня открылась', today.status === 200, `${today.status}`);

  group('Приложению нужны телефон диспетчерской и период выплат');
  const cfg = (await call('/master/app-config?version=1.0.0', { method: 'GET', token: newbie })).body;
  check('в конфигурации есть телефон диспетчерской', /^\+?\d{9,}$/.test(String(cfg.dispatcherPhone ?? '')), String(cfg.dispatcherPhone));
  const wallet = (await call('/master/wallet', { method: 'GET', token: newbie })).body;
  check('кошелёк отвечает, когда будет выплата', !!wallet.payout?.scheduleText, JSON.stringify(wallet.payout ?? null));

  group('Админ закрывает доступ');
  const closed = await call(`/admin/masters/${created.id}/access`, { token: admin, body: { open: false, reason: 'проверка' } });
  check('статус стал blocked', closed.body.status === 'blocked', closed.body.status);
  const after = await call('/master/today', { method: 'GET', token: newbie });
  check('лента снова закрыта', after.status === 403, `${after.status}`);
  check('код причины — MASTER_BLOCKED', errCode(after.body) === 'MASTER_BLOCKED', errCode(after.body));

  // Аудит пишется мимо ответа (`void repo.write`) — journal важнее задержки,
  // поэтому запись появляется чуть позже отданного 200. Ждём её, а не гадаем
  let rows = [];
  for (let i = 0; i < 10; i++) {
    const audit = (await call('/admin/audit?action=master.access_closed', { method: 'GET', token: admin })).body;
    rows = Array.isArray(audit) ? audit : (audit.items ?? []);
    if (rows.some((r) => r.entityId === created.id)) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  check('закрытие доступа попало в аудит', rows.some((r) => r.entityId === created.id), `записей: ${rows.length}`);

  console.log(`\nПройдено: ${passed}, провалено: ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
