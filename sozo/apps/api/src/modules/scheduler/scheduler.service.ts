import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { uuidv7 } from '@sozo/kernel';
import { StateStore } from '../../common/state-store';
import { PrismaService } from '../../common/prisma.service';
import { PgMirror } from '../../common/pg-mirror';
import { EventBus } from '../../common/event-bus';
import { AuditService } from '../platform/audit.service';
import { BillingService } from '../billing/billing.service';
import { CrmService } from '../crm/crm.service';
import { OrdersService } from '../orders/orders.service';
import { ParametersService } from '../platform/parameters.service';
import { currentDbContext, systemContext } from '../../common/db-context';
import { SlaService } from '../sla/sla.service';

/**
 * Движок таймеров и эскалаций (PRD-05 §8 — 54 таймера; DEV-07 §5 — воркеры).
 * Dev-реализация на setInterval; в проде — BullMQ с повторами и DLQ.
 * Каждое срабатывание идемпотентно: повторный прогон того же периода ничего не дублирует.
 */
export interface TimerRun {
  id: string;
  timer: string; // код таймера (#N по PRD-05 §8)
  title: string;
  result: string;
  affected: number;
  at: string;
  manual: boolean;
}

const CALLOUT_TIYIN = 5_000_000;

/** Владелец, от чьего имени работает планировщик вне запроса */
function schedulerTenant(): string {
  return (currentDbContext() ?? systemContext()).tenantId;
}

@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly runs: TimerRun[] = [];
  private handle: NodeJS.Timeout | null = null;
  /** Ключи уже выполненных периодических задач: не дублируем в одном периоде */
  private readonly done = new Set<string>();
  /** Смещение «виртуального времени» в днях — для симуляции прогона месяца в dev */
  /**
   * Сдвиг дня для прогона таймеров вперёд. Живёт только в памяти процесса и
   * намеренно не переезжает в базу: это отладочный рычаг, которым прогоняют
   * завтрашний день сегодня, а не свойство системы. Пережить перезапуск он
   * не должен — иначе забытый сдвиг незаметно смещает всю работу таймеров.
   */
  private dayOffset = 0;
  /**
   * Сухой прогон: считаем, но ничего не делаем.
   *
   * Симуляция дней вперёд выполняла БОЕВЫЕ действия: выставляла счета на
   * абонентку, авто-отменяла заявки на T+72, приостанавливала организации и
   * рассылала уведомления живым подписчикам — до шестидесяти дней за один
   * вызов. Комментарий в коде обещал обратное.
   *
   * Флаг поднимается только на время симуляции и гасит всё, что выходит
   * наружу или меняет состояние: события, проводки, переходы заявок, статусы
   * организаций и отметки «сделано». Считанные цифры остаются — ради них
   * симуляцию и запускают.
   */
  private dryRun = false;
  /** Что уже записано в базу: прогоны и отметки неизменяемы после записи */
  private readonly savedRuns = new Set<string>();
  private readonly savedDone = new Set<string>();
  /** Тик не должен накладываться на тик: расписание и ручной запуск сходятся */
  private ticking = false;

  /** Журнал прогонов и отметки «сделано» — в базе (DEV-19, m36) */
  private readonly mirror: PgMirror;

  constructor(
    private readonly store: StateStore,
    prisma: PrismaService,
    private readonly bus: EventBus,
    private readonly audit: AuditService,
    private readonly billing: BillingService,
    private readonly crm: CrmService,
    private readonly orders: OrdersService,
    private readonly params: ParametersService,
    private readonly sla: SlaService,
  ) {
    this.mirror = new PgMirror(prisma, 'Scheduler', {
      load: async (tx) => {
        const [runs, done] = await Promise.all([
          // Последние 200, а не первые: `asc` брал самые старые записи за всю
          // историю, и «последний прогон» показывал прошлогоднее
          tx.timerRun.findMany({ where: { tenantId: schedulerTenant() }, orderBy: { at: 'desc' }, take: 200 }),
          // Ключи «сделано» — свои: чужие сваливались в один Set, а сам ключ
          // тенанта не содержит, и отметка соседа гасила бы напоминание здесь
          tx.timerDone.findMany({ where: { tenantId: schedulerTenant() } }),
        ]);
        if (runs.length) {
          this.runs.length = 0;
          this.runs.push(
            // Вернули порядок «старые → новые»: журнал читают сверху вниз
            ...[...runs].reverse().map((r) => ({
              id: r.id,
              timer: r.timer,
              title: r.title,
              result: r.result,
              affected: r.affected,
              manual: r.manual,
              at: r.at.toISOString(),
            })),
          );
        }
        for (const d of done) this.done.add(d.key);
        return runs.length + done.length;
      },
      save: async (tx, tenantId) => {
        /**
         * Пишем только новое.
         *
         * Раньше на каждое планирование перебирался весь список — по одному
         * upsert на запись, — и список этот растёт неограниченно. Прогоны и
         * отметки «сделано» неизменяемы после записи, поэтому достаточно
         * помнить, что уже записано.
         */
        for (const r of this.runs) {
          if (this.savedRuns.has(r.id)) continue;
          await tx.timerRun.upsert({
            where: { id: r.id },
            create: {
              id: r.id, tenantId, timer: r.timer, title: r.title, result: r.result,
              affected: r.affected, manual: r.manual, at: new Date(r.at),
            },
            update: {},
          });
          this.savedRuns.add(r.id);
        }
        for (const key of this.done) {
          if (this.savedDone.has(key)) continue;
          await tx.timerDone.upsert({
            where: { tenantId_key: { tenantId, key } },
            create: { tenantId, key },
            update: {},
          });
          this.savedDone.add(key);
        }
      },
    });
    this.store.register(
      'scheduler',
      // dayOffset в снимок НЕ попадает: виртуальное время — инструмент
      // разбора, а не состояние системы. Оно переживало рестарт, и сервер
      // просыпался в выдуманном дне, продолжая слать по нему уведомления
      () => ({ runs: this.runs.slice(-200), done: [...this.done] }),
      (d) => {
        const data = d as { runs: TimerRun[]; done: string[] };
        this.runs.length = 0;
        this.runs.push(...(data.runs ?? []));
        this.done.clear();
        for (const k of data.done ?? []) this.done.add(k);
        this.dayOffset = 0;
      },
    );
  }

  /** Разовый перенос state.json (deploy/import-state) */
  flushToDb(): Promise<void> {
    return this.mirror.flush();
  }

  onModuleInit(): void {
    void this.mirror.init();
    // Минутный тик: короткие операционные таймеры
    this.handle = setInterval(() => void this.tick(false), 60_000);
    void this.tick(false); // первый прогон на старте
  }

  onModuleDestroy(): void {
    if (this.handle) clearInterval(this.handle);
  }

  /** Виртуальное «сейчас» (учитывает симуляцию дней) */
  now(): Date {
    return new Date(Date.now() + this.dayOffset * 86_400_000);
  }

  /**
   * Побочное действие таймера.
   *
   * В сухом прогоне не выполняется — и это единственное, чем симуляция
   * отличается от боевого тика. Возвращает `false`, если действие пропущено,
   * чтобы счётчики в журнале честно показывали «столько бы сделали».
   */
  private commit(fn: () => void): boolean {
    if (this.dryRun) return false;
    fn();
    return true;
  }

  /**
   * Запись в аудит.
   *
   * В сухом прогоне не пишется: журнал действий — тоже состояние системы, и
   * шестьдесят виртуальных дней оставляли бы в нём шестьдесят дней событий,
   * которых не было.
   */
  private auditWrite(rec: Parameters<AuditService['write']>[0]): void {
    if (this.dryRun) return;
    this.audit.write(rec);
  }

  /** Отметка «сделано»: в сухом прогоне не ставится, иначе боевой тик её пропустит */
  private markDone(key: string): void {
    if (this.dryRun) return;
    this.done.add(key);
    this.mirror.schedule();
    this.store.persist();
  }

  history(limit = 50): TimerRun[] {
    return this.runs.slice(-limit).reverse();
  }

  state() {
    return {
      dayOffset: this.dayOffset,
      virtualNow: this.now().toISOString(),
      runsTotal: this.runs.length,
      lastRunAt: this.runs.at(-1)?.at ?? null,
    };
  }

  private log(timer: string, title: string, result: string, affected: number, manual: boolean): void {
    if (affected === 0 && !manual) return; // не засоряем журнал пустыми тиками
    this.runs.push({ id: uuidv7(), timer, title, result, affected, at: this.now().toISOString(), manual });
    this.mirror.schedule();
    if (this.runs.length > 500) this.runs.splice(0, this.runs.length - 500);
    this.store.persist();
  }

  /**
   * Полный прогон всех таймеров. `manual=true` — запуск человеком из админки
   * или прогон дней вперёд; расписание ставит false.
   *
   * Раньше параметр назывался `manual`, и это было неправдой: побочные
   * действия выполняются одинаково в обоих случаях. Отличие ровно одно —
   * пустой тик расписания в журнал не пишется, чтобы не засорять его.
   */
  async tick(manual: boolean): Promise<TimerRun[]> {
    // Тики не накладываются: расписание и ручной запуск сходятся легко, а
    // счётчики и отметки «сделано» этого не переживают
    if (this.ticking) return [];
    this.ticking = true;
    try {
      return await this.runTimers(manual);
    } finally {
      this.ticking = false;
    }
  }

  private async runTimers(manual: boolean): Promise<TimerRun[]> {
    const before = this.runs.length;
    await this.urgentSurchargeRelease(manual); // #22
    await this.approvalEscalation(manual); // #7–9
    await this.paymentReminders(manual); // #13–14
    this.subscriptionCycle(manual); // #15, ТЗ 8.3
    this.suspendUnpaid(manual); // ТЗ 8.3 — приостановка к 10-му
    this.dunning(manual); // #15–17, ТЗ 8.9
    await this.addressDetailsReminder(manual); // C-50, ТЗ §17.17
    await this.warrantyExpiring(manual); // ТЗ §17.12
    await this.careTouch(manual); // ТЗ §17.12 — сервисное касание
    await this.slaBreaches(manual); // DEV-15 §7.2
    this.balanceChecker(manual); // #42
    this.gphExpiry(manual); // A-11 — алерт за 14 дней
    return this.runs.slice(before).reverse();
  }

  /** #22: наценка «Срочно» снимается, если работы не начаты за 3 ч (правило честности, ТЗ 17.3) */
  private async urgentSurchargeRelease(sim: boolean): Promise<void> {
    const all = await this.orders.list('t0');
    const now = this.now().getTime();
    const affected = all.filter(
      (o) =>
        o.urgency === 'urgent' &&
        ['new', 'estimated', 'assigned', 'master_departed'].includes(o.status) &&
        now - new Date(o.createdAt).getTime() > 3 * 3_600_000,
    );
    let affectedCount = 0;
    for (const o of affected) {
      /**
       * Снятие наценки — один раз на заявку и с сохранением.
       *
       * Раньше поля правились напрямую: заявка не помечалась к записи, версия
       * не поднималась, ключа идемпотентности не было. После рестарта клиент
       * снова видел +30%, таймер срабатывал второй раз и писал второй аудит.
       */
      const key = `urgent_release:${o.id}`;
      if (this.done.has(key)) continue;
      this.markDone(key);
      affectedCount += 1;
      if (this.dryRun) continue;
      o.urgency = 'normal';
      // Снять флаг мало: наценка вшита в итог при создании, и без пересчёта
      // клиент продолжал бы видеть +30% после обещания их убрать
      if (o.urgentSurchargePercent) {
        const discount = o.promoDiscountPercent ?? 0;
        o.totalFromTiyin = Math.floor((o.baseFromTiyin * (100 - discount)) / 100);
        o.totalToTiyin = Math.floor((o.baseToTiyin * (100 - discount)) / 100);
        o.urgentSurchargePercent = undefined;
      }
      // Без этого правка живёт только в памяти и умирает с процессом
      this.orders.touchOrder();
      this.auditWrite({
        actorPhone: 'система',
        action: 'timer.urgent_surcharge_released',
        entity: 'Order',
        entityId: o.id,
        payload: { number: o.number, rule: 'не начали за 3 ч — наценка «Срочно» снята (ТЗ 17.3)' },
      });
    }
    this.log('#22', 'Снятие наценки «Срочно»', affectedCount ? `снята у ${affectedCount} заявок` : 'нет кандидатов', affectedCount, sim);
  }

  /** #7–9: эскалация утверждений T+24/48, авто-отмена T+72 (ТЗ 5.3) */
  private async approvalEscalation(sim: boolean): Promise<void> {
    const all = await this.orders.list('t0');
    const now = this.now().getTime();
    const pending = all.filter((o) => o.status === 'pending_approval');
    let escalated = 0;
    let cancelled = 0;
    for (const o of pending) {
      const waitedH = (now - new Date(o.statusLog.at(-1)?.at ?? o.createdAt).getTime()) / 3_600_000;
      if (waitedH >= 72) {
        try {
          // Отмена заявки — необратимое боевое действие: в сухом прогоне
          // только считаем, сколько заявок отменилось бы
          if (!this.dryRun) {
            await this.orders.transition('t0', o.id, { action: 'cancel', version: o.version, reason: 'Молчание утверждающего T+72 (авто-отмена, ТЗ 5.3)' }, 'система');
          }
          cancelled += 1;
        } catch {
          /* критичные дефекты не отменяются — правило графа */
        }
      } else if (waitedH >= 24) {
        // Та же болезнь, что и у напоминаний об оплате: без отметки
        // утверждающий получал бы «смета ждёт решения» каждую минуту все
        // двое суток до авто-отмены
        const key = `approval_escalated:${o.id}`;
        if (this.done.has(key)) continue;
        this.markDone(key);
        this.auditWrite({ actorPhone: 'система', action: 'timer.approval_escalated', entity: 'Order', entityId: o.id, payload: { number: o.number, waitedH: Math.round(waitedH) } });
        // ТЗ §5.3: на T+24 повторное напоминание уходит уже двумя каналами.
        // Молчание утверждающего стоит клиенту суток простоя, и одного
        // push, который человек мог смахнуть не глядя, здесь мало
        this.commit(() => this.bus.publish('order.approval_escalated', {
          orderId: o.id,
          number: o.number,
          amountTiyin: o.quotes.at(-1)?.amountTiyin ?? o.totalFromTiyin,
          waitedH: Math.round(waitedH),
          approvers: this.approversOf(o),
        }));
        escalated += 1;
      }
    }
    this.log('#7–9', 'Эскалация утверждений B2B', `эскалировано ${escalated}, авто-отменено ${cancelled}`, escalated + cancelled, sim);
  }

  /** #13–14: напоминания об оплате T+24 push / T+72 SMS (ТЗ 8.9, дунинг B2C) */
  private async paymentReminders(sim: boolean): Promise<void> {
    const all = await this.orders.list('t0');
    const now = this.now().getTime();
    const waiting = all.filter((o) => o.status === 'awaiting_payment');
    let notified = 0;
    for (const o of waiting) {
      const h = (now - new Date(o.statusLog.at(-1)?.at ?? o.createdAt).getTime()) / 3_600_000;
      if (h >= 24) {
        /**
         * Один раз на этап, а не на каждый тик.
         *
         * Раньше отметки не было, и это сходило с рук, пока напоминание
         * оставалось строкой в аудите: мусор в журнале никого не будил.
         * С подключённой доставкой та же ветка стала отправкой сообщения —
         * и заявка, висящая в «ожидает оплаты», слала должнику требование
         * каждую минуту, пока кто-нибудь не заплатит.
         *
         * Ключ включает этап: T+24 и T+72 — два разных напоминания, второе
         * обязано уйти, даже если первое уже отправлено.
         */
        const stage = h >= 72 ? 'T+72' : 'T+24';
        const key = `payment_reminder:${o.id}:${stage}`;
        if (this.done.has(key)) continue;
        this.markDone(key);
        this.auditWrite({
          actorPhone: 'система',
          action: stage === 'T+72' ? 'timer.payment_reminder_sms' : 'timer.payment_reminder_push',
          entity: 'Order',
          entityId: o.id,
          payload: { number: o.number, stage: stage === 'T+72' ? 'T+72 SMS + блок новых заявок' : 'T+24 push' },
        });
        /**
         * Напоминание человеку (ТЗ §8.9, дунинг B2C).
         *
         * До сих пор таймер писал в аудит и на этом заканчивался: запись
         * «уведомлено» означала, что мы знаем о долге, а не что о нём знает
         * клиент. Дальше доставку решает движок уведомлений — он же решает,
         * что T+72 уходит SMS, а T+24 обходится push.
         */
        this.commit(() => this.bus.publish('order.payment_reminder', {
          orderId: o.id,
          number: o.number,
          clientPhone: o.clientPhone,
          amountTiyin: o.quotes.at(-1)?.amountTiyin ?? o.totalFromTiyin,
          stage,
        }));
        notified += 1;
      }
    }
    this.log('#13–14', 'Напоминания об оплате B2C', `уведомлено ${notified}`, notified, sim);
  }

  /** ТЗ 8.3: 1-го числа — СФ на абонентку + резерв плановых осмотров */
  private subscriptionCycle(sim: boolean): void {
    const now = this.now();
    const period = now.toISOString().slice(0, 7);
    if (now.getDate() !== 1 && !sim) return;
    const key = `subscription:${period}`;
    if (this.done.has(key)) {
      this.log('#15', 'Начисление абоненток', `период ${period} уже начислен (идемпотентность)`, 0, sim);
      return;
    }
    let issued = 0;
    for (const org of this.crm.list()) {
      if (org.status !== 'active' || !org.subscriptionTiyin) continue;
      try {
        // Счёт — документ, по которому платят: в сухом прогоне не выставляем
        if (!this.dryRun) this.billing.issueSubscriptionInvoice(org.id, org.name, org.subscriptionTiyin);
        issued += 1;
      } catch {
        /* период закрыт — пропускаем */
      }
    }
    if (issued) this.markDone(key);
    this.log('#15', 'Начисление абоненток (1-е число)', `выставлено СФ: ${issued}`, issued, sim);
  }

  /** ТЗ 8.3: неоплата к 10-му → организация «приостановлена» (только аварийные) */
  private suspendUnpaid(sim: boolean): void {
    const now = this.now();
    const period = now.toISOString().slice(0, 7);
    let suspended = 0;
    for (const org of this.crm.list()) {
      if (org.status !== 'active' || !org.subscriptionTiyin) continue;
      // «к 10-му» = счёт на абонентку не оплачен более 10 дней (по виртуальному времени)
      const unpaid = this.billing
        .invoicesList()
        .some(
          (i) =>
            i.organizationId === org.id &&
            i.kind === 'subscription' &&
            i.status === 'issued' &&
            this.ageDays(i.issuedAt) >= 10,
        );
      if (unpaid) {
        // Приостановка организации закрывает ей приём заявок — не в симуляции
        this.commit(() => {
          this.crm.update(org.id, { status: 'suspended' });
          this.auditWrite({ actorPhone: 'система', action: 'timer.org_suspended', entity: 'Organization', entityId: org.id, payload: { period, rule: 'неоплата абонентки к 10-му (ТЗ 8.3)' } });
        });
        suspended += 1;
      }
    }
    this.log('#18', 'Приостановка при неоплате (10-е)', `приостановлено: ${suspended}`, suspended, sim);
  }

  /**
   * Кому напоминать об утверждении.
   *
   * Тот же отбор, что и при первом запросе (ТЗ §5.2): утверждает тот, чей
   * потолок покрывает сумму. Напомнить не тому — значит потерять ещё сутки,
   * потому что человек без права утверждения ничего с уведомлением сделать
   * не сможет.
   */
  private approversOf(order: { locationId?: string; quotes: Array<{ amountTiyin: number }>; totalFromTiyin: number }): Array<{ phone: string; name: string }> {
    if (!order.locationId) return [];
    const found = this.crm.findLocation(order.locationId);
    if (!found) return [];
    const amount = order.quotes.at(-1)?.amountTiyin ?? order.totalFromTiyin;
    const reps = found.loc.representatives;
    const able = reps.filter((r) => r.approvalLimitTiyin === null || r.approvalLimitTiyin >= amount);
    const list = able.length ? able : reps.filter((r) => r.approvalLimitTiyin === null);
    return list.map((r) => ({ phone: r.phone, name: r.fullName }));
  }

  /**
   * Кому в организации адресованы деньги (ТЗ §8.9: дунинг идёт бухгалтерии
   * и руководству организации).
   *
   * Только уровень организации — те, у кого потолок утверждения не задан.
   * Первая редакция брала всех, кто вправе утверждать хоть что-то, и это
   * была ошибка масштаба: у сети из пятидесяти точек счёт организации
   * уходил бы полусотне руководителей точек, которые его не оплачивают и
   * повлиять на оплату не могут. Каждый этап дунинга — с десятого дня ещё и
   * SMS каждому.
   */
  private orgApprovers(organizationId?: string): Array<{ phone: string; name: string }> {
    if (!organizationId) return [];
    const org = this.crm.list().find((o) => o.id === organizationId);
    if (!org) return [];
    const out = new Map<string, { phone: string; name: string }>();
    for (const loc of this.crm.get(organizationId).locations) {
      for (const rep of loc.representatives) {
        if (rep.approvalLimitTiyin !== null) continue;
        out.set(rep.phone, { phone: rep.phone, name: rep.fullName });
      }
    }
    return [...out.values()];
  }

  /** Возраст в днях по виртуальному времени планировщика */
  private ageDays(iso: string): number {
    return Math.floor((this.now().getTime() - new Date(iso).getTime()) / 86_400_000);
  }

  /** #15–17: дунинг B2B T+3/7/10/30/60 (ТЗ 8.9) */
  private dunning(sim: boolean): void {
    const unpaidInvoices = this.billing.invoicesList().filter((i) => i.status === 'issued');
    const stages: Array<[number, string]> = [
      [60, 'T+60 пред-суд / списание'],
      [30, 'T+30 претензионное письмо'],
      [10, 'T+10 приостановка обслуживания'],
      [7, 'T+7 письмо руководству'],
      [3, 'T+3 письмо бухгалтерии'],
    ];
    let touched = 0;
    for (const inv of unpaidInvoices) {
      const ageDays = this.ageDays(inv.issuedAt);
      const stage = stages.find(([d]) => ageDays >= d);
      if (!stage) continue;
      const key = `dunning:${inv.id}:${stage[0]}`;
      if (this.done.has(key)) continue; // один этап дунинга — одно уведомление
      this.markDone(key);
      this.auditWrite({
        actorPhone: 'система',
        action: 'timer.dunning',
        entity: 'Invoice',
        entityId: inv.id,
        payload: { number: inv.number, organization: inv.organizationName, ageDays, stage: stage[1] },
      });
      /**
       * Этап дунинга людям в организации (ТЗ §8.9).
       *
       * Адресаты — те, кто вправе платить и решать: бухгалтерию от рядового
       * сотрудника отличает право утверждения, и в CRM это единственный
       * признак, который у нас есть. Слать всем подряд нельзя — счёт
       * организации не касается человека, который вызывает электрика.
       */
      this.commit(() => this.bus.publish('invoice.dunning', {
        invoiceId: inv.id,
        number: inv.number,
        organizationId: inv.organizationId,
        organizationName: inv.organizationName,
        amountTiyin: inv.amountTiyin,
        ageDays,
        stage: stage[1],
        recipients: this.orgApprovers(inv.organizationId),
      }));
      touched += 1;
    }
    this.log('#15–17', 'Дунинг дебиторки', touched ? `новых этапов дунинга: ${touched}` : 'нет новых этапов', touched, sim);
  }

  /** Число из параметра вида «14 дней»: значения редактируются как текст */
  private paramNumber(num: number, fallback: number): number {
    const m = /(\d+)/.exec(this.params.text(num, String(fallback)));
    return m ? Number(m[1]) : fallback;
  }

  /**
   * Напоминание уточнить детали адреса (C-50, ТЗ §17.17).
   *
   * Мастер теряет время на поиске подъезда и домофона, а клиент узнаёт об
   * этом по звонку «я у ворот». Напоминание уходит незадолго до окна — и
   * только тому, кто деталей не заполнил: остальным это просто шум.
   */
  private async addressDetailsReminder(sim: boolean): Promise<void> {
    const hours = this.paramNumber(205, 4);
    const all = await this.orders.list('t0');
    const now = this.now().getTime();
    let sent = 0;
    for (const o of all) {
      if (!['assigned', 'master_departed'].includes(o.status)) continue;
      if (o.graphType === 'b2b') continue; // адрес точки известен из паспорта
      if (o.addressDetails && Object.values(o.addressDetails).some((v) => String(v ?? '').trim())) continue;
      const w = o.requestedWindow;
      if (!w?.date || w.startMin === undefined) continue;
      const windowAt = new Date(`${w.date}T00:00:00`).getTime() + w.startMin * 60_000;
      const leftH = (windowAt - now) / 3_600_000;
      if (leftH > hours || leftH < 0) continue;
      const key = `address_details:${o.id}`;
      if (this.done.has(key)) continue;
      this.markDone(key);
      this.commit(() => this.bus.publish('order.address_details_missing', {
        orderId: o.id,
        number: o.number,
        clientPhone: o.clientPhone,
        hoursLeft: Math.max(0, Math.round(leftH)),
      }));
      sent += 1;
    }
    this.log('#C-50', 'Напоминание о деталях адреса', sent ? `напомнили по ${sent} заявкам` : 'нет кандидатов', sent, sim);
  }

  /**
   * Гарантия заканчивается (ТЗ §17.12).
   *
   * Смысл не в вежливости: пока гарантия действует, повторный выезд для
   * клиента бесплатен, а после — платный. Человек, узнавший об этом на
   * следующий день после окончания, считает себя обманутым, и он прав.
   */
  private async warrantyExpiring(sim: boolean): Promise<void> {
    const warrantyDays = this.paramNumber(29, 30);
    const noticeDays = this.paramNumber(207, 7);
    const all = await this.orders.list('t0');
    const now = this.now().getTime();
    let sent = 0;
    for (const o of all) {
      if (!['closed', 'rated'].includes(o.status)) continue;
      const closedAt = o.statusLog.filter((l) => l.to === 'closed').at(-1)?.at;
      if (!closedAt) continue;
      const endsAt = new Date(closedAt).getTime() + warrantyDays * 86_400_000;
      const leftDays = (endsAt - now) / 86_400_000;
      if (leftDays > noticeDays || leftDays < 0) continue;
      const key = `warranty_expiring:${o.id}`;
      if (this.done.has(key)) continue;
      this.markDone(key);
      this.commit(() => this.bus.publish('order.warranty_expiring', {
        orderId: o.id,
        number: o.number,
        clientPhone: o.clientPhone,
        daysLeft: Math.max(0, Math.round(leftDays)),
      }));
      sent += 1;
    }
    this.log('#W-7', 'Окончание гарантии', sent ? `предупреждено: ${sent}` : 'нет кандидатов', sent, sim);
  }

  /**
   * Касание «Как дела» (C-27, ТЗ §17.12).
   *
   * Единственное здесь, что не является операционным уведомлением: человека
   * спрашивают, всё ли работает, через полторы недели после ремонта. Поэтому
   * помечается сервисным — на него распространяется частотный потолок, а
   * согласие на маркетинг проверяет движок доставки.
   */
  private async careTouch(sim: boolean): Promise<void> {
    const afterDays = this.paramNumber(206, 10);
    const all = await this.orders.list('t0');
    const now = this.now().getTime();
    let sent = 0;
    for (const o of all) {
      if (!['closed', 'rated'].includes(o.status)) continue;
      if (o.graphType === 'b2b') continue; // сервисные касания — контур B2C
      const closedAt = o.statusLog.filter((l) => l.to === 'closed').at(-1)?.at;
      if (!closedAt) continue;
      const passedDays = (now - new Date(closedAt).getTime()) / 86_400_000;
      if (passedDays < afterDays) continue;
      const key = `care_touch:${o.id}`;
      if (this.done.has(key)) continue;
      this.markDone(key);
      this.commit(() => this.bus.publish('order.care_touch', {
        orderId: o.id,
        number: o.number,
        clientPhone: o.clientPhone,
        subject: o.lines[0]?.name ?? o.description.slice(0, 40),
      }));
      sent += 1;
    }
    this.log('#C-27', 'Касание «Как дела»', sent ? `отправлено: ${sent}` : 'нет кандидатов', sent, sim);
  }

  /** #42: ежедневный баланс-чекер с алертом при расхождении в 1 сум (ТЗ 8.8) */
  private balanceChecker(sim: boolean): void {
    const check = this.billing.balanceCheck();
    if (!check.ok) {
      this.auditWrite({ actorPhone: 'система', action: 'timer.balance_check_failed', entity: 'Billing', payload: check });
    }
    this.log('#42', 'Баланс-чекер', check.ok ? 'баланс сходится' : `РАСХОЖДЕНИЕ ${check.discrepancyTiyin} тийин`, check.ok ? 0 : 1, sim);
  }

  /** A-11: алерт по истекающему договору ГПХ за 14 дней */
  private gphExpiry(sim: boolean): void {
    this.log('#48', 'Проверка сроков договоров ГПХ', 'алерты видны в карточках мастеров', 0, sim);
  }

  /**
   * Просрочка SLA объектов (DEV-15 §7.2).
   *
   * Таймера SLA в планировщике не было вовсе: `check()` звали только руками
   * из контроллера, а значит нарушение не фиксировалось до тех пор, пока
   * кто-нибудь не нажмёт кнопку. Светофор в кабинете оператора при этом
   * показывал зелёное — не потому что успевали, а потому что никто не считал.
   */
  private async slaBreaches(sim: boolean): Promise<void> {
    if (this.dryRun) {
      // В сухом прогоне не фиксируем: нарушение — факт, по которому считают
      // штрафы оператору, и виртуальные дни его порождать не должны
      this.log('#SLA', 'Просрочка SLA объектов', 'сухой прогон: не фиксируем', 0, sim);
      return;
    }
    const breached = this.sla.check(schedulerTenant(), this.now());
    for (const st of breached) {
      this.auditWrite({
        actorPhone: 'система',
        action: 'timer.sla_breached',
        entity: 'Order',
        entityId: st.orderId,
        payload: { breached: st.breached, resolutionDue: st.resolutionDue },
      });
    }
    this.log('#SLA', 'Просрочка SLA объектов', breached.length ? `новых нарушений: ${breached.length}` : 'нарушений нет', breached.length, sim);
  }

  /** Dev: сдвиг виртуального времени на N дней вперёд с прогоном таймеров */
  /**
   * Прогон дней вперёд. По умолчанию СУХОЙ.
   *
   * Считает, что случилось бы, и ничего не делает: ни счетов, ни отмен, ни
   * приостановок, ни уведомлений живым подписчикам. Раньше это было
   * единственным поведением — и оно было боевым: прогон до шестидесяти дней
   * реально выставлял счета, авто-отменял заявки на T+72, приостанавливал
   * организации и рассылал сообщения. Вопреки комментарию в коде.
   *
   * `apply: true` возвращает прежнее поведение там, где оно нужно осознанно
   * — на стенде и в прогонах, которые проверяют месячный цикл целиком.
   *
   * Виртуальное время возвращается на место в `finally` — иначе сервер
   * остаётся жить в выдуманном дне, а тик по расписанию работает по нему.
   */
  async simulateDays(days: number, opts: { apply?: boolean } = {}): Promise<TimerRun[]> {
    const out: TimerRun[] = [];
    const savedOffset = this.dayOffset;
    // Применение — только по явному требованию и под запись в аудит:
    // раньше оно было единственным поведением и никак не называлось
    this.dryRun = opts.apply !== true;
    try {
      for (let i = 0; i < Math.min(days, 60); i += 1) {
        this.dayOffset += 1;
        out.push(...(await this.tick(true)));
      }
    } finally {
      /**
       * Сухой прогон возвращает часы на место: ничего не произошло, и жить
       * в выдуманном дне после него не за чем. Прогон с применением часы
       * оставляет — иначе последующие тики пересчитают то же самое по
       * реальному времени и отправят заново то, что уже отправлено.
       *
       * В снимок состояния смещение не попадает ни в одном случае: рестарт
       * обязан вернуть сервер в настоящий день.
       */
      if (this.dryRun) this.dayOffset = savedOffset;
      this.dryRun = false;
    }
    this.store.persist();
    return out;
  }

  /**
   * Сброс виртуального времени.
   *
   * Отметки «сделано» больше НЕ чистятся. Раньше сброс очищал весь список, и
   * следующий тик считал, что напоминаний не было никогда: заново уходили все
   * напоминания об оплате, все этапы дунинга и заново выставлялись счета на
   * абонентку — по всей базе должников разом. Виртуальное время и журнал
   * отправленного — разные вещи, и связывать их было ошибкой.
   */
  resetClock(): void {
    this.dayOffset = 0;
    this.store.persist();
  }

  /**
   * Отдельная кнопка на случай, когда отметки действительно надо снять
   * (разбор инцидента на dev-стенде). Названа тем, что делает.
   */
  clearDeliveryMarks(): { cleared: number } {
    const cleared = this.done.size;
    this.done.clear();
    this.savedDone.clear();
    this.store.persist();
    return { cleared };
  }
}
