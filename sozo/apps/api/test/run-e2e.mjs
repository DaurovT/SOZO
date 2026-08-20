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
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const API_DIR = join(HERE, '..');
const PORT = Number(process.env.E2E_PORT ?? 3111);
const ROOT = `http://localhost:${PORT}`;

const ALL = ['home-contour', 'web-card', 'b2b', 'b2b-access', 'client-app', 'locale'];
const suites = process.argv.slice(2).length ? process.argv.slice(2) : ALL;

const stateDir = mkdtempSync(join(tmpdir(), 'sozo-e2e-'));
const api = spawn('npx', ['ts-node', '--project', 'tsconfig.json', 'src/main.ts'], {
  cwd: API_DIR,
  env: { ...process.env, STATE_FILE: join(stateDir, 'state.json'), PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let apiLog = '';
api.stdout.on('data', (d) => (apiLog += d));
api.stderr.on('data', (d) => (apiLog += d));

function cleanup() {
  api.kill();
  rmSync(stateDir, { recursive: true, force: true });
}
process.on('SIGINT', () => { cleanup(); process.exit(130); });

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
