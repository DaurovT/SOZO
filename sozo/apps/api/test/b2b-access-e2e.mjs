/**
 * Сквозной прогон прав в B2B-контуре.
 *
 * Проверяем не «отвечает ли эндпойнт», а «то ли он отвечает этой роли».
 * Ошибки такого рода тихие: раздел финансов сотруднику закрыт, а те же суммы
 * приезжают в сводке по сети — экрана у него нет, но токен лежит в телефоне.
 * Ровно это здесь и ловится, вместе с двумя правами, которые сервер давал, а
 * приложение не показывало: руководитель точки заводит людей и выдаёт коды.
 *
 * Запуск: node apps/api/test/b2b-access-e2e.mjs [http://localhost:3000]
 */

const ROOT = process.argv[2] ?? 'http://localhost:3000';
const BASE = `${ROOT}/v1`;

const STAFF = '+998900000803'; // сотрудник точки
const SITE_MANAGER = '+998900000802'; // руководитель точки
const ORG_MANAGER = '+998900000801'; // руководитель организации

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

async function contextOf(token) {
  const me = await call('/app/me', { token });
  return me.body.contexts?.[0] ?? {};
}

async function main() {
  console.log(`\nПрава в B2B-контуре: ${ROOT}\n${'='.repeat(52)}`);

  const staff = await login(STAFF);
  const siteManager = await login(SITE_MANAGER);
  const orgManager = await login(ORG_MANAGER);

  const staffCtx = await contextOf(staff);
  const managerCtx = await contextOf(orgManager);

  group('Роли определяются по данным, а не по названию должности');
  check('сотрудник — staff', staffCtx.role === 'staff', String(staffCtx.role));
  check('руководитель организации — org_manager', managerCtx.role === 'org_manager', String(managerCtx.role));
  check('сотруднику суммы скрыты', staffCtx.showMoney === false, String(staffCtx.showMoney));

  group('Деньги сети сотруднику не показываются нигде');
  const staffFinance = await call(`/app/b2b/org/${staffCtx.organizationId}/finance`, { token: staff });
  check('раздел финансов закрыт', staffFinance.status === 403, String(staffFinance.status));
  const staffDash = await call(`/app/b2b/org/${staffCtx.organizationId}`, { token: staff });
  check('дашборд отвечает', staffDash.status === 200, String(staffDash.status));
  const summary = staffDash.body.summary ?? {};
  check('в сводке нет абонентки', summary.subscriptionTiyin === undefined);
  check('в сводке нет долга по счетам', summary.unpaidTiyin === undefined);
  check('в сводке нет техдолга в деньгах', summary.techDebtTiyin === undefined);
  check('счётчик ожидающих утверждения остался', summary.pendingApproval !== undefined);

  const bossDash = await call(`/app/b2b/org/${managerCtx.organizationId}`, { token: orgManager });
  check('руководителю суммы приходят', (bossDash.body.summary ?? {}).subscriptionTiyin !== undefined);

  group('Раздел людей открыт руководителям, закрыт сотруднику');
  const staffUsers = await call(`/app/b2b/org/${staffCtx.organizationId}/users`, { token: staff });
  check('сотруднику закрыт', staffUsers.status === 403, String(staffUsers.status));
  const smUsers = await call(`/app/b2b/org/${managerCtx.organizationId}/users`, { token: siteManager });
  check('руководителю точки открыт', smUsers.status === 200, String(smUsers.status));
  const smLoc = smUsers.body.locations?.[0] ?? {};
  check('видит только свои точки, права ограничены', smLoc.canManage === 'staff_only', String(smLoc.canManage));
  const omUsers = await call(`/app/b2b/org/${managerCtx.organizationId}/users`, { token: orgManager });
  check('руководителю организации — полные права', omUsers.body.locations?.[0]?.canManage === 'all');

  group('Приглашение: выдать, увидеть в списке, отозвать');
  const locationId = smLoc.id;
  const issued = await call('/app/b2b/team/invites', {
    token: siteManager,
    body: { locationId, position: 'Проверка прав', approvalLimitTiyin: 0 },
  });
  check('код выдан', issued.status === 201, String(issued.status));
  check('вернулся id для отзыва', typeof issued.body.id === 'string' && issued.body.id.length > 0);
  const listed = await call(`/app/b2b/org/${managerCtx.organizationId}/users`, { token: siteManager });
  const invites = listed.body.locations?.[0]?.invites ?? [];
  check('код виден в списке точки', invites.some((i) => i.id === issued.body.id));
  const revoked = await call(`/app/b2b/team/invites/${issued.body.id}/revoke`, { token: siteManager, body: {} });
  check('код отозван', revoked.status === 201 && revoked.body.revoked === true, String(revoked.status));
  const after = await call(`/app/b2b/org/${managerCtx.organizationId}/users`, { token: siteManager });
  check(
    'отозванный код из списка ушёл',
    !(after.body.locations?.[0]?.invites ?? []).some((i) => i.id === issued.body.id),
  );

  group('Правка человека: должность меняется, чужой потолок — нет');
  const target = (smLoc.users ?? []).find((u) => u.role === 'staff');
  if (!target) {
    check('нашёлся сотрудник для правки', false, 'на точке нет сотрудника');
  } else {
    const position = await call(`/app/b2b/site/${locationId}/users/${target.id}`, {
      token: siteManager,
      body: { position: 'Старший завхоз' },
    });
    check('должность правится руководителем точки', position.status === 201, String(position.status));
    const limit = await call(`/app/b2b/site/${locationId}/users/${target.id}`, {
      token: siteManager,
      body: { approvalLimitTiyin: 50_000_000 },
    });
    check('потолок утверждения руководителю точки не отдан', limit.status === 403, String(limit.status));
  }

  group('Зона покрытия не пугает обычным адресом');
  const withCity = await call('/app/address-check?address=' + encodeURIComponent('Ташкент, ул. Навои 12'), {
    token: staff,
  });
  check('город назван — обслуживаем', withCity.body.inZone === true, JSON.stringify(withCity.body.message));
  const withZone = await call('/app/address-check?address=' + encodeURIComponent('Чиланзар-9'), { token: staff });
  check('район назван — обслуживаем с именем зоны', withZone.body.zone === 'Чиланзар', String(withZone.body.zone));
  const foreign = await call('/app/address-check?address=' + encodeURIComponent('Самарканд, ул. Регистан 5'), {
    token: staff,
  });
  check('чужой город — не обслуживаем', foreign.body.inZone === false, String(foreign.body.inZone));

  console.log(`\n${'='.repeat(52)}`);
  console.log(`Пройдено: ${passed}   Провалено: ${failed}`);
  if (failures.length) {
    console.log('\nНе прошло:');
    for (const f of failures) console.log(`  · ${f}`);
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('Прогон упал:', e);
  process.exit(1);
});
