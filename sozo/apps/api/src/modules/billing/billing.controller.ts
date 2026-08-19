import { Body, Controller, Get, Param, Post, Query, Req, UseGuards, BadRequestException } from '@nestjs/common';
import { AuthGuard, Roles } from '../identity/auth.guard';
import { BillingService } from './billing.service';
import { AuditService } from '../platform/audit.service';
import { CrmService } from '../crm/crm.service';
import type { JwtClaims } from '../../common/jwt';

@Controller('admin/billing')
@UseGuards(AuthGuard)
@Roles('admin', 'accountant')
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly audit: AuditService,
    private readonly crm: CrmService,
  ) {}

  /** A-15: балансы счетов */
  @Get('accounts')
  accounts() {
    return this.billing.accounts();
  }

  /** A-15: журнал проводок */
  @Get('transactions')
  transactions() {
    return this.billing.transactions();
  }

  /** A-15: ручная проводка — двойное подтверждение (PRD-04 §1.3) */
  @Post('transactions')
  manual(
    @Body() body: { debit: string; credit: string; amountTiyin: number; comment: string; secondAdminConfirmed?: boolean },
    @Req() req: { auth: JwtClaims },
  ) {
    if (!body.secondAdminConfirmed) {
      throw new BadRequestException({ code: 'SECOND_ADMIN_REQUIRED', message: 'Ручная проводка требует двойного подтверждения (PRD-04 §1.3)' });
    }
    const txs = this.billing.post([
      { type: 'manual', debit: body.debit, credit: body.credit, amountTiyin: body.amountTiyin, comment: body.comment },
    ]);
    this.audit.write({ actorPhone: req.auth.phone, action: 'billing.manual_tx', entity: 'Transaction', entityId: txs[0].id, payload: body });
    return txs;
  }

  /** Сторно — единственный способ исправления */
  @Post('transactions/:id/storno')
  storno(@Param('id') id: string, @Body() body: { comment?: string; secondAdminConfirmed?: boolean }, @Req() req: { auth: JwtClaims }) {
    if (!body?.secondAdminConfirmed) {
      throw new BadRequestException({ code: 'SECOND_ADMIN_REQUIRED', message: 'Сторно требует двойного подтверждения (PRD-04 §1.3)' });
    }
    const tx = this.billing.storno(id, body?.comment ?? '');
    this.audit.write({ actorPhone: req.auth.phone, action: 'billing.storno', entity: 'Transaction', entityId: id });
    return tx;
  }

  /** A-16: СФ на абонентку (1-е число — вручную кнопкой до планировщика) */
  @Get('invoices')
  invoices() {
    return this.billing.invoicesList();
  }

  @Post('invoices/subscription')
  issueSubscription(@Body() body: { organizationId: string }, @Req() req: { auth: JwtClaims }) {
    const org = this.crm.get(body.organizationId);
    if (!org.subscriptionTiyin) throw new BadRequestException({ code: 'NO_SUBSCRIPTION', message: 'У организации нет абонентки' });
    const inv = this.billing.issueSubscriptionInvoice(org.id, org.name, org.subscriptionTiyin);
    this.audit.write({ actorPhone: req.auth.phone, action: 'invoice.issued', entity: 'Invoice', entityId: inv.id, payload: { number: inv.number } });
    return inv;
  }

  @Post('invoices/:id/mark-paid')
  markPaid(@Param('id') id: string, @Req() req: { auth: JwtClaims }) {
    const inv = this.billing.markInvoicePaid(id);
    this.audit.write({ actorPhone: req.auth.phone, action: 'invoice.paid', entity: 'Invoice', entityId: id });
    return inv;
  }

  /** A-17: ведомость выплат мастерам */
  @Get('payouts')
  payouts() {
    return this.billing.payouts();
  }

  @Post('payouts/:masterId/pay')
  pay(@Param('masterId') masterId: string, @Req() req: { auth: JwtClaims }) {
    const txs = this.billing.payOut(masterId);
    this.audit.write({ actorPhone: req.auth.phone, action: 'payout.paid', entity: 'MasterBalance', entityId: masterId });
    return txs;
  }

  /** A-18: дебиторка aging */
  @Get('receivables')
  receivables() {
    return this.billing.receivablesAging();
  }

  /**
   * Пени по просроченным счетам организации.
   *
   * Отдельно от дебиторки: там возраст долга, здесь его цена. Расчёт
   * показывается всегда, счёт выставляется только по решению человека.
   */
  @Get('penalties/:orgId')
  penalties(@Param('orgId') orgId: string) {
    return this.billing.penaltyFor(orgId);
  }

  @Post('penalties/:orgId/issue')
  @Roles('admin', 'accountant')
  issuePenalty(@Param('orgId') orgId: string, @Req() req: { auth: JwtClaims }) {
    const inv = this.billing.issuePenaltyInvoice(orgId);
    this.audit.write({
      actorPhone: req.auth.phone,
      action: 'billing.penalty_issued',
      entity: 'Invoice',
      entityId: inv.id,
      payload: { organizationId: orgId, amountTiyin: inv.amountTiyin },
    });
    return inv;
  }

  /**
   * Дунинг: у кого сколько просрочено и что с этим уже сделал таймер.
   *
   * Ступени заданы договором и одинаковы для всех: T+3 — предупреждение,
   * T+7 — приостановка обслуживания, кроме аварийных заявок (ТЗ 8.9).
   * Экран не решает, а показывает — приостановку ставит планировщик.
   */
  @Get('dunning')
  dunning() {
    const now = Date.now();
    const rows = this.crm
      .list()
      .map((o) => {
        const unpaid = this.billing
          .invoicesList()
          .filter((i) => i.organizationId === o.id && i.status === 'issued')
          .map((i) => ({
            id: i.id,
            number: i.number,
            amountTiyin: i.amountTiyin,
            issuedAt: i.issuedAt,
            days: Math.floor((now - new Date(i.issuedAt).getTime()) / 86_400_000),
          }));
        if (!unpaid.length) return null;
        const oldest = Math.max(...unpaid.map((i) => i.days));
        return {
          organizationId: o.id,
          organizationName: o.name,
          status: o.status,
          unpaidCount: unpaid.length,
          unpaidTiyin: unpaid.reduce((s, i) => s + i.amountTiyin, 0),
          oldestDays: oldest,
          // Ступень называем словами: «T+7» ничего не говорит тому, кто звонит клиенту
          stage: oldest >= 7 ? 'Обслуживание приостановлено' : oldest >= 3 ? 'Отправлено предупреждение' : 'В пределах срока',
          suspended: o.status === 'suspended',
          invoices: unpaid.sort((a, b) => b.days - a.days),
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => b.oldestDays - a.oldestDays);

    return {
      organizations: rows,
      warned: rows.filter((r) => r.oldestDays >= 3 && r.oldestDays < 7).length,
      suspended: rows.filter((r) => r.oldestDays >= 7).length,
      totalTiyin: rows.reduce((s, r) => s + r.unpaidTiyin, 0),
      note: 'Ступени ставит планировщик: T+3 предупреждение, T+7 приостановка (кроме аварийных заявок)',
    };
  }

  /**
   * Где деньги: сколько прошло каким каналом и что где лежит.
   *
   * По проводкам это было и раньше, но собрать картину можно было только
   * глазами по журналу. Вопрос «сколько у нас наличных на руках у мастеров»
   * — ежедневный, и он не должен требовать выгрузки в таблицу.
   */
  @Get('money-flow')
  moneyFlow() {
    const accounts = this.billing.accounts();
    const balance = (code: string) => accounts.find((a) => a.code === code)?.balanceTiyin ?? 0;
    const txs = this.billing.transactions(5000);
    const sumOf = (type: string) =>
      txs.filter((t) => t.type === type && !t.isStorno).reduce((s, t) => s + t.amountTiyin, 0);

    return {
      // Где деньги лежат сейчас
      where: [
        { code: 'settlement', title: 'На расчётном счёте', amountTiyin: balance('settlement') },
        { code: 'clearing', title: 'В пути от провайдеров', amountTiyin: balance('clearing'), note: 'платежи приняты, деньги ещё не зачислены' },
        { code: 'cash_masters', title: 'Наличные у мастеров', amountTiyin: balance('cash_masters'), note: 'сдаются в кассу; сверх лимита мастер снимается с линии' },
        { code: 'ar', title: 'Долг клиентов', amountTiyin: balance('ar'), note: 'выставленные и неоплаченные счета' },
      ],
      // Кому мы должны
      owed: [
        { code: 'master_payable', title: 'Мастерам к выплате', amountTiyin: balance('master_payable') },
        { code: 'advances', title: 'Авансы по абоненткам', amountTiyin: balance('advances'), note: 'оплачено вперёд, работами не закрыто' },
        { code: 'reserve_fund', title: 'Резервный фонд ущербов', amountTiyin: balance('reserve_fund') },
      ],
      // Что прошло за всё время — по видам операций
      flows: [
        { code: 'revenue', title: 'Выручка работ', amountTiyin: sumOf('order.revenue') },
        { code: 'tips', title: 'Чаевые мастерам', amountTiyin: sumOf('order.tip'), note: 'мимо выручки: идут мастеру целиком' },
        { code: 'invoices', title: 'Выставлено счетов', amountTiyin: sumOf('invoice.issued') },
        { code: 'paid', title: 'Оплачено счетов', amountTiyin: sumOf('invoice.paid') },
        { code: 'penalty', title: 'Пени предъявлено', amountTiyin: sumOf('invoice.penalty') },
        { code: 'payouts', title: 'Выплачено мастерам', amountTiyin: sumOf('payout') },
      ],
      balanceCheck: this.billing.balanceCheck(),
      note: 'Считается из проводок двойной записи — то же, что в балансах, но собрано по смыслу',
    };
  }

  /** A-22: баланс-чекер */
  @Get('balance-check')
  balanceCheck() {
    return this.billing.balanceCheck();
  }

  /** A-19: закрытие периода (двойное подтверждение, PRD-04 §1.3) */
  @Get('periods')
  periods() {
    return this.billing.periods();
  }

  @Post('periods/close')
  closePeriod(@Body() body: { month: string; secondAdminConfirmed?: boolean }, @Req() req: { auth: JwtClaims }) {
    if (!body?.secondAdminConfirmed) {
      throw new BadRequestException({ code: 'SECOND_ADMIN_REQUIRED', message: 'Закрытие периода требует двойного подтверждения' });
    }
    const res = this.billing.closePeriod(body.month);
    this.audit.write({ actorPhone: req.auth.phone, action: 'period.closed', entity: 'Period', entityId: body.month });
    return res;
  }

  @Post('periods/reopen')
  reopenPeriod(@Body() body: { month: string; secondAdminConfirmed?: boolean }, @Req() req: { auth: JwtClaims }) {
    if (!body?.secondAdminConfirmed) {
      throw new BadRequestException({ code: 'SECOND_ADMIN_REQUIRED', message: 'Переоткрытие периода требует двойного подтверждения' });
    }
    this.billing.reopenPeriod(body.month);
    this.audit.write({ actorPhone: req.auth.phone, action: 'period.reopened', entity: 'Period', entityId: body.month });
    return { month: body.month, closed: false };
  }

  /** A-31: налоговые регистры (реестры СФ / чеков / выплат) */
  @Get('tax-registers')
  taxRegisters(@Query('month') month?: string) {
    return this.billing.taxRegisters(month);
  }

  /** A-32: стартовые остатки — однократно, двойное подтверждение */
  @Post('opening-balances')
  openingBalances(
    @Body() body: { entries: Array<{ account: string; side: 'debit' | 'credit'; amountTiyin: number; comment?: string }>; secondAdminConfirmed?: boolean },
    @Req() req: { auth: JwtClaims },
  ) {
    if (!body?.secondAdminConfirmed) {
      throw new BadRequestException({ code: 'SECOND_ADMIN_REQUIRED', message: 'Стартовые остатки требуют подтверждения админа и бухгалтера (A-32)' });
    }
    const res = this.billing.openingBalances(body.entries ?? []);
    this.audit.write({ actorPhone: req.auth.phone, action: 'opening_balances.posted', entity: 'Transaction', entityId: res.operationId });
    return res;
  }

  /** A-21: клиринг Payme/Click */
  @Get('clearing')
  clearing() {
    return this.billing.clearingState();
  }

  @Post('clearing/settle')
  settleClearing(@Body() body: { commissionPermille?: number }, @Req() req: { auth: JwtClaims }) {
    const res = this.billing.settleClearing(body?.commissionPermille ?? 20); // 2% по умолчанию
    this.audit.write({ actorPhone: req.auth.phone, action: 'clearing.settled', entity: 'Transaction', entityId: res.operationId, payload: res });
    return res;
  }
}
