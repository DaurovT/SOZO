/**
 * Планировщик: смены, брони, лист ожидания (ТЗ 17.3, PRD-03 D-04/D-05/D-18).
 *
 * Набора не было вовсе: ни одна из шести сюит не бронировала слот. Обнаружилось
 * при переносе планировщика в PostgreSQL — таблицы броней оставались пустыми
 * после полного прогона, и это ничего не ломало, потому что проверять было
 * нечем.
 *
 * Проверяются правила, а не вызовы: заморозка ближайших часов, потолок плана
 * дня, буфер на дорогу, окно клиента, очередь листа ожидания. Именно они
 * отличают планировщик от календаря, и именно они молча ломаются при правках.
 *
 *   node apps/api/test/scheduling-e2e.mjs [http://localhost:3000]
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
  const r = await call('/auth/verify', { body: { phone, code: '00000' } });
  return r.body.accessToken;
}

const errText = (b) => (typeof b?.message === 'object' ? b.message.code ?? b.message.message : b?.code ?? b?.message) ?? '';
/** Дата через N дней: сегодня трогать нельзя — мешает заморозка ленты */
const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function main() {
  const t = await login(ADMIN);
  const newOrder = async (description) =>
    (await call('/orders', { token: t, body: { clientPhone: '+998901234500', address: 'Ташкент, планировщик', description } })).body.id;

  console.log(`Планировщик: ${ROOT}\n${'='.repeat(60)}`);

  // ---------------------------------------------------------------
  group('1. Смены');
  const masters = (await call('/dispatch/masters', { token: t, method: 'GET' })).body;
  const list = Array.isArray(masters) ? masters : (masters.masters ?? []);
  const active = list.filter((m) => m.status === 'active');
  check('в системе есть активные мастера', active.length > 0, String(list.length));

  // Дата за горизонтом демо-данных: демо заполняет смены на две недели
  // вперёд, и внутри этого окна seed-day правильно не создаёт ничего.
  // Набор, зависящий от того, прогнали ли до него демо, врёт ровно тогда,
  // когда его читают.
  const D = day(20);
  const seeded = (await call('/dispatch/scheduling/shifts/seed-day', { token: t, body: { date: D } })).body;
  check('график дня заполняется одним действием', seeded.created > 0, JSON.stringify(seeded).slice(0, 100));
  const shifts = (await call(`/dispatch/scheduling/shifts?date=${D}`, { token: t, method: 'GET' })).body;
  check('смены появились на нужной дате', shifts.length === seeded.created, `${shifts.length} / ${seeded.created}`);
  const seededAgain = (await call('/dispatch/scheduling/shifts/seed-day', { token: t, body: { date: D } })).body;
  check('повторное заполнение не плодит смены', seededAgain.created === 0, JSON.stringify(seededAgain).slice(0, 80));
  check('смена задана минутами от полуночи', shifts[0]?.startMin === 540 && shifts[0]?.endMin === 1080,
    `${shifts[0]?.startMin}–${shifts[0]?.endMin}`);

  const master = shifts[0].masterId;
  const other = shifts.find((s) => s.masterId !== master)?.masterId ?? master;

  // ---------------------------------------------------------------
  group('2. Бронь: слоты, буфер, окно клиента');
  const o1 = await newOrder('замена смесителя');
  const b1 = await call('/dispatch/scheduling/bookings', {
    token: t, body: { orderId: o1, masterId: master, date: D, startMin: 600, anchored: true },
  });
  check('бронь создана', b1.status < 400, errText(b1.body));
  const rec = b1.body;
  check('к работе добавлен буфер на дорогу', rec.bufferMin > 0, String(rec.bufferMin));
  check('бронь занимает целые слоты по 30 мин', (rec.endMin - rec.startMin) % 30 === 0, String(rec.endMin - rec.startMin));
  check('клиенту названо двухчасовое окно', rec.clientWindow?.[1] - rec.clientWindow?.[0] === 120, JSON.stringify(rec.clientWindow));
  check('окно начинается там же, где работа', rec.clientWindow?.[0] === rec.startMin, JSON.stringify(rec.clientWindow));

  const again = await call('/dispatch/scheduling/bookings', {
    token: t, body: { orderId: o1, masterId: master, date: D, startMin: 800 },
  });
  check('дважды одну заявку не забронировать', again.status >= 400 && errText(again.body) === 'ALREADY_BOOKED', errText(again.body));

  // ---------------------------------------------------------------
  group('3. Что бронь отклоняет');
  const o2 = await newOrder('течь под мойкой');
  const clash = await call('/dispatch/scheduling/bookings', {
    token: t, body: { orderId: o2, masterId: master, date: D, startMin: rec.startMin + 30 },
  });
  check('пересечение с чужой бронью отклонено', errText(clash.body) === 'SLOT_BUSY', errText(clash.body));

  const late = await call('/dispatch/scheduling/bookings', {
    token: t, body: { orderId: o2, masterId: master, date: D, startMin: 1050 },
  });
  check('за границу смены не выходит', errText(late.body) === 'OUT_OF_SHIFT', errText(late.body));

  const noShift = await call('/dispatch/scheduling/bookings', {
    token: t, body: { orderId: o2, masterId: master, date: day(30), startMin: 600 },
  });
  check('без смены мастера бронировать некуда', errText(noShift.body) === 'NO_SHIFT', errText(noShift.body));

  // Заморозка считается от ТЕКУЩЕГО времени: «сейчас + 2 часа». Поэтому смена
  // на сегодня заводится вокруг «сейчас», а не стандартными 09:00–18:00, и
  // бронь ставится на «сейчас + 30 минут» — заведомо внутри окна заморозки.
  //
  // Раньше здесь стояли фиксированные 09:00, и проверка проходила только если
  // прогон случился между 07:00 и 09:00: в остальное время до брони было
  // больше двух часов, заморозка не срабатывала, бронь создавалась, а вторая
  // попытка падала с ALREADY_BOOKED вместо LANE_FROZEN.
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  // Оставляем себе четыре часа до полуночи: иначе поздним вечером окно смены
  // вылезет за границу суток и отказ придёт как OUT_OF_SHIFT
  const base = Math.min(nowMin, 24 * 60 - 240);

  // Смена на сегодня у мастера может уже быть — её заводят соседние наборы
  // общего прогона (seed-day ставит всем активным 09:00–18:00). Тогда наша
  // не создастся, а бронь в ночной час окажется вне чужого окна: проверка
  // падала с OUT_OF_SHIFT вместо LANE_FROZEN. Поэтому берём мастера, у
  // которого смены на сегодня нет.
  const todayShifts = (await call(`/dispatch/scheduling/shifts?date=${day(0)}`, { token: t, method: 'GET' })).body;
  const busyToday = new Set((todayShifts ?? []).map((x) => x.masterId));
  const freeMaster = shifts.map((x) => x.masterId).find((id) => !busyToday.has(id));
  const frozenMaster = freeMaster ?? master;

  if (!freeMaster) {
    // Свободных нет — освобождаем окно сами. Смена с бронями не снимется,
    // и это правильно: тогда проверка честно упадёт, а не соврёт зелёным
    const mine = (todayShifts ?? []).find((x) => x.masterId === master);
    if (mine) await call(`/dispatch/scheduling/shifts/${mine.id}`, { token: t, method: 'DELETE' });
  }
  const madeShift = await call('/dispatch/scheduling/shifts', {
    token: t, body: { masterId: frozenMaster, date: day(0), startMin: base, endMin: base + 240 },
  });
  check('смена на сегодня заведена вокруг текущего часа', madeShift.status < 400, errText(madeShift.body));
  const frozen = await call('/dispatch/scheduling/bookings', {
    token: t, body: { orderId: o2, masterId: frozenMaster, date: day(0), startMin: base + 30 },
  });
  check('ближайшие часы ленты заморожены', errText(frozen.body) === 'LANE_FROZEN', errText(frozen.body));
  const forcedToday = await call('/dispatch/scheduling/bookings', {
    token: t, body: { orderId: o2, masterId: frozenMaster, date: day(0), startMin: base + 30, force: true },
  });
  check('и продавливаются подтверждением', forcedToday.status < 400, errText(forcedToday.body));
  await call(`/dispatch/scheduling/bookings/${o2}`, { token: t, method: 'DELETE' });

  // ---------------------------------------------------------------
  group('4. Потолок плана дня');
  // Смена девять часов, потолок 80% — забиваем ленту второго мастера, пока
  // планировщик не откажет. Резерв под аварии и задержки не подлежит
  // раздаче: без него любая авария срывает уже обещанные окна.
  let capHit = null;
  let start = 540;
  for (let i = 0; i < 12 && !capHit; i += 1) {
    const oid = await newOrder(`наполнение ленты ${i}`);
    const r = await call('/dispatch/scheduling/bookings', {
      token: t, body: { orderId: oid, masterId: other, date: D, startMin: start },
    });
    if (r.status >= 400) capHit = errText(r.body);
    else start = r.body.endMin;
  }
  check('план дня упирается в потолок, а не в конец смены', capHit === 'DAY_PLAN_CAP', String(capHit));

  const forced = await newOrder('аварийная сверх плана');
  const force = await call('/dispatch/scheduling/bookings', {
    token: t, body: { orderId: forced, masterId: other, date: D, startMin: start, force: true },
  });
  check('диспетчер продавливает потолок явным подтверждением', force.status < 400, errText(force.body));

  const lane = (await call(`/dispatch/scheduling/lanes?date=${D}`, { token: t, method: 'GET' })).body.lanes.find((l) => l.masterId === other);
  check('лента показывает перегруз', lane?.loadPercent > 80, String(lane?.loadPercent));

  // ---------------------------------------------------------------
  group('5. Ёмкость дня');
  const cap = (await call(`/dispatch/scheduling/capacity?date=${D}`, { token: t, method: 'GET' })).body;
  check('ёмкость считает всех мастеров дня', cap.masters === shifts.length, `${cap.masters} / ${shifts.length}`);
  check('загрузка ненулевая', cap.loadPercent > 0, String(cap.loadPercent));
  check('видно, сколько лент перегружено', cap.overloaded >= 1, String(cap.overloaded));
  check('почасовая разбивка отдаётся', Array.isArray(cap.byHour) && cap.byHour.length > 0, String(cap.byHour?.length));

  // ---------------------------------------------------------------
  group('6. Лист ожидания');
  const w1 = await newOrder('ждёт освободившийся слот');
  const wl = (await call('/dispatch/scheduling/waitlist', { token: t, body: { orderId: w1 } })).body;
  check('заявка встала в лист ожидания', wl.some((x) => x.orderId === w1), JSON.stringify(wl).slice(0, 120));

  const wlAgain = (await call('/dispatch/scheduling/waitlist', { token: t, body: { orderId: w1 } })).body;
  check('повторная запись не двигает очередь', wlAgain.filter((x) => x.orderId === w1).length === 1, String(wlAgain.length));

  const urgent = (await call('/orders', {
    token: t, body: { clientPhone: '+998901234501', address: 'Ташкент, планировщик', description: 'срочно', urgency: 'urgent' },
  })).body.id;
  const wl2 = (await call('/dispatch/scheduling/waitlist', { token: t, body: { orderId: urgent } })).body;
  check('срочная заявка встаёт впереди обычной', wl2[0]?.orderId === urgent, JSON.stringify(wl2.map((x) => x.orderId)).slice(0, 120));

  // ---------------------------------------------------------------
  group('7. Снятие брони');
  const rel = (await call(`/dispatch/scheduling/bookings/${o1}`, { token: t, method: 'DELETE' })).body;
  check('бронь снята', rel.freed?.orderId === o1, JSON.stringify(rel).slice(0, 120));
  check('освободившийся слот предложен листу ожидания', rel.nextCandidate?.orderId === urgent, JSON.stringify(rel.nextCandidate));

  const relAgain = (await call(`/dispatch/scheduling/bookings/${o1}`, { token: t, method: 'DELETE' })).body;
  check('повторное снятие ничего не ломает', relAgain.freed === null, JSON.stringify(relAgain));

  const afterRelease = await call('/dispatch/scheduling/bookings', {
    token: t, body: { orderId: o2, masterId: master, date: D, startMin: 600 },
  });
  check('освободившееся время снова бронируется', afterRelease.status < 400, errText(afterRelease.body));

  // Бронь заявки снимает её из листа ожидания: иначе заявка стоит в очереди
  // и уже едет одновременно
  const bookedFromWaitlist = await call('/dispatch/scheduling/bookings', {
    token: t, body: { orderId: urgent, masterId: master, date: D, startMin: 900 },
  });
  check('срочная забронирована', bookedFromWaitlist.status < 400, errText(bookedFromWaitlist.body));
  const wl3 = (await call('/dispatch/scheduling/waitlist', { token: t, method: 'GET' })).body;
  check('забронированная заявка ушла из листа ожидания', !wl3.some((x) => x.orderId === urgent), JSON.stringify(wl3.map((x) => x.orderId)));

  // ---------------------------------------------------------------
  group('8. Окна для клиента');
  // На свободный день: на D ленты намеренно забиты потолком плана, и пустой
  // список окон там был бы правильным ответом, а не находкой
  const DW = day(21);
  await call('/dispatch/scheduling/shifts/seed-day', { token: t, body: { date: DW } });
  const o3 = await newOrder('выбор окна клиентом');
  const win = (await call(`/dispatch/scheduling/windows?orderId=${o3}&date=${DW}`, { token: t, method: 'GET' })).body;
  check('окна предлагаются', Array.isArray(win.windows) && win.windows.length > 0, String(win.windows?.length));
  check('видно, что нормо-часы не заполнены', win.normHoursAssumed === true, String(win.normHoursAssumed));
  check('число слотов посчитано', win.slotsNeeded >= 1, String(win.slotsNeeded));

  console.log(`\n${'='.repeat(52)}\nПройдено: ${passed}   Провалено: ${failed}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
