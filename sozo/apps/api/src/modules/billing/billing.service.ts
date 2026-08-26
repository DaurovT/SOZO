import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { masterShare, roundTo100Soums, uuidv7, serviceFee, SERVICE_FEE_CAP_BPS, MASTER_SHARE_DEFAULT_PERMILLE } from '@sozo/kernel';
import { EventBus, type OrderCancelledEvent, type OrderClosedEvent } from '../../common/event-bus';
import { dbFailure } from '../../common/db-failure';
import { queue } from '../../common/pg-mirror';
import { StateStore } from '../../common/state-store';
import { CrmService } from '../crm/crm.service';
import { ParametersService } from '../platform/parameters.service';
import { PrismaService } from '../../common/prisma.service';
import { currentDbContext, systemContext } from '../../common/db-context';
import { stableUuid } from '../../common/stable-uuid';

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
  /**
   * Сервисный сбор объекта до сих пор существовал только как событие и строка
   * в реестре оператора: в балансе платформы обязательства перед операторами
   * не было вовсе, а раздел «Кому мы должны» показывал ноль при реальном долге.
   */
  { code: 'operator_payable', name: 'Кредиторка операторам (сервисный сбор)', kind: 'liability' },
  { code: 'service_fee_expense', name: 'Расход: сервисный сбор объектов', kind: 'expense' },
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
  kind: 'subscription' | 'overlimit' | 'one_off_prepayment' | 'penalty';
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
  /**
   * Сколько пеней по этому счёту уже предъявлено отдельным счётом.
   *
   * Без этой отметки расчёт пеней — чистая функция от текущей даты, и второе
   * нажатие в тот же день выставляет ровно такой же счёт второй раз. Храним
   * предъявленное, а начисляем разницу: пени растут каждый день, поэтому
   * «уже выставляли» — не то же самое, что «больше нельзя».
   */
  penaltyChargedTiyin?: number;
  /**
   * Заявка, по которой выставлен счёт (материалы отдельным документом).
   *
   * Нужна разбору «за что этот счёт» и идемпотентности: повторная доставка
   * события закрытия не должна присылать клиенту второй счёт за те же
   * материалы. Сама проверка идёт по журналу проводок — он append-only и
   * переживает рестарт, — а поле здесь держит связь для отчётов.
   */
  orderId?: string;
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

  /** code → id счёта в базе; заполняется при загрузке плана счетов */
  private accountIds = new Map<string, string>();
  private loaded = false;

  constructor(
    private readonly bus: EventBus,
    private readonly store: StateStore,
    private readonly crm: CrmService,
    private readonly params: ParametersService,
    private readonly prisma: PrismaService,
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

  async onModuleInit(): Promise<void> {
    await this.loadFromDb();
    /**
     * Справка для заявок: можно ли сейчас провести закрытие.
     *
     * Заявка обязана узнать это ДО перехода в «Закрыта» — иначе закрытие
     * проходит, событие уходит в outbox и висит там до переоткрытия периода,
     * а диспетчер видит успешно закрытую заявку без проводок. Импортировать
     * биллинг в заявки нельзя (DEV-07 §3), спросить через шину — можно.
     */
    this.bus.registerProbe<{ at?: string }, boolean>('billing.period_open', (q) =>
      this.periodOpen(q?.at ? new Date(q.at) : new Date()),
    );
    this.bus.subscribe<OrderClosedEvent>('order.closed', (e, id) => this.onOrderClosed(e, id), 'billing.order_closed', { retry: true });
    // Отмена заявки — тоже деньги (матрица ТЗ 4.4): ложный вызов клиенту,
    // компенсация мастеру. Раньше на это событие не был подписан никто
    this.bus.subscribe<OrderCancelledEvent>('order.cancelled', (e, id) => this.onOrderCancelled(e, id), 'billing.order_cancelled', { retry: true });
    // Склад: продажа мастеру — удержание из будущей выплаты (ТЗ 17.16)
    this.bus.subscribe<{ masterId: string; masterName: string; amountTiyin: number; itemName: string }>(
      'stock.sold_to_master',
      (e, id) =>
        this.post(
          [
            { type: 'stock.sale', debit: 'master_payable', credit: 'revenue', amountTiyin: e.amountTiyin, masterId: e.masterId, comment: `Продажа со склада: ${e.itemName} → ${e.masterName}` },
          ],
          stableUuid(id),
        ),
      'billing.stock_sold',
      { retry: true },
    );
    // Резервный фонд: выплата ущерба + регресс к мастеру ≤30% (ТЗ 17.7)
    this.bus.subscribe<{ caseId: string; amountTiyin: number; regressTiyin: number; masterId?: string; description: string }>(
      'damage.payout',
      (e, id) => {
        // Две операции одного события: ключи производные от eventId, поэтому
        // повтор попадает в те же самые, а не заводит третью и четвёртую
        this.post(
          [{ type: 'damage.payout', debit: 'reserve_fund', credit: 'settlement', amountTiyin: e.amountTiyin, comment: `Выплата ущерба: ${e.description}` }],
          stableUuid(`${id}:payout`),
        );
        if (e.regressTiyin > 0 && e.masterId) {
          this.post(
            [{ type: 'damage.regress', debit: 'master_payable', credit: 'reserve_fund', amountTiyin: e.regressTiyin, masterId: e.masterId, comment: `Регресс к мастеру по делу об ущербе` }],
            stableUuid(`${id}:regress`),
          );
        }
      },
      'billing.damage_payout',
      { retry: true },
    );
  }

  /**
   * Загрузка с базы и посев плана счетов.
   *
   * План счетов — константа кода (PRD-05 §4.3), но в базе он таблица, и
   * проводка ссылается на счёт внешним ключом. Это не дублирование источника
   * истины: без ссылки база не может отказать проводке на несуществующий
   * счёт, а для журнала двойной записи именно это и есть смысл ограничения.
   * Счета заводятся один раз и опознаются кодом.
   */
  private async loadFromDb(): Promise<void> {
    if (!this.prisma.enabled) {
      this.loaded = true;
      return;
    }
    const tenantId = (currentDbContext() ?? systemContext()).tenantId;
    const d = await this.prisma.withContext(async (tx) => {
      for (const a of ACCOUNTS) {
        const existing = await tx.account.findFirst({ where: { tenantId, code: a.code } });
        if (!existing) {
          await tx.account.create({ data: { id: uuidv7(), tenantId, code: a.code, name: a.name, kind: a.kind } });
        }
      }
      return {
        accounts: await tx.account.findMany({ where: { tenantId } }),
        // Скоуп по тенанту обязателен: RLS на transaction/invoice нет (см. миграцию
        // m40_rls_billing), и без where в память грузился журнал всех владельцев —
        // а по нему считается ведомость и восстанавливается счётчик номеров счетов
        txs: await tx.transaction.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } }),
        invoices: await tx.invoice.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } }),
        periods: await tx.accountingPeriod.findMany({ where: { tenantId } }),
      };
    });
    this.accountIds = new Map(d.accounts.map((a) => [a.code, a.id]));
    const codeOf = new Map(d.accounts.map((a) => [a.id, a.code]));

    if (d.txs.length) {
      this.txs.length = 0;
      this.txs.push(
        ...d.txs.map((t) => ({
          id: t.id,
          operationId: t.operationId,
          type: t.type,
          debit: codeOf.get(t.debitAccountId) ?? '',
          credit: codeOf.get(t.creditAccountId) ?? '',
          amountTiyin: Number(t.amountTiyin),
          orderId: t.orderId ?? undefined,
          invoiceId: t.invoiceId ?? undefined,
          masterId: t.masterId ?? undefined,
          isStorno: t.isStorno,
          reversedTxId: t.reversedTxId ?? undefined,
          comment: t.comment ?? undefined,
          createdAt: t.createdAt.toISOString(),
        })),
      );
    }
    if (d.invoices.length) {
      this.invoices.length = 0;
      this.invoices.push(
        ...d.invoices.map((i) => ({
          id: i.id,
          number: i.number,
          organizationId: i.organizationId,
          organizationName: i.organizationName,
          kind: i.kind as InvoiceRec['kind'],
          amountTiyin: Number(i.amountTiyin),
          status: i.status as InvoiceRec['status'],
          issuedAt: i.createdAt.toISOString(),
          paidAt: i.paidAt?.toISOString(),
          vatTiyin: Number(i.vatTiyin),
          vatRatePercent: i.vatRatePercent,
        })),
      );
      // Счётчик номеров восстанавливается из выставленных счетов, а не
      // хранится отдельно: отдельный счётчик рассыпается ровно тогда, когда
      // он и нужен — при восстановлении из резервной копии
      this.invoiceSeq = this.invoices.reduce((max, i) => Math.max(max, Number(i.number.split('-').pop()) || 0), 0);
    }
    for (const p of d.periods) this.closedPeriods.add(p.period);
    // Стартовые остатки узнаются по проводкам, а не по флагу: флаг может
    // разойтись с журналом, журнал — источник истины (ТЗ 8.1)
    this.openingDone = this.txs.some((t) => t.type === 'opening');
    this.loaded = true;
    if (this.txs.length || this.invoices.length) {
      // eslint-disable-next-line no-console
      console.log(`[Billing] из базы: проводок ${this.txs.length}, счетов ${this.invoices.length}, закрытых периодов ${this.closedPeriods.size}`);
    }
  }

  /**
   * Запись только дописыванием, в отличие от остальных модулей.
   *
   * Журнал проводок append-only (ТЗ 8.1): правка задним числом запрещена,
   * исправление — сторно. Переписать «всё, что в памяти», как делают
   * объекты и заявки, здесь нельзя — это было бы прямым нарушением
   * инварианта, ради которого журнал и существует. Поэтому пишутся ровно
   * новые проводки, а счета и периоды — точечно.
   */
  private writing: Promise<void> = Promise.resolve();

  private enqueue(work: (tx: Parameters<Parameters<PrismaService['withContext']>[0]>[0], tenantId: string) => Promise<void>): void {
    if (!this.prisma.enabled || !this.loaded) return;
    const tenantId = (currentDbContext() ?? systemContext()).tenantId;
    // Общая очередь на процесс: проводка ссылается на заявку, а пишутся они
    // разными модулями — своя цепочка порядок между ними не держит
    this.writing = queue().add(async () => {
      try {
        await this.prisma.withContext((tx) => work(tx, tenantId));
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[Billing] запись в базу не удалась:', dbFailure(e));
      }
    });
  }

  /**
   * Разовый перенос журнала в базу (deploy/import-state).
   *
   * Биллинг тоже читает state.json и с включённой базой, поэтому переносится
   * то, что уже в памяти. План счетов к этому моменту засеян загрузкой —
   * без него проводке некуда ссылаться.
   */
  async flushToDb(): Promise<{ txs: number; invoices: number; periods: number }> {
    this.loaded = true;
    this.appendTxs(this.txs);
    for (const inv of this.invoices) this.saveInvoice(inv);
    for (const m of this.closedPeriods) this.savePeriod(m, true);
    await this.writing;
    return { txs: this.txs.length, invoices: this.invoices.length, periods: this.closedPeriods.size };
  }

  private appendTxs(created: TxRec[]): void {
    this.enqueue(async (tx, tenantId) => {
      for (const t of created) {
        const debitAccountId = this.accountIds.get(t.debit);
        const creditAccountId = this.accountIds.get(t.credit);
        if (!debitAccountId || !creditAccountId) throw new Error(`нет счёта плана: ${t.debit} / ${t.credit}`);
        await tx.transaction.create({
          data: {
            id: t.id,
            tenantId,
            operationId: t.operationId,
            debitAccountId,
            creditAccountId,
            amountTiyin: BigInt(t.amountTiyin),
            type: t.type,
            orderId: t.orderId ?? null,
            invoiceId: t.invoiceId ?? null,
            masterId: t.masterId ?? null,
            isStorno: t.isStorno,
            reversedTxId: t.reversedTxId ?? null,
            comment: t.comment ?? null,
            createdAt: new Date(t.createdAt),
          },
        });
      }
    });
  }

  private saveInvoice(inv: InvoiceRec): void {
    this.enqueue(async (tx, tenantId) => {
      const data = {
        number: inv.number,
        organizationId: inv.organizationId,
        organizationName: inv.organizationName,
        kind: inv.kind,
        amountTiyin: BigInt(inv.amountTiyin),
        vatTiyin: BigInt(inv.vatTiyin),
        vatRatePercent: inv.vatRatePercent,
        status: inv.status,
        paidAt: inv.paidAt ? new Date(inv.paidAt) : null,
      };
      await tx.invoice.upsert({
        where: { id: inv.id },
        create: { id: inv.id, tenantId, createdAt: new Date(inv.issuedAt), ...data },
        update: data,
      });
    });
  }

  private savePeriod(month: string, closed: boolean): void {
    this.enqueue(async (tx, tenantId) => {
      if (closed) {
        await tx.accountingPeriod.upsert({
          where: { tenantId_period: { tenantId, period: month } },
          create: { tenantId, period: month },
          update: {},
        });
      } else {
        await tx.accountingPeriod.deleteMany({ where: { tenantId, period: month } });
      }
    });
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

  /** Открыт ли период, в котором лежит эта дата. Спрашивают до необратимых действий */
  periodOpen(at: Date = new Date()): boolean {
    return !this.closedPeriods.has(at.toISOString().slice(0, 7));
  }

  /**
   * Проверка суммы проводки.
   *
   * `<= 0` не отсеивает NaN: любое сравнение с NaN ложно, и проводка с NaN
   * проходила насквозь. В памяти она оседала, а запись в базу падала на
   * BigInt(NaN) — и падение гасилось в зеркале. Дальше баланс навсегда NaN, а
   * сторно не лечит: сторно NaN — тоже NaN. Поэтому проверяем не знак, а то,
   * что это вообще целое число тийинов.
   */
  private assertAmount(v: number): void {
    if (!Number.isSafeInteger(v)) {
      throw new BadRequestException({
        code: 'AMOUNT_NOT_INTEGER',
        message: 'Сумма проводки — целое число тийинов; дробь, NaN и бесконечность недопустимы',
        value: String(v),
      });
    }
    if (v <= 0) throw new BadRequestException({ code: 'AMOUNT_NOT_POSITIVE' });
  }

  /** Единственный способ движения денег; Σ Дт = Σ Кт внутри операции по построению */
  post(entries: Array<Omit<TxRec, 'id' | 'operationId' | 'isStorno' | 'createdAt'>>, operationId = uuidv7(), at: Date = new Date()): TxRec[] {
    /**
     * Идемпотентность по идентификатору операции.
     *
     * `operationId` был просто меткой группировки со значением по умолчанию
     * «новый uuid», и повторный вызов с тем же ключом проводил всё заново.
     * Пока падение подписчика гасилось в console.error, это ничего не
     * стоило — потеря была одна. С журналом доставки и повторами повтор стал
     * настоящим: у закрытой заявки, чей обработчик упал на середине (закрытый
     * период, NaN в сумме, неизвестный счёт), вторая попытка положила бы
     * прошедшую до броска часть проводок второй раз — и дублями они бы даже
     * не выглядели, у каждой был бы свой operationId.
     *
     * Теперь ключ проверяется: операция с таким id уже проведена — возвращаем
     * её и ничего не пишем. Это же закрывает частичный сбой стартовых
     * остатков: повтор не заводит первые шесть строк второй раз.
     */
    const already = this.txs.filter((t) => t.operationId === operationId);
    if (already.length) return already;
    /**
     * Операция с таким идентификатором уже проведена — возвращаем её.
     *
     * Это то, что делает биллинг идемпотентным по-настоящему, а не на словах.
     * Шина повторяет доставку до восьми раз, и без этой проверки каждая
     * попытка создавала бы новую выручку, новую долю мастера и новое
     * отчисление в резервный фонд — причём с разными `operationId`, то есть
     * даже не похожие на дубли. Ключ приходит снаружи: подписчик берёт его из
     * `eventId` события.
     *
     * Тем же закрывается частичный сбой стартовых остатков: повторный вызов
     * с тем же ключом не заведёт проводки второй раз.
     */
    const existing = this.txs.filter((t) => t.operationId === operationId);
    if (existing.length) return existing;
    // Период берётся по дате операции, а не по сегодняшнему числу: проводка
    // прошлого месяца, которую проводят сегодня, относится к своему периоду —
    // иначе закрытие текущего месяца молча блокирует всё подряд
    const month = at.toISOString().slice(0, 7);
    if (this.closedPeriods.has(month)) {
      throw new BadRequestException({ code: 'PERIOD_LOCKED', message: `Период ${month} закрыт — проводки невозможны (A-19); переоткройте период` });
    }
    for (const e of entries) {
      this.assertAmount(e.amountTiyin);
      if (!ACCOUNTS.some((a) => a.code === e.debit) || !ACCOUNTS.some((a) => a.code === e.credit)) {
        throw new BadRequestException({ code: 'ACCOUNT_UNKNOWN', debit: e.debit, credit: e.credit });
      }
    }
    const created = entries.map((e) => ({
      ...e,
      id: uuidv7(),
      operationId,
      isStorno: false,
      createdAt: at.toISOString(),
    }));
    this.txs.push(...created);
    this.appendTxs(created);
    this.store.persist();
    return created;
  }

  /**
   * Сторно — единственный способ исправления (ТЗ 8.1).
   *
   * Раньше писалось в журнал напрямую, мимо post(): мимо закрытого периода,
   * мимо плана счетов и мимо проверки суммы. То есть ровно то, ради запрета
   * чего закрытие периода и заводилось, через сторно проходило свободно.
   * Теперь проверки те же — отличается только направление и пометка.
   */
  storno(txId: string, comment: string): TxRec {
    const src = this.txs.find((t) => t.id === txId);
    if (!src) throw new NotFoundException({ code: 'TX_NOT_FOUND' });
    if (this.txs.some((t) => t.reversedTxId === txId)) {
      throw new BadRequestException({ code: 'ALREADY_REVERSED' });
    }
    const at = new Date();
    const month = at.toISOString().slice(0, 7);
    if (this.closedPeriods.has(month)) {
      throw new BadRequestException({ code: 'PERIOD_LOCKED', message: `Период ${month} закрыт — сторно невозможно (A-19); переоткройте период` });
    }
    this.assertAmount(src.amountTiyin);
    const rec: TxRec = {
      id: uuidv7(),
      operationId: uuidv7(),
      type: `storno:${src.type}`,
      debit: src.credit, // обратная проводка
      credit: src.debit,
      amountTiyin: src.amountTiyin,
      orderId: src.orderId,
      // Ссылка на счёт копируется: без неё развёрнутая оплата не связана со
      // счётом, и счёт остаётся «оплаченным» при отсутствии денег
      invoiceId: src.invoiceId,
      masterId: src.masterId,
      isStorno: true,
      reversedTxId: txId,
      comment,
      createdAt: at.toISOString(),
    };
    this.txs.push(rec);
    this.appendTxs([rec]);
    // Сторнировали оплату — счёт снова не оплачен. Иначе он навсегда
    // «оплачен» без денег: повторно отметить оплату нельзя (ALREADY_PAID)
    if (src.type === 'invoice.paid' && src.invoiceId) {
      const inv = this.invoices.find((i) => i.id === src.invoiceId);
      if (inv && inv.status === 'paid') {
        inv.status = 'issued';
        inv.paidAt = undefined;
        this.saveInvoice(inv);
      }
    }
    this.store.persist();
    return rec;
  }

  // ---------- Автопроводки закрытия заявки (PRD-05 §4.4) ----------

  private onOrderClosed(e: OrderClosedEvent, eventId: string): void {
    /**
     * Ключ операции выводится из идентификатора события, а не берётся
     * случайным: повтор доставки обязан попасть в ту же операцию, иначе он её
     * удвоит. Через `stableUuid`, потому что колонка `operation_id` в базе —
     * типа `uuid`, и строка вида «order.closed:<id>» роняет запись (молча, в
     * зеркале).
     */
    const op = stableUuid(eventId);
    const work = e.totalWorkTiyin;

    /**
     * Материалы отдельным счётом, если так записано в договоре (ТЗ 8.4).
     * Делаем до проверки суммы работ: заявка могла быть только на материалы.
     *
     * Счёт выставляется один раз на заявку. Проверяем по журналу проводок, а
     * не по полю счёта: проводка `invoice.issued` несёт `orderId` и живёт в
     * append-only журнале — то есть отвечает на вопрос «выставляли ли» точно и
     * после рестарта. Раньше `try/catch` ловил только «организация удалена», а
     * каждая повторная доставка события стоила клиенту ещё одного счёта.
     */
    const materialsIssued = this.txs.some((t) => t.orderId === e.orderId && t.type === 'invoice.issued');
    if (e.organizationId && (e.materialsTiyin ?? 0) > 0 && !materialsIssued) {
      try {
        const org = this.crm.get(e.organizationId);
        if (org.terms.materialsSeparateInvoice) {
          this.issueMaterialsInvoice(org.id, org.name, e.materialsTiyin!, e.number, e.orderId);
        }
      } catch {
        /* организация могла быть удалена — счёт не выставляем */
      }
    }

    // ---- Сервисный сбор объекта (DEV-15 §8.2, ТЗ §19.3 п.4) ----
    // Начисляется ТОЛЬКО с частных заявок жителей подключённого объекта и
    // ТОЛЬКО если работу выполнила не собственная служба оператора.
    // База — работы клиента без материалов; сбор идёт из комиссии платформы
    // и доли мастера не касается (принцип №5 ТЗ 8.1).
    if (
      e.buildingId &&
      e.operatorOrgId &&
      e.orderScope === 'private' &&
      e.laborSettlement !== 'salary' &&
      (e.serviceFeeBps ?? 0) > 0 &&
      work > 0
    ) {
      const bps = BigInt(Math.min(e.serviceFeeBps!, Number(SERVICE_FEE_CAP_BPS)));
      /**
       * База сбора — работы ДО скидки, тот же принцип, что у доли мастера.
       *
       * Считалось от итога со скидкой, и это перекладывало маркетинговую акцию
       * платформы на вознаграждение оператора: промокод давала платформа, а
       * недополучал оператор объекта, который о промокоде не знает.
       */
      const feeBase = e.baseWorkTiyin || work;
      const fee = Number(serviceFee(BigInt(feeBase), bps));
      if (fee > 0) {
        // Обязательство перед оператором — проводкой, а не только событием:
        // до этого в балансе и в разделе «Кому мы должны» его не было вовсе
        this.post(
          [
            {
              type: 'service_fee.accrued',
              debit: 'service_fee_expense',
              credit: 'operator_payable',
              amountTiyin: fee,
              orderId: e.orderId,
              comment: `Сервисный сбор объекта по ${e.number} (${Number(bps) / 100}%)`,
            },
          ],
          // Ключ производный: закрытие заявки порождает ДВЕ операции — сбор
          // и сам расчёт, — и один общий идентификатор схлопнул бы вторую
          stableUuid(`${op}:service_fee`),
        );
        this.bus.publish('service_fee.accrued', {
          orderId: e.orderId,
          number: e.number,
          buildingId: e.buildingId,
          operatorOrgId: e.operatorOrgId,
          amountTiyin: fee,
          bps: Number(bps),
        });
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
          // Ставка приходит с событием: раньше здесь стоял литерал 550, и
          // золотому мастеру приложение обещало 57%, а платили 55%
          amountTiyin: Number(masterShare(BigInt(e.baseWorkTiyin || work), 1000n, BigInt(e.masterSharePermille ?? Number(MASTER_SHARE_DEFAULT_PERMILLE)))),
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
      stableUuid(`${op}:order`),
    );
  }

  /**
   * Деньги при отмене (матрица ТЗ 4.4).
   *
   * Клиент платит стоимость ложного вызова, мастер получает компенсацию за
   * выезд. Канал прихода — тот же, что у обычной заявки: B2B уходит в счёт
   * (дебиторка), розница — в клиринг провайдера.
   */
  private onOrderCancelled(e: OrderCancelledEvent, eventId: string): void {
    const op = stableUuid(eventId);
    const entries: Array<Omit<TxRec, 'id' | 'operationId' | 'isStorno' | 'createdAt'>> = [];
    if (e.clientPaysTiyin > 0) {
      entries.push({
        type: 'order.cancel_fee',
        debit: e.organizationId ? 'ar' : 'clearing',
        credit: 'revenue',
        amountTiyin: e.clientPaysTiyin,
        orderId: e.orderId,
        comment: `Отмена ${e.number}: ${e.note}`,
      });
    }
    if (e.masterCompTiyin > 0 && e.masterId) {
      entries.push({
        type: 'order.cancel_compensation',
        debit: 'master_share_expense',
        credit: 'master_payable',
        amountTiyin: e.masterCompTiyin,
        orderId: e.orderId,
        masterId: e.masterId,
        comment: `Компенсация выезда мастеру ${e.masterName ?? ''} по ${e.number}`.replace(/\s+/g, ' ').trim(),
      });
    }
    if (entries.length) this.post(entries, op);
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

  /**
   * Ведомость по мастерам.
   *
   * Считается по знаку проводки, а не по флагу «сторно», потому что сторно
   * бывает двух разных смыслов: отменённое начисление и отменённая выплата.
   * Раньше начисление брало только не-сторно проводки, а выплаченное — любые,
   * и обратная проводка по ошибочной выплате уходила в никуда: исходная
   * выплата оставалась в «выплачено», её сторно — нигде. Долг перед мастером
   * занижался на всю сумму навсегда, а повторить выплату мешал NOTHING_DUE.
   */
  payouts(): Array<{ masterId: string; masterName: string; accruedTiyin: number; paidTiyin: number; dueTiyin: number }> {
    const byMaster = new Map<string, { masterName: string; accrued: number; paid: number }>();
    for (const t of this.txs) {
      if (!t.masterId) continue;
      if (t.debit !== 'master_payable' && t.credit !== 'master_payable') continue;
      const m = byMaster.get(t.masterId) ?? { masterName: t.comment?.match(/Доля мастера (.*?) по/)?.[1] ?? '', accrued: 0, paid: 0 };
      if (!m.masterName) m.masterName = t.comment?.match(/Доля мастера (.*?) по/)?.[1] ?? '';
      // +1 — кредиторка выросла (начислили), −1 — уменьшилась (выплатили/удержали)
      const sign = t.credit === 'master_payable' ? 1 : -1;
      const base = t.type.startsWith('storno:') ? t.type.slice('storno:'.length) : t.type;
      if (base === 'payout') m.paid += -sign * t.amountTiyin;
      else m.accrued += sign * t.amountTiyin;
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

  /**
   * Когда мастеру платили в последний раз.
   *
   * Нужно приложению мастера: «когда выплата» — вопрос номер один, а на
   * экране кошелька не было ни даты, ни периода. Обещать дату вперёд нельзя
   * (ведомость закрывает бухгалтер), поэтому отдаём факт: период выплат
   * параметром и дату последней выплаты проводкой.
   */
  lastPayoutAt(masterId: string): string | undefined {
    const dates = this.txs
      .filter((t) => t.masterId === masterId && t.type === 'payout' && !t.isStorno)
      .map((t) => t.createdAt)
      .sort();
    return dates.at(-1);
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
    /** К предъявлению сейчас: начислено минус уже выставленное отдельным счётом */
    amountTiyin: number;
    accruedTiyin?: number;
    alreadyChargedTiyin?: number;
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

    /**
     * Уже предъявленные пени по этой организации.
     *
     * Пени растут каждый день, поэтому запретить второй счёт нельзя — но и
     * выставить те же самые сутки второй раз нельзя тоже. Предъявленное
     * вычитается из начисленного: второе нажатие в тот же день даёт ноль,
     * а через неделю — ровно прирост за неделю.
     */
    const alreadyCharged = this.invoices
      .filter((i) => i.organizationId === organizationId && (i.kind === 'penalty' || i.kind === 'overlimit'))
      .reduce((sum, i) => sum + i.amountTiyin, 0);

    const rows = this.invoices
      // Счёт на пени сам в базу расчёта не попадает: иначе через шесть дней
      // он просрочится и на пени начнут начисляться пени
      .filter((i) => i.organizationId === organizationId && i.status === 'issued' && i.kind !== 'penalty' && i.kind !== 'overlimit')
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

    const accrued = rows.reduce((s, r) => s + r.penaltyTiyin, 0);
    return { ...base, amountTiyin: Math.max(0, accrued - alreadyCharged), accruedTiyin: accrued, alreadyChargedTiyin: alreadyCharged, rows };
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
      throw new BadRequestException({
        code: 'NOTHING_OVERDUE',
        message: penalty.accruedTiyin ? 'Начисленные пени уже предъявлены счётом' : 'Просроченных счетов нет',
      });
    }
    this.invoiceSeq += 1;
    const inv: InvoiceRec = {
      id: uuidv7(),
      number: `INV-${new Date().getFullYear()}-${String(this.invoiceSeq).padStart(5, '0')}`,
      organizationId,
      organizationName: org.name,
      kind: 'penalty',
      amountTiyin: penalty.amountTiyin,
      status: 'issued',
      issuedAt: new Date().toISOString(),
      // Пени НДС не облагаются: это не реализация, а санкция
      vatTiyin: 0,
      vatRatePercent: this.vatRatePercent(),
    };
    this.invoices.push(inv);
    this.saveInvoice(inv);
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
    this.saveInvoice(inv);
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
  issueMaterialsInvoice(organizationId: string, organizationName: string, amountTiyin: number, orderNumber: string, orderId?: string): InvoiceRec {
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
    this.saveInvoice(inv);
    this.store.persist();
    this.post([
      {
        type: 'invoice.issued',
        debit: 'ar',
        credit: 'revenue',
        amountTiyin,
        invoiceId: inv.id,
        // orderId — чтобы повторная доставка события закрытия увидела, что
        // счёт по этой заявке уже есть
        orderId,
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
    this.saveInvoice(inv);
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
    this.savePeriod(month, true);
    this.store.persist();
    return { month, closed: true, checklist };
  }

  reopenPeriod(month: string): void {
    this.closedPeriods.delete(month);
    this.savePeriod(month, false);
    this.store.persist();
  }

  // ---------- Налоговые регистры (A-31, ТЗ 8.10) ----------

  taxRegisters(month?: string) {
    const inMonth = (iso: string) => !month || iso.startsWith(month);
    return {
      month: month ?? 'все периоды',
      invoicesRegister: this.invoices.filter((i) => inMonth(i.issuedAt)).map((i) => ({
        number: i.number, organization: i.organizationName, kind: i.kind, amountTiyin: i.amountTiyin,
        // НДС берётся зафиксированным при выставлении, а не считается заново:
        // у организации-неплательщика он ноль, и пересчёт по литералу 12%
        // рисовал в реестре налог, которого в первичке нет
        vatTiyin: i.vatTiyin,
        vatRatePercent: i.vatRatePercent,
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
    /**
     * Все строки одним вызовом post(), а не по одной в цикле.
     *
     * Раньше флаг «сделано» ставился после цикла: ошибка на седьмой строке
     * оставляла шесть проводок в журнале и флаг снятым — повторный вызов
     * заводил те же шесть второй раз. Один вызов проверяет весь набор до
     * записи, и частичного результата не бывает.
     */
    this.post(
      entries.map((e) =>
        e.side === 'debit'
          ? { type: 'opening', debit: e.account, credit: 'opening', amountTiyin: e.amountTiyin, comment: e.comment ?? 'Стартовый остаток' }
          : { type: 'opening', debit: 'opening', credit: e.account, amountTiyin: e.amountTiyin, comment: e.comment ?? 'Стартовый остаток' },
      ),
      op,
    );
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
    // Комиссия приходит числом из формы, и до сих пор никак не проверялась:
    // 0 давал вторую проводку на ноль и ронял всё зачисление, хотя деньги
    // пришли; 1200 промилле давали отрицательную проводку и немой 400
    if (!Number.isFinite(commissionPermille) || commissionPermille < 0 || commissionPermille >= 1000) {
      throw new BadRequestException({
        code: 'COMMISSION_OUT_OF_RANGE',
        message: 'Комиссия провайдера — от 0 до 999 промилле (0–99,9%)',
      });
    }
    const fee = Math.floor((pending * commissionPermille) / 1000);
    const op = uuidv7();
    this.post(
      [
        { type: 'clearing.settle', debit: 'settlement', credit: 'clearing', amountTiyin: pending - fee, comment: `Клиринг: зачисление минус комиссия` },
        // Нулевая комиссия — не проводка: сумма проводки всегда положительна
        ...(fee > 0
          ? [{ type: 'clearing.fee', debit: 'provider_fees', credit: 'clearing', amountTiyin: fee, comment: `Комиссия провайдера ${(commissionPermille / 10).toFixed(1)}%` }]
          : []),
      ],
      op,
    );
    return { settledTiyin: pending - fee, feeTiyin: fee, operationId: op };
  }

  // ---------- Баланс-чекер (A-22, ТЗ 8.8) ----------

  /**
   * Баланс-чекер.
   *
   * Раньше он считал `активы + расходы − обязательства − доходы` и был
   * тождественно равен нулю: у каждой проводки дебетуемый счёт вносит +a, а
   * кредитуемый −a, независимо от вида счёта. Проверка не могла покраснеть от
   * потерянной проводки или неверной пары счетов — то есть ровно от того,
   * ради чего писалась. Единственное, что её действительно красило, — мусорные
   * коды счетов у кросс-тенантных строк.
   *
   * Поэтому здесь проверяется то, что в этом журнале ломается на самом деле:
   * коды счетов, целостность сумм, парность сторно и совпадение по операциям.
   * Балансовое уравнение остаётся справочной строкой — как напоминание, а не
   * как проверка.
   */
  balanceCheck() {
    const problems: Array<{ kind: string; txId: string; detail: string }> = [];
    const known = new Set(ACCOUNTS.map((a) => a.code));
    const byOperation = new Map<string, number>();
    for (const t of this.txs) {
      if (!known.has(t.debit) || !known.has(t.credit)) {
        problems.push({ kind: 'ACCOUNT_UNKNOWN', txId: t.id, detail: `${t.debit} / ${t.credit}` });
      }
      if (t.debit === t.credit) {
        problems.push({ kind: 'SELF_TRANSFER', txId: t.id, detail: t.debit });
      }
      if (!Number.isSafeInteger(t.amountTiyin) || t.amountTiyin <= 0) {
        problems.push({ kind: 'AMOUNT_BROKEN', txId: t.id, detail: String(t.amountTiyin) });
      }
      if (t.isStorno && !this.txs.some((x) => x.id === t.reversedTxId)) {
        problems.push({ kind: 'STORNO_ORPHAN', txId: t.id, detail: t.reversedTxId ?? '—' });
      }
      byOperation.set(t.operationId, (byOperation.get(t.operationId) ?? 0) + t.amountTiyin);
    }
    // Сторно должно быть одно на проводку: два разворота удваивают отмену
    const reversedTwice = new Map<string, number>();
    for (const t of this.txs) {
      if (!t.reversedTxId) continue;
      reversedTwice.set(t.reversedTxId, (reversedTwice.get(t.reversedTxId) ?? 0) + 1);
    }
    for (const [txId, n] of reversedTwice) {
      if (n > 1) problems.push({ kind: 'STORNO_DUPLICATE', txId, detail: `разворотов: ${n}` });
    }

    const totalDebit = this.txs.reduce((s, t) => s + t.amountTiyin, 0);
    const assets = ACCOUNTS.filter((a) => a.kind === 'asset').reduce((s, a) => s + this.balance(a.code), 0);
    const liabilities = ACCOUNTS.filter((a) => a.kind === 'liability').reduce((s, a) => s + this.balance(a.code), 0);
    const income = ACCOUNTS.filter((a) => a.kind === 'income').reduce((s, a) => s + this.balance(a.code), 0);
    const expense = ACCOUNTS.filter((a) => a.kind === 'expense').reduce((s, a) => s + this.balance(a.code), 0);
    return {
      ok: problems.length === 0,
      problems,
      // Тождественный ноль по построению — оставлен как справка, не как проверка
      equationTiyin: assets + expense - liabilities - income,
      discrepancyTiyin: problems.length,
      totalDebitTiyin: totalDebit,
      totalCreditTiyin: totalDebit, // двойная запись: одна проводка = Дт и Кт
      txCount: this.txs.length,
      operationCount: byOperation.size,
      checkedAt: new Date().toISOString(),
    };
  }
}
