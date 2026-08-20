/**
 * Раннер e2e: поднимает API на одноразовом состоянии и гоняет набор.
 *
 * Зачем: наборы пишут в то же хранилище, что и рабочий сервер, и не убирают
 * за собой. Второй прогон подряд валится не потому, что код сломан, а потому
 * что подписка начислена дважды, а наряды и мастера остались с прошлого раза.
 * Отладка такого падения стоит часа, поэтому чистое состояние гарантируется
 * здесь, а не памятью запускающего.
 *
 *   node test/run-e2e.mjs home-contour
 *   node test/run-e2e.mjs            # все наборы по очереди
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const API_DIR = join(HERE, '..');
const PORT = Number(process.env.E2E_PORT ?? 3111);
const ROOT = `http://localhost:${PORT}`;

const ALL = ['home-contour', 'web-card', 'b2b', 'b2b-access', 'client-app', 'locale'];
const suites = process.argv.slice(2).length ? process.argv.slice(2) : ALL;

/** Свободен ли порт: занятый означает забытый сервер от прошлого прогона */
function portFree(port) {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });
}

if (!(await portFree(PORT))) {
  console.error(
    `Порт ${PORT} занят — вероятно, остался сервер от прерванного прогона.\n` +
      `Найти и снять:  pgrep -af "ts-node.*src/main.ts"  →  kill <pid>\n` +
      `Или задать другой порт:  E2E_PORT=3112 npm run test:e2e`,
  );
  process.exit(1);
}


// ---------------------------------------------------------------------------
// Одноразовая база на прогон
// ---------------------------------------------------------------------------
//
// Пока модули живут на state.json, база в прогоне не нужна и не поднимается:
// на машине без Docker набор обязан идти как прежде. Как только первый модуль
// переедет на Prisma, наборы начнут требовать схему — и лучше, чтобы к этому
// моменту контур уже работал, чем городить его посреди миграции.
//
// База именно одноразовая, а не общая: тесты пишут в те же таблицы, что и
// приложение, и второй прогон подряд валился бы на данных первого — ровно та
// беда, ради которой появился одноразовый state.json.

const COMPOSE = ['compose', '-f', join(API_DIR, '../../infra/docker-compose.yml')];
const MIGRATIONS = ['000_init', 'm7_buildings_rls', 'm7_shutdown_exclusion', 'm8_audit_actor_phone', 'm9_identity', 'm10_pricing', 'm11_crm'];

function psql(db, sql) {
  return execFileSync(
    'docker',
    [...COMPOSE, 'exec', '-T', 'postgres', 'psql', '-U', 'sozo', '-d', db, '-v', 'ON_ERROR_STOP=1', '-q'],
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  );
}

function postgresReady() {
  if (process.env.E2E_DB === 'off') return false;
  try {
    execFileSync('docker', [...COMPOSE, 'exec', '-T', 'postgres', 'pg_isready', '-U', 'sozo'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function createScratchDb() {
  const name = `sozo_e2e_${randomUUID().slice(0, 8)}`;
  psql('postgres', `CREATE DATABASE ${name};`);
  for (const m of MIGRATIONS) {
    psql(name, readFileSync(join(API_DIR, '../../prisma/migrations', m, 'migration.sql'), 'utf8'));
  }
  return name;
}

function dropScratchDb(name) {
  if (!name) return;
  try {
    psql('postgres', `DROP DATABASE IF EXISTS ${name} WITH (FORCE);`);
  } catch {
    // Не роняем прогон из-за неубранной базы: она одноразовая и с уникальным
    // именем, а сообщение об уборке маскировало бы результат тестов
  }
}

let scratchDb = null;
if (postgresReady()) {
  scratchDb = createScratchDb();
  console.log(`[e2e] одноразовая база: ${scratchDb}`);
} else {
  console.log('[e2e] PostgreSQL недоступен — прогон на файловом хранилище (E2E_DB=off отключает проверку)');
}

const stateDir = mkdtempSync(join(tmpdir(), 'sozo-e2e-'));
const api = spawn('npx', ['ts-node', '--project', 'tsconfig.json', 'src/main.ts'], {
  cwd: API_DIR,
  env: {
    ...process.env,
    STATE_FILE: join(stateDir, 'state.json'),
    PORT: String(PORT),
    ...(scratchDb ? { DATABASE_URL: `postgresql://sozo:sozo@127.0.0.1:5432/${scratchDb}` } : {}),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true, // своя группа процессов — иначе внука не снять
});
let apiLog = '';
api.stdout.on('data', (d) => (apiLog += d));
api.stderr.on('data', (d) => (apiLog += d));

let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  // Убиваем всю группу: ts-node запускает дочерний node, и kill() по
  // родителю оставлял внука жить и держать порт
  try { process.kill(-api.pid, 'SIGKILL'); } catch { api.kill('SIGKILL'); }
  rmSync(stateDir, { recursive: true, force: true });
  dropScratchDb(scratchDb);
}

// SIGTERM обязателен: его шлют timeout, CI при отмене задачи и обычный kill.
// Раньше обрабатывался только SIGINT — и прерванный прогон оставлял сервер
// на порту вместе с временным каталогом. Следующий запуск не мог занять порт,
// waitReady отвечал от чужого живого сервера, и падали все наборы разом:
// выглядело как поломка продукта, а было мусором от прошлого прогона.
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => { cleanup(); process.exit(sig === 'SIGINT' ? 130 : 143); });
}
process.on('exit', cleanup);

async function waitReady(timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (api.exitCode !== null) throw new Error(`API упал до готовности:\n${apiLog}`);
    try {
      const r = await fetch(`${ROOT}/v1/health`);
      if (r.ok) return;
    } catch {
      // сервер ещё поднимается — это ожидаемо, ждём дальше
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`API не поднялся за ${timeoutMs} мс:\n${apiLog}`);
}

const run = (file) =>
  new Promise((resolve) => {
    const p = spawn(process.execPath, [join(HERE, `${file}-e2e.mjs`), ROOT], { stdio: 'inherit' });
    p.on('exit', (code) => resolve(code ?? 1));
  });

try {
  await waitReady();
  const failed = [];
  for (const s of suites) if ((await run(s)) !== 0) failed.push(s);

  console.log(`\n${'='.repeat(60)}`);
  if (failed.length) {
    console.log(`Наборы с падениями: ${failed.join(', ')}`);
    cleanup();
    process.exit(1);
  }
  console.log(`Все наборы прошли: ${suites.join(', ')}`);
  cleanup();
  process.exit(0);
} catch (e) {
  console.error(String(e));
  cleanup();
  process.exit(1);
}
