/**
 * Вход по SMS с настоящим поставщиком.
 *
 * Набор поднимает свой сервер и свою заглушку Eskiz, потому что проверяет
 * ровно то, чего не видно на журнальном отправителе: код перестаёт быть
 * предсказуемым, включаются пауза и часовой предел, а ветка HTTP поставщика
 * впервые исполняется.
 *
 * Заглушка, а не настоящий Eskiz. Учётной записи у нас нет, и до договора её
 * не будет — но оставлять код поставщика вовсе непроверенным нельзя: он
 * исполнится первый раз в проде, на первом живом входе. Заглушка повторяет
 * протокол по документации: FormData на вход, токен в теле ответа, Bearer в
 * заголовке, 401 на протухшем токене. Она не доказывает, что Eskiz ведёт себя
 * именно так, — она доказывает, что наш код разговаривает так, как мы
 * задумали, и что каждая ветка отказа исполняется.
 *
 *   node apps/api/test/otp-sms-e2e.mjs
 */
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import crypto from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const API_DIR = join(HERE, '..');
const API_PORT = Number(process.env.OTP_E2E_PORT ?? 3141);
const STUB_PORT = API_PORT + 1;
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
// Заглушка Eskiz
// ---------------------------------------------------------------------------

const sent = []; // что «ушло абоненту»
let issuedToken = 'token-1';
/** Сколько раз заглушка обязана ответить 401 — проверка повторного входа */
let rejectTokenTimes = 0;
let loginCount = 0;
/** Отдавать ли 500 на отправку — проверка отказа поставщика */
let failSend = false;

const readBody = (req) =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => resolve(raw));
  });

/** Значение поля multipart/form-data — заглушке хватает такого разбора */
const field = (raw, name) => {
  const m = raw.match(new RegExp(`name="${name}"\\r?\\n\\r?\\n([\\s\\S]*?)\\r?\\n--`));
  return m ? m[1] : null;
};

const stub = createServer(async (req, res) => {
  const raw = await readBody(req);
  const json = (code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.url === '/api/auth/login') {
    loginCount += 1;
    if (field(raw, 'email') !== 'robot@sozo.uz' || field(raw, 'password') !== 'secret') {
      return json(401, { message: 'Unauthorized' });
    }
    return json(200, { data: { token: issuedToken } });
  }
  if (req.url === '/api/message/sms/send') {
    if (rejectTokenTimes > 0) {
      rejectTokenTimes -= 1;
      // Протухший токен: поставщик отвечает 401, и наш код обязан
      // перелогиниться и повторить — один раз
      issuedToken = 'token-2';
      return json(401, { message: 'Expired' });
    }
    if (req.headers.authorization !== `Bearer ${issuedToken}`) return json(401, { message: 'Bad token' });
    if (failSend) return json(500, { message: 'provider down' });
    sent.push({ phone: field(raw, 'mobile_phone'), message: field(raw, 'message'), from: field(raw, 'from') });
    return json(200, { id: `msg-${sent.length}`, message: 'Waiting for SMS provider' });
  }
  json(404, { message: 'not found' });
});
await new Promise((r) => stub.listen(STUB_PORT, '127.0.0.1', r));

// ---------------------------------------------------------------------------
// Сервер с настоящим поставщиком
// ---------------------------------------------------------------------------

// Набор идёт по собранному коду, а не по ts-node, как остальные: часовой
// предел проверяется прямо на хранилище кодов, а импортировать TypeScript из
// обычного ESM нельзя. Сборка занимает секунды и снимает вопрос «а та ли это
// версия» — иначе набор молча проверял бы прошлую.
execFileSync('npm', ['run', 'build', '-w', '@sozo/api'], { cwd: join(API_DIR, '../..'), stdio: 'ignore' });

const stateDir = mkdtempSync(join(tmpdir(), 'sozo-otp-'));
const api = spawn(process.execPath, [join(API_DIR, 'dist/main.js')], {
  cwd: API_DIR,
  env: {
    ...process.env,
    STATE_FILE: join(stateDir, 'state.json'),
    PORT: String(API_PORT),
    DATABASE_URL: '',
    SMS_PROVIDER: 'eskiz',
    SMS_ESKIZ_EMAIL: 'robot@sozo.uz',
    SMS_ESKIZ_PASSWORD: 'secret',
    SMS_ESKIZ_FROM: '4546',
    SMS_ESKIZ_BASE: `http://127.0.0.1:${STUB_PORT}`,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true,
});
let apiLog = '';
api.stdout.on('data', (d) => (apiLog += d));
api.stderr.on('data', (d) => (apiLog += d));

function cleanup() {
  try {
    process.kill(-api.pid, 'SIGKILL');
  } catch {
    // сервер уже мёртв — это не повод шуметь при уборке
  }
  stub.close();
  rmSync(stateDir, { recursive: true, force: true });
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => (cleanup(), process.exit(1)));

async function call(path, { method = 'POST', body, token } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {} };
}

async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${API_PORT}/v1/health`);
      if (r.ok) return;
    } catch {
      // сервер ещё поднимается
    }
    if (api.exitCode !== null) throw new Error(`API упал до готовности:\n${apiLog}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`API не поднялся:\n${apiLog}`);
}

/** Код из последнего отправленного сообщения */
const lastCode = () => (sent.at(-1)?.message.match(/(\d{5})/) ?? [])[1];

try {
  await waitReady();
  console.log(`Вход по SMS: заглушка Eskiz на :${STUB_PORT}\n${'='.repeat(60)}`);

  group('1. Отправка кода');
  const phone = '+998901110001';
  const r1 = await call('/auth/request-otp', { body: { phone } });
  check('код запрошен', r1.status < 400, JSON.stringify(r1.body));
  check('сообщение ушло поставщику', sent.length === 1, String(sent.length));
  check('номер без плюса, как ждёт Eskiz', sent[0]?.phone === '998901110001', String(sent[0]?.phone));
  check('отправитель из конфига', sent[0]?.from === '4546', String(sent[0]?.from));
  check('канал в ответе — eskiz, а не log', r1.body.channel === 'eskiz', String(r1.body.channel));
  check('в сообщении пятизначный код', /\b\d{5}\b/.test(sent[0]?.message ?? ''), sent[0]?.message);
  check('код не «пять нулей»', lastCode() !== '00000', String(lastCode()));
  check('в сообщении сказано, сколько он живёт', /\d+\s*мин/.test(sent[0]?.message ?? ''), sent[0]?.message);

  group('2. Проверка кода');
  const wrong = await call('/auth/verify', { body: { phone, code: '00000' } });
  check('dev-код с настоящим поставщиком не проходит', wrong.status === 401, String(wrong.status));
  const ok = await call('/auth/verify', { body: { phone, code: lastCode() } });
  check('настоящий код проходит', ok.status < 400 && Boolean(ok.body.accessToken), JSON.stringify(ok.body).slice(0, 80));
  const again = await call('/auth/verify', { body: { phone, code: lastCode() } });
  check('код одноразовый: второй раз не проходит', again.status === 401, String(again.status));

  group('3. Пауза между отправками');
  const p2 = '+998901110002';
  await call('/auth/request-otp', { body: { phone: p2 } });
  const tooSoon = await call('/auth/request-otp', { body: { phone: p2 } });
  check('повтор сразу отклонён', tooSoon.status === 429, String(tooSoon.status));
  check('сказано, через сколько можно', Number(tooSoon.body.retryAfterSec) > 0, JSON.stringify(tooSoon.body));
  check('вторая SMS не отправлена', sent.filter((x) => x.phone === '998901110002').length === 1);

  group('4. Перебор кода');
  const p3 = '+998901110003';
  await call('/auth/request-otp', { body: { phone: p3 } });
  const real = lastCode();
  const wrongCode = real === '11111' ? '22222' : '11111';
  let lastStatus = 0;
  for (let i = 0; i < 5; i++) lastStatus = (await call('/auth/verify', { body: { phone: p3, code: wrongCode } })).status;
  check('после пяти неверных попыток отказ', lastStatus === 401);
  const burned = await call('/auth/verify', { body: { phone: p3, code: real } });
  check('код сожжён: настоящий уже не проходит', burned.status === 401, String(burned.status));
  check('и сказано, что нужен новый', burned.body.code === 'OTP_ATTEMPTS_EXCEEDED', String(burned.body.code));

  group('5. Протухший токен поставщика');
  const before = loginCount;
  rejectTokenTimes = 1;
  const p4 = '+998901110004';
  const r4 = await call('/auth/request-otp', { body: { phone: p4 } });
  check('отправка удалась после повторного входа', r4.status < 400, JSON.stringify(r4.body));
  check('вход в Eskiz выполнен ещё раз', loginCount === before + 1, `${before} → ${loginCount}`);
  check('сообщение всё-таки ушло', sent.at(-1)?.phone === '998901110004', String(sent.at(-1)?.phone));

  group('6. Поставщик отказал');
  failSend = true;
  const p5 = '+998901110005';
  const r5 = await call('/auth/request-otp', { body: { phone: p5 } });
  check('отказ поставщика виден клиенту', r5.status === 503, String(r5.status));
  check('и назван кодом, а не текстом', r5.body.code === 'SMS_SEND_FAILED', String(r5.body.code));
  failSend = false;
  const r5b = await call('/auth/request-otp', { body: { phone: p5 } });
  check('неудачная отправка не включила паузу', r5b.status < 400, JSON.stringify(r5b.body));

  group('7. Часовой предел');
  // Через HTTP до него не добраться: пауза в минуту упирается раньше, и
  // ждать пять минут внутри набора нельзя. Поэтому предел проверяется прямо
  // на хранилище кодов — оно принимает время параметром именно для этого.
  const { OtpStore, OTP_HOURLY_LIMIT } = await import(join(API_DIR, 'dist/modules/identity/otp.store.js'));
  const store = new OtpStore();
  const p6 = '+998901110006';
  let t = Date.now();
  for (let i = 0; i < OTP_HOURLY_LIMIT; i++) {
    check(`пауза прошла — код ${i + 1} выдаётся`, store.cooldownLeft(p6, t) === 0 && !store.hourlyExhausted(p6, t));
    store.issue(p6, undefined, t);
    t += 61_000; // прошла минута паузы
  }
  check('шестой код за час отклонён', store.hourlyExhausted(p6, t));
  check('через час предел отпускает', !store.hourlyExhausted(p6, t + 3600_000));
  check('чужой номер предел не задел', !store.hourlyExhausted('+998901119999', t));

  group('8. Срок жизни кода');
  const p7 = '+998901110007';
  const issued = store.issue(p7, undefined, t);
  check('код пятизначный', /^\d{5}$/.test(issued.code), issued.code);
  check('за секунду до срока код принимается', store.verify(p7, issued.code, t + 179_000) === 'ok');
  const again7 = store.issue(p7, undefined, t);
  check('после срока код истёк, а не «неверен»', store.verify(p7, again7.code, t + 181_000) === 'expired');

  group('9. Ссылки уходят SMS, а не только выписываются');
  // Раньше короткий код складывался в журнал и ждал, что его отправит
  // человек руками. Проверяется весь путь: событие шины → подписчик
  // доставки → поставщик.
  const login = async (phone) => {
    await call('/auth/request-otp', { body: { phone } });
    const r = await call('/auth/verify', { body: { phone, code: lastCode() } });
    return r.body.accessToken;
  };
  const admin = await login('+998900000000');
  const b = (await call('/buildings', { token: admin, body: { name: 'ЖК Проверка', address: 'Проверочная 1', emergencyPhone: '+998711234567' } })).body;
  await call(`/buildings/${b.id}/units`, { token: admin, body: { number: '12', riserIds: ['R1'] } });
  await call(`/buildings/${b.id}/zones`, { token: admin, body: { zoneType: 'water_riser', label: 'Стояк ХВС', riserId: 'R1' } });
  await call(`/buildings/${b.id}/claim`, { token: admin, body: { operatorOrgId: 'uk9' } });
  await call(`/buildings/${b.id}/verify`, { token: admin, method: 'POST' });
  await call(`/buildings/${b.id}/staff`, { token: admin, body: { userPhone: '+998907770001', fullName: 'Согласующий', staffRole: 'approver' } });
  await call(`/buildings/${b.id}/staff`, { token: admin, body: { userPhone: '+998907770003', fullName: 'Резерв', staffRole: 'approver', isBackup: true } });
  const activated = await call(`/buildings/${b.id}/activate`, { token: admin, method: 'POST' });
  check('объект подключён', activated.status < 400, JSON.stringify(activated.body).slice(0, 120));
  await call('/operator/uk9/subscription', { token: admin, body: { plan: 'free', tenantKind: 'hoa' } });

  const ordId = (await call('/orders', { token: admin, body: { clientPhone: '+998901234567', address: 'Проверочная 1', description: 'течь' } })).body.id;
  const permit = (await call(`/orders/${ordId}/permits`, {
    token: admin,
    body: {
      buildingId: b.id, zoneTypes: ['water_riser'], riserIds: ['R1'],
      windowFrom: new Date(Date.now() + 3600_000).toISOString(),
      windowTo: new Date(Date.now() + 3 * 3600_000).toISOString(),
      masterIsPlatform: true, qualificationOk: true,
    },
  })).body;
  check('наряд создан', Boolean(permit.id), JSON.stringify(permit).slice(0, 160));
  const beforeSubmit = sent.length;
  const submitted = await call(`/permits/${permit.id}/transitions`, { token: admin, body: { action: 'submit', clientOpUuid: crypto.randomUUID() } });
  check('наряд отправлен на согласование', submitted.status < 400, JSON.stringify(submitted.body).slice(0, 160));
  await new Promise((r) => setTimeout(r, 300)); // доставка асинхронна к переходу
  const toApprover = sent.slice(beforeSubmit).find((x) => x.phone === '998907770001');
  check('согласующему ушла SMS', Boolean(toApprover), JSON.stringify(sent.slice(beforeSubmit)));
  check('в ней ссылка на страницу согласования', /\/p\/[A-Z2-9]{8}/.test(toApprover?.message ?? ''), toApprover?.message);
  check(
    'сообщение в одну SMS — не длиннее 70 знаков',
    Boolean(toApprover) && toApprover.message.length <= 70,
    String(toApprover?.message?.length),
  );

  const resident = '+998907770002';
  await call(`/buildings/units/${(await call(`/buildings/${b.id}/units`, { token: admin, method: 'GET' })).body[0].id}/residents`, {
    token: admin, body: { userPhone: resident, fullName: 'Житель', residentRole: 'owner' },
  });
  const unitId = (await call(`/buildings/${b.id}/units`, { token: admin, method: 'GET' })).body[0].id;
  const beforeAccess = sent.length;
  await call('/unit-access', {
    token: admin,
    body: {
      buildingId: b.id, unitId, permitId: permit.id, reason: 'Нужен доступ к стояку',
      windowFrom: new Date(Date.now() + 3600_000).toISOString(),
      windowTo: new Date(Date.now() + 3 * 3600_000).toISOString(),
    },
  });
  await new Promise((r) => setTimeout(r, 300));
  const toResident = sent.slice(beforeAccess).find((x) => x.phone === '998907770002');
  check('жителю ушла SMS о доступе', Boolean(toResident), JSON.stringify(sent.slice(beforeAccess)));
  check('в ней ссылка на страницу ответа', /\/u\/[A-Z2-9]{8}/.test(toResident?.message ?? ''), toResident?.message);

  console.log(`\n${'='.repeat(52)}\nПройдено: ${passed}   Провалено: ${failed}`);
  cleanup();
  process.exit(failed ? 1 : 0);
} catch (e) {
  console.error(String(e));
  cleanup();
  process.exit(1);
}
