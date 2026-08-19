import { Injectable, NotFoundException } from '@nestjs/common';
import { MasterOpsService } from '../master-api/master-ops.service';
import { BillingService } from '../billing/billing.service';
import { CrmService } from '../crm/crm.service';
import { OrdersService } from '../orders/orders.service';

/**
 * Генератор документов (PRD-05 §13). Dev-реализация: печатный HTML — открывается
 * в браузере и сохраняется в PDF (Cmd+P). В проде — серверный PDF-рендер,
 * S3-хранение и QR на онлайн-версию акта (ТЗ 9.1).
 * Данные документа берутся из копий (цены, гарантия) — воспроизводимость (ТЗ 3.7).
 */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly orders: OrdersService,
    private readonly crm: CrmService,
    private readonly billing: BillingService,
    private readonly ops: MasterOpsService,
  ) {}

  private soums(tiyin: number): string {
    return `${Math.round(tiyin / 100)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} сум`;
  }

  private date(iso: string | Date): string {
    return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  private esc(s: unknown): string {
    return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
  }

  /** Общая обёртка: фирменный бланк + печатный CSS (A4, поля 15 мм) */
  private page(title: string, body: string): string {
    return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${this.esc(title)}</title>
<style>
  @page { size: A4; margin: 15mm; }
  * { box-sizing: border-box; }
  body { font-family: Inter, -apple-system, "Segoe UI", Roboto, sans-serif; color: #1A1915; font-size: 12px; line-height: 1.45; margin: 0; padding: 24px; background: #FAF9F5; }
  .sheet { max-width: 780px; margin: 0 auto; background: #fff; border: 1px solid #E8E5DD; border-radius: 12px; padding: 32px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 24px 0 8px; }
  .brand { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2px solid #C15F3C; padding-bottom: 12px; margin-bottom: 20px; }
  .brand__name { font-size: 20px; font-weight: 700; color: #C15F3C; letter-spacing: 0.04em; }
  .brand__meta { color: #6E6B63; text-align: right; font-size: 11px; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0; }
  th { text-align: left; font-size: 11px; color: #6E6B63; border-bottom: 1px solid #E8E5DD; padding: 6px 8px; }
  td { padding: 6px 8px; border-bottom: 1px solid #E8E5DD; vertical-align: top; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .total { font-weight: 600; font-size: 14px; }
  .muted { color: #6E6B63; }
  dl { display: grid; grid-template-columns: 200px 1fr; gap: 4px 16px; margin: 0; }
  dt { color: #6E6B63; }
  dd { margin: 0; }
  .photos { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 8px; }
  .photo { aspect-ratio: 4/3; border: 1px dashed #E8E5DD; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: #6E6B63; font-size: 11px; text-align: center; padding: 8px; }
  .photo--img { display: block; padding: 0; border: 1px solid #E8E5DD; overflow: hidden; margin: 0; aspect-ratio: auto; }
  .photo--img img { width: 100%; aspect-ratio: 4/3; object-fit: cover; display: block; }
  .photo--img figcaption { padding: 4px 8px; font-size: 10px; color: #6E6B63; }
  .sign { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin-top: 32px; }
  .sign__line { border-top: 1px solid #1A1915; padding-top: 4px; color: #6E6B63; }
  .note { background: #FAF9F5; border: 1px solid #E8E5DD; border-radius: 8px; padding: 10px 12px; margin-top: 12px; color: #6E6B63; }
  .print-btn { display: block; margin: 0 auto 16px; padding: 8px 20px; background: #C15F3C; color: #fff; border: none; border-radius: 8px; font: inherit; cursor: pointer; }
  @media print { body { background: #fff; padding: 0; } .sheet { border: none; border-radius: 0; padding: 0; max-width: none; } .print-btn { display: none; } }
</style></head><body>
<button class="print-btn" onclick="window.print()">Печать / сохранить в PDF</button>
<div class="sheet">
  <div class="brand">
    <div><div class="brand__name">SOZO</div><div class="muted">Платформа технического сервиса · Ташкент</div></div>
    <div class="brand__meta">${this.esc(title)}<br>от ${this.date(new Date())}</div>
  </div>
  ${body}
</div></body></html>`;
  }

  /** ТЗ 9.1: акт по заявке — работы, материалы, фото до/после, гарантия */
  async orderAct(orderId: string, token?: string): Promise<string> {
    const o = await this.orders.get('t0', orderId);
    const works = o.lines
      .map(
        (l) =>
          `<tr><td>${this.esc(l.name)}</td><td class="num">${l.qty} ${this.esc(l.unit)}</td><td class="num">${this.soums(l.priceFromTiyin)}</td></tr>`,
      )
      .join('');
    const materials = o.materials.length
      ? o.materials
          .map(
            (m) =>
              `<tr><td>${this.esc(m.name)} <span class="muted">(${m.kind === 'spare_part' ? 'запчасть' : 'расходник'})</span></td><td class="num">${m.hasReceipt ? 'чек есть' : 'фикс-прайс'}</td><td class="num">${this.soums(m.amountTiyin)}</td></tr>`,
          )
          .join('')
      : '<tr><td colspan="3" class="muted">Материалы не использовались</td></tr>';
    // Фотофиксация: реальные снимки вставляются как <img> (доступ по тому же токену)
    const q = token ? `?token=${encodeURIComponent(token)}` : '';
    const stageLabels: Array<['before' | 'after' | 'during' | 'receipt', string]> = [
      ['before', 'До'],
      ['after', 'После'],
      ['receipt', 'Чек'],
    ];
    const photoCells = stageLabels
      .flatMap(([stage, label]) => {
        const found = o.photos.filter((p) => p.stage === stage);
        if (!found.length) {
          return stage === 'receipt'
            ? []
            : [`<div class="photo">Фото «${label}»<br><span class="muted">не приложено</span></div>`];
        }
        return found.map((p) =>
          p.file
            ? `<figure class="photo photo--img"><img src="/v1/photos/${this.esc(p.file)}${q}" alt="Фото ${label}"><figcaption>${label} · ${this.date(p.at)}${p.geoMissing ? ' · без гео' : ''}</figcaption></figure>`
            : `<div class="photo">Фото «${label}»<br><span class="muted">отметка конвейера ${this.date(p.at)}</span></div>`,
        );
      })
      .join('');
    const approved = o.quotes.find((q) => q.kind === 'approved');

    // Позиции к закупке: клиент выбрал вариант запчасти, а купить её ещё
    // предстоит. В акте они стоят отдельно от материалов — это не расход,
    // а обязательство, и путать одно с другим в документе нельзя
    const chosen = this.ops.spareTiers.filter((s) => s.orderId === o.id && s.status === 'chosen');
    const purchase = chosen
      .map((s) => {
        const v = s.variants.find((x) => x.tier === s.chosenTier);
        const tier = s.chosenTier === 'economy' ? 'Эконом' : s.chosenTier === 'premium' ? 'Премиум' : 'Стандарт';
        return `<tr><td>${this.esc(s.partName)}</td><td>${tier}${v?.title ? ` · ${this.esc(v.title)}` : ''}</td><td class="num">${this.soums(v?.amountTiyin ?? 0)}</td></tr>`;
      })
      .join('');

    // Зачёт платного осмотра: если диагностику оплатили, а работы заказали,
    // её сумма не берётся дважды (ТЗ 4.1). Показываем это в акте, иначе
    // клиент видит две оплаты и считает, что переплатил
    const diagnostics = o.lines.find((l) => /диагност|осмотр|выезд/i.test(l.name));
    const creditRow =
      diagnostics && o.lines.length > 1
        ? `<tr><td class="muted">в т.ч. зачтён платный осмотр «${this.esc(diagnostics.name)}»</td><td class="num muted">−${this.soums(diagnostics.priceFromTiyin)}</td></tr>`
        : '';

    return this.page(
      `Акт по заявке ${o.number}`,
      `<h1>Акт выполненных работ ${this.esc(o.number)}</h1>
<dl>
  <dt>Заказчик</dt><dd>${this.esc(o.clientName || o.clientPhone)}</dd>
  <dt>Адрес</dt><dd>${this.esc(o.address)}</dd>
  <dt>Мастер</dt><dd>${this.esc(o.masterName ?? '—')}</dd>
  <dt>Дата создания</dt><dd>${this.date(o.createdAt)}</dd>
  <dt>Санкция клиента</dt><dd>${approved ? `подтверждена ${this.date(approved.at)} (${this.esc(approved.approvedVia ?? '—')})` : '<span class="muted">не зафиксирована</span>'}</dd>
  <dt>Гарантия на работы</dt><dd>30 дней с даты закрытия (копия срока фиксируется при закрытии, ТЗ 4.2)</dd>
</dl>
<h2>Выполненные работы</h2>
<table><thead><tr><th>Наименование</th><th class="num">Кол-во</th><th class="num">Стоимость</th></tr></thead><tbody>${works}</tbody></table>
<h2>Материалы</h2>
<table><thead><tr><th>Наименование</th><th class="num">Документ</th><th class="num">Стоимость</th></tr></thead><tbody>${materials}</tbody></table>
${purchase ? `<h2>К закупке по выбору заказчика</h2>
<table><thead><tr><th>Позиция</th><th>Выбранный вариант</th><th class="num">Стоимость</th></tr></thead><tbody>${purchase}</tbody></table>` : ''}
<table><tbody>
  <tr><td class="total">Итого работы</td><td class="num total">${this.soums(o.totalFromTiyin)}</td></tr>
  ${creditRow}
  ${o.promoCode ? `<tr><td class="muted">в т.ч. скидка по промокоду ${this.esc(o.promoCode)}</td><td class="num muted">−${o.promoDiscountPercent}%</td></tr>` : ''}
  <tr><td class="total">Итого материалы</td><td class="num total">${this.soums(o.totalMaterialTiyin)}</td></tr>
  <tr><td class="total">ВСЕГО</td><td class="num total">${this.soums(o.totalFromTiyin + o.totalMaterialTiyin)}</td></tr>
</tbody></table>
<h2>Фотофиксация</h2>
<div class="photos">${photoCells}</div>
<div class="note">Работы приняты заказчиком. Претензии по качеству принимаются в течение гарантийного срока через приложение или диспетчерскую службу.</div>
<div class="sign"><div class="sign__line">Исполнитель (мастер)</div><div class="sign__line">Заказчик</div></div>`,
    );
  }

  /** ТЗ 9.2: месячный отчёт по точке — «главная продающая ценность B2B» */
  async locationReport(orgId: string, locationId: string): Promise<string> {
    const org = this.crm.get(orgId);
    const loc = org.locations.find((l) => l.id === locationId);
    if (!loc) throw new NotFoundException({ code: 'LOCATION_NOT_FOUND' });
    const all = await this.orders.list('t0');
    const orders = all.filter((o) => o.locationId === locationId);
    const closed = orders.filter((o) => ['closed', 'rated'].includes(o.status));
    const rows = orders.length
      ? orders
          .map(
            (o) =>
              `<tr><td>${this.esc(o.number)}</td><td>${this.date(o.createdAt)}</td><td>${this.esc(o.description || '—')}</td><td>${this.esc(o.masterName ?? '—')}</td><td class="num">${this.soums(o.totalFromTiyin)}</td></tr>`,
          )
          .join('')
      : '<tr><td colspan="5" class="muted">За период обращений не было</td></tr>';
    return this.page(
      `Отчёт по точке ${loc.name}`,
      `<h1>Отчёт по обслуживанию объекта</h1>
<dl>
  <dt>Организация</dt><dd>${this.esc(org.name)}</dd>
  <dt>Объект</dt><dd>${this.esc(loc.name)}, ${this.esc(loc.address)}</dd>
  <dt>Тип объекта</dt><dd>${this.esc(loc.passport.objectType ?? '—')}${loc.passport.areaM2 ? `, ${loc.passport.areaM2} м²` : ''}</dd>
  <dt>Договор</dt><dd>${org.contractType === 'subscription' ? 'абонентское обслуживание' : 'разовые заявки'}${org.subscriptionTiyin ? ` · ${this.soums(org.subscriptionTiyin)}/мес` : ''}</dd>
  <dt>SLA по авариям</dt><dd>${org.terms.slaEmergencyMin[0]} мин днём / ${org.terms.slaEmergencyMin[1]} мин ночью</dd>
</dl>
<h2>Обращения за период</h2>
<table><thead><tr><th>Заявка</th><th>Дата</th><th>Работы</th><th>Мастер</th><th class="num">Сумма</th></tr></thead><tbody>${rows}</tbody></table>
<table><tbody>
  <tr><td class="total">Всего обращений</td><td class="num total">${orders.length}</td></tr>
  <tr><td class="total">Закрыто</td><td class="num total">${closed.length}</td></tr>
  <tr><td class="total">Сумма работ</td><td class="num total">${this.soums(closed.reduce((s, o) => s + o.totalFromTiyin, 0))}</td></tr>
</tbody></table>
<h2>Фотофиксация работ</h2>
<div class="photos"><div class="photo">Фото до/после по каждой заявке<br><span class="muted">формируются приложением мастера</span></div><div class="photo">&nbsp;</div><div class="photo">&nbsp;</div></div>
<div class="note">Отчёт формируется автоматически из закрытых заявок и прикладывается к счёту-фактуре. Все работы подтверждены фотофиксацией и приёмкой представителя объекта.</div>
<div class="sign"><div class="sign__line">SOZO, представитель</div><div class="sign__line">${this.esc(org.name)}, представитель</div></div>`,
    );
  }

  /** Журнал технического обслуживания — печатная форма для объекта (щитовая/управляющий) */
  async maintenanceLog(orgId: string, locationId: string): Promise<string> {
    const org = this.crm.get(orgId);
    const loc = org.locations.find((l) => l.id === locationId);
    if (!loc) throw new NotFoundException({ code: 'LOCATION_NOT_FOUND' });
    const all = await this.orders.list('t0');
    const orders = all.filter((o) => o.locationId === locationId);
    const rows = orders.length
      ? orders
          .map(
            (o) =>
              `<tr><td>${this.date(o.createdAt)}</td><td>${this.esc(o.description || o.lines.map((l) => l.name).join(', ') || '—')}</td><td>${this.esc(o.masterName ?? '—')}</td><td></td></tr>`,
          )
          .join('')
      : Array.from({ length: 8 }, () => '<tr><td>&nbsp;</td><td></td><td></td><td></td></tr>').join('');
    return this.page(
      `Журнал ТО — ${loc.name}`,
      `<h1>Журнал технического обслуживания</h1>
<dl>
  <dt>Объект</dt><dd>${this.esc(loc.name)}, ${this.esc(loc.address)}</dd>
  <dt>Организация</dt><dd>${this.esc(org.name)}</dd>
  <dt>Обслуживающая компания</dt><dd>SOZO · диспетчерская служба</dd>
  <dt>Доступ на объект</dt><dd>${this.esc(loc.access.schedule ?? '—')}</dd>
  <dt>Контакт ТСЖ / УК</dt><dd>${this.esc(loc.access.hoaContact ?? '—')}</dd>
</dl>
<h2>Записи о работах</h2>
<table><thead><tr><th>Дата</th><th>Выполненные работы</th><th>Исполнитель</th><th>Подпись представителя</th></tr></thead><tbody>${rows}</tbody></table>
<div class="note">Журнал хранится на объекте (электрощитовая либо у управляющего). Каждая запись подтверждается подписью представителя объекта. Электронная версия с фотофиксацией доступна в личном кабинете организации.</div>`,
    );
  }

  /** Акт сверки взаиморасчётов из проводок (ТЗ 8.9) */
  reconciliation(orgId: string): string {
    const org = this.crm.get(orgId);
    const invoices = this.billing.invoicesList().filter((i) => i.organizationId === orgId);
    const rows = invoices.length
      ? invoices
          .map(
            (i) =>
              `<tr><td>${this.esc(i.number)}</td><td>${this.date(i.issuedAt)}</td><td>${i.kind === 'subscription' ? 'абонентская плата' : 'сверхлимит / материалы'}</td><td class="num">${this.soums(i.amountTiyin)}</td><td class="num">${i.status === 'paid' ? this.soums(i.amountTiyin) : '—'}</td></tr>`,
          )
          .join('')
      : '<tr><td colspan="5" class="muted">Операций за период нет</td></tr>';
    const issued = invoices.reduce((s, i) => s + i.amountTiyin, 0);
    const paid = invoices.filter((i) => i.status === 'paid').reduce((s, i) => s + i.amountTiyin, 0);
    // НДС в сверке — не украшение: бухгалтер сверяет именно его, и считать
    // его по калькулятору из итоговой суммы каждый раз заново не должен
    const vat = invoices.reduce((s, i) => s + (i.vatTiyin ?? 0), 0);
    const penalty = this.billing.penaltyFor(orgId);
    return this.page(
      `Акт сверки — ${org.name}`,
      `<h1>Акт сверки взаиморасчётов</h1>
<dl><dt>Организация</dt><dd>${this.esc(org.name)}, ИНН ${this.esc(org.inn)}</dd>
<dt>Период</dt><dd>с начала обслуживания по ${this.date(new Date())}</dd></dl>
<table><thead><tr><th>Документ</th><th>Дата</th><th>Основание</th><th class="num">Начислено</th><th class="num">Оплачено</th></tr></thead><tbody>${rows}</tbody></table>
<table><tbody>
  <tr><td class="total">Итого начислено</td><td class="num total">${this.soums(issued)}</td></tr>
  ${vat > 0 ? `<tr><td class="muted">в том числе НДС</td><td class="num muted">${this.soums(vat)}</td></tr>` : '<tr><td class="muted">без НДС</td><td class="num muted">—</td></tr>'}
  <tr><td class="total">Итого оплачено</td><td class="num total">${this.soums(paid)}</td></tr>
  <tr><td class="total">Задолженность на дату акта</td><td class="num total">${this.soums(issued - paid)}</td></tr>
  ${penalty.amountTiyin > 0 ? `<tr><td class="total">Пени за просрочку (${penalty.ratePercentPerDay}% в день, потолок ${penalty.capPercent}%)</td><td class="num total">${this.soums(penalty.amountTiyin)}</td></tr>` : ''}
</tbody></table>
${penalty.amountTiyin > 0 ? `<div class="note">Пени начислены по счетам, просроченным более чем на ${penalty.graceDays} дней. Расчёт по каждому счёту — в разделе «Дебиторка» личного кабинета.</div>` : ''}
<div class="note">Акт сформирован из проводок двойной записи. Расхождения просим сообщить в течение 5 рабочих дней.</div>
<div class="sign"><div class="sign__line">SOZO, бухгалтерия</div><div class="sign__line">${this.esc(org.name)}, бухгалтерия</div></div>`,
    );
  }

  /** Счёт-фактура (печатная форма; ЭДО — фаза 2) */
  invoice(invoiceId: string): string {
    const inv = this.billing.invoicesList().find((i) => i.id === invoiceId);
    if (!inv) throw new NotFoundException({ code: 'INVOICE_NOT_FOUND' });
    const org = this.crm.get(inv.organizationId);
    // НДС берём тот, что записан на счёте при выставлении, а не считаем заново:
    // организация могла сняться с учёта, и пересчёт задним числом изменил бы
    // уже отданный покупателю документ
    const vat = inv.vatTiyin ?? 0;
    const vatRate = inv.vatRatePercent ?? 12;
    return this.page(
      `Счёт-фактура ${inv.number}`,
      `<h1>Счёт-фактура ${this.esc(inv.number)}</h1>
<dl>
  <dt>Покупатель</dt><dd>${this.esc(org.name)}, ИНН ${this.esc(org.inn)}</dd>
  <dt>Дата выставления</dt><dd>${this.date(inv.issuedAt)}</dd>
  <dt>Статус</dt><dd>${inv.status === 'paid' ? `оплачен ${this.date(inv.paidAt ?? inv.issuedAt)}` : 'ожидает оплаты'}</dd>
</dl>
<table><thead><tr><th>Наименование</th><th class="num">Сумма</th></tr></thead><tbody>
  <tr><td>${inv.kind === 'subscription' ? 'Абонентское техническое обслуживание' : 'Работы сверх абонентской платы'}</td><td class="num">${this.soums(inv.amountTiyin)}</td></tr>
</tbody></table>
<table><tbody>
  ${vat > 0 ? `<tr><td class="muted">в том числе НДС ${vatRate}%</td><td class="num muted">${this.soums(vat)}</td></tr>` : '<tr><td class="muted">без НДС</td><td class="num muted">—</td></tr>'}
  <tr><td class="total">Всего к оплате</td><td class="num total">${this.soums(inv.amountTiyin)}</td></tr>
</tbody></table>
<div class="note">Оплата в течение 5 банковских дней. При неоплате к 10-му числу обслуживание приостанавливается, кроме аварийных вызовов (условия договора).</div>
<div class="sign"><div class="sign__line">Руководитель</div><div class="sign__line">Главный бухгалтер</div></div>`,
    );
  }
}
