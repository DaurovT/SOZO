/**
 * Приёмка переноса state.json → PostgreSQL.
 *
 * Поднимает два сервера на одних и тех же данных — один на файле, другой на
 * базе — и сверяет, что они отвечают одинаково. Совпадение счётчиков в
 * инструменте переноса доказывает, что строки записаны; оно не доказывает,
 * что приложение видит их так же, как видело в файле. Разница между этими
 * двумя утверждениями и есть всё, ради чего делается приёмка.
 *
 *   node apps/api/test/import-verify.mjs <снимок> <DATABASE_URL>
 */
import { spawn } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const API_DIR = join(HERE, '..');
const SNAPSHOT = process.argv[2];
const DB_URL = process.argv[3];
const PORT_FILE = Number(process.env.VERIFY_PORT ?? 3451);
const PORT_DB = PORT_FILE + 1;

if (!SNAPSHOT || !DB_URL) {
  console.error('Нужны снимок и строка подключения:\n  node import-verify.mjs /var/lib/sozo/state.json postgresql://...');
  process.exit(1);
}

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

const servers = [];
function start(port, env) {
  const dir = mkdtempSync(join(tmpdir(), 'sozo-verify-'));
  const stateFile = join(dir, 'state.json');
  copyFileSync(SNAPSHOT, stateFile);
  const p = spawn(process.execPath, [join(API_DIR, 'dist/main.js')], {
    cwd: API_DIR,
    env: {
      ...process.env,
      STATE_FILE: stateFile,
      PORT: String(port),
      ALLOW_DEV_OTP: '1',
      // Посев демо выключен на обеих сторонах: иначе сравнивались бы не
      // перенесённые данные, а то, что каждая сторона себе досочинила
      SOZO_NO_SEED: '1',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  let log = '';
  p.stdout.on('data', (d) => (log += d));
  p.stderr.on('data', (d) => (log += d));
  servers.push({ p, dir, log: () => log });
  return p;
}

function cleanup() {
  for (const s of servers) {
    try {
      process.kill(-s.p.pid, 'SIGKILL');
    } catch {
      // уже мёртв
    }
    rmSync(s.dir, { recursive: true, force: true });
  }
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => (cleanup(), process.exit(1)));

async function ready(port) {
  for (let i = 0; i < 90; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/v1/health`);
      if (r.ok) return;
    } catch {
      // поднимается
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`сервер на ${port} не поднялся:\n${servers.map((s) => s.log()).join('\n')}`);
}

async function token(port) {
  await fetch(`http://127.0.0.1:${port}/v1/auth/request-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '+998900000000' }),
  });
  const r = await fetch(`http://127.0.0.1:${port}/v1/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '+998900000000', code: '00000' }),
  });
  return (await r.json()).accessToken;
}

const get = async (port, tok, path) => {
  const r = await fetch(`http://127.0.0.1:${port}/v1${path}`, { headers: { Authorization: `Bearer ${tok}` } });
  const text = await r.text();
  return text ? JSON.parse(text) : {};
};

try {
  start(PORT_FILE, { DATABASE_URL: '' });
  start(PORT_DB, { DATABASE_URL: DB_URL });
  await Promise.all([ready(PORT_FILE), ready(PORT_DB)]);
  const [tf, td] = await Promise.all([token(PORT_FILE), token(PORT_DB)]);

  console.log(`Файл :${PORT_FILE}   База :${PORT_DB}\n${'='.repeat(60)}\n`);

  // Заявки: сравниваем множества номеров, а не счётчики. Счётчики совпадают и
  // тогда, когда одна заявка потерялась, а другая задвоилась
  const [of_, od] = await Promise.all([get(PORT_FILE, tf, '/admin/orders'), get(PORT_DB, td, '/admin/orders')]);
  const nums = (r) => new Set((Array.isArray(r) ? r : (r.orders ?? [])).map((o) => o.number));
  const nf = nums(of_);
  const nd = nums(od);
  const missing = [...nf].filter((n) => !nd.has(n));
  const extra = [...nd].filter((n) => !nf.has(n));
  console.log(`Заявки: файл ${nf.size}, база ${nd.size}`);
  check('в базе нет лишних заявок', extra.length === 0, extra.slice(0, 5).join(', '));
  // Не «сколько потерялось», а «те ли самые». Порог вроде «не больше
  // двенадцати» проходит и тогда, когда не доехали двенадцать других заявок
  const snap = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
  const liveLoc = new Set();
  const seenInn = new Set();
  for (const o of snap.crm ?? []) {
    // Организация с уже встреченным ИНН при переносе пропускается — вместе с
    // её точками B2B, а на точку ссылается заявка
    if (o.inn && seenInn.has(o.inn)) continue;
    if (o.inn) seenInn.add(o.inn);
    for (const l of o.locations ?? []) liveLoc.add(l.id);
  }
  const liveMasters = new Set((snap.masters ?? []).map((m) => m.id));
  const expectedMissing = new Set(
    (snap.orders ?? [])
      .filter((o) => (o.locationId && !liveLoc.has(o.locationId)) || (o.masterId && !liveMasters.has(o.masterId)))
      .map((o) => o.number),
  );
  const unexpected = missing.filter((n) => !expectedMissing.has(n));
  check(
    'не доехали ровно те заявки, что названы при переносе',
    unexpected.length === 0 && missing.length === expectedMissing.size,
    `лишние потери: ${unexpected.slice(0, 8).join(', ') || 'нет'}; ожидалось ${expectedMissing.size}, потеряно ${missing.length}`,
  );

  // Статусы: заявка, приехавшая с другим статусом, — это молча испорченные данные
  const byNum = (r) => new Map((Array.isArray(r) ? r : (r.orders ?? [])).map((o) => [o.number, o]));
  const mf = byNum(of_);
  const md = byNum(od);
  const wrongStatus = [...md].filter(([n, o]) => mf.has(n) && mf.get(n).status !== o.status);
  check('статусы совпадают', wrongStatus.length === 0, wrongStatus.slice(0, 5).map(([n]) => n).join(', '));
  const wrongMoney = [...md].filter(([n, o]) => mf.has(n) && (mf.get(n).totalTiyin ?? 0) !== (o.totalTiyin ?? 0));
  check('суммы совпадают', wrongMoney.length === 0, wrongMoney.slice(0, 5).map(([n]) => n).join(', '));

  // Деньги: сверяем остатки по счётам плана — они считаются из проводок
  const [bf, bd] = await Promise.all([get(PORT_FILE, tf, '/admin/billing/accounts'), get(PORT_DB, td, '/admin/billing/accounts')]);
  const bal = (r) => new Map((Array.isArray(r) ? r : (r.accounts ?? [])).map((a) => [a.code, a.balanceTiyin]));
  const balF = bal(bf);
  const balD = bal(bd);
  const diff = [...balF].filter(([code, v]) => balD.get(code) !== v);
  check('остатки по счётам плана сошлись', diff.length === 0, diff.map(([c, v]) => `${c}: ${v} ≠ ${balD.get(c)}`).join('; '));

  // Мастера и пользователи
  const [msf, msd] = await Promise.all([get(PORT_FILE, tf, '/dispatch/masters'), get(PORT_DB, td, '/dispatch/masters')]);
  const phones = (r) => new Set((Array.isArray(r) ? r : (r.masters ?? [])).map((m) => m.phone));
  check('мастера те же', [...phones(msf)].every((p) => phones(msd).has(p)) && phones(msf).size === phones(msd).size,
    `${phones(msf).size} / ${phones(msd).size}`);

  const [uf, ud] = await Promise.all([get(PORT_FILE, tf, '/admin/users'), get(PORT_DB, td, '/admin/users')]);
  const uphones = (r) => new Set((Array.isArray(r) ? r : (r.users ?? [])).map((u) => u.phone));
  const lostUsers = [...uphones(uf)].filter((p) => !uphones(ud).has(p));
  check('учётные записи на месте', lostUsers.length === 0, lostUsers.slice(0, 5).join(', '));

  // Роли: пользователь без роли — это потерянный доступ, а не мелочь
  const rolesOf = (r) => new Map((Array.isArray(r) ? r : (r.users ?? [])).map((u) => [u.phone, [...(u.roles ?? [])].sort().join(',')]));
  const rf = rolesOf(uf);
  const rd = rolesOf(ud);
  const wrongRoles = [...rf].filter(([p, v]) => rd.has(p) && rd.get(p) !== v);
  check('роли совпадают', wrongRoles.length === 0, wrongRoles.slice(0, 5).map(([p, v]) => `${p}: ${v} ≠ ${rd.get(p)}`).join('; '));

  // Параметры: они правят поведением, и разъехавшееся значение меняет расчёты
  const [pf, pd] = await Promise.all([get(PORT_FILE, tf, '/admin/parameters'), get(PORT_DB, td, '/admin/parameters')]);
  const vals = (r) => new Map((Array.isArray(r) ? r : (r.parameters ?? [])).map((p) => [p.num, p.value]));
  const vf = vals(pf);
  const vd = vals(pd);
  const wrongParams = [...vf].filter(([n, v]) => vd.get(n) !== v);
  check('значения параметров совпадают', wrongParams.length === 0,
    wrongParams.slice(0, 5).map(([n, v]) => `${n}: ${String(v).slice(0, 20)} ≠ ${String(vd.get(n)).slice(0, 20)}`).join('; '));

  // Прайс: активный релиз и число позиций
  const [prf, prd] = await Promise.all([get(PORT_FILE, tf, '/pricing/active'), get(PORT_DB, td, '/pricing/active')]);
  check('активный релиз прайса тот же', prf.number === prd.number, `${prf.number} / ${prd.number}`);
  check('позиций в прайсе столько же', (prf.items ?? []).length === (prd.items ?? []).length,
    `${(prf.items ?? []).length} / ${(prd.items ?? []).length}`);

  console.log(`\n${'='.repeat(52)}\nПройдено: ${passed}   Провалено: ${failed}`);
  cleanup();
  process.exit(failed ? 1 : 0);
} catch (e) {
  console.error(String(e));
  cleanup();
  process.exit(1);
}
