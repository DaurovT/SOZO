/**
 * Доставка push (ТЗ §11, PRD-01 §5, PRD-02 §5).
 *
 * Набор поднимает свой сервер, свою заглушку FCM и свою заглушку Eskiz —
 * как и набор входа по SMS, и по той же причине: на журнальном отправителе
 * не видно ничего из того, ради чего этот код написан. Заглушка FCM
 * повторяет протокол HTTP v1 по документации: обмен подписанного JWT на
 * токен доступа, Bearer в заголовке отправки, 404 UNREGISTERED на мёртвом
 * токене. Она не доказывает, что Google ведёт себя именно так, — она
 * доказывает, что наш код разговаривает так, как задумано.
 *
 * Главная проверка здесь — первая: пока FCM не подключён, ни одна SMS не
 * уходит. Правило держится на одной строке в push-dispatch, и снять её
 * молча слишком легко: цена ошибки — платная рассылка на всю базу в день,
 * когда включат боевого поставщика SMS, и связать её с давней правкой
 * пушей уже никто не сможет.
 *
 *   node apps/api/test/push-e2e.mjs
 */
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const API_DIR = join(HERE, '..');
const API_PORT = Number(process.env.PUSH_E2E_PORT ?? 3151);
const SMS_PORT = API_PORT + 1;
const FCM_PORT = API_PORT + 2;
const BASE = `http://127.0.0.1:${API_PORT}/v1`;

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

// ---------------------------------------------------------------------------
// Заглушки поставщиков
// ---------------------------------------------------------------------------

/** Что «ушло абоненту» SMS-ом */
let sms = [];
/** Что приняла заглушка FCM */
let pushes = [];
/** Токены, на которые заглушка отвечает 404 UNREGISTERED */
const deadTokens = new Set();

const readBody = (req) =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => resolve(raw));
  });

const field = (raw, name) => {
  const m = raw.match(new RegExp(`name="${name}"\\r?\\n\\r?\\n([\\s\\S]*?)\\r?\\n--`));
  return m ? m[1] : null;
};

const smsStub = createServer(async (req, res) => {
  const raw = await readBody(req);
  const json = (code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.url === '/api/auth/login') return json(200, { data: { token: 'sms-token' } });
  if (req.url === '/api/message/sms/send') {
    sms.push({ phone: field(raw, 'mobile_phone'), message: field(raw, 'message') });
    return json(200, { id: `msg-${sms.length}` });
  }
  json(404, { message: 'not found' });
});

const fcmStub = createServer(async (req, res) => {
  const raw = await readBody(req);
  const json = (code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.url === '/token') {
    // Проверяем не подпись, а форму: без assertion наш код вообще не дошёл
    // до обмена, и дальше проверять нечего
    const ok = /grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer/.test(raw) && /assertion=ey/.test(raw);
    if (!ok) return json(400, { error: 'invalid_grant' });
    return json(200, { access_token: 'fcm-access-token', expires_in: 3600 });
  }
  if (req.url?.endsWith('/messages:send')) {
    if (req.headers.authorization !== 'Bearer fcm-access-token') return json(401, { error: 'unauthorized' });
    const body = JSON.parse(raw);
    const token = body.message?.token;
    if (deadTokens.has(token)) {
      // Так FCM сообщает, что приложения на устройстве больше нет
      return json(404, { error: { status: 'UNREGISTERED', message: 'Requested entity was not found.' } });
    }
    pushes.push(body.message);
    return json(200, { name: `projects/sozo-test/messages/${pushes.length}` });
  }
  json(404, { message: 'not found' });
});

await new Promise((r) => smsStub.listen(SMS_PORT, '127.0.0.1', r));
await new Promise((r) => fcmStub.listen(FCM_PORT, '127.0.0.1', r));

// Ключ сервисного аккаунта — настоящий RSA, выписанный на месте: подпись
// собирается нашим кодом, и подсунуть строку вместо ключа нельзя
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const credentials = JSON.stringify({
  project_id: 'sozo-test',
  client_email: 'push@sozo-test.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
});

// ---------------------------------------------------------------------------
// Сервер
// ---------------------------------------------------------------------------

execFileSync('npm', ['run', 'build', '-w', '@sozo/api'], { cwd: join(API_DIR, '../..'), stdio: 'ignore' });

let api = null;
let apiLog = '';
let stateDir = null;

async function startApi(env) {
  stateDir = mkdtempSync(join(tmpdir(), 'sozo-push-'));
  apiLog = '';
  api = spawn(process.execPath, [join(API_DIR, 'dist/main.js')], {
    cwd: API_DIR,
    env: {
      ...process.env,
      STATE_FILE: join(stateDir, 'state.json'),
      PORT: String(API_PORT),
      DATABASE_URL: '',
      SMS_PROVIDER: 'eskiz',
      SMS_ESKIZ_EMAIL: 'robot@sozo.uz',
      SMS_ESKIZ_PASSWORD: 'secret',
      SMS_ESKIZ_BASE: `http://127.0.0.1:${SMS_PORT}`,
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  api.stdout.on('data', (d) => (apiLog += d));
  api.stderr.on('data', (d) => (apiLog += d));
  const until = Date.now() + 60_000;
  while (Date.now() < until) {
    if (api.exitCode !== null) throw new Error(`API упал до готовности:\n${apiLog}`);
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return;
    } catch {
      // сервер ещё поднимается
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`API не поднялся:\n${apiLog}`);
}

function stopApi() {
  try {
    if (api) process.kill(-api.pid, 'SIGKILL');
  } catch {
    // уже мёртв — при уборке это не новость
  }
  if (stateDir) rmSync(stateDir, { recursive: true, force: true });
  api = null;
}

function cleanup() {
  stopApi();
  smsStub.close();
  fcmStub.close();
}
process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit(1);
});

// ---------------------------------------------------------------------------
// Вспомогательное
// ---------------------------------------------------------------------------

const req = async (method, path, { token, body } = {}) => {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: r.status, body: json };
};

/** Вход по OTP: код непредсказуем, читаем его из SMS-заглушки */
async function login(phone) {
  const before = sms.length;
  await req('POST', '/auth/request-otp', { body: { phone } });
  const line = sms.slice(before).find((m) => m.phone === phone.replace(/\D/g, ''));
  const code = line?.message.match(/(\d{5})/)?.[1];
  if (!code) throw new Error(`код входа для ${phone} не найден в SMS`);
  const res = await req('POST', '/auth/verify', { body: { phone, code } });
  const token = res.body?.accessToken;
  if (!token) throw new Error(`вход ${phone} не удался: ${JSON.stringify(res.body)}`);
  return token;
}

const CLIENT_PHONE = '+998901112233';
const DISPATCHER_PHONE = '+998900000002';
const ADMIN_PHONE = '+998900000000';

/** Заявка клиента, готовая к назначению мастера, и свободный мастер */
async function seedAndPick(clientToken, dispatcherToken) {
  await req('POST', '/app/demo/seed', { token: clientToken, body: {} });
  const orders = await req('GET', '/app/orders', { token: clientToken });
  const order = orders.body.orders.find((o) => o.status === 'estimated');
  const masters = await req('GET', '/dispatch/masters', { token: dispatcherToken });
  const list = Array.isArray(masters.body) ? masters.body : masters.body.items;
  return { order, master: list[0] };
}

const assign = (dispatcherToken, order, master) =>
  req('POST', `/dispatch/orders/${order.id}/transitions`, {
    token: dispatcherToken,
    body: { action: 'assign', version: order.version ?? 0, masterId: master.id, masterName: master.fullName },
  });

/** Доставка успевает уйти в тот же тик, но запись в журнал асинхронна */
const settle = () => new Promise((r) => setTimeout(r, 300));

// ===========================================================================
// 1. Без FCM: канал не настроен — SMS не подменяет push
// ===========================================================================

group('Push не настроен: SMS-дубли молчат');
await startApi({ PUSH_PROVIDER: '' });
{
  const clientToken = await login(CLIENT_PHONE);
  const dispatcherToken = await login(DISPATCHER_PHONE);
  const { order, master } = await seedAndPick(clientToken, dispatcherToken);

  // Устройство НЕ регистрируем — так выглядит сегодняшний прод: приложения
  // ещё не умеют присылать токен, адресатов нет ни у кого
  sms = [];
  const res = await assign(dispatcherToken, order, master);
  await settle();

  check('назначение прошло', res.status === 201 || res.status === 200, `HTTP ${res.status}`);
  check('ни одной SMS не ушло', sms.length === 0, `ушло ${sms.length}: ${sms.map((m) => m.message).join(' | ')}`);

  const log = await req('GET', '/devices/deliveries', { token: clientToken });
  const items = log.body.items ?? [];
  const assigned = items.find((i) => i.event === 'order.assigned');
  check('событие попало в журнал доставки', !!assigned, JSON.stringify(items).slice(0, 200));
  check('канал — никакой', assigned?.channel === 'none', assigned?.channel);
  check('причина названа: push не настроен', assigned?.detail === 'push_not_configured', assigned?.detail);
}
stopApi();

// ===========================================================================
// 2. С FCM: сообщение уходит поставщику
// ===========================================================================

group('FCM подключён: уведомление доходит до поставщика');
await startApi({
  PUSH_PROVIDER: 'fcm',
  PUSH_FCM_CREDENTIALS_JSON: credentials,
  PUSH_FCM_BASE: `http://127.0.0.1:${FCM_PORT}`,
  PUSH_FCM_OAUTH_BASE: `http://127.0.0.1:${FCM_PORT}`,
});
{
  const clientToken = await login(CLIENT_PHONE);
  const dispatcherToken = await login(DISPATCHER_PHONE);
  const { order, master } = await seedAndPick(clientToken, dispatcherToken);

  const reg = await req('POST', '/devices', {
    token: clientToken,
    body: { token: 'device-client-1', app: 'client', platform: 'android', locale: 'ru' },
  });
  check('устройство зарегистрировано', reg.status === 201 || reg.status === 200, JSON.stringify(reg.body));

  sms = [];
  pushes = [];
  await assign(dispatcherToken, order, master);
  await settle();

  const assigned = pushes.find((m) => m.notification?.title === 'Мастер назначен');
  check('push «Мастер назначен» ушёл в FCM', !!assigned, JSON.stringify(pushes).slice(0, 200));
  check('адресован нужному устройству', assigned?.token === 'device-client-1', assigned?.token);
  check('в теле имя мастера', (assigned?.notification?.body ?? '').includes(master.fullName), assigned?.notification?.body);
  check('deep-link ведёт на карточку заявки', assigned?.data?.deepLink === `sozo-client://order/${order.id}`, assigned?.data?.deepLink);
  check('приоритет высокий', assigned?.android?.priority === 'HIGH', assigned?.android?.priority);
  check('SMS-дубля не было: push доставлен', sms.length === 0, sms.map((m) => m.message).join(' | '));

  const details = pushes.find((m) => m.notification?.title === 'Уточните детали адреса');
  check('просьба уточнить адрес — отдельным уведомлением', !!details);
  check('и без высокого приоритета', details?.android?.priority === 'NORMAL', details?.android?.priority);

  // ------------------------------------------------------------------
  // Оффер мастеру: приоритет, TTL и своё приложение
  // ------------------------------------------------------------------
  const masterToken = await login(master.phone);
  await req('POST', '/devices', {
    token: masterToken,
    body: { token: 'device-master-1', app: 'master', platform: 'android', locale: 'ru' },
  });
  pushes = [];
  const offered = await req('POST', '/dispatch/offers', {
    token: dispatcherToken,
    body: { orderId: order.id, masterIds: [master.id] },
  });
  await settle();
  check('оффер отправлен', offered.body?.sent === 1, JSON.stringify(offered.body).slice(0, 150));
  const offer = pushes.find((m) => m.token === 'device-master-1');
  check('оффер ушёл в приложение мастера', !!offer, JSON.stringify(pushes).slice(0, 200));
  check('оффер будит устройство', offer?.android?.priority === 'HIGH', offer?.android?.priority);
  check('оффер живёт ровно свой таймер', offer?.android?.ttl === '60s', offer?.android?.ttl);
  check('deep-link ведёт на оффер', (offer?.data?.deepLink ?? '').startsWith('sozo-master://offer/'), offer?.data?.deepLink);
  check('в клиентское приложение оффер не ушёл', !pushes.some((m) => m.token === 'device-client-1'));

  // ------------------------------------------------------------------
  // Мёртвый токен: устройство снимается, критичное уходит SMS
  // ------------------------------------------------------------------
  deadTokens.add('device-client-1');
  sms = [];
  pushes = [];
  // Следующий шаг той же заявки: мастер выехал — критичное событие, и клиент
  // обязан узнать о нём даже с мёртвым токеном
  const current = await req('GET', `/orders/${order.id}`, { token: dispatcherToken });
  const departed = await req('POST', `/dispatch/orders/${order.id}/transitions`, {
    token: dispatcherToken,
    body: { action: 'depart', version: current.body.version },
  });
  await settle();
  check('переход «выехал» прошёл', departed.status === 201 || departed.status === 200, JSON.stringify(departed.body).slice(0, 150));
  check('на мёртвый токен ушла SMS-замена', sms.length > 0, 'SMS не было');
  check('в SMS — номер заявки', sms.some((m) => m.message.includes(order.number)), sms.map((m) => m.message).join(' | '));

  const after = await req('GET', '/devices/deliveries', { token: clientToken });
  const rec = (after.body.items ?? [])[0];
  check('журнал доставки помнит запасной канал', rec?.channel === 'sms_fallback', rec?.channel);

  // Мёртвое устройство снято: на следующее событие запроса к нему уже нет
  pushes = [];
  sms = [];
  await req('POST', `/dispatch/orders/${order.id}/transitions`, {
    token: dispatcherToken,
    body: { action: 'start', version: departed.body?.version ?? 0, payload: { photosBefore: 1 } },
  });
  await settle();
  check('снятый токен больше не беспокоят', !pushes.some((m) => m.token === 'device-client-1'), JSON.stringify(pushes).slice(0, 150));
}
stopApi();

// ===========================================================================
// 3. Напоминания планировщика уходят один раз, а не на каждый тик
// ===========================================================================

group('Таймеры: напоминание отправляется однажды');
await startApi({ PUSH_PROVIDER: '' });
{
  const clientToken = await login(CLIENT_PHONE);
  const dispatcherToken = await login(DISPATCHER_PHONE);
  const adminToken = await login(ADMIN_PHONE);
  const { order, master } = await seedAndPick(clientToken, dispatcherToken);

  /**
   * Доводим заявку до «ожидает оплаты».
   *
   * Через настоящие переходы, а не подстановкой статуса: напоминание
   * считает время от последней записи в журнале статусов, и заявка,
   * появившаяся в нужном состоянии сама собой, ничего бы не проверила.
   */
  const step = async (action, payload) => {
    const cur = await req('GET', `/orders/${order.id}`, { token: dispatcherToken });
    return req('POST', `/dispatch/orders/${order.id}/transitions`, {
      token: dispatcherToken,
      body: { action, version: cur.body.version, ...(payload ? { payload } : {}) },
    });
  };
  await assign(dispatcherToken, order, master);
  await step('depart');
  await step('start', { photosBefore: 1 });
  // Гейты «Выполнена» в B2C: фото «после», чеки на запчасти, итог равен
  // санкционированному и собранная оплата либо санкция диспетчера (ТЗ §4.1)
  await step('complete', {
    photosAfter: 1,
    materialsWithoutReceipt: 0,
    totalEqualsSanctioned: true,
    dispatcherSanction: true,
  });
  // Приёмка перед оплатой: граф не пускает в «ожидает оплаты» напрямую из
  // «выполнена», а отпустить заявку без оплаты может только диспетчер и
  // только с причиной (ТЗ §4.1) — санкция передаётся тем же переходом
  await step('verify', { moderationPassed: true });
  const waiting = await req('POST', `/dispatch/orders/${order.id}/transitions`, {
    token: dispatcherToken,
    body: {
      action: 'await_payment',
      version: (await req('GET', `/orders/${order.id}`, { token: dispatcherToken })).body.version,
      reason: 'Санкция диспетчера: клиент оплатит переводом',
      payload: { dispatcherSanction: true },
    },
  });
  check('заявка ждёт оплаты', waiting.body?.status === 'awaiting_payment', JSON.stringify(waiting.body).slice(0, 160));

  // Сдвигаем время планировщика на трое суток: напоминание T+72 наступает
  const simulated = await req('POST', '/admin/scheduler/simulate', { token: adminToken, body: { days: 3 } });
  check('планировщик прогнал трое суток', simulated.status === 200 || simulated.status === 201, JSON.stringify(simulated.body).slice(0, 120));
  await settle();

  const countReminders = async () => {
    const log = await req('GET', '/devices/deliveries', { token: clientToken });
    return (log.body.items ?? []).filter((i) => i.event.startsWith('order.payment_reminder')).length;
  };
  const afterFirst = await countReminders();
  check('напоминание об оплате отправлено', afterFirst > 0, `отправок: ${afterFirst}`);

  // Ещё три прогона таймеров подряд — ровно то, что делает расписание раз в минуту
  for (let i = 0; i < 3; i++) {
    await req('POST', '/admin/scheduler/run', { token: adminToken, body: {} });
    await settle();
  }
  const afterRepeats = await countReminders();
  /**
   * Главная проверка набора после случая на проде.
   *
   * Планировщик тикает раз в минуту, и без отметки «уже отправлено» заявка
   * в «ожидает оплаты» слала должнику требование каждую минуту — бесконечно,
   * пока он не заплатит. В журнале это выглядело как рабочая доставка.
   */
  check(
    'повторные прогоны не плодят напоминания',
    afterRepeats === afterFirst,
    `было ${afterFirst}, стало ${afterRepeats}`,
  );
}
stopApi();

console.log(`\n${'='.repeat(60)}`);
console.log(`Проверок: ${passed + failed}, прошло: ${passed}, упало: ${failed}`);
cleanup();
process.exit(failed ? 1 : 0);
