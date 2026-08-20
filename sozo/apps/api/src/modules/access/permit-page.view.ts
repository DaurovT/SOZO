/**
 * Страница согласования наряда-допуска по ссылке из SMS (W-06, PRD-06 §3.12).
 *
 * Открывает её консьерж или главный инженер на своём телефоне, часто немолодой
 * и часто в подъезде. Поэтому: страница отдаётся сервером целиком, без JS,
 * решения — обычные формы, кнопки от 52 px. Требовать здесь установку кабинета
 * бессмысленно — на согласованиях этого человека держится весь контур доступа.
 *
 * Токены оформления — DEV-06: янтарь #FEB70F на светлом, текст на акценте
 * тёмный (белый по янтарю не читается).
 */

export const PAGE_CSS = `
  *{box-sizing:border-box}
  body{margin:0;background:#F6F6F8;color:#141518;font:16px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
  .wrap{max-width:520px;margin:0 auto;padding:16px 16px 40px;min-height:100vh;display:flex;flex-direction:column}
  header{display:flex;align-items:center;gap:8px;padding:8px 0 16px}
  .logo{width:24px;height:24px;border-radius:8px;background:#FEB70F;display:inline-block}
  .muted{color:#8A8A93;font-size:13px}
  h1{font-size:22px;margin:0 0 8px;line-height:1.3}
  .card{background:#fff;border:1px solid #ECECF0;border-radius:12px;padding:16px;margin-bottom:12px}
  .chip{display:inline-block;padding:4px 8px;border-radius:999px;font-size:13px;margin:0 4px 4px 0}
  .chip--neutral{background:#ECECF0;color:#8A8A93}
  .chip--warn{background:rgba(240,140,30,.14);color:#8A5200}
  .chip--err{background:rgba(224,72,61,.12);color:#E0483D}
  .warn{background:rgba(240,140,30,.08);border:1px solid rgba(240,140,30,.3)}
  .crit{background:rgba(224,72,61,.06);border:1px solid rgba(224,72,61,.25)}
  .btn{display:block;width:100%;min-height:56px;border:0;border-radius:8px;background:#FEB70F;color:#141518;font:600 17px/1 inherit;cursor:pointer;margin-top:8px}
  .btn--secondary{background:#fff;border:1px solid #ECECF0;color:#141518;font-weight:400;min-height:52px;font-size:16px}
  .btn--danger{background:#fff;border:1px solid #ECECF0;color:#E0483D;font-weight:400;min-height:52px;font-size:16px}
  .foot{margin-top:auto;padding-top:24px}
  label{display:block;font-size:13px;color:#8A8A93;margin:12px 0 4px}
  input,select{width:100%;min-height:52px;padding:0 12px;border:1px solid #ECECF0;border-radius:8px;font:16px inherit;background:#fff;color:#141518}
  a{color:#141518}
`;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="ru"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)}</title><style>${PAGE_CSS}</style></head>
<body><div class="wrap">
<header><span class="logo"></span><span class="muted">SOZO · согласование доступа</span></header>
${body}
</div></body></html>`;
}

export interface PermitPageView {
  code: string;
  buildingName: string;
  zones: string[];
  hasCriticalZone: boolean;
  requiresShutdown: boolean;
  affectedUnits: number;
  windowText: string;
  masterName: string;
  masterIsPlatform: boolean;
  verifyUrl: string | null;
  autoApproveAt: string | null;
}

export function renderPermitPage(v: PermitPageView): string {
  const zones = v.zones.map((z) => `<span class="chip chip--neutral">${esc(z)}</span>`).join('');

  const shutdown = v.requiresShutdown
    ? `<div class="card warn">
         <b>Потребуется отключение</b>
         <div class="muted" style="margin-top:4px">Затронет ${v.affectedUnits} помещ. Жителей предупредим сами.</div>
       </div>`
    : '';

  // Критичная зона: авто-согласия не будет никогда — сказать это надо до решения,
  // иначе человек будет ждать, что «само согласуется», как в прошлый раз
  const critical = v.hasCriticalZone
    ? `<div class="card crit">
         <b>Критичная зона</b>
         <div class="muted" style="margin-top:4px">Автоматически согласовано не будет — наряд ждёт вашего решения.</div>
       </div>`
    : v.autoApproveAt
      ? `<div class="muted" style="text-align:center;margin-bottom:8px">
           Если не ответить до ${esc(v.autoApproveAt)}, доступ согласуется автоматически
         </div>`
      : '';

  return page(
    'Согласование доступа',
    `<h1>Мастеру нужен доступ${v.zones.length ? `: ${esc(v.zones[0])}` : ''}</h1>
     <div class="muted" style="margin-bottom:16px">${esc(v.windowText)}</div>

     <div class="card">
       <div style="font-weight:600">${esc(v.masterName)}</div>
       <div class="muted" style="margin-top:4px">
         ${v.masterIsPlatform ? 'Мастер платформы' : 'Служба вашей организации'} · ${esc(v.buildingName)}
       </div>
       ${v.verifyUrl ? `<div style="margin-top:8px"><a href="${esc(v.verifyUrl)}">Проверить мастера</a></div>` : ''}
       <div style="margin-top:12px">${zones}</div>
     </div>

     ${shutdown}

     <div class="foot">
       ${critical}
       <form method="post" action="/p/${esc(v.code)}/approve">
         <button class="btn" type="submit">Согласовать</button>
       </form>
       <form method="get" action="/p/${esc(v.code)}/reschedule">
         <button class="btn btn--secondary" type="submit">Предложить другое время</button>
       </form>
       <form method="get" action="/p/${esc(v.code)}/reject">
         <button class="btn btn--danger" type="submit">Отклонить</button>
       </form>
     </div>`,
  );
}

/** Форма переноса окна: дата и время, ничего больше — вводят с телефона. */
export function renderReschedulePage(code: string, defaultFrom: string): string {
  return page(
    'Другое время',
    `<h1>Когда удобно?</h1>
     <form method="post" action="/p/${esc(code)}/reschedule" class="card">
       <label for="from">Начало</label>
       <input id="from" type="datetime-local" name="from" value="${esc(defaultFrom)}" required>
       <label for="hours">Продолжительность</label>
       <select id="hours" name="hours">
         <option value="2">2 часа</option>
         <option value="4" selected>4 часа</option>
         <option value="8">рабочий день</option>
       </select>
       <button class="btn" type="submit" style="margin-top:16px">Предложить</button>
     </form>
     <div class="foot"><a href="/p/${esc(code)}">Назад</a></div>`,
  );
}

/** Отказ без причины не принимается: она уходит в аудит и объясняет решение. */
export function renderRejectPage(code: string, reasons: string[]): string {
  return page(
    'Отклонить',
    `<h1>Почему отказываете?</h1>
     <form method="post" action="/p/${esc(code)}/reject" class="card">
       <label for="reason">Причина</label>
       <select id="reason" name="reason" required>
         ${reasons.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join('')}
       </select>
       <button class="btn btn--danger" type="submit" style="margin-top:16px">Отклонить</button>
     </form>
     <div class="foot"><a href="/p/${esc(code)}">Назад</a></div>`,
  );
}

export function renderResultPage(title: string, note: string): string {
  return page(title, `<div class="card"><h1 style="margin-bottom:8px">${esc(title)}</h1>
    <div class="muted">${esc(note)}</div></div>`);
}
