/**
 * Сквозной прогон B2B-контура по живому API.
 *
 * Проходит путь, который в жизни занимает недели: организация → точка →
 * ответственные → заявка → мастер → приёмка → счёт → оплата. Смысл не в том,
 * чтобы дёрнуть каждый эндпоинт, а в том, чтобы условия договора действительно
 * что-то меняли: пороги утверждения, заморозка цен, материалы отдельным счётом,
 * срок выезда по аварии.
 *
 * Тест мутирующий и заводит собственную организацию — демо-данные владельца
 * он не трогает.
 *
 * Запуск: node apps/api/test/b2b-e2e.mjs [http://localhost:3000]
 */

const BASE = (process.argv[2] ?? 'http://localhost:3000') + '/v1';
const ADMIN = '+998900000000';
const DISPATCHER = '+998900000002';
const BOSS = '+998900000801'; // руководитель организации: без потолка
const MANAGER = '+998900000802'; // руководитель точки: потолок 1 000 000 сум
const STAFF = '+998900000803'; // сотрудник: утверждать не может

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
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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

async function transition(token, orderId, action, payload = {}) {
  const cur = await call(`/dispatch/orders/${orderId}`, { token });
  return call(`/dispatch/orders/${orderId}/transitions`, {
    token,
    body: { action, version: cur.body.version, payload },
  });
}

const SOUM = 100; // тийины в суме — суммы в тесте пишем в сумах и умножаем

async function main() {
  console.log(`Сквозной прогон B2B → ${BASE}`);

  const A = await login(ADMIN);
  const D = await login(DISPATCHER);

  // ----------------------------------------------------- организация и точка
  group('Организация, точка, люди');

  const org = await call('/admin/organizations', {
    token: A,
    body: {
      name: `Тестовая сеть ${Date.now()}`,
      inn: '300000777',
      vatPayer: true,
      contractType: 'subscription',
      contractKind: 'annual',
      subscriptionTiyin: 500_000 * SOUM,
    },
  });
  check('организация заводится', org.status === 201 || org.status === 200, `${org.status}`);
  const orgId = org.body.id;

  const loc = await call(`/admin/organizations/${orgId}/locations`, {
    token: A,
    body: { name: 'Точка на Чиланзаре', address: 'Ташкент, Чиланзар-9, дом 3' },
  });
  check('точка заводится', !!loc.body.id, JSON.stringify(loc.body).slice(0, 120));
  const locId = loc.body.id;

  // Паспорт и доступ: из них берутся расчёт абонентки и подсказки при аварии
  await call(`/admin/organizations/${orgId}/locations/${locId}`, {
    token: A,
    method: 'PUT',
    body: {
      passport: { objectType: 'Аптека / магазин', areaM2: 100, bathrooms: 1, acUnits: 2, electricPanels: 1 },
      access: {
        schedule: 'пн–пт 09:00–18:00',
        accessNotes: 'вход со двора',
        hoaContact: 'УК «Тест» +998712000001',
        waterShutoff: 'кран в подсобке',
        electricalPanel: 'щиток у входа',
        gasValve: null,
      },
    },
  });

  const reps = [
    { phone: BOSS, fullName: 'Руководитель Организации', role: 'Руководитель организации', approvalLimitTiyin: null, primary: false },
    { phone: MANAGER, fullName: 'Руководитель Точки', role: 'Руководитель точки', approvalLimitTiyin: 1_000_000 * SOUM, primary: true },
    { phone: STAFF, fullName: 'Сотрудник Точки', role: 'Провизор', approvalLimitTiyin: 0, primary: false },
  ];
  for (const r of reps) {
    const res = await call(`/admin/organizations/${orgId}/locations/${locId}/representatives`, { token: A, body: r });
    check(`заведён ${r.role}`, res.status === 201 || res.status === 200, `${res.status}`);
  }

  const TBoss = await login(BOSS);
  const TManager = await login(MANAGER);
  const TStaff = await login(STAFF);

  const meStaff = await call('/app/me', { token: TStaff });
  const ctxStaff = (meStaff.body.contexts ?? []).find((c) => c.id === locId);
  check('сотрудник видит точку в контекстах', !!ctxStaff && ctxStaff.role === 'staff', JSON.stringify(ctxStaff));
  const meBoss = await call('/app/me', { token: TBoss });
  check(
    'руководитель организации определён по отсутствию потолка',
    (meBoss.body.contexts ?? []).some((c) => c.id === locId && c.role === 'org_manager'),
  );

  // --------------------------------------------- пороги договора и лимиты
  group('Пороги договора и лимиты людей');

  const mismatch = await call(`/admin/organizations/${orgId}/threshold-mismatch`, { token: A });
  check('расхождение с договором видно', Array.isArray(mismatch.body.mismatches));
  // По умолчанию порог руководителя точки — 1 000 000 сум, столько и поставили
  const applied = await call(`/admin/organizations/${orgId}/apply-thresholds`, { token: A, body: {} });
  check('пороги применяются без ошибки', applied.status === 200 || applied.status === 201, `${applied.status}`);

  // ------------------------------------------------ расчёт абонентки
  group('Абонентка по паспортам');

  const estimate = await call(`/admin/organizations/${orgId}/subscription-estimate`, { token: A });
  check('расчёт по паспорту считается', (estimate.body.estimateTiyin ?? 0) > 0, `${estimate.body.estimateTiyin}`);
  check(
    'площадь взята из паспорта, а не типовая',
    (estimate.body.locations ?? [])[0]?.areaAssumed === false,
    JSON.stringify(estimate.body.locations?.[0]),
  );

  // ------------------------------------------------------- заявка от точки
  group('Заявка от точки');

  const report = await call(`/app/b2b/site/${locId}/report`, {
    token: TStaff,
    body: { description: 'Не работает кондиционер в торговом зале', category: 'Кондиционер', urgency: 'normal' },
  });
  check('сотрудник может сообщить о поломке', report.status === 200 || report.status === 201, `${report.status}`);
  const orderId = report.body.orderId ?? report.body.id;
  check('заявка создана', !!orderId, JSON.stringify(report.body).slice(0, 150));

  const site = await call(`/app/b2b/site/${locId}`, { token: TStaff });
  check('сотруднику суммы скрыты', site.body.showMoney === false);
  check('заявка видна на точке', (site.body.orders ?? []).some((o) => o.id === orderId));

  // --------------------------------------------------- заморозка цен
  group('Годовой договор замораживает цены');

  const card = await call(`/dispatch/orders/${orderId}`, { token: D });
  const frozenRelease = card.body.priceListReleaseId;
  check('релиз прайса зафиксирован на заявке', !!frozenRelease);
  const orgAfter = await call(`/admin/organizations/${orgId}`, { token: A });
  check(
    'релиз заморожен в договоре',
    orgAfter.body.priceReleaseIdFrozen === frozenRelease,
    `${orgAfter.body.priceReleaseIdFrozen} ≠ ${frozenRelease}`,
  );

  // ------------------------------------------------------------ SLA аварии
  group('Авария и срок по договору');

  const guide = await call(`/app/b2b/site/${locId}/emergency`, { token: TManager });
  check('подсказка перекрытия воды заполнена', guide.body.kinds?.[0]?.steps?.[0]?.hint === 'кран в подсобке');
  check('срок по договору назван', (guide.body.slaMinutes ?? 0) > 0, `${guide.body.slaMinutes}`);

  const emergency = await call(`/app/b2b/site/${locId}/emergency`, { token: TManager, body: { kind: 'water' } });
  check('аварийная заявка создаётся из приложения', emergency.body.ok === true, JSON.stringify(emergency.body).slice(0, 150));
  const emergencyCard = await call(`/dispatch/orders/${emergency.body.orderId}`, { token: D });
  check('на аварийной заявке стоит срок выезда', !!emergencyCard.body.slaDueAt);
  check('аварийная заявка минует оценку', emergencyCard.body.graphType === 'emergency', emergencyCard.body.graphType);

  const kpi = await call('/dispatch/ops/kpi', { token: D });
  check('счётчик просроченных аварий отдаётся', typeof kpi.body.emergenciesOverdue === 'number');

  // ------------------------------------------------------- права и лимиты
  group('Кто что может утверждать');

  const staffApprovals = await call('/app/b2b/approvals', { token: TStaff });
  check('сотруднику центр утверждений пуст', (staffApprovals.body.items ?? []).length === 0);

  const staffDecide = await call(`/app/b2b/approvals/${orderId}`, { token: TStaff, body: { approve: true } });
  check('сотрудник не может утверждать', staffDecide.status === 403, `${staffDecide.status}`);

  const finance = await call(`/app/b2b/org/${orgId}/finance`, { token: TManager });
  check('финансы руководителю точки закрыты', finance.status === 403, `${finance.status}`);
  const financeBoss = await call(`/app/b2b/org/${orgId}/finance`, { token: TBoss });
  check('финансы руководителю организации открыты', financeBoss.status === 200);
  check('остаток абонентки посчитан', financeBoss.body.balance !== undefined, JSON.stringify(financeBoss.body.balance));

  // --------------------------------------------- люди из приложения (F-52)
  group('Руководитель управляет людьми сам');

  const added = await call(`/app/b2b/site/${locId}/users`, {
    token: TBoss,
    body: { fullName: 'Новый Сотрудник', phone: '+998900000804', approvalLimitTiyin: 0 },
  });
  check('руководитель заводит сотрудника', added.body.ok === true, JSON.stringify(added.body).slice(0, 150));

  const staffAdds = await call(`/app/b2b/site/${locId}/users`, {
    token: TStaff,
    body: { fullName: 'Кто-то Ещё', phone: '+998900000805', approvalLimitTiyin: 0 },
  });
  check('сотрудник людей не заводит', staffAdds.status === 403, `${staffAdds.status}`);

  const managerAddsBoss = await call(`/app/b2b/site/${locId}/users`, {
    token: TManager,
    body: { fullName: 'Второй Руководитель', phone: '+998900000806', approvalLimitTiyin: null },
  });
  check(
    'руководитель точки не может завести себе равного',
    managerAddsBoss.status === 403,
    `${managerAddsBoss.status}`,
  );

  const removed = await call(`/app/b2b/site/${locId}/users/${added.body.user.id}`, { token: TBoss, method: 'DELETE' });
  check('доступ снимается из приложения', removed.body.ok === true);

  // --------------------------------------------------------- документы
  group('Документы точки и организации');

  const T = await login(BOSS);
  const report1 = await fetch(
    `${BASE}/documents/organizations/${orgId}/locations/${locId}/report?token=${encodeURIComponent(T)}`,
  );
  check('отчёт по точке отдаётся руководителю', report1.status === 200, `${report1.status}`);

  const foreign = await login('+998900000899');
  const report2 = await fetch(
    `${BASE}/documents/organizations/${orgId}/locations/${locId}/report?token=${encodeURIComponent(foreign)}`,
  );
  check('чужому отчёт по точке закрыт', report2.status === 403, `${report2.status}`);

  const recon = await fetch(`${BASE}/documents/organizations/${orgId}/reconciliation?token=${encodeURIComponent(T)}`);
  check('акт сверки отдаётся руководителю организации', recon.status === 200, `${recon.status}`);
  const reconStaff = await fetch(
    `${BASE}/documents/organizations/${orgId}/reconciliation?token=${encodeURIComponent(TStaff)}`,
  );
  check('сверка сотруднику закрыта', reconStaff.status === 403, `${reconStaff.status}`);

  // ------------------------------------------------ жизненный цикл заявки
  group('От назначения до счёта');

  const masters = await call('/dispatch/masters', { token: D });
  const masterId = (masters.body ?? [])[0]?.id;
  check('мастер для назначения найден', !!masterId);

  await transition(D, orderId, 'estimate', { hasEstimate: true });

  // Заявка описанием — сумма ноль, в лимит она проходит, но в B2B смету
  // всё равно утверждает ответственный: путь через «на утверждении» и есть
  // тот, ради которого приложение существует
  await transition(D, orderId, 'request_approval');
  const inbox = await call('/app/b2b/approvals', { token: TManager });
  check('заявка попала в центр утверждений руководителя', (inbox.body.items ?? []).some((i) => i.orderId === orderId));

  const decided = await call(`/app/b2b/approvals/${orderId}`, { token: TManager, body: { approve: true } });
  check('руководитель точки утверждает смету', decided.body.ok === true, JSON.stringify(decided.body).slice(0, 150));

  // Назначение — через машину состояний, а не подменой поля: только так
  // проверяются лимиты точки и месячный потолок
  const assign = await call(`/dispatch/orders/${orderId}/transitions`, {
    token: D,
    body: {
      action: 'assign',
      version: (await call(`/dispatch/orders/${orderId}`, { token: D })).body.version,
      payload: { withinOrderLimit: true, monthlyLimitOk: true, prepaymentMarked: true },
      masterId,
    },
  });
  check('мастер назначается', assign.status === 200 || assign.status === 201, JSON.stringify(assign.body).slice(0, 150));

  const afterAssign = await call(`/app/b2b/site/${locId}`, { token: TManager });
  const mine = (afterAssign.body.orders ?? []).find((o) => o.id === orderId);
  check('руководителю точки суммы видны', afterAssign.body.showMoney === true);
  check('заявка дошла до назначения', !!mine);

  // ------------------------------------------------------------ материалы
  group('Материалы отдельным счётом');

  await call(`/admin/organizations/${orgId}/contract`, {
    token: A,
    method: 'PUT',
    body: { materialsSeparateInvoice: true },
  });
  const invoicesBefore = await call('/admin/billing/invoices', { token: A });
  const countBefore = (invoicesBefore.body ?? []).filter((i) => i.organizationId === orgId).length;

  for (const [action, payload] of [
    ['depart', {}],
    ['start', { photosBefore: 1, restrictedSite: false }],
  ]) {
    const r = await transition(D, orderId, action, payload);
    if (r.status !== 200 && r.status !== 201) {
      check(`переход «${action}»`, false, JSON.stringify(r.body).slice(0, 160));
    }
  }

  // Материалы вносятся в работе — раньше статуса «В работе» их некуда класть
  const material = await call(`/dispatch/orders/${orderId}/materials`, {
    token: D,
    body: {
      kind: 'spare_part',
      name: 'Плата управления',
      amountTiyin: 350_000 * SOUM,
      sourceChannel: 'partner_store',
      hasReceipt: true,
      priceTier: 'standard',
    },
  });
  check('материал внесён в заявку', material.status === 200 || material.status === 201, JSON.stringify(material.body).slice(0, 150));

  // Приёмка в B2B — не подпись мастера, а решение ответственного в приложении:
  // без неё заявку нельзя завершить, и это главное отличие контура
  const masterToken = await login((masters.body ?? []).find((m) => m.id === masterId)?.phone ?? '');
  const requested = await call(`/master/orders/${orderId}/acceptance/request`, { token: masterToken, body: {} });
  check('мастер отправляет работу на приёмку', requested.body.ok === true, JSON.stringify(requested.body).slice(0, 150));

  const early = await transition(D, orderId, 'complete', {
    photosAfter: 1,
    materialsReceiptsComplete: true,
    totalEqualsSanctioned: true,
  });
  check('до приёмки заявку завершить нельзя', early.status >= 400, `${early.status}`);

  const rejected = await call(`/app/b2b/orders/${orderId}/acceptance`, {
    token: TManager,
    body: { accept: false, reason: 'Не убрали за собой' },
  });
  check('ответственный может не принять работу', rejected.body.accepted === false);

  await call(`/master/orders/${orderId}/acceptance/request`, { token: masterToken, body: {} });
  const accepted = await call(`/app/b2b/orders/${orderId}/acceptance`, { token: TManager, body: { accept: true } });
  check('ответственный принимает работу', accepted.body.accepted === true, JSON.stringify(accepted.body).slice(0, 150));

  for (const [action, payload] of [
    ['complete', { photosAfter: 1, materialsReceiptsComplete: true, totalEqualsSanctioned: true }],
    ['verify', { moderationPassed: true }],
    ['close', { billingPosted: true, paymentConfirmed: true }],
  ]) {
    const r = await transition(D, orderId, action, payload);
    if (r.status !== 200 && r.status !== 201) {
      check(`переход «${action}»`, false, JSON.stringify(r.body).slice(0, 160));
    }
  }
  const closed = await call(`/dispatch/orders/${orderId}`, { token: D });
  check('заявка закрыта', closed.body.status === 'closed', closed.body.status);

  const invoicesAfter = await call('/admin/billing/invoices', { token: A });
  const forOrg = (invoicesAfter.body ?? []).filter((i) => i.organizationId === orgId);
  check(
    'на материалы выставлен отдельный счёт',
    forOrg.length > countBefore,
    `было ${countBefore}, стало ${forOrg.length}`,
  );

  // ---------------------------------------------------------------- итог
  console.log(`\n${'—'.repeat(60)}`);
  console.log(`Пройдено: ${passed}   Провалено: ${failed}`);
  if (failures.length) {
    console.log('\nПровалы:');
    for (const f of failures) console.log(`  • ${f}`);
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('Прогон упал:', e);
  process.exit(1);
});
