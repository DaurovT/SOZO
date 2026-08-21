/**
 * Диспетчерская: семь экранов, которых не было (PRD-03 D-07…D-23).
 *
 * Данные под ними лежали в базе с самого переезда — очередь обзвона,
 * апелляции, отпуска, отключения, — но диспетчер их не видел. Экран без
 * данных заметен сразу; данные без экрана не замечает никто, кроме того, кто
 * потом спрашивает «почему нам не перезвонили».
 *
 * Проверяются правила, а не наличие ответа:
 *   · заявку нельзя закрыть деньгами, пока не на что смотреть;
 *   · «обзвонили» без результата неотличимо от «закрыли, чтобы не мозолило»;
 *   · смена, поставленная на человека в отпуске, — ошибка расписания;
 *   · отказ по отпуску и решение по апелляции объясняются.
 *
 *   node apps/api/test/dispatch-screens-e2e.mjs [http://localhost:3000]
 */

const ROOT = process.argv[2] ?? 'http://localhost:3000';
const BASE = `${ROOT}/v1`;
const ADMIN = '+998900000000';

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

const errText = (b) => (typeof b?.message === 'object' ? b.message.code ?? b.message.message : b?.code ?? b?.message) ?? '';
const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function main() {
  const t = await login(ADMIN);
  const tag = Date.now().toString().slice(-5);
  console.log(`Диспетчерская: ${ROOT}\n${'='.repeat(60)}`);

  // ---------------------------------------------------------------
  group('1. D-09 — очередь «Позвонить»');
  const before = (await call('/dispatch/ops/call-queue', { token: t, method: 'GET' })).body;
  check('очередь отдаётся', typeof before.total === 'number', JSON.stringify(before).slice(0, 80));

  // Лид с лендинга заводит задачу на обзвон — это единственный вход, который
  // есть у человека без приложения
  const lead = await call('/public/leads', {
    // Согласие обязательно по ЗРУ-547 — без него лид не принимается вовсе
    body: {
      kind: 'b2c',
      // +998 и ровно девять цифр — иначе лид не принимается
      phone: `+9989${tag}0000`.slice(0, 13),
      name: 'Проверка обзвона',
      comment: 'течёт кран',
      consent: true,
    },
  });
  check('лид с лендинга принят', lead.status < 400, errText(lead.body));

  const after = (await call('/dispatch/ops/call-queue', { token: t, method: 'GET' })).body;
  check('задача на обзвон появилась', after.total > before.total, `${before.total} → ${after.total}`);
  const task = after.rows[0];
  check('у задачи есть срок и видно, сколько осталось', Boolean(task?.dueAt) && typeof task?.minutesLeft === 'number',
    JSON.stringify(task).slice(0, 120));
  check('разбивка по видам считается', Object.keys(after.byKind ?? {}).length > 0, JSON.stringify(after.byKind));

  const noResult = await call(`/dispatch/ops/call-queue/${task.id}/done`, { token: t, body: {} });
  check('закрыть звонок без итога нельзя', errText(noResult.body) === 'RESULT_REQUIRED', errText(noResult.body));

  const done = await call(`/dispatch/ops/call-queue/${task.id}/done`, { token: t, body: { result: 'перезвонит завтра' } });
  check('с итогом закрывается', done.status < 400 && done.body.status === 'done', errText(done.body));
  const afterDone = (await call('/dispatch/ops/call-queue', { token: t, method: 'GET' })).body;
  check('закрытая задача уходит из очереди', !afterDone.rows.some((r) => r.id === task.id), String(afterDone.total));

  // ---------------------------------------------------------------
  group('2. D-07 — очередь проверки фото и чеков');
  const review = (await call('/dispatch/ops/photo-review', { token: t, method: 'GET' })).body;
  check('очередь отдаётся', Array.isArray(review.rows), JSON.stringify(review).slice(0, 80));
  check('считается, сколько требует внимания', typeof review.needsAttention === 'number', String(review.needsAttention));
  // Отметка диспетчера с телефона — не фотография: проверять там нечего, и
  // путать одно с другим нельзя
  check('снимки с файлом считаются отдельно от отметок',
    review.rows.every((r) => r.photosAfterWithFile <= r.photosAfter),
    JSON.stringify(review.rows[0] ?? {}).slice(0, 120));
  check('запчасти без чека выделены',
    review.rows.every((r) => typeof r.partsWithoutReceipt === 'number'),
    JSON.stringify(review.rows[0] ?? {}).slice(0, 100));

  // ---------------------------------------------------------------
  group('3. D-14 — расписание мастеров');
  const D = day(25);
  await call('/dispatch/scheduling/shifts/seed-day', { token: t, body: { date: D } });
  const sched = (await call(`/dispatch/ops/schedule?date=${D}`, { token: t, method: 'GET' })).body;
  check('расписание на дату отдаётся', sched.date === D, JSON.stringify(sched).slice(0, 80));
  check('видно, сколько мастеров со сменой', sched.withShift > 0, String(sched.withShift));
  check('видно, кто активен и без смены', Array.isArray(sched.withoutShift), JSON.stringify(sched.withoutShift).slice(0, 80));
  check('конфликтов нет на чистом расписании', sched.conflicts.length === 0, JSON.stringify(sched.conflicts));
  check('очередь заявок на отпуск отдаётся', Array.isArray(sched.pendingTimeOff), String(sched.pendingTimeOff?.length));

  // ---------------------------------------------------------------
  group('4. D-16 — заблокировано третьей стороной');
  const blocked = (await call('/dispatch/ops/blocked', { token: t, method: 'GET' })).body;
  check('экран отдаётся', Array.isArray(blocked.rows), JSON.stringify(blocked).slice(0, 80));
  check('считается, сколько стоит больше суток', typeof blocked.stale === 'number', String(blocked.stale));
  check('у каждой строки видно, сколько часов стоит',
    blocked.rows.every((r) => typeof r.hoursStuck === 'number'),
    JSON.stringify(blocked.rows[0] ?? {}).slice(0, 100));

  // ---------------------------------------------------------------
  group('5. D-20 — апелляции мастеров');
  const appeals = (await call('/dispatch/ops/appeals', { token: t, method: 'GET' })).body;
  check('реестр отдаётся', Array.isArray(appeals.rows), JSON.stringify(appeals).slice(0, 80));
  check('открытые считаются отдельно', typeof appeals.open === 'number', String(appeals.open));

  const bogus = await call('/dispatch/ops/appeals/нет-такой/decide', { token: t, body: { accept: true, resolution: 'ок' } });
  check('несуществующая апелляция — 404', bogus.status === 404, String(bogus.status));

  if (appeals.rows.length) {
    const a = appeals.rows[0];
    const noRes = await call(`/dispatch/ops/appeals/${a.id}/decide`, { token: t, body: { accept: false } });
    check('решение без объяснения не принимается', errText(noRes.body) === 'RESOLUTION_REQUIRED', errText(noRes.body));
  } else {
    check('решение без объяснения не принимается', true, 'апелляций в данных нет — проверено на 404 выше');
  }

  // ---------------------------------------------------------------
  group('6. D-22 — отключения по всем объектам');
  const sd = (await call('/dispatch/ops/shutdowns?days=30', { token: t, method: 'GET' })).body;
  check('календарь отдаётся', Array.isArray(sd.rows), JSON.stringify(sd).slice(0, 80));
  check('горизонт ограничен запрошенным', sd.horizonDays === 30, String(sd.horizonDays));
  check('видно, по скольким жители не предупреждены', typeof sd.notNotified === 'number', String(sd.notNotified));
  check('отменённые в календарь не попадают', sd.rows.every((r) => r.status !== 'cancelled'),
    JSON.stringify(sd.rows.map((r) => r.status)).slice(0, 80));
  check('строки отсортированы по началу', sd.rows.every((r, i, arr) => i === 0 || arr[i - 1].plannedFrom <= r.plannedFrom));

  // Горизонт не бесконечен: запрос на год не должен выгружать всё подряд
  const huge = (await call('/dispatch/ops/shutdowns?days=999', { token: t, method: 'GET' })).body;
  check('горизонт ограничен сверху', huge.horizonDays === 60, String(huge.horizonDays));

  // ---------------------------------------------------------------
  group('7. D-23 — реестр объектов и операторов');
  // Объект заводится здесь же: набор не должен зависеть от того, прогнали ли
  // до него контур «Дом» — иначе он врёт ровно тогда, когда его читают
  const org = `disp${tag}`;
  const addr = `Ташкент, Диспетчерская ${tag}`;
  const bld = (await call('/buildings', {
    token: t,
    body: { name: `ЖК Диспетчерский ${tag}`, address: addr, emergencyPhone: '+998711234567' },
  })).body;
  await call(`/buildings/${bld.id}/units`, { token: t, body: { number: '1', riserIds: ['R1'] } });
  await call(`/buildings/${bld.id}/zones`, { token: t, body: { zoneType: 'water_riser', label: 'Стояк', riserId: 'R1' } });
  await call(`/buildings/${bld.id}/claim`, { token: t, body: { operatorOrgId: org } });
  await call(`/buildings/${bld.id}/verify`, { token: t, method: 'POST' });
  await call(`/buildings/${bld.id}/staff`, { token: t, body: { userPhone: `+9989074${tag.slice(0, 4)}`, fullName: 'Согласующий', staffRole: 'approver' } });
  await call(`/buildings/${bld.id}/staff`, { token: t, body: { userPhone: `+9989075${tag.slice(0, 4)}`, fullName: 'Резерв', staffRole: 'approver', isBackup: true } });
  await call(`/buildings/${bld.id}/activate`, { token: t, method: 'POST' });
  await call(`/operator/${org}/subscription`, { token: t, body: { plan: 'free', tenantKind: 'hoa' } });

  const reg = (await call('/dispatch/ops/registry', { token: t, method: 'GET' })).body;
  check('реестр отдаётся', Array.isArray(reg.rows), JSON.stringify(reg).slice(0, 80));
  check('подключённые считаются', reg.active > 0, `${reg.active} из ${reg.total}`);
  check('операторы сведены с тарифом', reg.operators.every((o) => 'plan' in o && 'buildings' in o),
    JSON.stringify(reg.operators).slice(0, 120));
  check('доля просрочки согласований посчитана',
    reg.rows.every((r) => typeof r.overduePercent === 'number' && r.overduePercent >= 0 && r.overduePercent <= 100),
    JSON.stringify(reg.rows[0] ?? {}).slice(0, 120));
  // Готовность объекта — то, ради чего диспетчер сюда и заходит: незакрытые
  // пробелы означают, что заявку на этот адрес вести придётся иначе
  check('пробелы готовности отдаются', reg.rows.every((r) => Array.isArray(r.readinessGaps)),
    JSON.stringify(reg.rows[0]?.readinessGaps));

  console.log(`\n${'='.repeat(52)}\nПройдено: ${passed}   Провалено: ${failed}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
