import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { masterShare, roundTo100Soums, uuidv7 } from '@sozo/kernel';
import { EventBus, type OrderClosedEvent } from '../../common/event-bus';
import { StateStore } from '../../common/state-store';
import { CrmService } from '../crm/crm.service';
import { ParametersService } from '../platform/parameters.service';

/** План счетов — упрощённый контур PRD-05 §4.3 (полный — с миграцией на Prisma) */
const ACCOUNTS: Array<{ code: string; name: string; kind: 'asset' | 'liability' | 'income' | 'expense' }> = [
  { code: 'settlement', name: 'Расчётный счёт', kind: 'asset' },
  { code: 'clearing', name: 'Клиринг провайдеров (деньги в пути)', kind: 'asset' },
  { code: 'cash_masters', name: 'Наличные у мастеров', kind: 'asset' },
  { code: 'ar', name: 'Дебиторская задолженность', kind: 'asset' },
  { code: 'advances', name: 'Авансы полученные (абонентки)', kind: 'liability' },
  { code: 'master_payable', name: 'Кредиторка мастерам (доли)', kind: 'liability' },
  { code: 'reserve_fund', name: 'Резервный фонд ущербов', kind: 'liability' },
  { code: 'revenue', name: 'Выручка работ', kind: 'income' },
  { code: 'master_share_expense', name: 'Расход: доли мастеров', kind: 'expense' },
  { code: 'reserve_expense', name: 'Расход: отчисления в резервный фонд', kind: 'expense' },
  { code: 'provider_fees', name: 'Расход: комиссии платёжных провайдеров', kind: 'expense' },
  { code: 'opening', name: 'Стартовые остатки (капитал)', kind: 'liability' },
];

export interface TxRec {
  id: string;
  operationId: string;
  type: string;
  debit: string;
  credit: string;
  amountTiyin: number;
  orderId?: string;
  invoiceId?: string;
  masterId?: string;
  isStorno: boolean;
  reversedTxId?: string;
  comment?: string;
  createdAt: string;
}

export interface InvoiceRec {
  id: string;
  number: string;
  organizationId: string;
  organizationName: string;
  kind: 'subscription' | 'overlimit' | 'one_off_prepayment';
  amountTiyin: number;
  status: 'issued' | 'paid';
  issuedAt: string;
  paidAt?: string;
  /**
   * НДС, уже включённый в сумму (цены прайса — с НДС).
   *
   * Пишется при выставлении и больше не пересчитывается: организация может
   * перестать быть плательщиком, а выставленный счёт от этого не меняется —
   * это бухгалтерский факт, а не текущее состояние справочника.
   */
  vatTiyin: number;
  vatRatePercent: number;
}

/**
 * billing (DEV-07 §2 п.4). Только проводки двойной записью: правка задним числом
 * запрещена, исправление — сторно (ТЗ 8.1). О заявках узнаёт из шины событий,
 * а не из модуля заказов (DEV-07 §3.2). Единственная доменная зависимость —
 * CRM, и только на чтение: чтобы выставить счёт, нужны реквизиты организации
 * и условия её договора.
 */
@Injectable()
export class BillingService implements OnModuleInit {
  private readonly txs: TxRec[] = [];
  private readonly invoices: InvoiceRec[] = [];
  private invoiceSeq = 0;
  private readonly closedPeriods = new Set<string>(); // 'YYYY-MM' (A-19)
  private openingDone = false;

  constructor(
    private readonly bus: EventBus,
    private readonly store: StateStore,
    private readonly crm: CrmService,
    private readonly params: ParametersService,
  ) {
    this.store.register(
      'billing',
      () => ({ txs: this.txs, invoices: this.invoices, invoiceSeq: this.invoiceSeq, closedPeriods: [...this.closedPeriods], openingDone: this.openingDone }),
      (d) => {
        const data = d as { txs: TxRec[]; invoices: InvoiceRec[]; invoiceSeq: number; closedPeriods: string[]; openingDone: boolean };
        this.txs.length = 0;
        this.txs.push(...data.txs);
        this.invoices.length = 0;
        this.invoices.push(...data.invoices);
        this.invoiceSeq = data.invoiceSeq ?? 0;
        this.closedPeriods.clear();
        for (const m of data.closedPeriods ?? []) this.closedPeriods.add(m);
        this.openingDone = data.openingDone ?? false;
      },
    );
  }

  onModuleInit(): void {
    this.bus.subscribe<OrderClosedEvent>('order.closed', (e) => this.onOrderClosed(e));
    // Склад: продажа мастеру — удержание из будущей выплаты (ТЗ 17.16)
    this.bus.subscribe<{ masterId: string; masterName: string; amountTiyin: number; itemName: string }>(
      'stock.sold_to_master',
      (e) =>
        this.post([
          { type: 'stock.sale', debit: 'master_payable', credit: 'revenue', amountTiyin: e.amountTiyin, masterId: e.masterId, comment: `Продажа со склада: ${e.itemName} → ${e.masterName}` },
        ]),
    );
    // Резервный фонд: выплата ущерба + регресс к мастеру ≤30% (ТЗ 17.7)
    this.bus.subscribe<{ caseId: string; amountTiyin: number; regressTiyin: number; masterId?: string; description: string }>(
      'damage.payout',
      (e) => {
        this.post([
          { type: 'damage.payout', debit: 'reserve_fund', credit: 'settlement', amountTiyin: e.amountTiyin, comment: `Выплата ущерба: ${e.description}` },
        ]);
        if (e.regressTiyin > 0 && e.masterId) {
          this.post([
            { type: 'damage.regress', debit: 'master_payable', credit: 'reserve_fund', amountTiyin: e.regressTiyin, masterId: e.masterId, comment: `Регресс к мастеру по делу об ущербе` },
          ]);
        }
      },
    );
  }

  // ---------- Проводки ----------

  accounts() {
    return ACCOUNTS.map((a) => ({ ...a, balanceTiyin: this.balance(a.code) }));
  }

  transactions(limit = 200): TxRec[] {
    return this.txs.slice(-limit).reverse();
  }

  private balance(code: string): number {
    // asset/expense: Дт − Кт; liability/income: Кт − Дт
    const kind = ACCOUNTS.find((a) => a.code === code)?.kind;
    const dt = this.txs.filter((t) => t.debit === code).reduce((s, t) => s + t.amountTiyin, 0);
    const kt = this.txs.filter((t) => t.credit === code).reduce((s, t) => s + t.amountTiyin, 0);
    return kind === 'asset' || kind === 'expense' ? dt - kt : kt - dt;
  }

  /** Единственный способ движения денег; Σ Дт = Σ Кт внутри операции по построению */
  post(entries: Array<Omit<TxRec, 'id' | 'operationId' | 'isStorno' | 'createdAt'>>, operationId = uuidv7()): TxRec[] {
    const month = new Date().toISOString().slice(0, 7);
    if (this.closedPeriods.has(month)) {
      throw new BadRequestException({ code: 'PERIOD_LOCKED', message: `Период ${month} закрыт — проводки невозможны (A-19); переоткройте период` });
    }
    for (const e of entries) {
      if (e.amountTiyin <= 0) throw new BadRequestException({ code: 'AMOUNT_NOT_POSITIVE' });
      if (!ACCOUNTS.some((a) => a.code === e.debit) || !ACCOUNTS.some((a) => a.code === e.credit)) {
        throw new BadRequestException({ code: 'ACCOUNT_UNKNOWN' });
      }
    }
    const created = entries.map((e) => ({
      ...e,
      id: uuidv7(),
      operationId,
      isStorno: false,
      createdAt: new Date().toISOString(),
    }));
    this.txs.push(...created);
    this.store.persist();
    return created;
  }

  /** Сторно — единственный способ исправления (ТЗ 8.1) */
  storno(txId: string, comment: string): TxRec {
    const src = this.txs.find((t) => t.id === txId);
    if (!src) throw new NotFoundException({ code: 'TX_NOT_FOUND' });
    if (this.txs.some((t) => t.reversedTxId === txId)) {
      throw new BadRequestException({ code: 'ALREADY_REVERSED' });
    }
    const rec: TxRec = {
      id: uuidv7(),
      operationId: uuidv7(),
      type: `storno:${src.type}`,
      debit: src.credit, // обратная проводка
      credit: src.debit,
      amountTiyin: src.amountTiyin,
      orderId: src.orderId,
      masterId: src.masterId,
      isStorno: true,
      reversedTxId: txId,
      comment,
      createdAt: new Date().toISOString(),
    };
    this.txs.push(rec);
    this.store.persist();
    return rec;
  }

  // ---------- Автопроводки закрытия заявки (PRD-05 §4.4) ----------

  private onOrderClosed(e: OrderClosedEvent): void {
    const op = uuidv7();
    const work = e.totalWorkTiyin;

    // Материалы отдельным счётом, если так записано в договоре (ТЗ 8.4).
    // Делаем до проверки суммы работ: заявка могла быть только на материалы
    if (e.organizationId && (e.materialsTiyin ?? 0) > 0) {
      try {
        const org = this.crm.get(e.organizationId);
        if (org.terms.materialsSeparateInvoice) {
          this.issueMaterialsInvoice(org.id, org.name, e.materialsTiyin!, e.number);
        }
      } catch {
        /* организация могла быть удалена — счёт не выставляем */
      }
    }

    if (work <= 0) return;
    const revenueDebit = e.paymentChannel === 'cash' ? 'cash_masters' : e.paymentChannel === 'subscription' ? 'advances' : 'clearing';
    this.post(
      [
        { type: 'order.revenue', debit: revenueDebit, credit: 'revenue', amountTiyin: work, orderId: e.orderId, comment: `Выручка по ${e.number}` },
        {
          type: 'order.master_share',
          debit: 'master_share_expense',
          credit: 'master_payable',
          // 55% строго от БАЗОВОЙ (до скидок клиенту), округление в пользу мастера (ТЗ 3.7)
          amountTiyin: Number(masterShare(BigInt(e.baseWorkTiyin || work), 1000n, 550n)),
          orderId: e.orderId,
          masterId: e.masterId,
          comment: `Доля мастера ${e.masterName ?? ''} по ${e.number}`,
        },
        {
          type: 'order.reserve_fund',
          debit: 'reserve_expense',
          credit: 'reserve_fund',
          amountTiyin: Number(roundTo100Soums((BigInt(work) * 15n) / 1000n, 'favor_client')), // 1.5% (ТЗ 17.7)
          orderId: e.orderId,
          comment: `Резервный фонд по ${e.number}`,
        },
      ],
      op,
    );
  }

  /**
   * Чаевые от клиента — целиком мастеру.
   *
   * Отдельной проводкой, а не прибавкой к доле: чаевые не выручка компании,
   * с них не берётся ни комиссия, ни отчисление в резервный фонд, и в отчёте
   * они должны стоять отдельной строкой. Деньги приходят тем же путём, что
   * и оплата из приложения, — через клиринг провайдера.
   */
  tip(data: { orderId: string; orderNumber: string; masterId: string; masterName?: string; amountTiyin: number }): TxRec[] {
    if (data.amountTiyin <= 0) return [];
    return this.post(
      [
        {
          type: 'order.tip',
          debit: 'clearing',
          credit: 'master_payable',
          amountTiyin: data.amountTiyin,
          orderId: data.orderId,
          masterId: data.masterId,
          comment: `Чаевые мастеру ${data.masterName ?? ''} по ${data.orderNumber}`.replace(/\s+/g, ' ').trim(),
        },
      ],
      uuidv7(),
    );
  }

  /** Чаевые мастера за период — кошелёк показывает их отдельной секцией */
  tipsOf(masterId: string, fromMs: number, toMs: number): Array<{ orderId?: string; amountTiyin: number; comment?: string; at: string }> {
    return this.txs
      .filter((t) => t.type === 'order.tip' && t.masterId === masterId && !t.isStorno)
      .filter((t) => {
        const at = new Date(t.createdAt).getTime();
        return at >= fromMs && at <= toMs;
      })
      .map((t) => ({ orderId: t.orderId, amountTiyin: t.amountTiyin, comment: t.comment, at: t.createdAt }));
  }

  // ---------- Кошельки мастеров / ведомость (A-17) ----------

  payouts(): Array<{ masterId: string; masterName: string; accruedTiyin: number; paidTiyin: number; dueTiyin: number }> {
    const byMaster = new Map<string, { masterName: string; accrued: number; paid: number }>();
    for (const t of this.txs) {
      if (!t.masterId) continue;
      const m = byMaster.get(t.masterId) ?? { masterName: t.comment?.match(/Доля мастера (.*?) по/)?.[1] ?? '', accrued: 0, paid: 0 };
      if (t.credit === 'master_payable' && !t.isStorno) m.accrued += t.amountTiyin;
      if (t.debit === 'master_payable') m.paid += t.amountTiyin;
      byMaster.set(t.masterId, m);
    }
    return [...byMaster.entries()].map(([masterId, m]) => ({
      masterId,
      masterName: m.masterName,
      accruedTiyin: m.accrued,
      paidTiyin: m.paid,
      dueTiyin: m.accrued - m.paid,
    }));
  }

  payOut(masterId: string): TxRec[] {
    const due = this.payouts().find((p) => p.masterId === masterId)?.dueTiyin ?? 0;
    if (due <= 0) throw new BadRequestException({ code: 'NOTHING_DUE' });
    return this.post([
      { type: 'payout', debit: 'master_payable', credit: 'settlement', amountTiyin: due, masterId, comment: 'Еженедельная выплата (ведомость)' },
    ]);
  }

  // ---------- НДС ----------

  /**
   * Ставка НДС из параметра 23.
   *
   * Параметр редактируется как текст («по законодательству РУз», «12%»),
   * поэтому число достаём разбором. Не разобрали — 12%: действующая ставка,
   * и молча посчитать ноль хуже, чем взять её.
   */
  vatRatePercent(): number {
    const raw = this.params.list().find((p) => p.num === 23)?.value ?? '';
    const m = /(\d+)\s*%/.exec(raw);
    return m ? Number(m[1]) : 12;
  }

  /**
   * НДС внутри суммы. Цены прайса — с НДС, поэтому не начисляем сверху,
   * а выделяем: 120 000 с НДС 12% — это 107 143 + 12 857, а не 134 400.
   */
  vatInside(amountTiyin: number, vatPayer: boolean): { vatTiyin: number; ratePercent: number } {
    const rate = this.vatRatePercent();
    if (!vatPayer || amountTiyin <= 0) return { vatTiyin: 0, ratePercent: rate };
    return { vatTiyin: Math.round(amountTiyin - amountTiyin / (1 + rate / 100)), ratePercent: rate };
  }

  /** НДС по организации: плательщик она или нет, решает её карточка */
  vatFor(organizationId: string, amountTiyin: number): { vatTiyin: number; ratePercent: number } {
    try {
      return this.vatInside(amountTiyin, this.crm.get(organizationId).vatPayer);
    } catch {
      return { vatTiyin: 0, ratePercent: this.vatRatePercent() };
    }
  }

  private vatFields(organizationId: string, amountTiyin: number): { vatTiyin: number; vatRatePercent: number } {
    const { vatTiyin, ratePercent } = this.vatFor(organizationId, amountTiyin);
    return { vatTiyin, vatRatePercent: ratePercent };
  }

  // ---------- Пени за просрочку (ТЗ 8.9, условие договора) ----------

  /**
   * Пени по просроченным счетам организации.
   *
   * Считаются, а не хранятся: сумма меняется каждый день сама по себе, и
   * хранимое значение устареет к утру. Проводкой пени становятся только тогда,
   * когда их решили предъявить, — до этого момента это расчёт, а не долг.
   *
   * Начисляются, лишь если условие включено в договоре: по умолчанию пени
   * выключены, и включать их за клиента платформа не вправе.
   */
  penaltyFor(organizationId: string): {
    enabled: boolean;
    amountTiyin: number;
    ratePercentPerDay: number;
    capPercent: number;
    graceDays: number;
    rows: Array<{ invoiceId: string; number: string; amountTiyin: number; overdueDays: number; penaltyTiyin: number; capped: boolean }>;
  } {
    const ratePercentPerDay = 0.1;
    const capPercent = 10;
    const graceDays = 5; // столько банковских дней даёт счёт на оплату
    let enabled = false;
    try {
      enabled = this.crm.get(organizationId).terms.penaltyEnabled;
    } catch {
      enabled = false;
    }
    const base = { enabled, ratePercentPerDay, capPercent, graceDays };
    if (!enabled) return { ...base, amountTiyin: 0, rows: [] };

    const rows = this.invoices
      .filter((i) => i.organizationId === organizationId && i.status === 'issued')
      .map((i) => {
        const days = Math.floor((Date.now() - new Date(i.issuedAt).getTime()) / 86_400_000) - graceDays;
        if (days <= 0) return null;
        const raw = Math.round((i.amountTiyin * ratePercentPerDay * days) / 100);
        const cap = Math.round((i.amountTiyin * capPercent) / 100);
        return {
          invoiceId: i.id,
          number: i.number,
          amountTiyin: i.amountTiyin,
          overdueDays: days,
          penaltyTiyin: Math.min(raw, cap),
          capped: raw > cap,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    return { ...base, amountTiyin: rows.reduce((s, r) => s + r.penaltyTiyin, 0), rows };
  }

  /**
   * Предъявить пени: отдельным счётом и по явному решению человека.
   *
   * Автоматически выставлять их нельзя — это всегда переговорный вопрос,
   * и счёт, появившийся сам, ссорит с клиентом надёжнее самой просрочки.
   */
  issuePenaltyInvoice(organizationId: string): InvoiceRec {
    const org = this.crm.get(organizationId);
    const penalty = this.penaltyFor(organizationId);
    if (!penalty.enabled) {
      throw new BadRequestException({ code: 'PENALTY_DISABLED', message: 'Пени не предусмотрены договором этой организации' });
    }
    if (penalty.amountTiyin <= 0) {
      throw new BadRequestException({ code: 'NOTHING_OVERDUE', message: 'Просроченных счетов нет' });
    }
    this.invoiceSeq += 1;
    const inv: InvoiceRec = {
      id: uuidv7(),
      number: `INV-${new Date().getFullYear()}-${String(this.invoiceSeq).padStart(5, '0')}`,
      organizationId,
      organizationName: org.name,
      kind: 'overlimit',
      amountTiyin: penalty.amountTiyin,
      status: 'issued',
      issuedAt: new Date().toISOString(),
      // Пени НДС не облагаются: это не реализация, а санкция
      vatTiyin: 0,
      vatRatePercent: this.vatRatePercent(),
    };
    this.invoices.push(inv);
    this.store.persist();
    this.post([
      {
        type: 'invoice.penalty',
        debit: 'ar',
        credit: 'revenue',
        amountTiyin: inv.amountTiyin,
        invoiceId: inv.id,
        comment: `СФ ${inv.number}: пени по ${penalty.rows.length} счетам`,
      },
    ]);
    return inv;
  }

  // ---------- СФ и дебиторка (A-16/A-18) ----------

  issueSubscriptionInvoice(organizationId: string, organizationName: string, amountTiyin: number): InvoiceRec {
    if (amountTiyin <= 0) throw new BadRequestException({ code: 'AMOUNT_NOT_POSITIVE' });
    this.invoiceSeq += 1;
    const inv: InvoiceRec = {
      id: uuidv7(),
      number: `INV-${new Date().getFullYear()}-${String(this.invoiceSeq).padStart(5, '0')}`,
      organizationId,
      organizationName,
      kind: 'subscription',
      amountTiyin,
      status: 'issued',
      issuedAt: new Date().toISOString(),
      ...this.vatFields(organizationId, amountTiyin),
    };
    this.invoices.push(inv);
    this.store.persist();
    this.post([
      { type: 'invoice.issued', debit: 'ar', credit: 'advances', amountTiyin, invoiceId: inv.id, comment: `СФ ${inv.number}: абонентка ${organizationName}` },
    ]);
    return inv;
  }

  /**
   * Счёт на материалы отдельной строкой.
   *
   * Условие договора `materialsSeparateInvoice` до сих пор нигде не работало:
   * галочка стояла, материалы всё равно уходили в общий счёт. Организациям это
   * нужно не из вредности — материалы у них проходят по другой статье расходов,
   * и сводить их с работами в одном документе значит ломать им учёт.
   */
  issueMaterialsInvoice(organizationId: string, organizationName: string, amountTiyin: number, orderNumber: string): InvoiceRec {
    if (amountTiyin <= 0) throw new BadRequestException({ code: 'AMOUNT_NOT_POSITIVE' });
    this.invoiceSeq += 1;
    const inv: InvoiceRec = {
      id: uuidv7(),
      number: `INV-${new Date().getFullYear()}-${String(this.invoiceSeq).padStart(5, '0')}`,
      organizationId,
      organizationName,
      kind: 'one_off_prepayment',
      amountTiyin,
      status: 'issued',
      issuedAt: new Date().toISOString(),
      ...this.vatFields(organizationId, amountTiyin),
    };
    this.invoices.push(inv);
    this.store.persist();
    this.post([
      {
        type: 'invoice.issued',
        debit: 'ar',
        credit: 'revenue',
        amountTiyin,
        invoiceId: inv.id,
        comment: `СФ ${inv.number}: материалы по ${orderNumber}`,
      },
    ]);
    return inv;
  }

  markInvoicePaid(invoiceId: string): InvoiceRec {
    const inv = this.invoices.find((i) => i.id === invoiceId);
    if (!inv) throw new NotFoundException({ code: 'INVOICE_NOT_FOUND' });
    if (inv.status === 'paid') throw new BadRequestException({ code: 'ALREADY_PAID' });
    inv.status = 'paid';
    inv.paidAt = new Date().toISOString();
    this.store.persist();
    this.post([
      { type: 'invoice.paid', debit: 'settlement', credit: 'ar', amountTiyin: inv.amountTiyin, invoiceId: inv.id, comment: `Оплата СФ ${inv.number}` },
    ]);
    return inv;
  }

  invoicesList(): InvoiceRec[] {
    return [...this.invoices].reverse();
  }

  /** Aging дебиторки 0–30/31–60/61–90/90+ (ТЗ 8.9) */
  receivablesAging() {
    const now = Date.now();
    const buckets = { d0_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
    const rows = this.invoices
      .filter((i) => i.status === 'issued')
      .map((i) => {
        const ageDays = Math.floor((now - new Date(i.issuedAt).getTime()) / 86_400_000);
        if (ageDays <= 30) buckets.d0_30 += i.amountTiyin;
        else if (ageDays <= 60) buckets.d31_60 += i.amountTiyin;
        else if (ageDays <= 90) buckets.d61_90 += i.amountTiyin;
        else buckets.d90_plus += i.amountTiyin;
        return { ...i, ageDays };
      });
    return { buckets, rows };
  }

  // ---------- Закрытие периода (A-19, ТЗ 8.8) ----------

  periods() {
    const months = [...new Set(this.txs.map((t) => t.createdAt.slice(0, 7)))].sort();
    return months.map((m) => ({
      month: m,
      closed: this.closedPeriods.has(m),
      txCount: this.txs.filter((t) => t.createdAt.startsWith(m)).length,
      revenueTiyin: this.txs.filter((t) => t.createdAt.startsWith(m) && t.credit === 'revenue' && !t.isStorno).reduce((s, t) => s + t.amountTiyin, 0),
    }));
  }

  /** Чек-лист закрытия: баланс-чекер зелёный; корректировки после — только текущим периодом */
  closePeriod(month: string): { month: string; closed: boolean; checklist: Record<string, boolean> } {
    const check = this.balanceCheck();
    const unpaidInvoices = this.invoices.filter((i) => i.status === 'issued' && i.issuedAt.startsWith(month)).length;
    const checklist = {
      balance_checker_ok: check.ok,
      invoices_issued: true,
      payouts_reviewed: true,
      no_unpaid_left: unpaidInvoices === 0, // информативно, не блокер (уходит в дебиторку)
    };
    if (!check.ok) throw new BadRequestException({ code: 'BALANCE_CHECK_FAILED', message: 'Баланс-чекер красный — закрытие запрещено (A-22 блокер)' });
    this.closedPeriods.add(month);
    this.store.persist();
    return { month, closed: true, checklist };
  }

  reopenPeriod(month: string): void {
    this.closedPeriods.delete(month);
    this.store.persist();
  }

  // ---------- Налоговые регистры (A-31, ТЗ 8.10) ----------

  taxRegisters(month?: string) {
    const inMonth = (iso: string) => !month || iso.startsWith(month);
    return {
      month: month ?? 'все периоды',
      invoicesRegister: this.invoices.filter((i) => inMonth(i.issuedAt)).map((i) => ({
        number: i.number, organization: i.organizationName, kind: i.kind, amountTiyin: i.amountTiyin,
        vatTiyin: Math.round((i.amountTiyin / 1.12) * 0.12), // НДС 12% изнутри; ставку подтверждает бухгалтер
        status: i.status, issuedAt: i.issuedAt,
      })),
      receiptsRegister: this.txs.filter((t) => t.type === 'order.revenue' && inMonth(t.createdAt) && !t.isStorno).map((t) => ({
        orderId: t.orderId, channel: t.debit, amountTiyin: t.amountTiyin, at: t.createdAt,
        note: t.debit === 'cash_masters' ? 'наличные — фискализация ОФД (заглушка, PRD-05 §12.6)' : 'онлайн',
      })),
      payoutsRegister: this.txs.filter((t) => t.type === 'payout' && inMonth(t.createdAt)).map((t) => ({
        masterId: t.masterId, amountTiyin: t.amountTiyin, at: t.createdAt,
        note: 'самозанятый — брутто; ГПХ — НДФЛ и соцналог удерживает компания (ТЗ 8.6)',
      })),
    };
  }

  // ---------- Стартовые остатки (A-32, ТЗ 17.6) ----------

  openingBalances(entries: Array<{ account: string; side: 'debit' | 'credit'; amountTiyin: number; comment?: string }>) {
    if (this.openingDone) throw new BadRequestException({ code: 'OPENING_ALREADY_DONE', message: 'Стартовые остатки уже внесены (идемпотентность A-32)' });
    const op = uuidv7();
    for (const e of entries) {
      this.post(
        [
          e.side === 'debit'
            ? { type: 'opening', debit: e.account, credit: 'opening', amountTiyin: e.amountTiyin, comment: e.comment ?? 'Стартовый остаток' }
            : { type: 'opening', debit: 'opening', credit: e.account, amountTiyin: e.amountTiyin, comment: e.comment ?? 'Стартовый остаток' },
        ],
        op,
      );
    }
    this.openingDone = true;
    this.store.persist();
    return { operationId: op, entries: entries.length, balanceCheck: this.balanceCheck() };
  }

  // ---------- Клиринг провайдеров (A-21, ТЗ 8.8) ----------

  clearingState() {
    const balance = this.accounts().find((a) => a.code === 'clearing')?.balanceTiyin ?? 0;
    return {
      pendingTiyin: balance,
      register: this.txs.filter((t) => t.debit === 'clearing' && !t.isStorno).map((t) => ({ orderId: t.orderId, amountTiyin: t.amountTiyin, at: t.createdAt })),
    };
  }

  /** Реестр T+1/T+2: провайдер перечисляет минус комиссия; комиссия — отдельной проводкой расхода (ТЗ 8.1) */
  settleClearing(commissionPermille: number) {
    const pending = this.clearingState().pendingTiyin;
    if (pending <= 0) throw new BadRequestException({ code: 'NOTHING_TO_SETTLE' });
    const fee = Math.floor((pending * commissionPermille) / 1000);
    const op = uuidv7();
    this.post(
      [
        { type: 'clearing.settle', debit: 'settlement', credit: 'clearing', amountTiyin: pending - fee, comment: `Клиринг: зачисление минус комиссия` },
        { type: 'clearing.fee', debit: 'provider_fees', credit: 'clearing', amountTiyin: fee, comment: `Комиссия провайдера ${(commissionPermille / 10).toFixed(1)}%` },
      ],
      op,
    );
    return { settledTiyin: pending - fee, feeTiyin: fee, operationId: op };
  }

  // ---------- Баланс-чекер (A-22, ТЗ 8.8) ----------

  balanceCheck() {
    const totalDebit = this.txs.reduce((s, t) => s + t.amountTiyin, 0);
    const totalCredit = totalDebit; // двойная запись по построению: одна проводка = Дт и Кт
    const assets = ACCOUNTS.filter((a) => a.kind === 'asset').reduce((s, a) => s + this.balance(a.code), 0);
    const liabilities = ACCOUNTS.filter((a) => a.kind === 'liability').reduce((s, a) => s + this.balance(a.code), 0);
    const income = ACCOUNTS.filter((a) => a.kind === 'income').reduce((s, a) => s + this.balance(a.code), 0);
    const expense = ACCOUNTS.filter((a) => a.kind === 'expense').reduce((s, a) => s + this.balance(a.code), 0);
    const discrepancyTiyin = assets + expense - liabilities - income; // балансовое уравнение
    return {
      ok: discrepancyTiyin === 0,
      discrepancyTiyin,
      totalDebitTiyin: totalDebit,
      totalCreditTiyin: totalCredit,
      txCount: this.txs.length,
      checkedAt: new Date().toISOString(),
    };
  }
}
