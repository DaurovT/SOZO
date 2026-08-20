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
  check('второй заявитель на тот же объект отклоняется', conflict.status === 409, errText(conflict.body));

  const uk = await setupBuilding(t, { name: 'ЖК Сокол', address: 'Амира Темура 15', org: 'uk1', plan: 'free', kind: 'hoa' });
  const bc = await setupBuilding(t, { name: 'БЦ Пойтахт', address: 'Шота Руставели 4', org: 'bc1', plan: 'pro', kind: 'bc' });
  check('объекты активированы', Boolean(uk && bc));

  // ---------------------------------------------------------------
  group('2. Справочник зон A-41');
  const zones = (await call(`/buildings/${uk}/zones`, { token: t })).body;
  const gas = zones.find((z) => z.zoneType === 'gas_equipment');
  const panel = zones.find((z) => z.zoneType === 'electrical_panel');
  const riser = zones.find((z) => z.zoneType === 'water_riser');
  check('газовое оборудование критично и лицензируемо', gas?.isCritical && gas?.isLicensed);
  check('электрощитовая критична, но не лицензируема', panel?.isCritical && !panel?.isLicensed);
  check('водяной стояк — обычная зона', !riser?.isCritical && !riser?.isLicensed);

  // ---------------------------------------------------------------
  group('3. Наряд-допуск: запреты');
  const licensed = await call('/orders/o-lic/permits', {
    token: t,
    body: { buildingId: uk, zoneTypes: ['gas_equipment'], masterIsPlatform: true, qualificationOk: true },
  });
  check('лицензируемая зона мастеру платформы запрещена (ТЗ 17.8)', licensed.status === 403, errText(licensed.body));

  const licensedOp = await call('/orders/o-lic2/permits', {
    token: t,
    body: { buildingId: uk, zoneTypes: ['gas_equipment'], masterIsPlatform: false, operatorSelfDeclared: true },
  });
  check('та же зона штатному мастеру оператора разрешена', licensedOp.status < 400, errText(licensedOp.body));

  // ---------------------------------------------------------------
  group('4. Наряд-допуск: граф и гейты');
  const p = (await call('/orders/o-1/permits', {
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

  await call('/passes', { token: t, body: { buildingId: uk, orderId: 'o-1', masterId: 'm-1', validFrom: iso(-1), validTo: iso(12) } });
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
  const plain = (await call('/orders/o-auto1/permits', { token: t, body: { buildingId: uk, zoneTypes: ['water_riser'], windowFrom: iso(1), windowTo: iso(5), masterIsPlatform: true, qualificationOk: true } })).body;
  const crit = (await call('/orders/o-auto2/permits', { token: t, body: { buildingId: uk, zoneTypes: ['electrical_panel'], windowFrom: iso(1), windowTo: iso(5), masterIsPlatform: false, operatorSelfDeclared: true } })).body;
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
  const smsPermit = (await call('/orders/o-sms/permits', {
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
  check('видна зона доступа', pageHtml.includes('стояк ХВС'));
  check('видна зона влияния отключения', /Затронет \d+ помещ/.test(pageHtml));
  check('обещан срок авто-согласия', pageHtml.includes('согласуется автоматически'));

  // Критичная зона: авто-согласия не будет — это должно быть сказано ДО решения
  const critPermit = (await call('/orders/o-sms2/permits', {
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
