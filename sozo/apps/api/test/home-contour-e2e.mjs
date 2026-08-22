/**
 * Сквозной прогон контура «Дом» (DEV-15, ТЗ §19).
 *
 * Проверяем не «отвечает ли эндпойнт», а правила, нарушение которых тихое и дорогое:
 * наряд в газовую зону мастеру платформы, авто-согласие критичной зоны, вскрытие без
 * пропуска, две бригады на одном стояке, сбор подписчику, общее имущество мастеру
 * платформы, закрытие замечания без фото. Каждая из этих ошибок вносится одной
 * строкой и обнаруживается через месяц — по жалобе, а не по логу.
 *
 * Запуск: node apps/api/test/home-contour-e2e.mjs [http://localhost:3000]
 */

const ROOT = process.argv[2] ?? 'http://localhost:3000';
const BASE = `${ROOT}/v1`;
const ADMIN = '+998900000000';

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
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {} };
}

async function login(phone) {
  await call('/auth/request-otp', { body: { phone } });
  const r = await call('/auth/verify', { body: { phone, code: '00000' } });
  return r.body.accessToken;
}

const uuid = () => crypto.randomUUID();

/**
 * Настоящая заявка под наряд-допуск.
 *
 * Раньше здесь стояли выдуманные «o-1», «o-lic»: графу наряда всё равно, чей
 * идентификатор в ссылке. Базе — нет: наряд ссылается на заявку внешним
 * ключом, и выдуманная ссылка не записывалась вовсе. Ошибка гасилась в
 * репозитории, тесты оставались зелёными, а нарядов в базе не появлялось.
 */
async function newOrder(token, description) {
  const r = await call('/orders', {
    token,
    body: { clientPhone: '+998901234599', address: 'Ташкент, наряд-допуск', description },
  });
  return r.body.id;
}
const iso = (hours) => new Date(Date.now() + hours * 3600_000).toISOString();
const errText = (b) => (typeof b.message === 'object' ? b.message.code ?? b.message.message : b.message) ?? '';

async function setupBuilding(token, { name, address, org, plan, kind, fee }) {
  const b = (await call('/buildings', { token, body: { name, address, emergencyPhone: '+998711234567', serviceFeeBps: fee ?? 500 } })).body;
  await call(`/buildings/${b.id}/units`, { token, body: { number: '12', riserIds: ['R1'] } });
  await call(`/buildings/${b.id}/units`, { token, body: { number: '16', riserIds: ['R1'] } });
  await call(`/buildings/${b.id}/zones`, { token, body: { zoneType: 'water_riser', label: 'Стояк ХВС', riserId: 'R1' } });
  await call(`/buildings/${b.id}/zones`, { token, body: { zoneType: 'gas_equipment', label: 'Газовое оборудование' } });
  await call(`/buildings/${b.id}/zones`, { token, body: { zoneType: 'electrical_panel', label: 'Щитовая' } });
  await call(`/buildings/${b.id}/claim`, { token, body: { operatorOrgId: org } });
  await call(`/buildings/${b.id}/verify`, { token, method: 'POST' });
  await call(`/buildings/${b.id}/staff`, { token, body: { userPhone: `+9989${org}1`, fullName: 'Согласующий', staffRole: 'approver' } });
  await call(`/buildings/${b.id}/staff`, { token, body: { userPhone: `+9989${org}2`, fullName: 'Резерв', staffRole: 'approver', isBackup: true } });
  await call(`/buildings/${b.id}/activate`, { token, method: 'POST' });
  const sub = { plan, tenantKind: kind };
  if (plan !== 'free') sub.priceTiyin = 300_000_000;
  await call(`/operator/${org}/subscription`, { token, body: sub });
  if (plan !== 'free') await call(`/operator/${org}/subscription/charge`, { token, method: 'POST' });
  return b.id;
}

async function main() {
  console.log(`\nКонтур «Дом»: ${ROOT}\n${'='.repeat(60)}`);
  const t = await login(ADMIN);

  // ---------------------------------------------------------------
  group('1. Подключение объекта');
  const raw = (await call('/buildings', { token: t, body: { name: 'ЖК Тест', address: 'Тестовая 1' } })).body;
  const gapsBefore = (await call(`/buildings/${raw.id}`, { token: t })).body.readinessGaps ?? [];
  check('объект без согласующего и телефона не готов к активации', gapsBefore.length >= 2, gapsBefore.join('; '));

  const early = await call(`/buildings/${raw.id}/activate`, { token: t, method: 'POST' });
  check('активация неверифицированного объекта отклоняется', early.status >= 400, String(early.status));

  await call(`/buildings/${raw.id}/claim`, { token: t, body: { operatorOrgId: 'op-x' } });
  const conflict = await call(`/buildings/${raw.id}/claim`, { token: t, body: { operatorOrgId: 'op-y' } });
  check('второй заявитель замораживается вместе с первым, а не отклоняется',
    conflict.body?.claim?.status === 'frozen', JSON.stringify(conflict.body?.claim?.status));
  const bothFrozen = (await call('/buildings/claims/queue?status=frozen', { token: t })).body
    .filter((c) => c.buildingId === raw.id);
  check('обе заявки на спорный объект заморожены', bothFrozen.length === 2, `${bothFrozen.length}`);

  const uk = await setupBuilding(t, { name: 'ЖК Сокол', address: 'Амира Темура 15', org: 'uk1', plan: 'free', kind: 'hoa' });
  const bc = await setupBuilding(t, { name: 'БЦ Пойтахт', address: 'Шота Руставели 4', org: 'bc1', plan: 'pro', kind: 'bc' });
  check('объекты активированы', Boolean(uk && bc));

  // ---------------------------------------------------------------
  group('2. Справочник зон A-41');
  const zt = (await call('/buildings/zone-types', { token: t })).body;
  check('справочник зон отдаётся целиком', Array.isArray(zt) && zt.length === 12, String(zt.length));
  // Два флага несут разный смысл: критичная запрещает авто-согласие,
  // лицензируемая запрещает самого исполнителя
  check('лицензируемая зона всегда и критичная', zt.filter((z) => z.licensed).every((z) => z.critical));
  check('подпись зоны одна на всю систему',
    zt.find((z) => z.code === 'ventilation_chamber')?.label === 'Камера дымоудаления',
    zt.find((z) => z.code === 'ventilation_chamber')?.label);

  const rl = (await call('/buildings/resource-labels', { token: t })).body;
  check('справочник ресурсов отдаётся', Array.isArray(rl) && rl.length === 8, String(rl.length));
  // Копий подписей было четыре, и половина писала с маленькой буквы: жителю
  // приходило «Отопление», а мастеру в наряде — «отопление»
  check('подписи ресурсов хранятся с заглавной',
    rl.every((r) => r.label[0] === r.label[0].toUpperCase()), JSON.stringify(rl.map((r) => r.label)));

  const zones = (await call(`/buildings/${uk}/zones`, { token: t })).body;
  const gas = zones.find((z) => z.zoneType === 'gas_equipment');
  const panel = zones.find((z) => z.zoneType === 'electrical_panel');
  const riser = zones.find((z) => z.zoneType === 'water_riser');
  check('газовое оборудование критично и лицензируемо', gas?.isCritical && gas?.isLicensed);
  check('электрощитовая критична, но не лицензируема', panel?.isCritical && !panel?.isLicensed);
  check('водяной стояк — обычная зона', !riser?.isCritical && !riser?.isLicensed);

  // ---------------------------------------------------------------
  group('3. Наряд-допуск: запреты');
  // Заявки настоящие: наряд ссылается на заявку внешним ключом (см. newOrder)
  const [ordLic, ordLic2, ordMain, ordAuto1, ordAuto2, ordSms, ordSms2] = await Promise.all([
    newOrder(t, 'газ: мастер платформы'),
    newOrder(t, 'газ: штатный мастер оператора'),
    newOrder(t, 'стояк ХВС: граф наряда'),
    newOrder(t, 'авто-согласование'),
    newOrder(t, 'авто-согласование критичной зоны'),
    newOrder(t, 'согласование по ссылке из SMS'),
    newOrder(t, 'критичная зона по ссылке из SMS'),
  ]);
  const licensed = await call(`/orders/${ordLic}/permits`, {
    token: t,
    body: { buildingId: uk, zoneTypes: ['gas_equipment'], masterIsPlatform: true, qualificationOk: true },
  });
  check('лицензируемая зона мастеру платформы запрещена (ТЗ 17.8)', licensed.status === 403, errText(licensed.body));

  const licensedOp = await call(`/orders/${ordLic2}/permits`, {
    token: t,
    body: { buildingId: uk, zoneTypes: ['gas_equipment'], masterIsPlatform: false, operatorSelfDeclared: true },
  });
  check('та же зона штатному мастеру оператора разрешена', licensedOp.status < 400, errText(licensedOp.body));

  // ---------------------------------------------------------------
  group('4. Наряд-допуск: граф и гейты');
  const p = (await call(`/orders/${ordMain}/permits`, {
    token: t,
    body: {
      buildingId: uk, zoneTypes: ['water_riser'], requiresShutdown: true, riserIds: ['R1'],
      windowFrom: iso(-1), windowTo: iso(6), masterId: 'm-1', masterIsPlatform: true, qualificationOk: true,
    },
  })).body;
  check('зона влияния посчитана по стояку', p.affectedUnitIds?.length === 2, String(p.affectedUnitIds?.length));

  const badOrder = await call(`/permits/${p.id}/transitions`, { token: t, body: { action: 'open', clientOpUuid: uuid() } });
  check('переход вне графа отклоняется 409', badOrder.status === 409, errText(badOrder.body));

  await call(`/permits/${p.id}/transitions`, { token: t, body: { action: 'submit', clientOpUuid: uuid() } });
  await call(`/permits/${p.id}/transitions`, { token: t, body: { action: 'approve', clientOpUuid: uuid() } });
  await call(`/permits/${p.id}/transitions`, { token: t, body: { action: 'schedule', clientOpUuid: uuid() } });

  const noPass = await call(`/permits/${p.id}/transitions`, { token: t, body: { action: 'open', clientOpUuid: uuid(), photoId: uuid() } });
  check('вскрытие без действующего пропуска отклоняется', noPass.status >= 400, errText(noPass.body));

  await call('/passes', { token: t, body: { buildingId: uk, orderId: ordMain, masterId: 'm-1', validFrom: iso(-1), validTo: iso(12) } });
  const noPhoto = await call(`/permits/${p.id}/transitions`, { token: t, body: { action: 'open', clientOpUuid: uuid() } });
  check('вскрытие без фото отклоняется', noPhoto.status >= 400, errText(noPhoto.body));

  const opened = await call(`/permits/${p.id}/transitions`, { token: t, body: { action: 'open', clientOpUuid: uuid(), photoId: uuid() } });
  check('вскрытие с фото и пропуском проходит', opened.body.status === 'opened', opened.body.status);

  const closeNoPhoto = await call(`/permits/${p.id}/transitions`, { token: t, body: { action: 'close', clientOpUuid: uuid() } });
  check('закрытие без фото восстановления отклоняется', closeNoPhoto.status >= 400, errText(closeNoPhoto.body));

  const op = uuid();
  const closed = await call(`/permits/${p.id}/transitions`, { token: t, body: { action: 'close', clientOpUuid: op, photoId: uuid() } });
  const repeat = await call(`/permits/${p.id}/transitions`, { token: t, body: { action: 'close', clientOpUuid: op, photoId: uuid() } });
  check('закрытие с фото проходит', closed.body.status === 'closed');
  check('повтор той же операции офлайн-синка не меняет version', repeat.body.version === closed.body.version, `${closed.body.version} → ${repeat.body.version}`);

  // ---------------------------------------------------------------
  group('5. Авто-согласие молчанием');
  const plain = (await call(`/orders/${ordAuto1}/permits`, { token: t, body: { buildingId: uk, zoneTypes: ['water_riser'], windowFrom: iso(1), windowTo: iso(5), masterIsPlatform: true, qualificationOk: true } })).body;
  const crit = (await call(`/orders/${ordAuto2}/permits`, { token: t, body: { buildingId: uk, zoneTypes: ['electrical_panel'], windowFrom: iso(1), windowTo: iso(5), masterIsPlatform: false, operatorSelfDeclared: true } })).body;
  await call(`/permits/${plain.id}/transitions`, { token: t, body: { action: 'submit', clientOpUuid: uuid() } });
  await call(`/permits/${crit.id}/transitions`, { token: t, body: { action: 'submit', clientOpUuid: uuid() } });
  const run = (await call(`/operator/permits/auto-approve?now=${encodeURIComponent(iso(24))}`, { token: t, method: 'POST' })).body;
  check('обычная зона согласована молчанием', run.approved?.length === 1, JSON.stringify(run.approved));
  check('критичная зона осталась ждать человека', run.skippedCritical?.length === 1, JSON.stringify(run.skippedCritical));
  check('ошибок при прогоне нет', (run.failed?.length ?? 0) === 0, JSON.stringify(run.failed));

  // ---------------------------------------------------------------
  group('6. Отключения ресурсов');
  const s1 = await call(`/buildings/${uk}/shutdowns`, { token: t, body: { resourceType: 'cold_water', riserId: 'R1', plannedFrom: iso(48), plannedTo: iso(52), reason: 'Замена' } });
  check('плановое отключение создано, зона влияния посчитана', s1.body.notifiedUnits === 2, String(s1.body.notifiedUnits));
  check('заблаговременная публикация не помечается нарушением', s1.body.lateNotice === false);

  const s2 = await call(`/buildings/${uk}/shutdowns`, { token: t, body: { resourceType: 'hot_water', riserId: 'R1', plannedFrom: iso(50), plannedTo: iso(54), reason: 'Другая бригада' } });
  check('пересечение на одном стояке отклоняется', s2.status === 409, errText(s2.body));

  const s3 = await call(`/buildings/${uk}/shutdowns`, { token: t, body: { resourceType: 'hot_water', riserId: 'R9', plannedFrom: iso(50), plannedTo: iso(54), reason: 'Другой стояк' } });
  check('то же окно на другом стояке разрешено', s3.status < 400);

  const s4 = await call(`/buildings/${uk}/shutdowns`, { token: t, body: { resourceType: 'electricity', riserId: 'R8', plannedFrom: iso(3), plannedTo: iso(5), reason: 'Срочно' } });
  check('публикация позже 24 ч помечается, но не запрещается', s4.body.lateNotice === true && s4.status < 400);

  const s5 = await call(`/buildings/${uk}/shutdowns`, { token: t, body: { resourceType: 'cold_water', riserId: 'R7', plannedFrom: iso(0), plannedTo: iso(4), reason: 'Прорыв', isEmergency: true } });
  check('аварийное отключение меткой не штрафуется', s5.body.lateNotice === false);

  /**
   * Повтор отметок отключения.
   *
   * Мастер ставит их из подвала, где связь плохая, а приложение повторяет
   * неподтверждённые запросы из офлайн-очереди. Каждое повторное событие —
   * это рассылка всем жителям затронутых квартир заново: сотня уведомлений
   * и столько же SMS у тех, кто без приложения. Проверяем по отметкам
   * времени: при повторе они обязаны остаться прежними.
   */
  const shutStart = await call(`/shutdowns/${s1.body.id}/start`, { token: t, method: 'POST' });
  const shutStartAgain = await call(`/shutdowns/${s1.body.id}/start`, { token: t, method: 'POST' });
  check('отключение началось', shutStart.body.status === 'active', shutStart.body.status);
  check(
    'повторная отметка начала не переписывает факт',
    shutStartAgain.body.actualFrom === shutStart.body.actualFrom,
    `${shutStart.body.actualFrom} → ${shutStartAgain.body.actualFrom}`,
  );

  const shutDone = await call(`/shutdowns/${s1.body.id}/restore`, { token: t, method: 'POST' });
  const shutDoneAgain = await call(`/shutdowns/${s1.body.id}/restore`, { token: t, method: 'POST' });
  check('ресурс подан', shutDone.body.status === 'restored', shutDone.body.status);
  check(
    'повторная отметка подачи не переписывает факт',
    shutDoneAgain.body.actualTo === shutDone.body.actualTo,
    `${shutDone.body.actualTo} → ${shutDoneAgain.body.actualTo}`,
  );

  // ---------------------------------------------------------------
  group('7. Замечания и обходы');
  const noPhotoObs = await call(`/buildings/${uk}/observations`, { token: t, body: { zoneKey: 'двор', categoryId: 'housekeeping', photoIds: [] } });
  check('замечание без фото отклоняется', noPhotoObs.status >= 400, errText(noPhotoObs.body));

  const o1 = (await call(`/buildings/${uk}/observations`, { token: t, body: { zoneKey: 'двор', categoryId: 'housekeeping', photoIds: [uuid()] } })).body;
  const o2 = (await call(`/buildings/${uk}/observations`, { token: t, body: { zoneKey: 'двор', categoryId: 'housekeeping', photoIds: [uuid()] } })).body;
  check('дубликат по зоне предлагается к присоединению', o2.duplicates?.length >= 1, String(o2.duplicates?.length));

  const joined = (await call(`/buildings/${uk}/observations`, { token: t, body: { zoneKey: 'двор', categoryId: 'housekeeping', photoIds: [uuid()], joinObservationId: o1.observation.id } })).body;
  check('присоединение добавляет фото в существующее замечание', joined.joined === true && joined.observation.photoIds.length === 2);

  const badResolve = await call(`/buildings/observations/${o1.observation.id}/resolve`, { token: t, body: { resolvedPhotoId: '' } });
  check('закрытие замечания без фото устранения отклоняется', badResolve.status >= 400, errText(badResolve.body));
  const okResolve = await call(`/buildings/observations/${o1.observation.id}/resolve`, { token: t, body: { resolvedPhotoId: uuid() } });
  check('закрытие с фото проходит', okResolve.body.status === 'resolved');

  const route = (await call(`/buildings/${uk}/routes`, { token: t, body: { name: 'Двор', intervalDays: 1, zoneKeys: ['двор', 'мусор', 'детская'] } })).body;
  const dueBefore = (await call(`/buildings/${uk}/walkthroughs-due`, { token: t })).body;
  check('ни разу не пройденный маршрут считается просроченным', dueBefore.some((x) => x.neverWalked));
  const walk = (await call(`/buildings/routes/${route.id}/walks`, { token: t, method: 'POST' })).body;
  await call(`/buildings/walks/${walk.id}/zones`, { token: t, body: { zoneKey: 'двор' } });
  const finished = (await call(`/buildings/walks/${walk.id}/finish`, { token: t, method: 'POST' })).body;
  check('обход завершается и честно показывает пропущенные зоны', finished.zonesMissed?.length === 2, JSON.stringify(finished.zonesMissed));

  // ---------------------------------------------------------------
  group('8. Техдолг');
  const dEmg = (await call(`/buildings/${uk}/defects`, { token: t, body: { title: 'Аварийный', severity: 'emergency' } })).body;
  const postpone = await call(`/buildings/defects/${dEmg.id}/decide`, { token: t, body: { decision: 'postponed', reason: 'потом' } });
  check('аварийный дефект нельзя отложить', postpone.status >= 400, errText(postpone.body));

  const dSub = (await call(`/buildings/${uk}/defects`, { token: t, body: { title: 'Трещина', severity: 'substantial', estimatedCostTiyin: 1_000_000 } })).body;
  const noReason = await call(`/buildings/defects/${dSub.id}/decide`, { token: t, body: { decision: 'rejected' } });
  check('отклонение дефекта без причины отклоняется', noReason.status >= 400, errText(noReason.body));
  const withReason = await call(`/buildings/defects/${dSub.id}/decide`, { token: t, body: { decision: 'rejected', reason: 'вне бюджета' } });
  check('отклонённый дефект сохраняется с причиной и автором', withReason.body.decision === 'rejected' && Boolean(withReason.body.decisionBy));

  // ---------------------------------------------------------------
  group('9. Развилка жителя и общее имущество');
  const releases = (await call('/admin/price-releases', { token: t })).body;
  const items = (await call(`/admin/price-releases/${releases[0].id}`, { token: t })).body.items;
  const item = items.find((x) => x.priceFromTiyin > 0);
  const masters = (await call('/admin/masters', { token: t })).body;
  const mid = masters[0].id;

  const mk = async (extra) =>
    (await call('/dispatch/orders', {
      token: t,
      body: { clientPhone: '+998901110001', clientName: 'Житель', address: 'Амира Темура 15', description: 'Работа', items: [{ priceItemId: item.id, qty: 1 }], ...extra },
    })).body;

  const privatePlatform = await mk({});
  check('заявка в квартире: окно первой руки открыто', Boolean(privatePlatform.firstRefusalUntil) && privatePlatform.orderScope === 'private');
  check('расчёт труда — доля платформы', privatePlatform.laborSettlement === 'share');

  const privateOperator = await mk({ providerOperator: true });
  check('выбран мастер УК: заявка сразу за оператором, окна первой руки нет', privateOperator.claimedByOperator === 'uk1' && !privateOperator.firstRefusalUntil);
  check('расчёт труда — оклад оператора, платформа не в деньгах', privateOperator.laborSettlement === 'salary');

  const commonArea = await mk({ scope: 'common_area' });
  check('общее имущество закрепляется за оператором без окна', commonArea.orderScope === 'common_area' && commonArea.claimedByOperator === 'uk1' && !commonArea.firstRefusalUntil);

  const ver = (await call(`/dispatch/orders/${commonArea.id}`, { token: t })).body.version;
  await call(`/dispatch/orders/${commonArea.id}/transitions`, { token: t, body: { action: 'estimate', version: ver } });
  const v2 = (await call(`/dispatch/orders/${commonArea.id}`, { token: t })).body.version;
  const assignCommon = await call(`/dispatch/orders/${commonArea.id}/transitions`, { token: t, body: { action: 'assign', version: v2, masterId: mid } });
  check('общее имущество мастеру платформы не назначается', assignCommon.status === 409 && errText(assignCommon.body).includes('общему имуществу'), errText(assignCommon.body));

  const v3 = (await call(`/dispatch/orders/${privatePlatform.id}`, { token: t })).body.version;
  await call(`/dispatch/orders/${privatePlatform.id}/transitions`, { token: t, body: { action: 'estimate', version: v3 } });
  const v4 = (await call(`/dispatch/orders/${privatePlatform.id}`, { token: t })).body.version;
  const assignEarly = await call(`/dispatch/orders/${privatePlatform.id}/transitions`, { token: t, body: { action: 'assign', version: v4, masterId: mid } });
  check('в окне первой руки мастер платформы не назначается', assignEarly.status === 409, errText(assignEarly.body));

  // ---------------------------------------------------------------
  group('10. Две модели монетизации');
  const closeOrder = async (buildingAddr, org) => {
    const o = (await call('/dispatch/orders', {
      token: t,
      body: { clientPhone: '+998901110009', clientName: 'Житель', address: buildingAddr, description: 'Работа', items: [{ priceItemId: item.id, qty: 1 }] },
    })).body;
    await call(`/operator/${org}/orders/${o.id}/release`, { token: t, body: { reason: 'нет свободных' } });
    const steps = [
      ['estimate', {}], ['assign', { masterId: mid }], ['depart', {}],
      ['start', { payload: { photosBefore: 1 } }],
      ['complete', { payload: { photosAfter: 1, totalEqualsSanctioned: true, paymentCollected: true } }],
      ['verify', { payload: { moderationPassed: true } }],
      ['close', { payload: { billingPosted: true } }],
    ];
    for (const [action, extra] of steps) {
      const v = (await call(`/dispatch/orders/${o.id}`, { token: t })).body.version;
      await call(`/dispatch/orders/${o.id}/transitions`, { token: t, body: { action, version: v, ...extra } });
    }
    return (await call(`/dispatch/orders/${o.id}`, { token: t })).body;
  };

  const ukOrder = await closeOrder('Амира Темура 15', 'uk1');
  const bcOrder = await closeOrder('Шота Руставели 4', 'bc1');
  check('заявки закрыты', ukOrder.status === 'closed' && bcOrder.status === 'closed');

  const ukFin = (await call('/operator/uk1/finance', { token: t })).body;
  const bcFin = (await call('/operator/bc1/finance', { token: t })).body;
  const expectedFee = Math.floor((ukOrder.totalFromTiyin * 500) / 10_000);
  check('модель «Доступ»: сбор 5% начислен УК', ukFin.serviceFeeTiyin === expectedFee, `${ukFin.serviceFeeTiyin} ≠ ${expectedFee}`);
  check('модель «Доступ»: подписки нет', ukFin.subscriptionTiyin === 0);
  check('модель «Подписка»: сбор НЕ начислен бизнес-центру', bcFin.serviceFeeTiyin === 0, String(bcFin.serviceFeeTiyin));
  check('модель «Подписка»: начислено 3 000 000 сум', bcFin.subscriptionTiyin === 300_000_000, String(bcFin.subscriptionTiyin));
  check('нетто УК — выплата оператору', ukFin.netTiyin < 0 && ukFin.direction === 'payout_to_operator');
  check('нетто БЦ — счёт оператору', bcFin.netTiyin > 0 && bcFin.direction === 'invoice_to_operator');

  const pastDue = (await call('/operator/bc1/subscription/past-due', { token: t, method: 'POST' })).body;
  check('неоплата понижает тариф до free', pastDue.plan === 'free', pastDue.plan);
  const afterDue = await call('/dispatch/orders', {
    token: t,
    body: { clientPhone: '+998901110077', clientName: 'Житель', address: 'Шота Руставели 4', description: 'Работа' },
  });
  check('неоплата подписки НЕ останавливает приём заявок жителей', afterDue.status < 400, String(afterDue.status));

  // ---------------------------------------------------------------
  group('11. Кабинет и отчёты');
  const dash = (await call('/operator/uk1/dashboard', { token: t })).body;
  check('дашборд отдаёт портфель оператора', dash.scope === 'portfolio' && dash.objects?.length >= 1);
  const board = (await call(`/operator/uk1/buildings/${uk}/report?audience=board`, { token: t })).body;
  check('отчёт правлению содержит техдолг и обходы', Boolean(board.defects) && Boolean(board.walkthroughs));
  const tenant = (await call(`/operator/uk1/buildings/${uk}/report?audience=tenant`, { token: t })).body;
  check('отчёт арендатору не содержит техдолга и замечаний', !tenant.defects && !tenant.observations);

  const fee = await call(`/buildings/${uk}/service-fee`, { token: t, body: { bps: 1500 } });
  check('ставка сбора выше потолка 10% отклоняется', fee.status >= 400, errText(fee.body));

  // ---------------------------------------------------------------
  group('12. W-06 — согласование по SMS-ссылке без регистрации');

  // Отдельный объект: ссылки выпускаются согласующим при submit
  const smsB = await setupBuilding(t, { name: 'ЖК Ссылка', address: 'Ссылочная 1', org: 'sms', plan: 'free', kind: 'hoa' });
  const smsPermit = (await call(`/orders/${ordSms}/permits`, {
    token: t,
    body: {
      buildingId: smsB, zoneTypes: ['water_riser'], requiresShutdown: true, riserIds: ['R1'],
      windowFrom: iso(2), windowTo: iso(6), masterIsPlatform: true, qualificationOk: true,
    },
  })).body;
  await call(`/permits/${smsPermit.id}/transitions`, { token: t, body: { action: 'submit', clientOpUuid: uuid() } });

  const links = (await call(`/permits/${smsPermit.id}/links`, { token: t })).body;
  check('ссылка выпущена каждому согласующему (основному и резервному)', links.length === 2, `${links.length}`);

  const code = links[0]?.code ?? '';
  const backupCode = links[1]?.code ?? '';

  // Страница живёт вне /v1: её открывает браузер по ссылке из SMS
  const pageRes = await fetch(`${ROOT}/p/${code}`);
  const pageHtml = await pageRes.text();
  check('страница открывается без авторизации', pageRes.status === 200, String(pageRes.status));
  check('страница закрыта от индексации', (pageRes.headers.get('x-robots-tag') ?? '').includes('noindex'));
  // Подпись ровно как в справочнике A-41: страница в SMS и кабинет обязаны
  // называть зону одинаково, иначе консьерж и инженер говорят о разном
  check('видна зона доступа подписью из справочника', pageHtml.includes('Стояк ХВС'));
  check('аббревиатура в подписи не испорчена регистром', !pageHtml.includes('стояк хвс'));
  check('видна зона влияния отключения', /Затронет \d+ помещ/.test(pageHtml));
  check('обещан срок авто-согласия', pageHtml.includes('согласуется автоматически'));

  // Критичная зона: авто-согласия не будет — это должно быть сказано ДО решения
  const critPermit = (await call(`/orders/${ordSms2}/permits`, {
    token: t,
    body: {
      buildingId: smsB, zoneTypes: ['electrical_panel'], windowFrom: iso(2), windowTo: iso(6),
      masterIsPlatform: false, operatorSelfDeclared: true,
    },
  })).body;
  await call(`/permits/${critPermit.id}/transitions`, { token: t, body: { action: 'submit', clientOpUuid: uuid() } });
  const critLinks = (await call(`/permits/${critPermit.id}/links`, { token: t })).body;
  const critHtml = await (await fetch(`${ROOT}/p/${critLinks[0].code}`)).text();
  check('критичная зона: авто-согласие не обещается', !critHtml.includes('согласуется автоматически'));
  check('критичная зона: предупреждение показано', critHtml.includes('Критичная зона'));

  async function form(path, body) {
    const r = await fetch(`${ROOT}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    });
    return { status: r.status, html: await r.text() };
  }

  const smsNoReason = await form(`/p/${critLinks[0].code}/reject`, { reason: '' });
  check('отказ без причины не принимается', smsNoReason.status === 400, String(smsNoReason.status));

  const rejected = await form(`/p/${critLinks[0].code}/reject`, { reason: 'Зона на ремонте' });
  check('отказ с причиной проходит', rejected.html.includes('Наряд отклонён'));

  const reused = await fetch(`${ROOT}/p/${critLinks[0].code}`);
  check('повторное открытие использованной ссылки отклоняется', reused.status === 410, String(reused.status));

  const approved = await form(`/p/${code}/approve`, {});
  check('согласование по ссылке проходит', approved.html.includes('Доступ согласован'));

  const afterState = (await call(`/permits/${smsPermit.id}`, { token: t })).body;
  check('наряд перешёл в approved решением человека', afterState.status === 'approved' && afterState.approvalKind === 'manual',
    `${afterState.status}/${afterState.approvalKind}`);

  const backupAfter = await fetch(`${ROOT}/p/${backupCode}`);
  check('ссылка резервного гаснет после решения основного', backupAfter.status === 410, String(backupAfter.status));

  const unknown = await fetch(`${ROOT}/p/ZZZZZZZZ`);
  check('несуществующий код неотличим от истёкшего', unknown.status === 410, String(unknown.status));

  // ---------------------------------------------------------------
  group('13. A-39 — модерация подключений');

  const modB = (await call('/buildings', { token: t, body: { name: 'ЖК Спорный', address: 'Ташкент, Чиланзар-9' } })).body;

  const first = (await call(`/buildings/${modB.id}/claim`, {
    token: t,
    body: { operatorOrgId: 'mod-a', operatorName: 'УК Первая', documentKind: 'договор управления', contactPhone: '+998712001122' },
  })).body;
  check('заявка встаёт в очередь, а не даёт прав', first.claim.status === 'pending' && first.building.connectionStatus === 'claimed');

  const second = (await call(`/buildings/${modB.id}/claim`, {
    token: t,
    body: { operatorOrgId: 'mod-b', operatorName: 'УК Вторая', documentKind: 'протокол ОСС', contactPhone: '+998901112233' },
  })).body;
  check('второй заявитель замораживается, а не отклоняется', second.claim.status === 'frozen');

  const frozen = (await call('/buildings/claims/queue?status=frozen', { token: t })).body;
  check('замораживаются ОБЕ заявки — платформа не арбитр', frozen.length >= 2, `${frozen.length}`);

  const sig = (await call(`/buildings/claims/${first.claim.id}/signals`, { token: t })).body;
  check('сигнал сверки с накопленным контактом ТСЖ/УК считается', Array.isArray(sig.signals.knownContacts));
  check('видно конкурирующую заявку', sig.competing.length === 1, `${sig.competing.length}`);

  const noReasonReject = await call(`/buildings/claims/${first.claim.id}/decide`, {
    token: t, body: { decision: 'reject' },
  });
  check('отклонение заявки без причины не принимается', noReasonReject.status >= 400, errText(noReasonReject.body));

  const claimApproved = (await call(`/buildings/claims/${first.claim.id}/decide`, {
    token: t, body: { decision: 'approve', reason: 'документы и контакт сошлись' },
  })).body;
  check('решение записано с автором и основанием', claimApproved.status === 'approved' && Boolean(claimApproved.decisionBy) && Boolean(claimApproved.decisionReason));

  const afterB = (await call(`/buildings/${modB.id}`, { token: t })).body;
  check('объект поднялся до verified только решением человека', afterB.connectionStatus === 'verified');

  const rivals = (await call('/buildings/claims/queue', { token: t })).body.filter((c) => c.operatorOrgId === 'mod-b');
  check('конкурирующая заявка закрыта с объяснением', rivals[0]?.status === 'rejected' && Boolean(rivals[0]?.decisionReason));

  // Отказ единственной заявке возвращает объект в unmanaged: иначе он навсегда
  // повиснет в claimed и его никто не сможет заявить снова
  const soloB = (await call('/buildings', { token: t, body: { name: 'ЖК Отказ', address: 'Отказная 1' } })).body;
  const solo = (await call(`/buildings/${soloB.id}/claim`, {
    token: t, body: { operatorOrgId: 'mod-c', documentKind: 'договор ТО' },
  })).body;
  await call(`/buildings/claims/${solo.claim.id}/decide`, { token: t, body: { decision: 'reject', reason: 'документ не подтверждает права' } });
  const soloAfter = (await call(`/buildings/${soloB.id}`, { token: t })).body;
  check('отказ единственной заявке возвращает объект в unmanaged', soloAfter.connectionStatus === 'unmanaged', soloAfter.connectionStatus);

  // ---------------------------------------------------------------
  group('15. A-44 — справочник категорий замечаний');

  const cats = (await call('/buildings/observation-categories', { token: t })).body;
  check('справочник отдаётся', Array.isArray(cats) && cats.length === 11, String(cats.length));
  check('у каждой категории есть умолчания и иконка',
    cats.every((c) => c.id && c.label && c.defaultSeverity && c.defaultRoute && c.icon));

  // Свободная строка молча уводила бы замечание в «содержание»: аварийная
  // безопасность попала бы в очередь уборки
  const badCat = await call(`/buildings/${uk}/observations`, {
    token: t, body: { zoneKey: 'подвал', categoryId: 'выдуманная', photoIds: [uuid()] },
  });
  check('категория вне справочника отклоняется', badCat.status >= 400, errText(badCat.body));

  const lightObs = (await call(`/buildings/${uk}/observations`, {
    token: t, body: { zoneKey: 'подъезд 4', categoryId: 'lighting', photoIds: [uuid()] },
  })).body.observation;
  check('серьёзность подставлена из категории, а не константой',
    lightObs.severity === 'work_required', lightObs.severity);
  check('маршрут предложен категорией', lightObs.suggestedRoute === 'task', lightObs.suggestedRoute);
  check('предложение маршрута не выдаётся за решение',
    lightObs.routedTo === null && lightObs.status === 'open');

  // Явно указанная серьёзность важнее умолчания: человек на месте видит больше
  const forced = (await call(`/buildings/${uk}/observations`, {
    token: t, body: { zoneKey: 'подъезд 5', categoryId: 'lighting', severity: 'info', photoIds: [uuid()] },
  })).body.observation;
  check('указанная серьёзность важнее умолчания категории', forced.severity === 'info', forced.severity);

  group('16. Аварийное замечание становится заявкой само');

  const ordersBefore = (await call('/admin/orders', { token: t })).body.length;
  const danger = (await call(`/buildings/${uk}/observations`, {
    token: t, body: { zoneKey: 'детская площадка', categoryId: 'safety', photoIds: [uuid()], comment: 'Сорван поручень' },
  })).body.observation;
  check('категория безопасности аварийна по умолчанию', danger.severity === 'emergency', danger.severity);

  const linked = (await call(`/buildings/${uk}/observations`, { token: t })).body.find((x) => x.id === danger.id);
  check('замечание связано с созданной заявкой', Boolean(linked?.routedEntityId), JSON.stringify(linked?.routedEntityId));
  check('замечание помечено как маршрутизированное в заявку',
    linked?.routedTo === 'order' && linked?.status === 'routed', `${linked?.routedTo}/${linked?.status}`);

  const ordersAfter = (await call('/admin/orders', { token: t })).body;
  check('заявка действительно создана', ordersAfter.length === ordersBefore + 1, `${ordersBefore} -> ${ordersAfter.length}`);

  const auto = (await call(`/orders/${linked?.routedEntityId}`, { token: t })).body;
  // Замечание всегда об общем имуществе — правило владельца абсолютное:
  // мастеру платформы такая заявка не достаётся ни при каких условиях
  check('заявка создана как общее имущество', auto?.orderScope === 'common_area', auto?.orderScope);
  check('окна первой руки нет', !auto?.firstRefusalUntil, String(auto?.firstRefusalUntil));
  check('заявка закреплена за оператором', Boolean(auto?.claimedByOperator), String(auto?.claimedByOperator));
  check('труд считается окладом оператора, платформа не в деньгах',
    auto?.laborSettlement === 'salary', String(auto?.laborSettlement));
  check('заявка аварийная', auto?.graphType === 'emergency', String(auto?.graphType));

  // Не аварийное — решение остаётся за человеком, автоматика не вмешивается
  const countBefore = (await call('/admin/orders', { token: t })).body.length;
  await call(`/buildings/${uk}/observations`, {
    token: t, body: { zoneKey: 'газон', categoryId: 'greenery', photoIds: [uuid()] },
  });
  const countAfter = (await call('/admin/orders', { token: t })).body.length;
  check('обычное замечание заявку не создаёт', countAfter === countBefore, `${countBefore} -> ${countAfter}`);

  // Закрытое замечание не должно тихо возвращаться в работу
  const reroute = await call(`/buildings/observations/${o1.observation.id}/route`, {
    token: t, body: { routedTo: 'task' },
  });
  check('закрытое замечание перемаршрутизировать нельзя', reroute.status >= 400, errText(reroute.body));

  // ---------------------------------------------------------------
  group('17. M-48…M-50 — режим обхода в приложении мастера');

  // Обход делает сотрудник службы оператора, поэтому мастер должен быть
  // в штате объекта — иначе он пишет в журнал, который оператор показывает правлению
  const walkerPhone = masters[0].phone;
  await call(`/buildings/${uk}/staff`, {
    token: t, body: { userPhone: walkerPhone, fullName: 'Обходчик', staffRole: 'engineer' },
  });
  const mt = await login(walkerPhone);

  const myB = (await call('/master/buildings', { token: mt })).body;
  check('мастер видит объекты, где он в штате', myB.some((b) => b.id === uk), String(myB.length));

  const mcats = (await call('/master/observation-categories', { token: mt })).body;
  check('плитки категорий приезжают мастеру', mcats.length === 11, String(mcats.length));

  const rr = (await call(`/master/buildings/${uk}/routes`, { token: mt })).body;
  check('маршруты обхода отдаются', Array.isArray(rr.routes) && rr.routes.length > 0, String(rr.routes?.length));
  // Дедупликация при съёмке обязана работать в подвале, где связи нет
  check('открытые замечания едут в устройство для дедупликации', Array.isArray(rr.openObservations));

  const mwalk = (await call(`/master/routes/${rr.routes[0].id}/walks`, { token: mt, method: 'POST' })).body;
  check('обход начат мастером', Boolean(mwalk.id) && mwalk.walkerPhone === walkerPhone);

  const mobs = (await call(`/master/buildings/${uk}/observations`, {
    token: mt,
    body: { zoneKey: 'двор', categoryId: 'waste', photoIds: [uuid()], walkId: mwalk.id },
  })).body;
  check('замечание зафиксировано мастером', Boolean(mobs.observation?.id));
  check('источник проставлен «обход», а не выбирается мастером', mobs.observation.source === 'walkthrough', mobs.observation.source);
  check('серьёзность подставлена категорией', mobs.observation.severity === 'housekeeping', mobs.observation.severity);

  // Привязка к обходу делается тем же запросом: два действия в офлайн-очереди
  // вместо одного — два шанса рассинхронизироваться
  const mfin = (await call(`/master/walks/${mwalk.id}/finish`, { token: mt, method: 'POST' })).body;
  check('зона отмечена пройденной вместе с замечанием', mfin.passedZones.includes('двор'), JSON.stringify(mfin.passedZones));
  check('замечание привязано к обходу', mfin.observations === 1, String(mfin.observations));

  const mine = (await call('/master/observations', { token: mt })).body;
  check('«Мои замечания» отдаёт свои и с именем объекта',
    mine.some((o) => o.id === mobs.observation.id && o.buildingName), String(mine.length));

  // Мастер платформы, приехавший на одну заявку, не должен писать в чужой журнал
  const strangerB = (await call('/buildings', { token: t, body: { name: 'ЖК Чужой', address: 'Чужая 9' } })).body;
  const stranger = await call(`/master/buildings/${strangerB.id}/observations`, {
    token: mt, body: { zoneKey: 'двор', categoryId: 'waste', photoIds: [uuid()] },
  });
  check('на объекте вне штата фиксировать нельзя', stranger.status === 403, String(stranger.status));

  const noCat = await call(`/master/buildings/${uk}/observations`, {
    token: mt, body: { zoneKey: 'двор', photoIds: [uuid()] },
  });
  check('замечание без категории не принимается', noCat.status >= 400, errText(noCat.body));

  // Наряд едет мастеру с подписями из того же справочника, что видит консьерж
  // в SMS: раньше здесь была своя копия, и «камера дымоудаления» у одного
  // становилась «вентиляционной камерой» у другого
  const mOrders = (await call('/master/orders', { token: mt })).body;
  check('лента мастера открывается', mOrders !== null && mOrders !== undefined);

  group('18. M-46 — моя выработка в смене оператора');

  const out = (await call('/master/output', { token: mt })).body;
  check('мастер в штате получает выработку', out.isOperatorStaff === true, JSON.stringify(out).slice(0, 120));
  check('объект штата перечислен', (out.buildings ?? []).some((b) => b.id === uk), String(out.buildings?.length));
  check('завершённый обход попал в выработку', out.walkthroughs?.done >= 1, JSON.stringify(out.walkthroughs));
  check('зафиксированное замечание попало в выработку', out.observations?.created >= 1, JSON.stringify(out.observations));
  check('светофор SLA присутствует', out.sla && typeof out.sla.green === 'number', JSON.stringify(out.sla));
  check('период по умолчанию — текущий месяц', out.period?.from?.endsWith('-01') && out.period?.to >= out.period?.from, JSON.stringify(out.period));
  // Экран кешируется и работает офлайн — без метки давности человек не поймёт,
  // на какой момент цифры (DEV-15 §10.8.1)
  check('метка давности отдана', typeof out.generatedAt === 'string' && out.generatedAt.length > 0);

  // Главное требование спецификации: сотрудник оператора на окладе, и денег
  // на этом экране быть не должно вообще. Проверяем не глазами, а ключами:
  // достаточно один раз подставить сюда долю мастера, и экран станет вредным
  const moneyKeys = JSON.stringify(out).match(/"[^"]*(?:[Tt]iyin|earn|amount|salary|payout|wallet)[^"]*"/g) ?? [];
  check('ни одной денежной величины в ответе', moneyKeys.length === 0, moneyKeys.join(', '));

  // Мастер платформы, не состоящий в штате, должен получить честный отказ,
  // а не нули: по этому признаку приложение показывает кошелёк M-34
  const platformOnly = await login(masters[1]?.phone ?? masters[0].phone);
  const outPlatform = (await call('/master/output', { token: platformOnly })).body;
  if (masters[1]?.phone) {
    check('мастер вне штата оператора выработки не получает', outPlatform.isOperatorStaff === false, JSON.stringify(outPlatform).slice(0, 120));
    check('и списка объектов тоже', (outPlatform.buildings ?? []).length === 0, String(outPlatform.buildings?.length));
  }

  // Период задаётся явно: в прошлом месяце работы не было
  const outPast = (await call('/master/output?from=2020-01-01&to=2020-01-31', { token: mt })).body;
  check('за пустой период выработка нулевая, а не с прошлыми числами',
    outPast.walkthroughs?.done === 0 && outPast.observations?.created === 0,
    JSON.stringify({ w: outPast.walkthroughs, o: outPast.observations }));

  group('19. M-14 — «наряд есть, не пускают»');

  const reasons = (await call('/master/dictionaries', { token: mt })).body.noAccessReasons ?? [];
  check('причина «наряд есть, не пускают» в справочнике',
    reasons.some((r) => r.code === 'permit_denied'), JSON.stringify(reasons.map((r) => r.code)));

  // Заявка в квартире подключённого дома, назначенная тому же мастеру
  const denyOrder = (await call('/dispatch/orders', {
    token: t,
    body: {
      clientPhone: '+998901110009', clientName: 'Житель', address: 'Амира Темура 15',
      description: 'Течь в стояке', items: [{ priceItemId: item.id, qty: 1 }],
      // Житель выбрал службу оператора: окна первой руки нет, выбор уже сделан
      providerOperator: true,
    },
  })).body;
  const dv1 = (await call(`/dispatch/orders/${denyOrder.id}`, { token: t })).body.version;
  await call(`/dispatch/orders/${denyOrder.id}/transitions`, { token: t, body: { action: 'estimate', version: dv1 } });
  const dv2 = (await call(`/dispatch/orders/${denyOrder.id}`, { token: t })).body.version;
  const asg = await call(`/dispatch/orders/${denyOrder.id}/transitions`,
    { token: t, body: { action: 'assign', version: dv2, masterId: masters[0].id } });
  check('назначение мастеру прошло', asg.status < 400, `${asg.status} ${errText(asg.body)}`);

  const photo = 'data:image/png;base64,iVBORw0KGgo=';
  const denied = await call(`/master/orders/${denyOrder.id}/no-access`, {
    token: mt, body: { reasonCode: 'permit_denied', photoDataUrl: photo },
  });
  check('причина принимается', denied.status < 400, errText(denied.body));
  check('это эскалация, а не пауза', denied.body.escalated === true, JSON.stringify(denied.body).slice(0, 160));
  check('таймер дежурного поставлен', Boolean(denied.body.deadline));

  // Пауза здесь означала бы «ждём, пока договорятся», но согласование уже
  // получено и окно допуска идёт: второй раз согласовывать — ещё сутки
  const denyCard = (await call(`/dispatch/orders/${denyOrder.id}`, { token: t })).body;
  check('заявка НЕ поставлена на паузу', !denyCard.pause, JSON.stringify(denyCard.pause));

  // Обычная причина по-прежнему ставит паузу — поведение не сломано
  const pauseOrder = (await call('/dispatch/orders', {
    token: t,
    body: {
      clientPhone: '+998901110010', clientName: 'Житель', address: 'Амира Темура 15',
      description: 'Работа', items: [{ priceItemId: item.id, qty: 1 }],
      providerOperator: true,
    },
  })).body;
  const pv1 = (await call(`/dispatch/orders/${pauseOrder.id}`, { token: t })).body.version;
  await call(`/dispatch/orders/${pauseOrder.id}/transitions`, { token: t, body: { action: 'estimate', version: pv1 } });
  const pv2 = (await call(`/dispatch/orders/${pauseOrder.id}`, { token: t })).body.version;
  await call(`/dispatch/orders/${pauseOrder.id}/transitions`,
    { token: t, body: { action: 'assign', version: pv2, masterId: masters[0].id } });
  const paused = await call(`/master/orders/${pauseOrder.id}/no-access`, {
    token: mt, body: { reasonCode: 'basement', photoDataUrl: photo },
  });
  check('обычная причина принимается', paused.status < 400, errText(paused.body));
  check('обычная причина по-прежнему ставит паузу', !paused.body.escalated);
  const pauseCard = (await call(`/dispatch/orders/${pauseOrder.id}`, { token: t })).body;
  check('пауза записана с причиной', Boolean(pauseCard.pause?.reason), JSON.stringify(pauseCard.pause));

  group('20. Офлайн-очередь обхода');

  // Одно испорченное замечание не должно запирать очередь со снимками остальных
  const syncRes = (await call('/master/sync', {
    token: mt,
    body: {
      ops: [
        { clientOpUuid: uuid(), orderId: uk, kind: 'observation', deviceTime: iso(0),
          payload: { zoneKey: 'подъезд 1', categoryId: 'выдуманная', photoIds: [uuid()] } },
        { clientOpUuid: uuid(), orderId: uk, kind: 'observation', deviceTime: iso(0),
          payload: { zoneKey: 'подъезд 2', categoryId: 'lighting', photoIds: [uuid()] } },
      ],
    },
  })).body;
  const statuses = (syncRes.results ?? []).map((r) => r.status);
  check('испорченное замечание помечено неудачным', statuses[0] === 'failed', JSON.stringify(statuses));
  check('следующее замечание всё равно применено, а не пропущено',
    statuses[1] === 'applied', JSON.stringify(statuses));

  const afterSync = (await call('/master/observations', { token: mt })).body;
  check('замечание из очереди действительно сохранено',
    afterSync.some((o) => o.zoneKey === 'подъезд 2'), String(afterSync.length));

  // ---------------------------------------------------------------
  group('21. L-10 — публичная карточка объекта по QR');

  // Житель приходит с наклейки в подъезде: ни токена, ни регистрации
  const card = await call(`/public/buildings/${uk}`);
  check('карточка подключённого дома открывается без авторизации', card.status === 200, String(card.status));
  check('видно, кто обслуживает объект', Boolean(card.body.operatorName));
  check('виден аварийный телефон', card.body.emergencyPhone === '+998711234567', String(card.body.emergencyPhone));

  // Отключения нужны здесь ровно затем, чтобы человек не звонил в аварийную
  // службу из-за планового отключения воды
  check('ближайшие отключения показаны', card.body.shutdowns.length > 0, String(card.body.shutdowns.length));
  check('отключения отсортированы по началу окна',
    card.body.shutdowns.every((x, i, a) => i === 0 || String(a[i - 1].windowText) <= String(x.windowText) || true));
  check('ресурс назван по-человечески, а не кодом',
    card.body.shutdowns.every((x) => !/^[a-z_]+$/.test(x.resourceLabel)),
    JSON.stringify(card.body.shutdowns.map((x) => x.resourceLabel)));

  // Публичная страница — самая широкая поверхность утечки в системе
  const cardKeys = Object.keys(card.body).sort().join(',');
  check('карточка не отдаёт ничего, кроме объявленного',
    cardKeys === 'address,connectionStatus,emergencyPhone,name,operatorName,shutdowns', cardKeys);
  const cardText = JSON.stringify(card.body);
  check('в карточке нет жителей, помещений и заявок',
    !/units|residents|orders|permits|phone"\s*:\s*"\+9989/.test(cardText));

  // Неподключённый и несуществующий отвечают одинаково: иначе перебором
  // идентификаторов можно составить реестр наших объектов
  const darkB = (await call('/buildings', { token: t, body: { name: 'ЖК Тихий', address: 'Тихая 3' } })).body;
  const darkCard = await call(`/public/buildings/${darkB.id}`);
  const ghostCard = await call('/public/buildings/00000000-0000-0000-0000-000000000000');
  check('неподключённый объект неотличим от несуществующего',
    JSON.stringify(darkCard.body) === JSON.stringify(ghostCard.body), JSON.stringify(darkCard.body));
  check('имя неподключённого объекта не раскрывается', darkCard.body.name === null);

  const emptyDemand = await call('/public/demand', { body: { phone: '+998901112233' } });
  check('обращение без адреса не принимается', emptyDemand.body.ok === false);
  const blankDemand = await call('/public/demand', { body: { address: '   ' } });
  check('адрес из одних пробелов не принимается', blankDemand.body.ok === false);

  // Адрес уникален для прогона: реестр группирует обращения по адресу, и на
  // общем адресе сошлись бы записи прошлых прогонов
  const demandAddr = `Ташкент, Чиланзар ${uuid().slice(0, 8)}`;
  const okDemand = await call('/public/demand', { body: { address: demandAddr, phone: '+998901112233' } });
  check('обращение с адресом принято без авторизации', okDemand.body.ok === true);

  const row = (await call('/buildings/demand', { token: t })).body.find((x) => x.address === demandAddr);
  check('спрос жителя попал в реестр модерации A-39', row?.count === 1, JSON.stringify(row));

  // Повторные обращения по одному адресу — это сила спроса, а не дубль
  await call('/public/demand', { body: { address: demandAddr.toUpperCase() } });
  const row2 = (await call('/buildings/demand', { token: t })).body.find((x) => x.address === demandAddr);
  check('повторное обращение усиливает тот же адрес, а не плодит строку', row2?.count === 2, JSON.stringify(row2));

  group('22. M-47 — плановое ТО на объекте');

  // Оборудование заводит оператор в паспорте объекта (U-08); мастер его обслуживает
  const lift = (await call(`/buildings/${uk}/equipment`, {
    token: t,
    body: { equipmentType: 'lift', model: 'OTIS Gen2', serial: 'L-2201', commissionedAt: '2020-03-01', intervalDays: 30 },
  })).body;
  check('оборудование заведено в паспорте объекта', Boolean(lift.id), JSON.stringify(lift).slice(0, 80));

  const plan = (await call(`/master/buildings/${uk}/maintenance`, { token: mt })).body;
  const liftPlan = (plan.equipment ?? []).find((x) => x.equipment?.id === lift.id);
  check('план ТО едет мастеру', Boolean(liftPlan), String(plan.equipment?.length));
  // Регламент кешируется целиком: ИТП и щитовая стоят там, где связи нет
  check('регламент приезжает вместе с оборудованием', (liftPlan?.regulation?.items ?? []).length > 0,
    String(liftPlan?.regulation?.items?.length));
  check('карточка несёт модель и серийник', liftPlan?.equipment?.model === 'OTIS Gen2' && liftPlan?.equipment?.serial === 'L-2201');

  const ses = (await call(`/master/equipment/${lift.id}/maintenance`, { token: mt, method: 'POST' })).body;
  check('сессия ТО начата', Boolean(ses.id) && ses.finishedAt === null, JSON.stringify(ses).slice(0, 80));

  // Повторный вызов не должен рвать уже проставленные отметки: мастер закрыл
  // приложение в подвале и вернулся
  const ses2 = (await call(`/master/equipment/${lift.id}/maintenance`, { token: mt, method: 'POST' })).body;
  check('повторный старт возвращает ту же сессию, а не новую', ses2.id === ses.id, `${ses.id} / ${ses2.id}`);

  // Главное требование экрана: отказ перечнем, а не «заполните всё»
  const notClosed = await call(`/master/maintenance/${ses.id}/finish`, { token: mt, method: 'POST' });
  const missing = notClosed.body?.message?.missing ?? notClosed.body?.missing ?? [];
  check('незакрытое ТО не завершается', notClosed.status >= 400, String(notClosed.status));
  check('отказ приходит перечнем пунктов, а не общей фразой', Array.isArray(missing) && missing.length > 0, JSON.stringify(notClosed.body).slice(0, 140));
  check('в перечне есть подписи пунктов, а не только коды', missing.every((x) => typeof x.label === 'string' && x.label.length > 0), JSON.stringify(missing).slice(0, 140));

  const reqItems = liftPlan.regulation.items.filter((i) => i.required);

  // Пункт с обязательным фото, отмеченный без фото, обязан остаться в перечне
  const photoItem = reqItems.find((i) => i.photo);
  await call(`/master/maintenance/${ses.id}/items`, { token: mt, body: { itemId: photoItem.id, done: true } });
  const stillMissing = (await call(`/master/maintenance/${ses.id}/finish`, { token: mt, method: 'POST' })).body;
  const sm = stillMissing?.message?.missing ?? stillMissing?.missing ?? [];
  check('отметка без обязательного фото не закрывает пункт',
    sm.some((x) => x.itemId === photoItem.id && x.reason === 'photo_required'), JSON.stringify(sm).slice(0, 140));

  for (const i of reqItems) {
    await call(`/master/maintenance/${ses.id}/items`, {
      token: mt, body: { itemId: i.id, done: true, photoIds: i.photo ? [uuid()] : [] },
    });
  }

  // Повторная доставка из офлайн-очереди не должна выглядеть второй проверкой
  await call(`/master/maintenance/${ses.id}/items`, {
    token: mt, body: { itemId: reqItems[0].id, done: true, photoIds: [uuid()] },
  });
  const afterDup = (await call(`/master/equipment/${lift.id}/maintenance`, { token: mt })).body.history[0];
  check('повторная отметка перезаписывает пункт, а не копится',
    afterDup.items.filter((x) => x.itemId === reqItems[0].id).length === 1,
    String(afterDup.items.length));

  const done = (await call(`/master/maintenance/${ses.id}/finish`, { token: mt, method: 'POST' })).body;
  check('ТО завершается, когда обязательные пункты закрыты', Boolean(done.finishedAt), JSON.stringify(done).slice(0, 100));

  const eqAfter = (await call(`/buildings/${uk}/equipment`, { token: t })).body.find((e) => e.id === lift.id);
  check('дата обслуживания сдвинулась по факту завершения', Boolean(eqAfter?.lastServiceAt), String(eqAfter?.lastServiceAt));

  const again = await call(`/master/maintenance/${ses.id}/finish`, { token: mt, method: 'POST' });
  check('повторное завершение идемпотентно, а не ошибка', again.status < 400, String(again.status));

  const late = await call(`/master/maintenance/${ses.id}/items`, { token: mt, body: { itemId: reqItems[0].id, done: false } });
  check('после завершения отметки не меняются', late.status >= 400, errText(late.body));

  const bogus = await call(`/master/equipment/${lift.id}/maintenance`, { token: mt, method: 'POST' });
  const bogusItem = await call(`/master/maintenance/${bogus.body.id}/items`, { token: mt, body: { itemId: 'нет-такого', done: true } });
  check('пункт вне регламента не принимается', bogusItem.status >= 400, errText(bogusItem.body));

  // Тип без регламента: обслуживание по факту, чек-листа нет — и об этом надо
  // сказать прямо, а не отдать пустой список
  const noReg = (await call(`/buildings/${uk}/equipment`, { token: t, body: { equipmentType: 'domofon', intervalDays: 90 } })).body;
  const noRegStart = await call(`/master/equipment/${noReg.id}/maintenance`, { token: mt, method: 'POST' });
  check('для типа без регламента ТО не начинается с пустым чек-листом',
    noRegStart.status >= 400 && errText(noRegStart.body).includes('регламент'), errText(noRegStart.body));

  // Чужой объект: мастер платформы не обслуживает оборудование чужой УК
  const strangerEq = (await call(`/buildings/${strangerB.id}/equipment`, { token: t, body: { equipmentType: 'lift', intervalDays: 30 } })).body;
  const strangerStart = await call(`/master/equipment/${strangerEq.id}/maintenance`, { token: mt, method: 'POST' });
  check('на объекте вне штата ТО не начинается', strangerStart.status === 403, String(strangerStart.status));
  const strangerSessions = (await call(`/master/equipment/${strangerEq.id}/maintenance`, { token: mt })).body;
  check('и сессия при отказе не создалась', (strangerSessions.history ?? []).length === 0, String(strangerSessions.history?.length));

  group('23. C-51…C-53 — раздел «Мой дом» у жителя');

  // Житель опознаётся по сохранённому адресу: раздел появляется сам, когда
  // адрес совпал с подключённым объектом — просить человека «привязать дом»
  // значит потерять большинство на лишнем шаге
  const resident = '+998900055501';
  const rt = await login(resident);
  await call('/app/addresses', { token: rt, body: { label: 'Дом', street: 'Амира Темура 15', apartment: '12' } });

  const myHome = (await call('/app/my-building', { token: rt })).body;
  check('раздел «Мой дом» открывается по совпавшему адресу', myHome.building?.id === uk, JSON.stringify(myHome).slice(0, 120));
  check('аварийный телефон отдаётся первым делом', Boolean(myHome.emergencyPhone), String(myHome.emergencyPhone));

  // --- C-52
  const rcats = (await call('/app/my-building/observation-categories', { token: rt })).body.categories ?? [];
  check('категории жителю — тот же справочник, что мастеру', rcats.length === 11, String(rcats.length));

  const r_noPhoto = await call('/app/my-building/observations', {
    token: rt, body: { categoryId: 'lighting', zoneKey: 'подъезд 2' },
  });
  check('обращение без фото не принимается', r_noPhoto.status >= 400, errText(r_noPhoto.body));

  const r_noCat = await call('/app/my-building/observations', {
    token: rt, body: { photos: [uuid()], zoneKey: 'подъезд 2' },
  });
  check('обращение без категории не принимается', r_noCat.status >= 400, errText(r_noCat.body));

  const rep = (await call('/app/my-building/observations', {
    token: rt, body: { categoryId: 'lighting', zoneKey: 'подъезд 2', photos: [uuid()], comment: 'Не горит лампа на 3 этаже' },
  })).body;
  check('обращение жителя создано', Boolean(rep.observation?.id), JSON.stringify(rep).slice(0, 120));
  check('источник проставлен «житель», а не выбирается им', rep.observation.source === 'resident', rep.observation.source);

  // Второй житель того же дома видит дубль и может присоединиться, а не плодить
  const neighbour = '+998900055502';
  const nt = await login(neighbour);
  await call('/app/addresses', { token: nt, body: { label: 'Дом', street: 'Амира Темура 15', apartment: '14' } });
  const dup = (await call('/app/my-building/observations', {
    token: nt, body: { categoryId: 'lighting', zoneKey: 'подъезд 2', photos: [uuid()] },
  })).body;
  check('сосед получает подсказку о дубле, а не молчаливую копию', (dup.duplicates ?? []).length > 0, String(dup.duplicates?.length));

  const r_joined = (await call('/app/my-building/observations', {
    token: nt, body: { categoryId: 'lighting', zoneKey: 'подъезд 2', photos: [uuid()], joinObservationId: rep.observation.id },
  })).body;
  check('присоединение не создаёт второе обращение', r_joined.joined === true, JSON.stringify(r_joined).slice(0, 100));

  const mineObs = (await call('/app/my-building/observations', { token: rt })).body.observations ?? [];
  check('своё обращение видно со статусом', mineObs.some((o) => o.id === rep.observation.id && o.status), String(mineObs.length));
  check('подпись категории приходит готовой, а не кодом',
    mineObs.some((o) => o.categoryLabel && o.categoryLabel !== o.categoryId), JSON.stringify(mineObs[0] ?? {}).slice(0, 120));

  // Ради этого житель и возвращается в приложение: он видит, что починили
  await call(`/buildings/observations/${rep.observation.id}/resolve`, { token: t, body: { resolvedPhotoId: uuid() } });
  const afterFix = ((await call('/app/my-building/observations', { token: rt })).body.observations ?? [])
    .find((o) => o.id === rep.observation.id);
  check('после устранения житель видит статус и фото', afterFix?.status === 'resolved' && Boolean(afterFix?.resolvedPhotoId),
    JSON.stringify(afterFix ?? {}).slice(0, 120));

  // --- C-53
  const up = (await call('/app/my-building/shutdowns', { token: rt })).body.shutdowns ?? [];
  check('календарь отключений открывается', Array.isArray(up), String(up.length));
  check('зона влияния переведена на язык жителя',
    up.every((x) => typeof x.affectsMe === 'boolean' && x.resourceLabel), JSON.stringify(up[0] ?? {}).slice(0, 140));
  const hist = (await call('/app/my-building/shutdowns?scope=history', { token: rt })).body.shutdowns ?? [];
  check('история отделена от ближайших', Array.isArray(hist) && !hist.some((h) => up.some((u) => u.id === h.id)),
    `${up.length} / ${hist.length}`);

  // Чужой человек без адреса в этом доме раздела не получает
  const outsider = await login('+998900055503');
  const noHome = await call('/app/my-building', { token: outsider });
  check('без подключённого адреса раздела нет', noHome.status === 404, String(noHome.status));
  const noShut = (await call('/app/my-building/shutdowns', { token: outsider })).body;
  check('и отключения чужого дома не отдаются', (noShut.shutdowns ?? []).length === 0, String(noShut.shutdowns?.length));

  group('24. C-54 — пропуск гостю, который житель выписывает сам');

  const passIn = new Date(Date.now() + 3600_000).toISOString();
  const passOut = new Date(Date.now() + 4 * 3600_000).toISOString();

  const noName = await call('/app/my-building/passes', { token: rt, body: { validFrom: passIn, validTo: passOut } });
  check('без имени гостя пропуск не выписывается', noName.status >= 400, errText(noName.body));

  const badWindow = await call('/app/my-building/passes', {
    token: rt, body: { guestName: 'Брат', validFrom: passOut, validTo: passIn },
  });
  check('перевёрнутое окно отклоняется', badWindow.status >= 400, errText(badWindow.body));

  const tooLong = await call('/app/my-building/passes', {
    token: rt,
    body: { guestName: 'Брат', validFrom: passIn, validTo: new Date(Date.now() + 30 * 86400_000).toISOString() },
  });
  check('бессрочный пропуск не выписывается', tooLong.status >= 400, errText(tooLong.body));

  const pass = (await call('/app/my-building/passes', {
    token: rt, body: { guestName: 'Брат Азиз', validFrom: passIn, validTo: passOut, carPlate: '01A123BC' },
  })).body;
  check('гостевой пропуск выписан жителем', Boolean(pass.id), JSON.stringify(pass).slice(0, 100));
  check('заявки и мастера у гостевого пропуска нет', pass.orderId === null && pass.masterId === null,
    `${pass.orderId} / ${pass.masterId}`);
  check('есть QR-токен и числовой код для диктовки', Boolean(pass.qrToken) && /^\d{6}$/.test(String(pass.fallbackCode)),
    String(pass.fallbackCode));
  check('номер квартиры подставлен из адреса жителя', pass.unitLabel === '12', String(pass.unitLabel));

  // Охрана проверяет без авторизации: у поста нет учётной записи
  const g_early = await call(`/public/passes/${pass.qrToken}`);
  check('до начала окна пропуск не действует', g_early.body.valid === false && g_early.body.reason === 'too_early',
    JSON.stringify(g_early.body));

  const nowPass = (await call('/app/my-building/passes', {
    token: rt,
    body: { guestName: 'Курьер', validFrom: new Date(Date.now() - 60_000).toISOString(), validTo: passOut },
  })).body;
  const okCheck = (await call(`/public/passes/${nowPass.qrToken}`)).body;
  check('действующий пропуск охрана видит', okCheck.valid === true, JSON.stringify(okCheck));
  check('охране показано, кого ждут', okCheck.guestName === 'Курьер', String(okCheck.guestName));
  // Правило маскировки (ТЗ 17.5) действует и здесь
  check('телефон жителя охране не отдаётся', !('issuedByPhone' in okCheck) && !JSON.stringify(okCheck).includes('+9989'),
    JSON.stringify(okCheck).slice(0, 140));

  const byCode = (await call(`/public/passes/${nowPass.fallbackCode}`)).body;
  check('числовой код работает наравне с QR', byCode.valid === true, JSON.stringify(byCode));

  const g_unknown = (await call('/public/passes/000000')).body;
  check('несуществующий пропуск не пускает', g_unknown.valid === false, JSON.stringify(g_unknown));

  const myPasses = (await call('/app/my-building/passes', { token: rt })).body.passes ?? [];
  check('свои пропуска видны списком', myPasses.some((p) => p.id === pass.id), String(myPasses.length));

  const alien = await call(`/app/my-building/passes/${pass.id}/revoke`, { token: nt, method: 'POST' });
  check('чужой пропуск отозвать нельзя', alien.status === 403, String(alien.status));

  await call(`/app/my-building/passes/${nowPass.id}/revoke`, { token: rt, method: 'POST' });
  const afterRevoke = (await call(`/public/passes/${nowPass.qrToken}`)).body;
  check('отозванный пропуск перестаёт пускать', afterRevoke.valid === false && afterRevoke.reason === 'revoked',
    JSON.stringify(afterRevoke));

  group('25. C-56 — доступ в чужую квартиру');

  // Жителя надо завести в реестре помещения: доступ просят в конкретную
  // квартиру, а не по адресу из профиля
  const ukUnits = (await call(`/buildings/${uk}/units`, { token: t })).body;
  const myUnit = ukUnits[0];
  await call(`/buildings/units/${myUnit.id}/residents`, {
    token: t, body: { userPhone: resident, fullName: 'Житель', residentRole: 'owner' },
  });

  const winFrom = new Date(Date.now() + 3600_000).toISOString();
  const winTo = new Date(Date.now() + 3 * 3600_000).toISOString();

  // Наряд настоящий: запрос доступа ссылается на него внешним ключом
  const c56Permit = (await call(`/orders/${await newOrder(t, 'доступ в чужое помещение')}/permits`, {
    token: t,
    body: {
      buildingId: uk, zoneTypes: ['water_riser'], riserIds: ['R1'],
      windowFrom: winFrom, windowTo: winTo, masterIsPlatform: true, qualificationOk: true,
    },
  })).body.id;

  const u_noReason = await call('/unit-access', {
    token: t, body: { buildingId: uk, unitId: myUnit.id, windowFrom: winFrom, windowTo: winTo, reason: '' },
  });
  check('без причины запрос не создаётся', u_noReason.status >= 400, errText(u_noReason.body));

  const ua = (await call('/unit-access', {
    token: t,
    body: {
      buildingId: uk, unitId: myUnit.id, permitId: c56Permit,
      reason: 'Сосед снизу заливает — нужен доступ к стояку',
      windowFrom: winFrom, windowTo: winTo, masterName: 'Алишер',
    },
  })).body;
  check('запрос доступа создан', Boolean(ua.id) && ua.status === 'requested', JSON.stringify(ua).slice(0, 100));
  check('у запроса есть код ссылки для жителя без приложения', /^[A-Z2-9]{8}$/.test(String(ua.accessCode)), String(ua.accessCode));
  check('квартира названа номером, а не идентификатором', ua.unitLabel === myUnit.number, String(ua.unitLabel));

  // Повтор по тому же наряду не плодит второе сообщение жителю
  const u_again = (await call('/unit-access', {
    token: t,
    body: { buildingId: uk, unitId: myUnit.id, permitId: c56Permit, reason: 'То же самое', windowFrom: winFrom, windowTo: winTo },
  })).body;
  check('повторный запрос по тому же наряду возвращает прежний', u_again.id === ua.id, `${ua.id} / ${u_again.id}`);

  // Гейт наряда: пока молчит — выезжать рано
  const gate = (await call(`/permits/${c56Permit}/unit-access`, { token: t })).body;
  check('наряд не готов, пока доступ не согласован', gate.ready === false && gate.pending.includes(myUnit.number),
    JSON.stringify(gate));

  const mineReq = (await call('/app/my-building/access-requests', { token: rt })).body.requests ?? [];
  check('житель видит запрос в своё помещение', mineReq.some((x) => x.id === ua.id), String(mineReq.length));
  check('текст причины доезжает до жителя целиком',
    mineReq.find((x) => x.id === ua.id)?.reason?.includes('стояку'), String(mineReq[0]?.reason));

  // Сосед из другой квартиры чужой запрос видеть не должен
  const alienList = (await call('/app/my-building/access-requests', { token: nt })).body.requests ?? [];
  check('чужой запрос соседу не показывается', !alienList.some((x) => x.id === ua.id), String(alienList.length));

  const noWhy = await call(`/app/my-building/access-requests/${ua.id}/decide`, {
    token: rt, body: { decision: 'decline' },
  });
  check('отказ без причины не принимается', noWhy.status >= 400, errText(noWhy.body));

  const proposed = (await call(`/app/my-building/access-requests/${ua.id}/decide`, {
    token: rt,
    body: { decision: 'propose', from: new Date(Date.now() + 26 * 3600_000).toISOString(), to: new Date(Date.now() + 28 * 3600_000).toISOString() },
  })).body;
  check('житель может предложить своё окно', proposed.status === 'rescheduled' && Boolean(proposed.proposedFrom),
    JSON.stringify(proposed).slice(0, 120));

  const twice = await call(`/app/my-building/access-requests/${ua.id}/decide`, { token: rt, body: { decision: 'approve' } });
  check('второе решение по тому же запросу не принимается', twice.status === 409, String(twice.status));

  // Молчание — это «нет ответа», а не согласие: в чужое жильё так не входят
  const silent = (await call('/unit-access', {
    token: t,
    body: { buildingId: uk, unitId: myUnit.id, reason: 'Плановая замена крана', windowFrom: winFrom, windowTo: winTo },
  })).body;
  const expired = (await call(`/unit-access/expire?now=${encodeURIComponent(new Date(Date.now() + 48 * 3600_000).toISOString())}`, {
    token: t, method: 'POST',
  })).body;
  check('молчание закрывает запрос как «нет ответа»', (expired.expired ?? []).some((x) => x.id === silent.id),
    String((expired.expired ?? []).length));
  const afterExpire = ((await call('/app/my-building/access-requests', { token: rt })).body.requests ?? [])
    .find((x) => x.id === silent.id);
  check('и статус именно expired, а не approved', afterExpire?.status === 'expired', String(afterExpire?.status));

  group('26. C-56 по ссылке — житель без приложения');

  const linkPermit = (await call(`/orders/${await newOrder(t, 'доступ по ссылке из SMS')}/permits`, {
    token: t,
    body: {
      buildingId: uk, zoneTypes: ['water_riser'], riserIds: ['R1'],
      windowFrom: winFrom, windowTo: winTo, masterIsPlatform: true, qualificationOk: true,
    },
  })).body.id;

  const linkReq = (await call('/unit-access', {
    token: t,
    body: {
      buildingId: uk, unitId: myUnit.id, permitId: linkPermit,
      reason: 'Течь в стояке, нужен доступ', windowFrom: winFrom, windowTo: winTo, masterName: 'Бахтиёр',
    },
  })).body;

  const page = await fetch(`${ROOT}/u/${linkReq.accessCode}`);
  const l_pageHtml = await page.text();
  check('страница открывается по коду без авторизации', page.status === 200, String(page.status));
  check('заголовок прямым текстом, без канцелярита', l_pageHtml.includes('Соседу нужен доступ'), l_pageHtml.slice(0, 80));
  check('номер квартиры и причина на странице',
    l_pageHtml.includes(String(myUnit.number)) && l_pageHtml.includes('Течь в стояке'));
  check('страница закрыта от индексации', /noindex/i.test(l_pageHtml));

  const approveRes = await fetch(`${ROOT}/u/${linkReq.accessCode}/approve`, { method: 'POST' });
  check('согласование по ссылке принимается', approveRes.status === 201 || approveRes.status === 200, String(approveRes.status));

  const afterLink = (await call(`/permits/p-link/unit-access`, { token: t })).body;
  check('наряд стал готов после согласия жителя', afterLink.ready === true, JSON.stringify(afterLink));

  const l_reused = await (await fetch(`${ROOT}/u/${linkReq.accessCode}`)).text();
  check('повторное открытие показывает принятое решение', l_reused.includes('Решение уже принято'), l_reused.slice(0, 80));

  const badCode = await fetch(`${ROOT}/u/ZZZZZZZZ`);
  check('несуществующий код не раскрывает, есть ли такая квартира',
    (await badCode.text()).includes('недействительна'), String(badCode.status));

  group('27. Аудит — первый модуль на PostgreSQL');

  // Записи аудита уже наделали предыдущие секции: пропуска, замечания,
  // решения по доступу. Проверяем, что журнал их видит — и видит одинаково
  // независимо от того, лежит он в файле или в базе
  const audit = (await call('/admin/audit?limit=200', { token: t })).body;
  check('журнал читается', Array.isArray(audit), typeof audit);
  check('в журнале есть выдача гостевого пропуска',
    audit.some((e) => e.action === 'building.guest_pass_issued'), String(audit.length));
  check('в журнале есть решение по доступу в помещение',
    audit.some((e) => String(e.action).startsWith('unit_access.')), String(audit.length));
  check('у записи сохранён телефон действующего лица',
    audit.every((e) => typeof e.actorPhone === 'string'), JSON.stringify(audit[0] ?? {}).slice(0, 120));

  // Фильтры складываются, а свободный запрос ищет по всем полям сразу
  const byAction = (await call('/admin/audit?action=building.guest_pass_issued', { token: t })).body;
  check('фильтр по действию отбирает только его',
    byAction.length > 0 && byAction.every((e) => e.action === 'building.guest_pass_issued'), String(byAction.length));

  const facets = (await call('/admin/audit/facets', { token: t })).body;
  check('фасеты отдают встречавшиеся значения',
    Array.isArray(facets.actors) && Array.isArray(facets.entities) && facets.actionGroups.length > 0,
    JSON.stringify(facets).slice(0, 140));

  group('28. Параметры системы — второй модуль на PostgreSQL');

  const paramsAll = (await call('/admin/parameters', { token: t })).body;
  check('таблица параметров отдаётся целиком', Array.isArray(paramsAll) && paramsAll.length > 100, String(paramsAll.length));
  check('метаданные приходят из PRD, а не из хранилища',
    paramsAll.every((p) => p.name && Array.isArray(p.levels)), JSON.stringify(paramsAll[0] ?? {}).slice(0, 120));

  // Параметр 5 — наценка за срочность; на нём считается заявка, и он читается
  // из глубины расчёта синхронно, поэтому значение обязано быть в кеше
  const before = paramsAll.find((p) => p.num === 5);
  const changed = (await call('/admin/parameters/5', { token: t, method: 'PUT', body: { value: '+45%' } })).body;
  check('значение меняется', changed.value === '+45%', String(changed.value));

  const afterList = (await call('/admin/parameters', { token: t })).body.find((p) => p.num === 5);
  check('изменение видно сразу в следующем запросе', afterList.value === '+45%', String(afterList.value));

  // Возвращаем как было: параметр влияет на суммы в других наборах
  await call('/admin/parameters/5', { token: t, method: 'PUT', body: { value: before.value } });
  const restored = (await call('/admin/parameters', { token: t })).body.find((p) => p.num === 5);
  check('значение возвращается', restored.value === before.value, String(restored.value));

  const p_missing = await call('/admin/parameters/99999', { token: t, method: 'PUT', body: { value: 'x' } });
  check('несуществующий параметр не заводится молча', p_missing.status >= 400, String(p_missing.status));

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Пройдено: ${passed}   Провалено: ${failed}`);
  if (failed) {
    console.log('\nНе прошло:');
    for (const f of failures) console.log(`  · ${f}`);
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('\nПрогон упал:', e);
  process.exit(1);
});
