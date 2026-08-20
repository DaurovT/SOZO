import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AccessService } from './access.service';
import { PAGE_CSS } from './permit-page.view';

/**
 * Страница согласования доступа в помещение по ссылке (C-56).
 *
 * Спецификация обещает жителю push. FCM в системе нет, и обещать доставку,
 * которой не существует, нельзя — поэтому работает тот же механизм, что у
 * W-06: короткая ссылка в SMS, открываемая без установки приложения.
 * Появится push — ссылка останется запасным каналом: у части жителей
 * приложения не будет никогда, а доступ к стояку нужен и у них.
 *
 * Живёт вне префикса /v1: адрес уходит в SMS, где каждый символ платный.
 */
@Controller('u')
export class UnitAccessPageController {
  constructor(private readonly access: AccessService) {}

  private html(res: Response, body: string): void {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.send(body);
  }

  private page(title: string, inner: string): string {
    return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title><style>${PAGE_CSS}</style></head>
<body><div class="wrap"><header><div class="logo">SOZO<span>.</span></div></header>${inner}</div></body></html>`;
  }

  private window(from: string, to: string): string {
    const f = new Date(from);
    const t = new Date(to);
    const hm = (d: Date) => d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    return `${f.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}, ${hm(f)} — ${hm(t)}`;
  }

  @Get(':code')
  show(@Param('code') code: string, @Res() res: Response) {
    const r = this.access.unitAccessByCode(code);
    // Несуществующий и уже решённый отвечают одинаково: перебором кодов
    // нельзя выяснить, в какую квартиру просятся
    if (!r) return this.html(res, this.page('Ссылка недействительна', `<div class="card empty"><div class="icon">🔒</div>
      <h1>Ссылка недействительна</h1><p class="muted">Срок истёк или решение уже принято.</p></div>`));

    if (r.status !== 'requested') {
      return this.html(res, this.page('Решение принято', `<div class="card empty"><div class="icon">✓</div>
        <h1>Решение уже принято</h1><p class="muted">${esc(this.statusText(r.status))}</p></div>`));
    }

    this.html(
      res,
      this.page(
        'Доступ в вашу квартиру',
        `<div class="card">
  <h1>Соседу нужен доступ к стояку в вашей квартире ${esc(r.unitLabel)}</h1>
  <p>${esc(r.reason)}</p>
  <div class="row"><span class="muted">Когда</span><span>${esc(this.window(r.windowFrom, r.windowTo))}</span></div>
  ${r.masterName ? `<div class="row"><span class="muted">Мастер</span><span>${esc(r.masterName)}</span></div>` : ''}
</div>
<form method="post" action="/u/${esc(r.accessCode)}/approve"><button class="btn" type="submit">Подтвердить</button></form>
<form method="post" action="/u/${esc(r.accessCode)}/decline">
  <div class="card"><label class="muted">Если не подходит — напишите почему</label>
  <input type="text" name="reason" placeholder="Например: буду в отъезде"></div>
  <button class="btn btn--secondary" type="submit">Отказать</button>
</form>
<p class="note">Ответ увидит мастер и диспетчерская. Без вашего ответа в квартиру никто не войдёт.</p>`,
      ),
    );
  }

  @Post(':code/approve')
  approve(@Param('code') code: string, @Res() res: Response) {
    const r = this.access.unitAccessByCode(code);
    if (!r) return this.show(code, res);
    this.access.decideUnitAccess('t0', r.id, { decision: 'approve', byPhone: `link:${code}` });
    this.html(res, this.page('Готово', `<div class="card empty"><div class="icon">✓</div>
      <h1>Спасибо, доступ согласован</h1><p class="muted">Мастер придёт в указанное время.</p></div>`));
  }

  @Post(':code/decline')
  decline(@Param('code') code: string, @Body() body: { reason?: string }, @Res() res: Response) {
    const r = this.access.unitAccessByCode(code);
    if (!r) return this.show(code, res);
    const reason = body?.reason?.trim() || 'Житель не может принять';
    this.access.decideUnitAccess('t0', r.id, { decision: 'decline', byPhone: `link:${code}`, reason });
    this.html(res, this.page('Записали', `<div class="card empty"><div class="icon">✓</div>
      <h1>Записали отказ</h1><p class="muted">Диспетчерская свяжется с вами, чтобы подобрать время.</p></div>`));
  }

  private statusText(s: string): string {
    return (
      { approved: 'Доступ согласован', declined: 'Вы отказали', rescheduled: 'Вы предложили другое время', expired: 'Срок ответа истёк', cancelled: 'Запрос отменён' } as Record<string, string>
    )[s] ?? s;
  }
}

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}
