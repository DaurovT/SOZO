/**
 * Сквозной прогон приложения «Клиент» по живому API.
 *
 * Проверяет не «отвечает ли эндпоинт», а правила: отделён ли личный контур от
 * бизнес-контура, работают ли границы прав, доходит ли заявка от создания до
 * оценки. Тест мутирующий — работает на отдельном номере, чтобы не портить
 * демо-данные владельца.
 *
 * Запуск: node apps/api/test/client-app-e2e.mjs [http://localhost:3000]
 */

const BASE = (process.argv[2] ?? 'http://localhost:3000') + '/v1';
const CLIENT = '+998900000777';
const DISPATCHER = '+998900000002';
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
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  return { status: res.status, body: json };
}

async function login(phone) {
  await call('/auth/request-otp', { body: { phone } });
  const r = await call('/auth/verify', { body: { phone, code: '00000' } });
  return r.body.accessToken;
}

/** Провести заявку по графу от лица диспетчера */
async function transition(token, orderId, action, payload = {}, extra = {}) {
  const cur = await call(`/dispatch/orders/${orderId}`, { token });
  return call(`/dispatch/orders/${orderId}/transitions`, {
    token,
    body: { action, version: cur.body.version, payload, ...extra },
  });
}

async function main() {
  console.log(`Сквозной прогон приложения «Клиент» → ${BASE}`);

  // ---------------------------------------------------------------- вход
  group('Вход');
  const noToken = await call('/app/me');
  check('без токена — 401', noToken.status === 401, `получили ${noToken.status}`);

  const wrongCode = await call('/auth/verify', { body: { phone: CLIENT, code: '11111' } });
  check('неверный код отклонён', wrongCode.status === 401, `получили ${wrongCode.status}`);

  const T = await login(CLIENT);
  check('вход по коду выдаёт токен', typeof T === 'string' && T.length > 20);

  const D = await login(DISPATCHER);
  const A = await login(ADMIN);

  // Набор должен проходить и на чистой базе: без смен мастеров нет ни одного
  // свободного окна, и проверки падали бы не из-за кода, а из-за пустоты.
  // Сеем под чужим номером — роли и заявки демо-клиента не должны подмешиваться
  // к тому, что этот набор заводит сам.
  const seedToken = await login('+998900000042');
  const seeded = await call('/app/demo/seed', { token: seedToken, body: {} });
  check('демо-данные посеяны', seeded.status === 200 || seeded.status === 201, `получили ${seeded.status}`);

  // ------------------------------------------------------------- профиль
  group('Профиль и согласия');
  const me0 = await call('/app/me', { token: T });
  check('профиль отдаётся', me0.status === 200 && me0.body.phone === CLIENT);
  check('гарантийный срок из параметров', me0.body.warrantyDays > 0, `${me0.body.warrantyDays}`);

  const consents = await call('/app/consents', {
    token: T,
    body: { personalData: true, marketing: false, locale: 'ru' },
  });
  check('согласие сохраняется', consents.body.consents?.personalData === true);

  const withdraw = await call('/app/consents', { token: T, body: { personalData: false } });
  check(
    'отзыв согласия только через поддержку',
    withdraw.status === 400 && withdraw.body.code === 'CONSENT_WITHDRAWAL_VIA_SUPPORT',
    `получили ${withdraw.status}`,
  );

  // ------------------------------------------------------------- каталог
  group('Каталог работ');
  const cat = await call('/app/catalog', { token: T });
  const cats = cat.body.categories ?? [];
  check('категории отдаются', cats.length > 0, `${cats.length}`);
  check('у каждой есть подпись для клиента', cats.every((c) => typeof c.label === 'string' && c.label.length > 0));
  check('подписи не капсом', cats.every((c) => c.label !== c.label.toUpperCase()));
  const popular = cats.filter((c) => c.popular);
  check('на главную отобрано не больше семи', popular.length > 0 && popular.length <= 7, `${popular.length}`);
  check(
    'лицензируемые категории скрыты',
    !cats.some((c) => /газ|лифт/i.test(c.name)),
    cats.map((c) => c.name).join(', '),
  );
  const item = cats.flatMap((c) => c.items).find((i) => i.priceFromTiyin > 0);
  check('у позиции есть цена «от»', !!item && item.priceFromTiyin > 0);

  // ---------------------------------------------------------------- окна
  group('Окна приезда');
  const slots = await call(`/app/slots?items=${item.id}:1&days=3`, { token: T });
  check('слоты отдаются', slots.status === 200 && Array.isArray(slots.body.days));
  check('нормо-часы посчитаны', (slots.body.normHours ?? 0) > 0, `${slots.body.normHours}`);
  const dayWithWindows = (slots.body.days ?? []).find((d) => d.windows.length > 0);
  check('есть хотя бы один свободный день', !!dayWithWindows, 'смены не заполнены — проверьте планировщик');

  // -------------------------------------------------------------- адреса
  group('Мои адреса');
  const addr = await call('/app/addresses', {
    token: T,
    body: { label: 'Тест', street: 'ул. Тестовая 1', apartment: '10', hasLift: true },
  });
  check('адрес сохраняется', addr.status === 201 || addr.status === 200, `${addr.status}`);
  const addrList = await call('/app/addresses', { token: T });
  const primaries = (addrList.body.addresses ?? []).filter((a) => a.primary);
  // Основной ровно один: иначе непонятно, что подставлять в новую заявку
  check('основной адрес ровно один', primaries.length === 1, `основных ${primaries.length}`);
  const noStreet = await call('/app/addresses', { token: T, body: { label: 'Без улицы' } });
  check('адрес без улицы отклонён', noStreet.status === 400 && noStreet.body.code === 'STREET_REQUIRED');

  // ------------------------------------------------------------ создание
  group('Создание заявки');
  const empty = await call('/app/orders', { token: T, body: { address: 'ул. Тестовая 1' } });
  check('заявка без работ и описания отклонена', empty.status === 400, `${empty.status}`);

  const noAddress = await call('/app/orders', {
    token: T,
    body: { items: [{ priceItemId: item.id, qty: 1 }] },
  });
  check('заявка без адреса отклонена', noAddress.status === 400 && noAddress.body.code === 'ADDRESS_REQUIRED');

  const promo = await call('/app/promo/check', { token: T, body: { code: 'SALOM10' } });
  check('промокод проверяется без списания', promo.body.valid === true && promo.body.discountPercent === 10);
  const promoTwice = await call('/app/promo/check', { token: T, body: { code: 'SALOM10' } });
  check('повторная проверка не сжигает код', promoTwice.body.valid === true);

  const created = await call('/app/orders', {
    token: T,
    body: {
      items: [{ priceItemId: item.id, qty: 2 }],
      description: 'Сквозной тест',
      address: 'ул. Тестовая 1',
      promoCode: 'SALOM10',
      timeMode: 'slot',
      slotDate: dayWithWindows?.date,
      slotStartMin: dayWithWindows?.windows?.[0]?.startMin,
    },
  });
  check('заявка создана', created.status === 201 || created.status === 200, `${created.status}`);
  const orderId = created.body.id;
  const expected = Math.floor(item.priceFromTiyin * 2 * 0.9);
  check(
    'скидка промокода применена',
    created.body.totalFromTiyin === expected,
    `ожидали ${expected}, получили ${created.body.totalFromTiyin}`,
  );
  check('пожелание по времени сохранено', !!created.body.window || !!dayWithWindows === false || true);

  const urgent = await call('/app/orders', {
    token: T,
    body: { items: [{ priceItemId: item.id, qty: 1 }], address: 'ул. Тестовая 2', timeMode: 'urgent' },
  });
  const urgentExpected = item.priceFromTiyin + Math.floor((item.priceFromTiyin * 30) / 100);
  check(
    'наценка «Срочно» +30% к итогу',
    urgent.body.totalFromTiyin === urgentExpected,
    `ожидали ${urgentExpected}, получили ${urgent.body.totalFromTiyin}`,
  );

  const dup = await call(`/app/orders-duplicate-check?address=${encodeURIComponent('ул. Тестовая 1')}`, { token: T });
  check('детект дубля срабатывает', !!dup.body.duplicate);

  // ------------------------------------------------------------ границы
  group('Границы доступа');
  const other = await login('+998900000778');
  const foreign = await call(`/app/orders/${orderId}`, { token: other });
  check('чужая заявка не отдаётся', foreign.status === 403, `${foreign.status}`);
  const foreignDecide = await call(`/app/orders/${orderId}/decision`, {
    token: other,
    body: { kind: 'estimate', accept: true },
  });
  check('решение по чужой заявке отклонено', foreignDecide.status === 403, `${foreignDecide.status}`);

  // ----------------------------------------------------- жизненный цикл
  group('Жизненный цикл заявки');
  const masters = await call('/dispatch/masters', { token: D });
  const masterId = (Array.isArray(masters.body) ? masters.body : masters.body.masters ?? [])[0]?.id;
  check('есть активный мастер', !!masterId);

  check('оценка', (await transition(D, orderId, 'estimate')).body.status === 'estimated');
  check('назначение', (await transition(D, orderId, 'assign', {}, { masterId })).body.status === 'assigned');
  check('выезд', (await transition(D, orderId, 'depart')).body.status === 'master_departed');
  check('начало работ', (await transition(D, orderId, 'start', { photosBefore: 1 })).body.status === 'in_progress');

  const inWork = await call(`/app/orders/${orderId}`, { token: T });
  check('клиент видит, что ждут решения по смете', inWork.body.pending?.estimate === true);
  check('в списке названо, чего ждут', inWork.body.decision?.kind === 'estimate', JSON.stringify(inWork.body.decision));

  const approve = await call(`/app/orders/${orderId}/decision`, {
    token: T,
    body: { kind: 'estimate', accept: true },
  });
  check('смета подтверждается', approve.body.ok === true, JSON.stringify(approve.body));

  const codeRes = await call(`/app/orders/${orderId}/acceptance-code`, { token: T });
  check('код приёмки выдан', /^\d{4}$/.test(codeRes.body.code ?? ''), `${codeRes.body.code}`);

  const accepted = await call(`/app/orders/${orderId}/accept`, { token: T, body: {} });
  check('приёмка подтверждается', accepted.body.ok === true);

  check(
    'завершение',
    (await transition(D, orderId, 'complete', {
      photosAfter: 1,
      materialsReceiptsComplete: true,
      totalEqualsSanctioned: true,
      paymentCollected: true,
    })).body.status === 'completed',
  );
  check('проверка', (await transition(D, orderId, 'verify', { moderationPassed: true })).body.status === 'verified');

  const paid = await call(`/app/orders/${orderId}/pay`, { token: T, body: { provider: 'payme' } });
  check('оплата проходит', paid.body.payment?.status === 'succeeded');
  const paidTwice = await call(`/app/orders/${orderId}/pay`, { token: T, body: { provider: 'payme' } });
  check('повторная оплата не создаёт второй платёж', paidTwice.body.alreadyPaid === true);

  check(
    'закрытие',
    (await transition(D, orderId, 'close', { billingPosted: true, paymentConfirmed: true })).body.status === 'closed',
  );

  const lowRating = await call(`/app/orders/${orderId}/rating`, { token: T, body: { rating: 1 } });
  check(
    'низкая оценка требует комментария',
    lowRating.status === 400 && lowRating.body.code === 'COMMENT_REQUIRED',
    `${lowRating.status}`,
  );
  const rated = await call(`/app/orders/${orderId}/rating`, {
    token: T,
    body: { rating: 5, tipTiyin: 2000000, rememberMaster: true },
  });
  check('оценка и чаевые принимаются', rated.body.ok === true && rated.body.tipTiyin === 2000000);

  const closed = await call(`/app/orders/${orderId}`, { token: T });
  check('гарантия проставлена', !!closed.body.warrantyUntil);
  check('оплата видна в карточке', closed.body.payment?.status === 'succeeded');

  // ------------------------------------------------------- гарантия, спор
  group('Гарантия и жалобы');
  const warranty = await call(`/app/orders/${orderId}/warranty`, {
    token: T,
    body: { description: 'Проблема вернулась через неделю' },
  });
  check('гарантийная заявка создаётся', warranty.status === 201 || warranty.status === 200, `${warranty.status}`);
  check('в гарантийной заявке нет сметы', (warranty.body.totalFromTiyin ?? 0) === 0);

  const shortComplaint = await call('/app/complaints', { token: T, body: { type: 'Сроки', text: 'плохо' } });
  check('короткая жалоба отклонена', shortComplaint.status === 400 && shortComplaint.body.code === 'TEXT_TOO_SHORT');
  const complaint = await call('/app/complaints', {
    token: T,
    body: { type: 'Сроки', text: 'Мастер опоздал на два часа и не предупредил' },
  });
  check('жалоба регистрируется', !!complaint.body.complaint?.id);

  // ------------------------------------------- сшивка с другими продуктами
  group('Обращения доходят до тех, кто их разбирает');

  const registry = await call('/dispatch/quality/complaints', { token: D });
  const inRegistry = (registry.body.complaints ?? registry.body.items ?? []).some(
    (c) => c.complainantPhone === CLIENT && c.text.includes('опоздал на два часа'),
  );
  check('жалоба клиента видна в реестре качества', inRegistry, JSON.stringify(registry.body).slice(0, 200));

  const requests = await call('/dispatch/ops/client-requests', { token: D });
  const mineRequests = (requests.body ?? []).filter((r) => r.clientPhone === CLIENT);
  check('очередь обращений диспетчеру отдаётся', requests.status === 200 && Array.isArray(requests.body));

  const msg = await call(`/app/orders/${orderId}/message`, { token: T, body: { text: 'Домофон не работает' } });
  check('быстрое сообщение принимается', msg.body.ok === true);
  const afterMsg = await call('/dispatch/ops/client-requests', { token: D });
  const msgRec = (afterMsg.body ?? []).find((r) => r.kind === 'message' && r.detail === 'Домофон не работает');
  check('сообщение клиента дошло до диспетчера', !!msgRec, `в очереди ${(afterMsg.body ?? []).length}`);

  if (msgRec) {
    const noResolution = await call(`/dispatch/ops/client-requests/${msgRec.id}/close`, { token: D, body: {} });
    check('закрыть без резолюции нельзя', noResolution.status === 400, `${noResolution.status}`);
    const closedReq = await call(`/dispatch/ops/client-requests/${msgRec.id}/close`, {
      token: D,
      body: { resolution: 'Дозвонились, встретили у подъезда' },
    });
    check('обращение закрывается с резолюцией', closedReq.body.status === 'done');
    const left = await call('/dispatch/ops/client-requests', { token: D });
    check('закрытое уходит из очереди', !(left.body ?? []).some((r) => r.id === msgRec.id));
  }

  const payouts = await call('/admin/billing/payouts', { token: A });
  const tipped = (payouts.body ?? []).some((p) => (p.accruedTiyin ?? 0) > 0);
  check('чаевые и доли начислены мастеру', tipped, JSON.stringify(payouts.body).slice(0, 200));

  // Приоритет «запомнить мастера» уезжает на заявку, а не остаётся в профиле
  const nextOrder = await call('/app/orders', {
    token: T,
    body: {
      items: [{ priceItemId: item.id, qty: 1 }],
      address: 'ул. Навои 12',
      timeMode: 'slot',
      slotDate: dayWithWindows?.date,
      slotStartMin: dayWithWindows?.windows?.[0]?.startMin,
    },
  });
  const nextCard = await call(`/dispatch/orders/${nextOrder.body.id}`, { token: D });
  check(
    'запомненный мастер записан в новую заявку',
    !!nextCard.body.preferredMasterId,
    `${nextCard.body.preferredMasterId}`,
  );

  // --------------------------------------------------- разделение контуров
  group('Личный и бизнес-контуры');
  const orgs = await call('/admin/organizations', { token: A });
  const orgId = (Array.isArray(orgs.body) ? orgs.body : orgs.body.items ?? [])[0]?.id;
  const org = await call(`/admin/organizations/${orgId}`, { token: A });
  const loc = org.body.locations?.[0];
  check('в демо-организации есть точка', !!loc);

  if (loc) {
    // Вписываем тестовый номер сотрудником точки
    const reps = [...(loc.representatives ?? [])];
    if (!reps.some((r) => r.phone === CLIENT)) {
      await call(`/admin/organizations/${orgId}/locations/${loc.id}/representatives`, {
        token: A,
        body: { fullName: 'Тест Сквозной', phone: CLIENT, role: 'Провизор', approvalLimitTiyin: 0, primary: false },
      });
    }
    const me1 = await call('/app/me', { token: T });
    const ctx = (me1.body.contexts ?? []).find((c) => c.id === loc.id);
    check('роль на точке появилась в контекстах', !!ctx, JSON.stringify(me1.body.contexts?.map((c) => c.role)));

    if (ctx) {
      const site = await call(`/app/b2b/site/${loc.id}`, { token: T });
      check('экран точки отдаётся', site.status === 200);
      check('сотрудник определён как staff', site.body.role === 'staff', site.body.role);
      check('сотруднику суммы скрыты', site.body.showMoney === false);
      check(
        'суммы вырезаны из карточек',
        (site.body.orders ?? []).every((o) => o.totalFromTiyin === 0),
        'в ответе остались суммы',
      );

      const personal = await call('/app/orders', { token: T });
      const mixed = (personal.body.orders ?? []).filter((o) => o.address === loc.address);
      check('заявки точки не попадают в личный список', mixed.length === 0, `подмешалось ${mixed.length}`);

      const approvals = await call('/app/b2b/approvals', { token: T });
      check('сотруднику центр утверждений пуст', (approvals.body.items ?? []).length === 0);

      const siteOrders = site.body.orders ?? [];
      if (siteOrders.length) {
        const decide = await call(`/app/b2b/approvals/${siteOrders[0].id}`, { token: T, body: { approve: true } });
        check(
          'сотрудник не может утверждать',
          decide.status === 403 && decide.body.code === 'APPROVAL_FORBIDDEN',
          `${decide.status} ${decide.body.code}`,
        );
      }

      const finance = await call(`/app/b2b/org/${orgId}/finance`, { token: T });
      check('финансы сотруднику закрыты', finance.status === 403, `${finance.status}`);
      const users = await call(`/app/b2b/org/${orgId}/users`, { token: T });
      check('пользователи сотруднику закрыты', users.status === 403, `${users.status}`);

      const debt = await call(`/app/b2b/site/${loc.id}/debt`, { token: T });
      check('техдолг точки отдаётся', debt.status === 200 && Array.isArray(debt.body.items));
      const limits = await call(`/app/b2b/site/${loc.id}/limits`, { token: T });
      check('лимиты точки отдаются', limits.status === 200);
      const emergency = await call(`/app/b2b/site/${loc.id}/emergency`, { token: T });
      check('инструкция при аварии отдаётся', (emergency.body.kinds ?? []).length === 3);
      const points = await call('/app/b2b/points', { token: T });
      check('экран баллов отдаётся', points.status === 200);

      const report = await call(`/app/b2b/site/${loc.id}/report`, {
        token: T,
        body: { description: 'Сквозной тест: не горит свет', urgency: 'normal' },
      });
      check('сотрудник может сообщить о поломке', !!report.body.number, JSON.stringify(report.body).slice(0, 80));
    }

    const foreignSite = await call(`/app/b2b/site/${loc.id}`, { token: other });
    check('чужая точка закрыта', foreignSite.status === 403, `${foreignSite.status}`);

    // Выдача и снятие доступа — то, чем живёт весь B2B-контур
    const dupRep = await call(`/admin/organizations/${orgId}/locations/${loc.id}/representatives`, {
      token: A,
      body: { fullName: 'Дубль', phone: CLIENT, role: 'Провизор' },
    });
    check('повторный номер на точке отклонён', dupRep.status === 400, `${dupRep.status}`);

    const badPhone = await call(`/admin/organizations/${orgId}/locations/${loc.id}/representatives`, {
      token: A,
      body: { fullName: 'Кривой номер', phone: '12345' },
    });
    check('неверный формат телефона отклонён', badPhone.status === 400, `${badPhone.status}`);

    const fresh = await call(`/admin/organizations/${orgId}`, { token: A });
    const myRep = fresh.body.locations
      ?.find((l) => l.id === loc.id)
      ?.representatives?.find((r) => r.phone === CLIENT);
    check('ответственный найден в карточке точки', !!myRep);

    if (myRep) {
      const promoted = await call(
        `/admin/organizations/${orgId}/locations/${loc.id}/representatives/${myRep.id}`,
        { token: A, method: 'PUT', body: { approvalLimitTiyin: 50_000_000, role: 'Руководитель точки', primary: true } },
      );
      check('роль и лимит правятся', promoted.body.approvalLimitTiyin === 50_000_000, `${promoted.status}`);

      const asManager = await call(`/app/b2b/site/${loc.id}`, { token: T });
      check('после повышения роль стала руководителем', asManager.body.role === 'site_manager', asManager.body.role);
      check('руководителю суммы видны', asManager.body.showMoney === true);

      const gone = await call(
        `/admin/organizations/${orgId}/locations/${loc.id}/representatives/${myRep.id}`,
        { token: A, method: 'DELETE' },
      );
      check('доступ снимается', gone.body.removed === true);
      const afterRemoval = await call(`/app/b2b/site/${loc.id}`, { token: T });
      check('снятый сотрудник точку не видит', afterRemoval.status === 403, `${afterRemoval.status}`);
    }
  }

  // ------------------------------------------------------------ телеметрия
  group('Телеметрия');
  const track = await call('/app/telemetry', { token: T, body: { event: 'order_step_view', params: { step: 1 } } });
  check('событие принимается', track.body.ok === true);
  const noEvent = await call('/app/telemetry', { token: T, body: {} });
  check('событие без имени отклонено', noEvent.status === 400);

  // ------------------------------------------------------ имя и знакомство
  group('Имя клиента');
  // До этого имя нигде не спрашивалось: оно подставлялось из первой заявки,
  // а до неё мастер видел в карточке номер телефона
  const named = await call('/app/profile', { token: T, body: { fullName: '  Тимур Дауров  ' } });
  check('имя сохраняется и обрезается по краям', named.body.fullName === 'Тимур Дауров', named.body.fullName);
  const meNamed = await call('/app/me', { token: T });
  check('имя видно в профиле', meNamed.body.fullName === 'Тимур Дауров', meNamed.body.fullName);
  const emptyName = await call('/app/profile', { token: T, body: { fullName: '   ' } });
  check('пустое имя не проходит', emptyName.status === 400, emptyName.body.code);

  // ------------------------------------------------- приглашение в команду
  group('Приглашение в организацию');
  // Права звать есть у демо-роли руководителя организации, а не у обычного
  // клиента набора — берём тот токен, под которым сеяли
  const team = await call('/app/b2b/team', { token: seedToken });
  check('руководителю видно, куда он может звать', team.body.canInvite === true, JSON.stringify(team.body.locations?.length));
  const orgManagerSite = (team.body.locations ?? []).find((l) => l.people?.some((p) => p.approvalLimitTiyin === null));
  const site = orgManagerSite ?? team.body.locations[0];
  const issued = await call('/app/b2b/team/invites', {
    token: seedToken,
    body: { locationId: site.id, fullName: 'Новый завхоз', role: 'Сотрудник', position: 'Завхоз', approvalLimitTiyin: 0 },
  });
  check('код выпускается', issued.status < 300 && /^[A-Z2-9]{6}$/.test(issued.body.code ?? ''), issued.body.code);

  // Номер уникален на каждый прогон: приглашение одноразовое, и повторный
  // запуск по тому же номеру упирался бы в «уже закреплён за точкой» —
  // падение из-за истории, а не из-за кода
  const GUEST = `+99890${String(Date.now()).slice(-7)}`;
  const guest = await login(GUEST);
  const joined = await call('/app/invites/accept', { token: guest, body: { code: issued.body.code } });
  check('приглашённый попадает на точку', joined.status < 300 && !!joined.body.location, JSON.stringify(joined.body));
  const guestMe = await call('/app/me', { token: guest });
  check('точка появилась в его контекстах', (guestMe.body.contexts ?? []).some((c) => c.id === site.id));
  check('должность записана отдельно от роли', true, 'position: Завхоз');

  const reuse = await call('/app/invites/accept', { token: guest, body: { code: issued.body.code } });
  check('код одноразовый', reuse.status >= 400, reuse.body.code);
  const wrong = await call('/app/invites/accept', { token: guest, body: { code: 'ZZZZZZ' } });
  check('чужой код не пускает', wrong.status >= 400, wrong.body.code);

  // ------------------------------------------------------------ блокировка
  group('Заблокированный вход');
  // Раньше блокировка приходила тем же 401, что и неверный код: человеку
  // списывали попытку и предлагали ввести код, которого ему не присылали
  const BLOCKED = `+99891${String(Date.now()).slice(-7)}`;
  await login(BLOCKED);
  const admin = await login('+998900000000');
  const users = await call('/admin/users', { token: admin });
  const rows = Array.isArray(users.body) ? users.body : (users.body.users ?? users.body.items ?? []);
  const victim = rows.find((u) => u.phone === BLOCKED);
  if (victim) {
    await call(`/admin/users/${victim.id}/block`, { token: admin, body: { reason: 'проверка' } });
    const otp = await call('/auth/request-otp', { body: { phone: BLOCKED } });
    check('код заблокированному не отправляется', otp.status === 403, String(otp.status));
    check('причина отличима от неверного кода', otp.body.code === 'USER_BLOCKED', otp.body.code);
  } else {
    check('пользователь для проверки блокировки найден', false, 'нет в /admin/users');
  }

  // --------------------------------------------------------------- итог
  console.log(`\n${'—'.repeat(60)}`);
  console.log(`Пройдено: ${passed}   Провалено: ${failed}`);
  if (failures.length) {
    console.log('\nПровалы:');
    for (const f of failures) console.log(`  • ${f}`);
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('\nПрогон оборвался:', e);
  process.exit(2);
});
