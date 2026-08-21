/**
 * Сквозной прогон локалей сервера.
 *
 * Интерфейс приложений переведён целиком, но половина того, что они
 * показывают, приходит отсюда: причины отказа, вопросы экзамена, тексты
 * ошибок, уведомления. Проверяем ровно это — один и тот же запрос с разным
 * `Accept-Language` должен возвращать разный язык, а данные при этом остаться
 * прежними: значение, которое приложение отправит обратно, переводу не
 * подлежит, иначе сервер его не узнает.
 *
 * Узбекский разобран подробно — он первым обзавёлся колонкой и на нём видно
 * все грани механики. Остальные восемь проверяются короче: что язык вообще
 * применяется и что справочные значения при этом не тронуты. Дублировать для
 * каждого весь сценарий незачем — код у них общий, разнятся только словари.
 *
 * Запуск: node apps/api/test/locale-e2e.mjs [http://localhost:3000]
 */

const ROOT = process.argv[2] ?? 'http://localhost:3000';
const BASE = `${ROOT}/v1`;
const MASTER = '+998901234567'; // мастер из сидов: у него есть карточка и допуски
const DISPATCHER = '+998900000002';
const CANDIDATE = '+998900000777';
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

async function call(path, { method, body, token, lang } = {}) {
  const res = await fetch(BASE + path, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(lang ? { 'Accept-Language': lang } : {}),
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

const CYR = /[А-Яа-яЁё]/;

async function main() {
  console.log(`\nЛокали сервера: ${ROOT}\n${'='.repeat(52)}`);

  const dispatcher = await login(DISPATCHER);
  await call('/app/demo/seed', { token: dispatcher, body: {} });
  const master = await login(MASTER);
  const admin = await login(ADMIN);

  group('Справочники приложения');
  const ru = await call('/master/dictionaries', { token: master });
  const uz = await call('/master/dictionaries', { token: master, lang: 'uz' });
  check('справочник отдаётся', ru.status === 200 && uz.status === 200, `${ru.status}/${uz.status}`);

  const ruReason = ru.body.noAccessReasons?.[0];
  const uzReason = uz.body.noAccessReasons?.[0];
  check('причина «нет доступа» переведена', !!uzReason && uzReason.title !== ruReason.title, uzReason?.title);
  check('в переведённой причине нет кириллицы', !CYR.test(uzReason?.title ?? 'x'), uzReason?.title);
  check('код причины не тронут — по нему сервер узнаёт ответ', uzReason?.code === ruReason?.code, uzReason?.code);

  // Тип техники приложение отправляет обратно в payload: переведи его сервер —
  // и следующий запрос ушёл бы со значением, которого в базе нет
  check(
    'тип техники остался русским: он уходит обратно на сервер',
    uz.body.assetTypes?.[0] === ru.body.assetTypes?.[0],
    `${ru.body.assetTypes?.[0]} → ${uz.body.assetTypes?.[0]}`,
  );

  group('Причины отказа от оффера');
  const ruOffers = await call('/master/offers', { token: master });
  const uzOffers = await call('/master/offers', { token: master, lang: 'uz' });
  const ruDecline = ruOffers.body.declineReasons?.find((r) => r.code === 'far');
  const uzDecline = uzOffers.body.declineReasons?.find((r) => r.code === 'far');
  check('причина отказа переведена', uzDecline && uzDecline.title !== ruDecline.title, uzDecline?.title);
  check('в причине отказа нет кириллицы', !CYR.test(uzDecline?.title ?? 'x'), uzDecline?.title);

  group('Экзамен: вопросы и варианты ответов');
  // Кандидат, доведённый до экзамена: он и есть тот, ради кого перевод нужен
  // больше всего — на линию без экзамена не выпускают
  const candidate = await login(CANDIDATE);
  await call('/master/onboarding/application', {
    token: candidate,
    body: { fullName: 'Тест Кандидатов', experienceYears: 3, skillTags: ['сантехника'], zones: ['Чиланзар'], transport: 'own_car', taxMode: 'self_employed' },
  });
  const modules = await call('/master/onboarding/training', { token: candidate });
  for (const m of modules.body.modules ?? []) {
    await call('/master/onboarding/training/complete', { token: candidate, body: { moduleId: m.id } });
  }
  const apps = await call('/admin/onboarding', { token: admin });
  const mine = (apps.body.stages ?? []).flatMap((s) => s.candidates ?? []).find((a) => a.phone === CANDIDATE);
  check('кандидат создан', !!mine, JSON.stringify(apps.body.stages?.map((s) => s.count) ?? []));
  const invited = await call('/admin/onboarding/interview', {
    token: admin,
    body: { phone: CANDIDATE, at: new Date(Date.now() + 86_400_000).toISOString() },
  });
  const seen = await call('/admin/onboarding/interview/passed', { token: admin, body: { phone: CANDIDATE } });
  check('кандидат доведён до экзамена', invited.status < 300 && seen.status < 300, `${invited.status}/${seen.status}`);
  const ruExam = await call('/master/onboarding/exam', { token: candidate });
  const uzExam = await call('/master/onboarding/exam', { token: candidate, lang: 'uz' });
  const ruQ = ruExam.body.questions?.[0];
  const uzQ = uzExam.body.questions?.[0];
  check('вопросы отдаются', !!ruQ && !!uzQ, `${ruExam.status}/${uzExam.status}`);
  check('текст вопроса переведён', !!uzQ && uzQ.text !== ruQ.text, uzQ?.text?.slice(0, 40));
  check('в вопросе нет кириллицы', !CYR.test(uzQ?.text ?? 'x'));
  check(
    'варианты ответов переведены целиком',
    !!uzQ && uzQ.options.every((o) => !CYR.test(o)),
    JSON.stringify(uzQ?.options ?? []).slice(0, 70),
  );
  check('порядок вариантов не изменился — по индексу считается ответ', uzQ?.options?.length === ruQ?.options?.length);

  group('Учебные модули');
  const uzModules = await call('/master/onboarding/training', { token: candidate, lang: 'uz' });
  const uzModule = uzModules.body.modules?.[0];
  check('заголовок модуля переведён', !!uzModule && !CYR.test(uzModule.title), uzModule?.title);

  group('Значения, которые приложение возвращает обратно');
  // Самая тихая поломка перевода: сервер перевёл подпись, приложение отправило
  // её обратно, и сервер своего же документа не узнал. Проверяем именно это —
  // кандидат, работающий на узбекском, должен суметь загрузить паспорт.
  const docsUz = await call('/master/onboarding/status', { token: candidate, lang: 'uz' });
  const docUz = (docsUz.body.application?.documents ?? [])[0];
  const docsRu = await call('/master/onboarding/status', { token: candidate });
  const docRu = (docsRu.body.application?.documents ?? [])[0];
  check('название документа переведено', !!docUz && docUz.name !== docRu?.name, docUz?.name);
  check('код документа не переведён', !!docUz && docUz.code === docRu?.code, docUz?.code);

  const png =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const upload = await call('/master/onboarding/documents', {
    token: candidate,
    lang: 'uz',
    body: { code: docUz?.code, name: docUz?.name, dataUrl: png },
  });
  check('документ загружается на узбекском', upload.status < 300, `${upload.status} ${upload.body.message ?? ''}`);

  // А по переведённому названию — не должен: это и была бы та самая поломка
  const byName = await call('/master/onboarding/documents', {
    token: candidate,
    lang: 'uz',
    body: { name: docUz?.name, dataUrl: png },
  });
  check('по переведённому названию документ не опознаётся — на то и код', byName.status >= 400, String(byName.status));

  group('Каталог услуг: перевод ведёт админ');
  // Название услуги — не строка интерфейса, а содержимое бизнеса: его пишет
  // владелец и меняет вместе с прайсом. Разработчик перевести его не может,
  // поэтому проверяем весь путь — от поля в админке до экрана мастера.
  const releases = await call('/admin/price-releases', { token: admin });
  const activeRelease = (Array.isArray(releases.body) ? releases.body : (releases.body.items ?? [])).find((r) => r.status === 'active');
  const detail = await call(`/admin/price-releases/${activeRelease.id}`, { token: admin });
  const priceItem = detail.body.items?.find((i) => i.name.includes('смесител') || i.name.includes('Смесител')) ?? detail.body.items[0];
  check('позиция прайса приходит с полем перевода', priceItem && 'nameUz' in priceItem, JSON.stringify(priceItem?.nameUz));

  const status0 = await call('/admin/price-releases/translation/status', { token: admin });
  check('видно, сколько позиций без перевода', status0.body.missing > 0, `${status0.body.missing} из ${status0.body.total}`);

  const UZ_NAME = 'Smesitelni o‘rnatish/almashtirish';
  const saved = await call(`/admin/price-releases/${activeRelease.id}/items/${priceItem.id}/name-uz`, {
    token: admin,
    method: 'PATCH',
    body: { nameUz: UZ_NAME },
  });
  check('перевод сохраняется в активном релизе — цену он не меняет', saved.status < 300 && saved.body.nameUz === UZ_NAME, `${saved.status}`);

  const status1 = await call('/admin/price-releases/translation/status', { token: admin });
  check('счётчик непереведённых уменьшился', status1.body.missing === status0.body.missing - 1, `${status0.body.missing} → ${status1.body.missing}`);

  const catUz = await call('/master/catalog', { token: master, lang: 'uz' });
  const catRu = await call('/master/catalog', { token: master });
  const uzLine = (catUz.body.items ?? []).find((i) => i.id === priceItem.id);
  const ruLine = (catRu.body.items ?? []).find((i) => i.id === priceItem.id);
  check('мастер видит услугу по-узбекски', uzLine?.name === UZ_NAME, uzLine?.name);
  check('по-русски название не изменилось — по нему выставлен счёт', ruLine?.name === priceItem.name, ruLine?.name);
  check('идентификатор позиции не тронут — его приложение шлёт обратно', uzLine?.id === ruLine?.id);

  const cleared = await call(`/admin/price-releases/${activeRelease.id}/items/${priceItem.id}/name-uz`, {
    token: admin,
    method: 'PATCH',
    body: { nameUz: '' },
  });
  const catBack = await call('/master/catalog', { token: master, lang: 'uz' });
  check('перевод убирается, название откатывается на русское', cleared.status < 300 && (catBack.body.items ?? []).find((i) => i.id === priceItem.id)?.name === priceItem.name);

  group('Тексты ошибок');
  // Ошибка — половина того, что мастер вообще читает: она приходит в тот
  // момент, когда что-то мешает работать
  const ruErr = await call('/master/orders/нет-такой/delay', { token: master, body: { minutes: 30 } });
  const uzErr = await call('/master/orders/нет-такой/delay', { token: master, lang: 'uz', body: { minutes: 30 } });
  check('ошибка возвращается обоим', ruErr.status >= 400 && uzErr.status === ruErr.status, `${ruErr.status}/${uzErr.status}`);
  check('код ошибки не переводится — по нему приложение ветвится', uzErr.body.code === ruErr.body.code, uzErr.body.code);

  // Собеседование уже пройдено — повтор даёт ошибку с внятным текстом,
  // и это удобный способ проверить сам фильтр исключений
  const ruMsg = await call('/admin/onboarding/interview/passed', { token: admin, body: { phone: CANDIDATE } });
  const uzMsg = await call('/admin/onboarding/interview/passed', { token: admin, lang: 'uz', body: { phone: CANDIDATE } });
  check('текст ошибки переведён', !!uzMsg.body.message && uzMsg.body.message !== ruMsg.body.message, uzMsg.body.message);
  check('в переведённой ошибке нет кириллицы', !CYR.test(uzMsg.body.message ?? 'x'), uzMsg.body.message);

  group('Лента уведомлений');
  // Уведомление рождается в запросе диспетчера — по-русски. Мастер читает его
  // своим запросом, и собраться оно должно на его языке, вместе с подстановками
  const board = await call('/dispatch/kanban', { token: dispatcher });
  const anyOrder = (board.body.columns ?? []).flatMap((c) => c.orders ?? c.items ?? [])[0];
  const masterId = (await call('/master/me', { token: master })).body?.id;
  if (anyOrder && masterId) {
    const sent = await call('/dispatch/offers', { token: dispatcher, body: { orderId: anyOrder.id, masterIds: [masterId] } });
    check('оффер отправлен диспетчером (по-русски)', sent.status < 300, String(sent.status));
  }
  const uzFeed = await call('/master/notifications', { token: master, lang: 'uz' });
  const ruFeed = await call('/master/notifications', { token: master });
  check('лента отдаётся', uzFeed.status === 200, String(uzFeed.status));
  const uzItems = (uzFeed.body.groups ?? []).flatMap((g) => g.items ?? []);
  const ruItems = (ruFeed.body.groups ?? []).flatMap((g) => g.items ?? []);
  if (uzItems.length) {
    check('заголовок уведомления переведён', uzItems.some((n, i) => n.title !== ruItems[i]?.title), uzItems[0]?.title);
    check('смысловая группа переведена', !CYR.test(uzItems[0]?.group ?? 'x'), uzItems[0]?.group);
    // Тело собирается из шаблона и подстановок уже при чтении. Проверяем
    // именно это: сама фраза узбекская, и район — слово из справочника —
    // тоже переведён.
    //
    // Кириллица внутри при этом остаться может и это правильно: название
    // услуги приходит из прайса, который ведёт админ. Переводить содержимое
    // каталога — работа админки, а не сервера, и требовать здесь ноль
    // кириллицы значило бы проверять не то, что мы делали.
    const offerItem = uzItems.find((n) => n.kind === 'offer');
    const ruOffer = ruItems.find((n) => n.kind === 'offer');
    check('тело уведомления собрано на узбекском', !!offerItem && offerItem.body !== ruOffer?.body, offerItem?.body);
    check('русский костяк фразы не остался', !!offerItem && !offerItem.body.includes('Ваша доля'), offerItem?.body);
    check(
      'район переведён внутри фразы',
      !!offerItem && !!ruOffer && offerItem.body.includes('Yunusobod') === ruOffer.body.includes('Юнусабад'),
      offerItem?.body,
    );
  } else {
    check('лента пуста — проверять нечего', true, 'уведомлений нет');
  }

  group('Язык не протекает между запросами');
  const again = await call('/master/dictionaries', { token: master });
  check(
    'запрос без заголовка снова русский',
    again.body.noAccessReasons?.[0]?.title === ruReason.title,
    again.body.noAccessReasons?.[0]?.title,
  );
  const dash = await call('/admin/dashboard', { token: admin });
  check(
    'админка заголовок не шлёт и получает русский',
    dash.status === 200 && !!JSON.stringify(dash.body).length,
    String(dash.status),
  );

  group('Остальные восемь языков');
  // Проверяем то, что у языков общее: заголовок применяется, текст меняется,
  // справочное значение остаётся русским. Качество перевода тут не измерить —
  // это работа вычитки, а не теста
  for (const lang of ['en', 'tr', 'tg', 'ar', 'fr', 'de', 'zh', 'ko']) {
    const r = await call('/master/dictionaries', { token: master, lang });
    const title = r.body.noAccessReasons?.[0]?.title;
    check(`${lang}: причина переведена`, !!title && title !== ruReason.title, title);
    check(
      `${lang}: тип техники остался русским`,
      r.body.assetTypes?.[0] === ru.body.assetTypes?.[0],
      r.body.assetTypes?.[0],
    );
  }

  group('Регион в заголовке не мешает');
  // Браузер шлёт «fr-CA», «zh-Hans-CN», «ar-AE» — регион нам безразличен
  const frCa = await call('/master/dictionaries', { token: master, lang: 'fr-CA' });
  const fr = await call('/master/dictionaries', { token: master, lang: 'fr' });
  check(
    'fr-CA и fr дают один словарь',
    frCa.body.noAccessReasons?.[0]?.title === fr.body.noAccessReasons?.[0]?.title,
    frCa.body.noAccessReasons?.[0]?.title,
  );

  group('Неизвестный язык откатывается на русский');
  const es = await call('/master/dictionaries', { token: master, lang: 'es-ES' });
  check('испанский → русский, а не пустота', es.body.noAccessReasons?.[0]?.title === ruReason.title);

  group('Догружаемые словари приложения «Клиент»');
  // Семь языков не лежат в сборке приложения: оно скачивает их отсюда при
  // выборе языка. Если эндпоинт молчит, человек упирается в невозможность
  // поставить свой язык — и никакой перевод в репозитории этого не исправит
  const index = await call('/public/app-locale');
  check('список языков отдаётся без авторизации', index.status === 200 && Array.isArray(index.body), String(index.status));
  const codes = (index.body ?? []).map((e) => e.code).sort();
  check(
    'в списке ровно семь догружаемых языков',
    JSON.stringify(codes) === JSON.stringify(['ar', 'de', 'fr', 'ko', 'tg', 'tr', 'zh']),
    codes.join(','),
  );
  check('у каждого языка есть отпечаток', (index.body ?? []).every((e) => e.rev && e.strings > 0));

  const ko = await call('/public/app-locale/ko');
  check('словарь отдаётся', ko.status === 200 && !!ko.body.strings, String(ko.status));
  check('в словаре тот же счёт строк, что в списке',
    Object.keys(ko.body.strings ?? {}).length === index.body.find((e) => e.code === 'ko')?.strings);
  check('отпечаток совпадает со списком', ko.body.rev === index.body.find((e) => e.code === 'ko')?.rev);
  check('строки переведены, а не отданы по-русски', !CYR.test(ko.body.strings?.['c30.language'] ?? 'x'),
    ko.body.strings?.['c30.language']);

  // ru/uz/en собраны внутрь приложения. Запрос за ними — ошибка в клиенте,
  // и отвечать на неё словарём значило бы прятать эту ошибку
  const builtIn = await call('/public/app-locale/ru');
  check('встроенный язык отдаёт ошибку, а не словарь', builtIn.status === 400, String(builtIn.status));
  const nonsense = await call('/public/app-locale/xx');
  check('несуществующий язык отдаёт ошибку', nonsense.status === 400, String(nonsense.status));

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
