/**
 * Разметка веб-карточки заявки (W-01…W-05, DEV-08 §4).
 *
 * Страницы отдаются сервером целиком: телефонный клиент открывает ссылку из
 * SMS на слабом телефоне в лифте, и одностраничное приложение на 200 КБ здесь
 * проигрывает обычной странице с формами. Никакого JS, кроме автообновления
 * статуса, — всё остальное делают формы: они работают всегда.
 *
 * Токены оформления те же, что в приложениях (DEV-06): янтарь на светлом фоне,
 * скругления 20/16/12, тап-зоны от 44 px.
 */

const CSS = `
  *{box-sizing:border-box}
  body{margin:0;background:#F4F5F7;color:#141518;font:15px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
  .wrap{max-width:520px;margin:0 auto;padding:16px 16px 40px}
  header{display:flex;align-items:center;justify-content:space-between;padding:12px 0 16px}
  .logo{font-size:20px;font-weight:800;letter-spacing:.04em}
  .logo span{color:#FEB70F}
  .card{background:#fff;border-radius:20px;padding:16px;margin-bottom:12px}
  h1{font-size:20px;margin:0 0 12px}
  h2{font-size:16px;margin:0 0 8px}
  .muted{color:#8E939F;font-size:13px}
  .row{display:flex;justify-content:space-between;gap:12px;padding:6px 0}
  .row+.row{border-top:1px solid #F2F2F5}
  .num{font-variant-numeric:tabular-nums;white-space:nowrap}
  .total{font-weight:700;font-size:17px}
  .badge{display:inline-block;padding:4px 10px;border-radius:8px;font-size:13px;font-weight:600}
  .badge--ok{background:#E7F6EE;color:#2FA36B}
  .badge--warn{background:#FDF1E3;color:#F08C1E}
  .badge--info{background:#EFF6FF;color:#3D6BF5}
  .btn{display:block;width:100%;min-height:52px;border:0;border-radius:14px;background:#FEB70F;color:#141518;font:600 16px/1 inherit;cursor:pointer;margin-top:12px}
  .btn--secondary{background:#fff;border:1px solid #E5E7EB;color:#141518}
  .btn--ghost{background:transparent;color:#8E939F;min-height:44px}
  a.btn{text-align:center;line-height:52px;text-decoration:none}
  .steps{list-style:none;margin:0;padding:0}
  .steps li{display:flex;gap:10px;align-items:flex-start;padding:5px 0;color:#8E939F;font-size:14px}
  .steps li.done{color:#141518}
  .steps li.current{color:#141518;font-weight:700}
  .dot{width:10px;height:10px;border-radius:50%;background:#E5E7EB;margin-top:6px;flex:0 0 auto}
  .done .dot{background:#2FA36B}
  .current .dot{background:#FEB70F}
  .photos{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
  .photos img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:12px;display:block}
  .stars{display:flex;gap:6px;justify-content:center;margin:8px 0 4px}
  .stars button{width:52px;height:52px;font-size:30px;line-height:1;background:none;border:0;cursor:pointer;color:#E5E7EB}
  .stars button.on{color:#FEB70F}
  .chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
  .chips button{min-height:44px;padding:0 14px;border-radius:999px;border:1px solid #E5E7EB;background:#fff;font:inherit;cursor:pointer}
  textarea,input[type=text]{width:100%;min-height:52px;padding:12px;border:1px solid #E5E7EB;border-radius:12px;font:inherit;background:#fff}
  .empty{text-align:center;padding:40px 16px}
  .empty .icon{font-size:44px}
  .note{background:#fff;border-radius:16px;padding:12px;color:#8E939F;font-size:13px;margin-bottom:12px}
`;

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

export function soums(tiyin: number | null | undefined): string {
  const v = Math.round((tiyin ?? 0) / 100);
  return `${v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} сум`;
}

/**
 * Оболочка страницы.
 *
 * `refreshSeconds` включает мета-обновление: на экране статуса человек ждёт
 * мастера и не должен дёргать кнопку перезагрузки. На экранах с формой
 * обновление выключено — иначе оно затрёт наполовину заполненный отзыв.
 */
export function page(opts: { title: string; body: string; dispatcherPhone: string; refreshSeconds?: number }): string {
  return `<!doctype html><html lang="ru"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
${opts.refreshSeconds ? `<meta http-equiv="refresh" content="${opts.refreshSeconds}">` : ''}
<title>${esc(opts.title)}</title>
<style>${CSS}</style>
</head><body><div class="wrap">
<header><div class="logo">SO<span>ZO</span></div><div class="muted">Заявка</div></header>
${opts.body}
<a class="btn btn--secondary" href="tel:${esc(opts.dispatcherPhone)}">Позвонить диспетчеру</a>
<p class="muted" style="text-align:center;margin-top:16px">Ссылка личная — не пересылайте её посторонним</p>
</div></body></html>`;
}

/** W-05: ссылка недействительна. Ни слова о заявке — перебор URL ничего не даёт */
export function expiredPage(dispatcherPhone: string): string {
  return page({
    title: 'Ссылка недействительна',
    dispatcherPhone,
    body: `<div class="card empty">
  <div class="icon">🔗</div>
  <h1>Ссылка устарела</h1>
  <p class="muted">Ссылка устарела или уже использована. Позвоните диспетчеру — вышлем новую.</p>
</div>`,
  });
}

type Step = { label: string; done: boolean; current: boolean };

/** W-01: где сейчас заявка */
export function statusPage(v: {
  number: string;
  statusLabel: string;
  steps: Step[];
  master: { name: string; rating: number | null; jobsDone: number | null } | null;
  etaText: string | null;
  windowText: string | null;
  lines: Array<{ name: string; qty: number; priceFromTiyin: number }>;
  totalFromTiyin: number;
  totalToTiyin: number;
  recommendation: { id: string; title: string; text: string; amountTiyin: number } | null;
  needsEstimate: boolean;
  token: string;
  dispatcherPhone: string;
  appInvite: boolean;
}): string {
  const steps = v.steps
    .map((s) => `<li class="${s.current ? 'current' : s.done ? 'done' : ''}"><span class="dot"></span>${esc(s.label)}</li>`)
    .join('');
  const lines = v.lines
    .map((l) => `<div class="row"><span>${esc(l.name)}${l.qty > 1 ? ` × ${l.qty}` : ''}</span><span class="num">${soums(l.priceFromTiyin)}</span></div>`)
    .join('');

  return page({
    title: `Заявка ${v.number}`,
    dispatcherPhone: v.dispatcherPhone,
    // Пока заявка в работе, страница обновляется сама: человек ждёт мастера
    refreshSeconds: 60,
    body: `
<div class="card">
  <div class="row" style="border:0;padding-top:0">
    <span class="muted">${esc(v.number)}</span>
    <span class="badge badge--info">${esc(v.statusLabel)}</span>
  </div>
  <ul class="steps">${steps}</ul>
</div>

${v.needsEstimate ? `<div class="card">
  <h2>Мастер ждёт вашего решения</h2>
  <p class="muted">Пока стоимость не подтверждена, работа не начнётся.</p>
  <a class="btn" href="/w/${esc(v.token)}/estimate">Посмотреть стоимость</a>
</div>` : ''}

${v.master ? `<div class="card">
  <h2>${esc(v.master.name)}</h2>
  <p class="muted">${[
    v.master.rating !== null ? `★ ${v.master.rating}` : null,
    v.master.jobsDone !== null ? `${v.master.jobsDone} работ` : null,
  ].filter(Boolean).join(' · ') || 'Мастер назначен'}</p>
  ${v.etaText ? `<p>${esc(v.etaText)}</p>` : ''}
  ${v.windowText ? `<p class="muted">${esc(v.windowText)}</p>` : ''}
  <p class="muted">Телефон мастера не показываем — связь через диспетчера.</p>
</div>` : ''}

${lines ? `<div class="card">
  <h2>Что делаем</h2>
  ${lines}
  <div class="row total"><span>Ориентировочно</span><span class="num">${soums(v.totalFromTiyin)} — ${soums(v.totalToTiyin)}</span></div>
  <p class="muted">Точную сумму мастер назовёт до начала работ.</p>
</div>` : ''}

${v.recommendation ? `<div class="card">
  <span class="badge badge--warn">Рекомендация</span>
  <h2 style="margin-top:8px">${esc(v.recommendation.title)}</h2>
  <p class="muted">${esc(v.recommendation.text)}</p>
  <div class="row total"><span>Стоимость</span><span class="num">${soums(v.recommendation.amountTiyin)}</span></div>
  <p class="muted">Это рекомендация — отказ не влияет на текущую работу.</p>
  <form method="post" action="/w/${esc(v.token)}/recommendation">
    <button class="btn" name="decision" value="accept">Сделать сейчас</button>
    <button class="btn btn--secondary" name="decision" value="postpone">Отложить</button>
    <button class="btn btn--ghost" name="decision" value="decline">Не нужно</button>
  </form>
</div>` : ''}

${v.appInvite ? `<div class="note">В приложении удобнее: история, гарантия, запись в два тапа.</div>` : ''}`,
  });
}

/** W-02: подтверждение стоимости */
export function estimatePage(v: {
  number: string;
  lines: Array<{ name: string; qty: number; priceFromTiyin: number }>;
  totalFromTiyin: number;
  totalToTiyin: number;
  alreadyApproved: boolean;
  token: string;
  dispatcherPhone: string;
}): string {
  const lines = v.lines
    .map((l) => `<div class="row"><span>${esc(l.name)}${l.qty > 1 ? ` × ${l.qty}` : ''}</span><span class="num">${soums(l.priceFromTiyin)}</span></div>`)
    .join('');
  return page({
    title: 'Подтвердите стоимость',
    dispatcherPhone: v.dispatcherPhone,
    body: `
<div class="card">
  <h1>Подтвердите стоимость</h1>
  <p class="muted">Заявка ${esc(v.number)}</p>
  ${lines || '<p class="muted">Позиции уточнит мастер на месте</p>'}
  <div class="row total"><span>Итого</span><span class="num">${soums(v.totalFromTiyin)} — ${soums(v.totalToTiyin)}</span></div>
</div>

${v.alreadyApproved
  ? `<div class="card"><span class="badge badge--ok">Уже подтверждено</span><p class="muted" style="margin-top:8px">Повторное подтверждение не требуется — мастер уже работает.</p>
<a class="btn btn--secondary" href="/w/${esc(v.token)}">К заявке</a></div>`
  : `<div class="card">
  <form method="post" action="/w/${esc(v.token)}/estimate">
    <button class="btn" name="decision" value="approve">Согласен</button>
    <button class="btn btn--secondary" name="decision" value="decline">Отказываюсь</button>
  </form>
  <p class="muted" style="margin-top:12px">Нажатие фиксируется как ваше подтверждение.</p>
</div>`}`,
  });
}

/** W-03: акт и оплата */
export function actPage(v: {
  number: string;
  photos: Array<{ url: string; stage: string }>;
  lines: Array<{ name: string; qty: number; priceFromTiyin: number }>;
  materials: Array<{ name: string; amountTiyin: number }>;
  worksTiyin: number;
  materialsTiyin: number;
  totalTiyin: number;
  paid: boolean;
  paidNote: string | null;
  warrantyUntil: string | null;
  actUrl: string | null;
  token: string;
  dispatcherPhone: string;
}): string {
  const photos = v.photos.length
    ? `<div class="photos">${v.photos.map((p) => `<img src="${esc(p.url)}" alt="${esc(p.stage)}">`).join('')}</div>`
    : '';
  const lines = v.lines
    .map((l) => `<div class="row"><span>${esc(l.name)}${l.qty > 1 ? ` × ${l.qty}` : ''}</span><span class="num">${soums(l.priceFromTiyin)}</span></div>`)
    .join('');
  const materials = v.materials
    .map((m) => `<div class="row"><span>${esc(m.name)}</span><span class="num">${soums(m.amountTiyin)}</span></div>`)
    .join('');

  return page({
    title: 'Работа выполнена',
    dispatcherPhone: v.dispatcherPhone,
    body: `
<div class="card">
  <h1>Работа выполнена</h1>
  <p class="muted">Заявка ${esc(v.number)}</p>
  ${photos}
</div>

<div class="card">
  <h2>Работы</h2>
  ${lines || '<p class="muted">Позиции не заводились</p>'}
  ${materials ? `<h2 style="margin-top:16px">Материалы</h2>${materials}` : ''}
  <div class="row"><span>Работы</span><span class="num">${soums(v.worksTiyin)}</span></div>
  ${v.materialsTiyin > 0 ? `<div class="row"><span>Материалы</span><span class="num">${soums(v.materialsTiyin)}</span></div>` : ''}
  <div class="row total"><span>${v.paid ? 'Оплачено' : 'К оплате'}</span><span class="num">${soums(v.totalTiyin)}</span></div>
  ${v.warrantyUntil ? `<p style="margin-top:8px"><span class="badge badge--ok">Гарантия до ${esc(v.warrantyUntil)}</span></p>` : ''}
</div>

${v.paid
  ? `<div class="card"><span class="badge badge--ok">Оплачено</span><p class="muted" style="margin-top:8px">${esc(v.paidNote ?? '')}</p>
<a class="btn" href="/w/${esc(v.token)}/rate">Оценить работу</a></div>`
  : `<div class="card">
  <h2>Оплата</h2>
  <form method="post" action="/w/${esc(v.token)}/pay">
    <button class="btn" name="provider" value="payme">Оплатить через Payme</button>
    <button class="btn btn--secondary" name="provider" value="click">Оплатить через Click</button>
    <button class="btn btn--secondary" name="provider" value="uzum">Оплатить через Uzum</button>
    <button class="btn btn--ghost" name="provider" value="cash">Заплачу наличными мастеру</button>
  </form>
</div>`}

${v.actUrl ? `<a class="btn btn--secondary" href="${esc(v.actUrl)}">Открыть акт для печати</a>` : ''}`,
  });
}

/** W-04: оценка */
export function ratePage(v: {
  number: string;
  masterName: string | null;
  alreadyRated: boolean;
  windowClosed: boolean;
  tipPresets: number[];
  token: string;
  dispatcherPhone: string;
}): string {
  if (v.alreadyRated) {
    return page({
      title: 'Спасибо!',
      dispatcherPhone: v.dispatcherPhone,
      body: `<div class="card empty"><div class="icon">★</div><h1>Спасибо!</h1>
<p class="muted">Оценка уже отправлена. В приложении удобнее: история, гарантия, запись в два тапа.</p></div>`,
    });
  }
  if (v.windowClosed) {
    return page({
      title: 'Окно оценки закрыто',
      dispatcherPhone: v.dispatcherPhone,
      body: `<div class="card empty"><div class="icon">★</div><h1>Спасибо!</h1>
<p class="muted">Окно оценки уже закрыто — прошло больше трёх суток с закрытия заявки.</p></div>`,
    });
  }

  // Звёзды — обычные кнопки формы: без JS, каждая отправляет свою оценку.
  // Комментарий и чаевые едут тем же запросом
  const stars = [1, 2, 3, 4, 5]
    .map((n) => `<button class="btn btn--secondary" name="rating" value="${n}" style="min-height:56px">${'★'.repeat(n)}</button>`)
    .join('');
  const tips = v.tipPresets
    .map((t) => `<button name="tipTiyin" value="${t}">${soums(t)}</button>`)
    .join('');

  return page({
    title: 'Оцените работу',
    dispatcherPhone: v.dispatcherPhone,
    body: `
<div class="card">
  <h1>Как всё прошло?</h1>
  <p class="muted">${esc(v.masterName ?? 'Мастер')} · заявка ${esc(v.number)}</p>
  <form method="post" action="/w/${esc(v.token)}/rate">
    <textarea name="comment" placeholder="Что понравилось или что пошло не так"></textarea>
    <p class="muted" style="margin-top:12px">Оценка 1–2 — расскажите, что случилось: перезвоним и разберёмся.</p>
    ${stars}
  </form>
</div>

<div class="card">
  <h2>Поблагодарить мастера</h2>
  <p class="muted">Чаевые идут мастеру целиком, комиссия с них не берётся.</p>
  <form method="post" action="/w/${esc(v.token)}/tip">
    <div class="chips">${tips}</div>
    <button class="btn btn--ghost" name="tipTiyin" value="0">Без чаевых</button>
  </form>
</div>`,
  });
}

/** Итог действия: короткая страница с возвратом к заявке */
export function donePage(v: { title: string; text: string; token: string; dispatcherPhone: string }): string {
  return page({
    title: v.title,
    dispatcherPhone: v.dispatcherPhone,
    body: `<div class="card empty"><div class="icon">✓</div><h1>${esc(v.title)}</h1>
<p class="muted">${esc(v.text)}</p>
<a class="btn btn--secondary" href="/w/${esc(v.token)}">К заявке</a></div>`,
  });
}
