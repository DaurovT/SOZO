/**
 * Сквозной прогон веб-карточки заявки (W-01…W-05).
 *
 * Проверяет путь телефонного клиента: получил SMS → открыл ссылку → увидел
 * статус → подтвердил стоимость → дождался работы → оплатил → оценил.
 * Отдельно проверяется то, ради чего карточка вообще закрыта токеном:
 * чужой и просроченный код не должны раскрывать ничего.
 *
 * Запуск: node apps/api/test/web-card-e2e.mjs [http://localhost:3000]
 */

const ROOT = process.argv[2] ?? 'http://localhost:3000';
const BASE = `${ROOT}/v1`;
const CLIENT = '+998900000911';
const DISPATCHER = '+998900000002';

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function group(title) {
  console.log(`\n${title}`);
}

async function call(path, { method, body, token } = {}) {
  const res = await fetch(BASE + path, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {} };
}

/** Страница веб-карточки: обычный HTML, читаем как текст */
async function web(path) {
  const res = await fetch(ROOT + path, { redirect: 'manual' });
  return { status: res.status, html: await res.text() };
}

/** Отправка формы — так же, как это делает браузер без JS */
async function submit(path, fields) {
  const res = await fetch(ROOT + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });
  return { status: res.status, html: await res.text() };
}

async function login(phone) {
  await call('/auth/request-otp', { body: { phone } });
  const r = await call('/auth/verify', { body: { phone, code: '00000' } });
  return r.body.accessToken;
}

async function transition(token, orderId, action, payload = {}) {
  const cur = await call(`/dispatch/orders/${orderId}`, { token });
  return call(`/dispatch/orders/${orderId}/transitions`, {
    token,
    body: { action, version: cur.body.version, payload },
  });
}

async function main() {
  console.log(`Сквозной прогон веб-карточки → ${ROOT}`);

  const D = await login(DISPATCHER);
  const T = await login(CLIENT);

  // Заявку заводим от лица клиента: телефонную создаёт диспетчер, но нам
  // важна сама карточка, а не канал появления заявки
  const catalog = await call('/app/catalog', { token: T });
  const item = (catalog.body.categories ?? []).flatMap((c) => c.items).find((i) => i.priceFromTiyin > 0);
  const created = await call('/app/orders', {
    token: T,
    body: { items: [{ priceItemId: item.id, qty: 1 }], address: 'ул. Навои 12', timeMode: 'waitlist' },
  });
  const orderId = created.body.id;
  check('заявка создана', !!orderId, JSON.stringify(created.body).slice(0, 120));

  // ------------------------------------------------------------- ссылка
  group('Ссылка для SMS');

  const issued = await call(`/dispatch/web-card/${orderId}`, { token: D, body: {} });
  const code = issued.body.code;
  check('диспетчер выдаёт короткий код', /^[A-Z2-9]{8}$/.test(code ?? ''), `${code}`);
  check('ссылка помещается в одну SMS', (issued.body.smsText ?? '').length <= 140, `${(issued.body.smsText ?? '').length} симв.`);

  const again = await call(`/dispatch/web-card/${orderId}`, { token: D, body: {} });
  check('повторная выдача не плодит ссылки', again.body.code === code, `${again.body.code} ≠ ${code}`);

  // -------------------------------------------------------------- W-05
  group('Недействительная ссылка (W-05)');

  const wrong = await web('/w/ZZZZZZZZ');
  check('несуществующий код отдаёт страницу-заглушку', wrong.status === 200 && wrong.html.includes('Ссылка устарела'));
  check('заглушка не раскрывает данных заявки', !wrong.html.includes('Z-2026'), 'в ответе есть номер заявки');

  // -------------------------------------------------------------- W-01
  group('Статус заявки (W-01)');

  const w1 = await web(`/w/${code}`);
  check('страница статуса открывается', w1.status === 200 && w1.html.includes('Заявка принята'));
  check('виден номер заявки', w1.html.includes(created.body.number), created.body.number);
  check('есть кнопка звонка диспетчеру', w1.html.includes('tel:'));
  check('страница обновляется сама', w1.html.includes('http-equiv="refresh"'));

  // -------------------------------------------------------------- W-02
  group('Подтверждение стоимости (W-02)');

  // В B2C точную сумму называет мастер на месте: до этого момента у клиента
  // предварительная вилка, и подтверждать нечего
  await transition(D, orderId, 'estimate', { hasEstimate: true });
  const masters = await call('/dispatch/masters', { token: D });
  const masterId = (masters.body ?? [])[0]?.id;
  await call(`/dispatch/orders/${orderId}/transitions`, {
    token: D,
    body: {
      action: 'assign',
      version: (await call(`/dispatch/orders/${orderId}`, { token: D })).body.version,
      payload: { withinOrderLimit: true, monthlyLimitOk: true, prepaymentMarked: true },
      masterId,
    },
  });
  await transition(D, orderId, 'depart');
  await transition(D, orderId, 'start', { photosBefore: 1 });

  const afterEstimate = await web(`/w/${code}`);
  check('на статусе появилось приглашение подтвердить', afterEstimate.html.includes('ждёт вашего решения'));

  const w2 = await web(`/w/${code}/estimate`);
  check('экран стоимости открывается', w2.status === 200 && w2.html.includes('Подтвердите стоимость'));
  check('видна оговорка о фиксации', w2.html.includes('фиксируется как ваше подтверждение'));

  const approved = await submit(`/w/${code}/estimate`, { decision: 'approve' });
  check('«Согласен» принимается', approved.html.includes('Стоимость подтверждена'), approved.html.slice(0, 200));

  const twice = await submit(`/w/${code}/estimate`, { decision: 'approve' });
  check('повторное «Согласен» не создаёт второго подтверждения', twice.html.includes('Уже подтверждено'));

  const card = await call(`/dispatch/orders/${orderId}`, { token: D });
  check('санкция клиента записана на заявке', (card.body.quotes ?? []).some((q) => q.kind === 'approved'));

  // -------------------------------------------------------------- W-03
  group('Акт и оплата (W-03)');

  await transition(D, orderId, 'complete', {
    photosAfter: 1,
    materialsReceiptsComplete: true,
    totalEqualsSanctioned: true,
    acceptanceFixed: true,
    paymentCollected: true,
  });

  const w3 = await web(`/w/${code}`);
  check('после выполнения открывается акт', w3.html.includes('Работа выполнена'));
  check('есть кнопки оплаты', w3.html.includes('Payme') && w3.html.includes('Click'));
  check('есть ссылка на печатный акт', w3.html.includes('/v1/documents/orders/'));

  const paid = await submit(`/w/${code}/pay`, { provider: 'payme' });
  check('оплата проходит', paid.html.includes('Оплата прошла'));

  const w3paid = await web(`/w/${code}`);
  check('после оплаты акт помечен оплаченным', w3paid.html.includes('Оплачено'));

  // -------------------------------------------------------------- W-04
  group('Оценка (W-04)');

  await transition(D, orderId, 'verify', { moderationPassed: true });
  await transition(D, orderId, 'close', { billingPosted: true, paymentConfirmed: true });

  const w4 = await web(`/w/${code}/rate`);
  check('экран оценки открывается', w4.status === 200 && w4.html.includes('Как всё прошло'));
  check('видна оговорка про низкую оценку', w4.html.includes('перезвоним и разберёмся'));

  const rated = await submit(`/w/${code}/rate`, { rating: '5', comment: 'Всё хорошо' });
  check('оценка принимается', rated.html.includes('Спасибо'));

  const ratedTwice = await web(`/w/${code}/rate`);
  check('повторная оценка не принимается', ratedTwice.html.includes('Оценка уже отправлена'));

  const closed = await call(`/dispatch/orders/${orderId}`, { token: D });
  check('оценка записана на заявке', closed.body.rating === 5, `${closed.body.rating}`);

  const tipped = await submit(`/w/${code}/tip`, { tipTiyin: '1000000' });
  check('чаевые принимаются', tipped.html.includes('Спасибо'));
  const payouts = await call('/admin/billing/payouts', { token: await login('+998900000000') });
  check('чаевые дошли до кошелька мастера', (payouts.body ?? []).some((p) => p.masterId === masterId && p.accruedTiyin > 0));

  // ------------------------------------------------------------- отзыв
  group('Отзыв ссылки');

  await call(`/dispatch/web-card/${orderId}/revoke`, { token: D, body: {} });
  const afterRevoke = await web(`/w/${code}`);
  check('отозванная ссылка больше не открывается', afterRevoke.html.includes('Ссылка устарела'));

  console.log(`\n${'—'.repeat(60)}`);
  console.log(`Пройдено: ${passed}   Провалено: ${failed}`);
  if (failures.length) {
    console.log('\nПровалы:');
    for (const f of failures) console.log(`  • ${f}`);
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('Прогон упал:', e);
  process.exit(1);
});
