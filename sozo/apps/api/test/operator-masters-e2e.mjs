/**
 * U-05: свои мастера оператора (DEV-15 §7.1).
 *
 * Проверяются границы, а не вызовы. Их четыре, и каждая закрывает свой способ
 * ошибиться:
 *
 *   · оператор видит только своих мастеров — чужой для него не существует;
 *   · поставить на заявку можно только своего и только действующего;
 *   · частная заявка жителя оператору не достаётся, пока он не взял её по
 *     праву первой руки;
 *   · мастер может работать у двух операторов сразу, и второй договор не
 *     отменяет первый.
 *
 *   node apps/api/test/operator-masters-e2e.mjs [http://localhost:3000]
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

async function setupBuilding(t, tag, org) {
  const address = `Ташкент, Мастерская ${tag}`;
  const b = (await call('/buildings', {
    token: t,
    body: { name: `ЖК Мастера ${tag}`, address, emergencyPhone: '+998711234567' },
  })).body;
  await call(`/buildings/${b.id}/units`, { token: t, body: { number: '1', riserIds: ['R1'] } });
  await call(`/buildings/${b.id}/zones`, { token: t, body: { zoneType: 'water_riser', label: 'Стояк', riserId: 'R1' } });
  await call(`/buildings/${b.id}/claim`, { token: t, body: { operatorOrgId: org } });
  await call(`/buildings/${b.id}/verify`, { token: t, method: 'POST' });
  await call(`/buildings/${b.id}/staff`, { token: t, body: { userPhone: `+9989072${tag}`, fullName: 'Согласующий', staffRole: 'approver' } });
  await call(`/buildings/${b.id}/staff`, { token: t, body: { userPhone: `+9989073${tag}`, fullName: 'Резерв', staffRole: 'approver', isBackup: true } });
  await call(`/buildings/${b.id}/activate`, { token: t, method: 'POST' });
  await call(`/operator/${org}/subscription`, { token: t, body: { plan: 'pro', tenantKind: 'hoa', priceTiyin: 300000000 } });
  return { id: b.id, address };
}

async function main() {
  const t = await login(ADMIN);
  const tag = Date.now().toString().slice(-4);
  const orgA = `mst-a${tag}`;
  const orgB = `mst-b${tag}`;

  console.log(`Свои мастера: ${ROOT}\n${'='.repeat(60)}`);

  const bA = await setupBuilding(t, tag, orgA);
  const bB = await setupBuilding(t, `${tag}9`, orgB);

  // ---------------------------------------------------------------
  group('1. Оператор заводит своего мастера');
  const empty = (await call(`/operator/${orgA}/masters`, { token: t, method: 'GET' })).body;
  check('до найма реестр пуст', empty.total === 0, JSON.stringify(empty).slice(0, 80));

  const bad = await call(`/operator/${orgA}/masters`, { token: t, body: { fullName: 'Без телефона' } });
  check('без телефона мастера не завести', bad.status >= 400 && errText(bad.body) === 'PHONE_INVALID', errText(bad.body));

  const phone = `+99893${tag}0001`.slice(0, 13);
  const hired = await call(`/operator/${orgA}/masters`, {
    token: t,
    body: { fullName: 'Слесарь Штатный', phone, skillTags: ['сантехника'], hourlyCostTiyin: 3_000_000 },
  });
  check('мастер заведён', hired.status < 400 && Boolean(hired.body.masterId), errText(hired.body));
  const masterA = hired.body.masterId;

  const again = await call(`/operator/${orgA}/masters`, { token: t, body: { fullName: 'Он же', phone } });
  check('дважды завести того же нельзя', errText(again.body) === 'ALREADY_AFFILIATED', errText(again.body));

  const reg = (await call(`/operator/${orgA}/masters`, { token: t, method: 'GET' })).body;
  check('мастер виден в реестре', reg.rows.some((r) => r.masterId === masterA), String(reg.total));
  check('видно, что смены на сегодня нет', reg.withoutShift >= 1, JSON.stringify(reg.rows[0]?.load));
  check('ставка сохранена', reg.rows[0]?.hourlyCostTiyin === 3_000_000, String(reg.rows[0]?.hourlyCostTiyin));
  // Экзамен для штатного мастера оператора необязателен (DEV-15 §7.1.1):
  // иначе оператор не смог бы поставить на заявку собственного слесаря
  check('карточка сразу рабочая, а не «кандидат»', reg.rows[0]?.platformStatus === 'active', String(reg.rows[0]?.platformStatus));

  // ---------------------------------------------------------------
  group('2. Чужой мастер для оператора не существует');
  const regB = (await call(`/operator/${orgB}/masters`, { token: t, method: 'GET' })).body;
  check('в реестре второго оператора его нет', !regB.rows.some((r) => r.masterId === masterA), String(regB.total));

  // ---------------------------------------------------------------
  group('3. Назначение на заявку');
  const orderA = (await call('/orders', {
    token: t,
    body: { clientPhone: '+998901110099', address: bA.address, description: 'течь в подъезде', buildingId: bA.id, scope: 'common_area' },
  })).body;
  check('заявка по общему имуществу создана', orderA.orderScope === 'common_area', String(orderA.orderScope));

  // Неоценённую заявку назначать некому: конвейер требует оценки, и оператор
  // должен получить это сообщение, а не «нарушение графа»
  const tooEarly = await call(`/operator/${orgA}/orders/${orderA.id}/assign`, { token: t, body: { masterId: masterA } });
  check('неоценённую заявку назначить нельзя, и сказано почему',
    errText(tooEarly.body) === 'ORDER_NOT_ESTIMATED', errText(tooEarly.body));

  const v1 = (await call(`/dispatch/orders/${orderA.id}`, { token: t, method: 'GET' })).body.version;
  await call(`/dispatch/orders/${orderA.id}/transitions`, { token: t, body: { action: 'estimate', version: v1 } });

  const assigned = await call(`/operator/${orgA}/orders/${orderA.id}/assign`, { token: t, body: { masterId: masterA } });
  check('свой мастер назначается', assigned.status < 400, errText(assigned.body));
  check('и записан в заявку', assigned.body?.masterId === masterA, String(assigned.body?.masterId));

  const foreign = await call(`/operator/${orgB}/orders/${orderA.id}/assign`, { token: t, body: { masterId: masterA } });
  check('чужой оператор на эту заявку не назначает', foreign.status >= 400, errText(foreign.body));

  // Частная заявка жителя: оператору она не достаётся, пока он не взял её
  // по праву первой руки — это граница между «его работой» и работой
  // платформы (ТЗ §19.3)
  const priv = (await call('/orders', {
    token: t,
    body: { clientPhone: '+998901110098', address: bA.address, description: 'кран в квартире', buildingId: bA.id },
  })).body;
  const privAssign = await call(`/operator/${orgA}/orders/${priv.id}/assign`, { token: t, body: { masterId: masterA } });
  check('частную заявку жителя без первой руки назначить нельзя',
    privAssign.status >= 400 && errText(privAssign.body) === 'NOT_YOUR_ORDER', errText(privAssign.body));

  // ---------------------------------------------------------------
  group('4. Приостановка');
  const noReason = await call(`/operator/${orgA}/masters/${masterA}/suspend`, { token: t, body: {} });
  check('приостановить без причины нельзя', errText(noReason.body) === 'REASON_REQUIRED', errText(noReason.body));

  const susp = await call(`/operator/${orgA}/masters/${masterA}/suspend`, { token: t, body: { reason: 'нет аттестации по электробезопасности' } });
  check('приостановка с причиной проходит', susp.status < 400 && susp.body.status === 'suspended', errText(susp.body));

  const order2 = (await call('/orders', {
    token: t,
    body: { clientPhone: '+998901110097', address: bA.address, description: 'вторая течь', buildingId: bA.id, scope: 'common_area' },
  })).body;
  const v2 = (await call(`/dispatch/orders/${order2.id}`, { token: t, method: 'GET' })).body.version;
  await call(`/dispatch/orders/${order2.id}/transitions`, { token: t, body: { action: 'estimate', version: v2 } });
  const blocked = await call(`/operator/${orgA}/orders/${order2.id}/assign`, { token: t, body: { masterId: masterA } });
  check('приостановленного на заявку не поставить',
    blocked.status >= 400 && errText(blocked.body) === 'NOT_YOUR_MASTER', errText(blocked.body));

  const resumed = await call(`/operator/${orgA}/masters/${masterA}/resume`, { token: t });
  check('возврат снимает приостановку', resumed.body?.status === 'active', errText(resumed.body));
  check('причина стёрта вместе с приостановкой', !resumed.body?.suspendReason, String(resumed.body?.suspendReason));

  const afterResume = await call(`/operator/${orgA}/orders/${order2.id}/assign`, { token: t, body: { masterId: masterA } });
  check('после возврата назначается снова', afterResume.status < 400, errText(afterResume.body));

  // ---------------------------------------------------------------
  group('5. Мастер у двух операторов сразу');
  // Управляющая компания и подрядчик — обычный случай. Второй договор не
  // отменяет первый, иначе человек теряет половину работы молча
  const second = await call(`/operator/${orgB}/masters`, { token: t, body: { masterId: masterA, hourlyCostTiyin: 4_000_000 } });
  check('второй оператор нанимает того же мастера', second.status < 400, errText(second.body));

  const regA2 = (await call(`/operator/${orgA}/masters`, { token: t, method: 'GET' })).body;
  const regB2 = (await call(`/operator/${orgB}/masters`, { token: t, method: 'GET' })).body;
  check('он остался у первого', regA2.rows.some((r) => r.masterId === masterA && r.status === 'active'));
  check('и появился у второго', regB2.rows.some((r) => r.masterId === masterA && r.status === 'active'));
  check('ставки у операторов разные',
    regA2.rows.find((r) => r.masterId === masterA)?.hourlyCostTiyin !== regB2.rows.find((r) => r.masterId === masterA)?.hourlyCostTiyin,
    `${regA2.rows.find((r) => r.masterId === masterA)?.hourlyCostTiyin} / ${regB2.rows.find((r) => r.masterId === masterA)?.hourlyCostTiyin}`);

  // ---------------------------------------------------------------
  group('6. Прекращение договора');
  const term = await call(`/operator/${orgB}/masters/${masterA}/terminate`, { token: t, body: {} });
  check('договор прекращается', term.body?.status === 'terminated', errText(term.body));

  const orderB = (await call('/orders', {
    token: t,
    body: { clientPhone: '+998901110096', address: bB.address, description: 'течь у второго', buildingId: bB.id, scope: 'common_area' },
  })).body;
  const vB = (await call(`/dispatch/orders/${orderB.id}`, { token: t, method: 'GET' })).body.version;
  await call(`/dispatch/orders/${orderB.id}/transitions`, { token: t, body: { action: 'estimate', version: vB } });
  const afterTerm = await call(`/operator/${orgB}/orders/${orderB.id}/assign`, { token: t, body: { masterId: masterA } });
  check('после прекращения назначить нельзя', afterTerm.status >= 400, errText(afterTerm.body));

  const revive = await call(`/operator/${orgB}/masters/${masterA}/resume`, { token: t });
  check('вернуть прекращённый договор нельзя — только оформить заново',
    revive.status >= 400 && errText(revive.body) === 'TERMINATED', errText(revive.body));

  const rehired = await call(`/operator/${orgB}/masters`, { token: t, body: { masterId: masterA, hourlyCostTiyin: 5_000_000 } });
  check('заново оформить можно', rehired.status < 400 && rehired.body.status === 'active', errText(rehired.body));
  check('у первого оператора это ничего не изменило',
    (await call(`/operator/${orgA}/masters`, { token: t, method: 'GET' })).body.rows.some((r) => r.masterId === masterA && r.status === 'active'));

  console.log(`\n${'='.repeat(52)}\nПройдено: ${passed}   Провалено: ${failed}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
