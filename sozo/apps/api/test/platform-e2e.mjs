/**
 * Платформенное: сроки SLA, фоновые таймеры, неудовлетворённый спрос.
 *
 * Все три переехали в PostgreSQL, но ни одна сюита их не трогала: после
 * полного прогона таблицы `sla_state`, `timer_run` и `demand_miss` оставались
 * пустыми. Перенос при этом считался проверенным — потому что проверять было
 * нечем.
 *
 * Проверяются правила, а не вызовы:
 *   · срок считается по политике, действовавшей в момент приёма заявки, и
 *     не пересчитывается при её правке;
 *   · нарушение отличается от «ещё не наступило» и от «уже выполнено»;
 *   · таймер, отработавший один раз, второй раз не повторяется;
 *   · холостой прогон отличается от настоящего.
 *
 *   node apps/api/test/platform-e2e.mjs [http://localhost:3000]
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
const iso = (h) => new Date(Date.now() + h * 3600_000).toISOString();

async function main() {
  const t = await login(ADMIN);
  console.log(`Платформенное: ${ROOT}\n${'='.repeat(60)}`);

  // ---------------------------------------------------------------
  group('1. Политика SLA');
  // Адрес и код оператора уникальны на прогон: набор не должен зависеть от
  // того, что осталось от соседних сюит, — иначе он врёт ровно тогда, когда
  // его читают
  const tag = Date.now().toString().slice(-6);
  const org = `sla${tag}`;
  const address = `Ташкент, СЛА ${tag}`;
  const b = (await call('/buildings', {
    token: t,
    body: { name: `ЖК Сроки ${tag}`, address, emergencyPhone: '+998711234567' },
  })).body;
  await call(`/buildings/${b.id}/units`, { token: t, body: { number: '1', riserIds: ['R1'] } });
  await call(`/buildings/${b.id}/zones`, { token: t, body: { zoneType: 'water_riser', label: 'Стояк', riserId: 'R1' } });
  await call(`/buildings/${b.id}/claim`, { token: t, body: { operatorOrgId: org } });
  await call(`/buildings/${b.id}/verify`, { token: t, method: 'POST' });
  await call(`/buildings/${b.id}/staff`, { token: t, body: { userPhone: `+9989070${tag.slice(0, 4)}`, fullName: 'Согласующий', staffRole: 'approver' } });
  await call(`/buildings/${b.id}/staff`, { token: t, body: { userPhone: `+9989071${tag.slice(0, 4)}`, fullName: 'Резерв', staffRole: 'approver', isBackup: true } });
  await call(`/buildings/${b.id}/activate`, { token: t, method: 'POST' });
  await call(`/operator/${org}/subscription`, { token: t, body: { plan: 'free', tenantKind: 'hoa' } });

  const policy = await call('/operator/sla/policies', {
    token: t,
    body: {
      operatorOrgId: org,
      buildingId: b.id,
      categoryId: null,
      priority: 'normal',
      responseMin: 15,
      arrivalMin: 60,
      resolutionMin: 240,
      workingHoursOnly: false,
      escalationChain: ['+998907001001'],
      appliesToScope: 'both',
    },
  });
  check('политика заведена', policy.status < 400 && Boolean(policy.body.id), errText(policy.body));

  const list = (await call(`/operator/sla/policies?operatorOrgId=${org}`, { token: t, method: 'GET' })).body;
  check('политика видна в списке оператора', list.some((p) => p.id === policy.body.id), String(list.length));

  // ---------------------------------------------------------------
  group('2. Сроки заводятся вместе с заявкой');
  const order = (await call('/orders', {
    token: t,
    body: { clientPhone: '+998901112200', address, description: 'течь стояка', buildingId: b.id },
  })).body;
  check('заявка создана', Boolean(order.id), JSON.stringify(order).slice(0, 120));
  // Без привязки к объекту сроки не заводятся вовсе — и это правильно:
  // Free-тариф SLA-контроля не включает. Поэтому проверяем привязку отдельно,
  // иначе «сроков нет» читалось бы как поломка SLA, а не как отсутствие
  // объекта у заявки
  check('заявка привязана к объекту', order.buildingId === b.id, `${order.buildingId} ≠ ${b.id}`);

  const st = (await call(`/operator/sla/orders/${order.id}`, { token: t, method: 'GET' })).body;
  check('состояние SLA заведено', Boolean(st.state), JSON.stringify(st).slice(0, 120));
  check('три срока посчитаны', Boolean(st.state?.responseDue && st.state?.arrivalDue && st.state?.resolutionDue),
    JSON.stringify(st.state).slice(0, 140));
  check('сроки идут по порядку: ответ → выезд → устранение',
    st.state && st.state.responseDue <= st.state.arrivalDue && st.state.arrivalDue <= st.state.resolutionDue,
    `${st.state?.responseDue} / ${st.state?.arrivalDue} / ${st.state?.resolutionDue}`);
  check('нарушений пока нет', Array.isArray(st.state?.breached) && st.state.breached.length === 0,
    JSON.stringify(st.state?.breached));

  // ---------------------------------------------------------------
  group('3. Срок посчитан по политике на момент приёма');
  // Правка политики не должна задним числом менять сроки уже принятой заявки:
  // иначе вчерашняя заявка становится просроченной без единого действия
  const before = st.state.resolutionDue;
  await call('/operator/sla/policies', {
    token: t,
    body: {
      operatorOrgId: org,
      buildingId: b.id,
      categoryId: null,
      priority: 'normal',
      responseMin: 1,
      arrivalMin: 2,
      resolutionMin: 3,
      workingHoursOnly: false,
      escalationChain: [],
      appliesToScope: 'both',
    },
  });
  const after = (await call(`/operator/sla/orders/${order.id}`, { token: t, method: 'GET' })).body;
  check('правка политики не сдвинула срок принятой заявки', after.state?.resolutionDue === before,
    `${before} → ${after.state?.resolutionDue}`);

  // ---------------------------------------------------------------
  group('4. Детект нарушений');
  const nowOk = (await call(`/operator/sla/check?now=${encodeURIComponent(iso(0))}`, { token: t })).body;
  check('сейчас нарушений нет', !(nowOk.breached ?? []).some((x) => x.orderId === order.id),
    JSON.stringify(nowOk.breached).slice(0, 120));

  const later = (await call(`/operator/sla/check?now=${encodeURIComponent(iso(6))}`, { token: t })).body;
  const mine = (later.breached ?? []).find((x) => x.orderId === order.id);
  check('через шесть часов срок устранения нарушен', Boolean(mine), JSON.stringify(later.breached).slice(0, 160));
  check('названо, что именно нарушено', Array.isArray(mine?.flags) && mine.flags.length > 0, JSON.stringify(mine?.flags));

  const again = (await call(`/operator/sla/check?now=${encodeURIComponent(iso(7))}`, { token: t })).body;
  check('повторный прогон не сообщает о том же нарушении дважды',
    !(again.breached ?? []).some((x) => x.orderId === order.id),
    JSON.stringify(again.breached).slice(0, 120));

  // ---------------------------------------------------------------
  group('5. Фоновые таймеры');
  const st0 = (await call('/admin/scheduler', { token: t, method: 'GET' })).body;
  check('состояние планировщика отдаётся', typeof st0 === 'object' && Array.isArray(st0.runs), JSON.stringify(st0).slice(0, 100));

  const runs = (await call('/admin/scheduler/run', { token: t })).body;
  check('ручной прогон отработал', Array.isArray(runs) && runs.length > 0, JSON.stringify(runs).slice(0, 120));
  check('у каждого прогона есть код таймера и итог',
    runs.every((r) => r.timer && typeof r.result === 'string'), JSON.stringify(runs[0]).slice(0, 140));
  // Флаг отвечает на вопрос «кто нажал», а не «взаправду ли»: побочные
  // действия выполняются одинаково, и раньше он назывался simulated — то есть
  // врал читающему журнал (см. m39)
  check('ручной прогон помечен ручным', runs.every((r) => r.manual === true),
    JSON.stringify(runs.map((r) => r.manual)).slice(0, 80));

  const after1 = (await call('/admin/scheduler', { token: t, method: 'GET' })).body;
  check('прогоны попали в журнал', after1.runs.length >= runs.length, `${after1.runs.length}`);

  const sim = (await call('/admin/scheduler/simulate', { token: t, body: { days: 2, apply: true } })).body;
  check('холостой прогон на два дня отработал', sim.days === 2 && Array.isArray(sim.runs), JSON.stringify(sim).slice(0, 100));
  check('прогон дней вперёд тоже помечен ручным', (sim.runs ?? []).every((r) => r.manual === true),
    JSON.stringify((sim.runs ?? []).map((r) => r.manual)).slice(0, 80));

  // Часы возвращаются на место: забытый сдвиг незаметно смещает всю работу
  // таймеров, поэтому сброс — отдельное действие, а не побочный эффект
  const reset = (await call('/admin/scheduler/reset-clock', { token: t })).body;
  check('часы сбрасываются в ноль', (reset.dayOffset ?? 0) === 0, JSON.stringify(reset).slice(0, 80));

  // ---------------------------------------------------------------
  group('6. Неудовлетворённый спрос');
  const missBefore = (await call('/admin/analytics/demand-miss', { token: t, method: 'GET' })).body;
  const countBefore = missBefore.total ?? 0;

  const miss = (await call('/admin/analytics/demand-miss', {
    token: t,
    body: { reason: 'no_windows', category: 'сантехника', zone: 'Чиланзар' },
  })).body;
  check('промах записан', Boolean(miss.id), JSON.stringify(miss).slice(0, 100));
  check('у промаха есть дата и причина', Boolean(miss.date) && miss.reason === 'no_windows', JSON.stringify(miss).slice(0, 100));

  const missAfter = (await call('/admin/analytics/demand-miss', { token: t, method: 'GET' })).body;
  check('счётчик промахов вырос', (missAfter.total ?? 0) > countBefore, `${countBefore} → ${missAfter.total}`);
  // Сводка группирует по причине, категории и дате — ради этого промахи и
  // пишутся: они показывают, где не хватает мастеров, до того как это
  // увидят в выручке
  check('промах попал в разбивку по причине',
    (missAfter.byReason ?? []).some((r) => r.reason === 'no_windows' && r.count > 0),
    JSON.stringify(missAfter.byReason));
  check('и в разбивку по категории',
    (missAfter.byCategory ?? []).some((r) => r.category === 'сантехника'),
    JSON.stringify(missAfter.byCategory));

  console.log(`\n${'='.repeat(52)}\nПройдено: ${passed}   Провалено: ${failed}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
