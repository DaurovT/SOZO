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
  ) {
    this.mirror = new PgMirror(prisma, 'Scheduler', {
      load: async (tx) => {
        const [runs, done] = await Promise.all([
          tx.timerRun.findMany({ orderBy: { at: 'asc' }, take: 200 }),
          tx.timerDone.findMany(),
        ]);
        if (runs.length) {
          this.runs.length = 0;
          this.runs.push(
            ...runs.map((r) => ({
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
        for (const r of this.runs) {
          await tx.timerRun.upsert({
            where: { id: r.id },
            create: {
              id: r.id, tenantId, timer: r.timer, title: r.title, result: r.result,
              affected: r.affected, manual: r.manual, at: new Date(r.at),
            },
            update: {},
          });
        }
        for (const key of this.done) {
          await tx.timerDone.upsert({
            where: { tenantId_key: { tenantId, key } },
            create: { tenantId, key },
            update: {},
          });
        }
      },
    });
    this.store.register(
      'scheduler',
      () => ({ runs: this.runs.slice(-200), done: [...this.done], dayOffset: this.dayOffset }),
      (d) => {
        const data = d as { runs: TimerRun[]; done: string[]; dayOffset: number };
        this.runs.length = 0;
        this.runs.push(...(data.runs ?? []));
        this.done.clear();
        for (const k of data.done ?? []) this.done.add(k);
        this.dayOffset = data.dayOffset ?? 0;
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
    const before = this.runs.length;
    await this.urgentSurchargeRelease(manual); // #22
    await this.approvalEscalation(manual); // #7–9
    await this.paymentReminders(manual); // #13–14
    this.subscriptionCycle(manual); // #15, ТЗ 8.3
    this.suspendUnpaid(manual); // ТЗ 8.3 — приостановка к 10-му
    this.dunning(manual); // #15–17, ТЗ 8.9
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
    for (const o of affected) {
      o.urgency = 'normal';
      // Снять флаг мало: наценка вшита в итог при создании, и без пересчёта
      // клиент продолжал бы видеть +30% после обещания их убрать
      if (o.urgentSurchargePercent) {
        const discount = o.promoDiscountPercent ?? 0;
        o.totalFromTiyin = Math.floor((o.baseFromTiyin * (100 - discount)) / 100);
        o.totalToTiyin = Math.floor((o.baseToTiyin * (100 - discount)) / 100);
        o.urgentSurchargePercent = undefined;
      }
      this.audit.write({
        actorPhone: 'система',
        action: 'timer.urgent_surcharge_released',
        entity: 'Order',
        entityId: o.id,
        payload: { number: o.number, rule: 'не начали за 3 ч — наценка «Срочно» снята (ТЗ 17.3)' },
      });
    }
    this.log('#22', 'Снятие наценки «Срочно»', affected.length ? `снята у ${affected.length} заявок` : 'нет кандидатов', affected.length, sim);
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
          await this.orders.transition('t0', o.id, { action: 'cancel', version: o.version, reason: 'Молчание утверждающего T+72 (авто-отмена, ТЗ 5.3)' }, 'система');
          cancelled += 1;
        } catch {
          /* критичные дефекты не отменяются — правило графа */
        }
      } else if (waitedH >= 24) {
        this.audit.write({ actorPhone: 'система', action: 'timer.approval_escalated', entity: 'Order', entityId: o.id, payload: { number: o.number, waitedH: Math.round(waitedH) } });
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
        this.audit.write({
          actorPhone: 'система',
          action: h >= 72 ? 'timer.payment_reminder_sms' : 'timer.payment_reminder_push',
          entity: 'Order',
          entityId: o.id,
          payload: { number: o.number, stage: h >= 72 ? 'T+72 SMS + блок новых заявок' : 'T+24 push' },
        });
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
        this.billing.issueSubscriptionInvoice(org.id, org.name, org.subscriptionTiyin);
        issued += 1;
      } catch {
        /* период закрыт — пропускаем */
      }
    }
    if (issued) {
      this.done.add(key);
      this.mirror.schedule();
      this.mirror.schedule();
    }
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
        this.crm.update(org.id, { status: 'suspended' });
        this.audit.write({ actorPhone: 'система', action: 'timer.org_suspended', entity: 'Organization', entityId: org.id, payload: { period, rule: 'неоплата абонентки к 10-му (ТЗ 8.3)' } });
        suspended += 1;
      }
    }
    this.log('#18', 'Приостановка при неоплате (10-е)', `приостановлено: ${suspended}`, suspended, sim);
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
      this.done.add(key);
      this.mirror.schedule();
      this.audit.write({
        actorPhone: 'система',
        action: 'timer.dunning',
        entity: 'Invoice',
        entityId: inv.id,
        payload: { number: inv.number, organization: inv.organizationName, ageDays, stage: stage[1] },
      });
      touched += 1;
    }
    this.log('#15–17', 'Дунинг дебиторки', touched ? `новых этапов дунинга: ${touched}` : 'нет новых этапов', touched, sim);
  }

  /** #42: ежедневный баланс-чекер с алертом при расхождении в 1 сум (ТЗ 8.8) */
  private balanceChecker(sim: boolean): void {
    const check = this.billing.balanceCheck();
    if (!check.ok) {
      this.audit.write({ actorPhone: 'система', action: 'timer.balance_check_failed', entity: 'Billing', payload: check });
    }
    this.log('#42', 'Баланс-чекер', check.ok ? 'баланс сходится' : `РАСХОЖДЕНИЕ ${check.discrepancyTiyin} тийин`, check.ok ? 0 : 1, sim);
  }

  /** A-11: алерт по истекающему договору ГПХ за 14 дней */
  private gphExpiry(sim: boolean): void {
    this.log('#48', 'Проверка сроков договоров ГПХ', 'алерты видны в карточках мастеров', 0, sim);
  }

  /** Dev: сдвиг виртуального времени на N дней вперёд с прогоном таймеров */
  async simulateDays(days: number): Promise<TimerRun[]> {
    const out: TimerRun[] = [];
    for (let i = 0; i < Math.min(days, 60); i += 1) {
      this.dayOffset += 1;
      out.push(...(await this.tick(true)));
    }
    this.store.persist();
    return out;
  }

  resetClock(): void {
    this.dayOffset = 0;
    this.done.clear();
    this.store.persist();
  }
}
