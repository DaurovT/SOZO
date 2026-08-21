import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { subscriptionCharge, operatorSettlement, uuidv7, type BillingUnit } from '@sozo/kernel';
import type { SubscriptionPlan, TenantKind } from '@sozo/contracts';
import { StateStore } from '../../common/state-store';
import { PrismaService } from '../../common/prisma.service';
import { PgMirror, APP_TENANT } from '../../common/pg-mirror';
import { EventBus } from '../../common/event-bus';

export interface SubscriptionRecord {
  id: string;
  tenantId: string;
  operatorOrgId: string;
  plan: SubscriptionPlan;
  tenantKind: TenantKind;
  billingUnit: BillingUnit;
  /** цена за единицу тарификации в тийинах; для per_object — за объект */
  priceTiyin: number;
  unitsBilled: number;
  periodFrom: string;
  periodTo: string;
  status: 'active' | 'past_due' | 'cancelled';
}

/** Начисления и претензии оператору за период — для нетто-расчёта (DEV-15 §11.5) */
export interface OperatorLedgerRow {
  id: string;
  tenantId: string;
  operatorOrgId: string;
  kind: 'subscription' | 'claim' | 'service_fee';
  amountTiyin: number;
  note: string;
  at: string;
}

/**
 * Модуль subscriptions (DEV-07 §2.1): тарифы операторов, деградация Pro→Free, нетто-расчёт.
 * Правило DEV-07 §3 п.8: billing его не импортирует — модуль публикует события.
 */
@Injectable()
export class SubscriptionsService implements OnModuleInit {
  private subs = new Map<string, SubscriptionRecord>();
  private ledger: OperatorLedgerRow[] = [];

  private readonly mirror: PgMirror;

  onModuleInit(): Promise<void> {
    return this.mirror.init();
  }

  /** Разовый перенос state.json (deploy/import-state) */
  flushToDb(): Promise<void> {
    return this.mirror.flush();
  }

  constructor(store: StateStore, private readonly bus: EventBus, prisma: PrismaService) {
    store.register(
      'subscriptions',
      () => ({ subs: [...this.subs.values()], ledger: this.ledger }),
      (d) => {
        const data = d as { subs?: SubscriptionRecord[]; ledger?: OperatorLedgerRow[] };
        this.subs = new Map((data.subs ?? []).map((x) => [x.id, x]));
        this.ledger = data.ledger ?? [];
      },
    );
    this.mirror = new PgMirror(prisma, 'Subscriptions', {
      load: async (tx) => {
        const [subs, ledger] = await Promise.all([
          tx.operatorSubscription.findMany(),
          tx.operatorLedgerRow.findMany({ orderBy: { at: 'asc' } }),
        ]);
        if (subs.length) {
          this.subs = new Map(
            subs.map((x) => [
              x.id,
              {
                id: x.id,
                tenantId: APP_TENANT,
                operatorOrgId: x.operatorOrgId,
                plan: x.plan as SubscriptionRecord['plan'],
                tenantKind: x.tenantKind as SubscriptionRecord['tenantKind'],
                billingUnit: x.billingUnit as SubscriptionRecord['billingUnit'],
                priceTiyin: Number(x.priceTiyin),
                unitsBilled: x.unitsBilled,
                periodFrom: x.periodFrom.toISOString(),
                periodTo: x.periodTo.toISOString(),
                status: x.status as SubscriptionRecord['status'],
              },
            ]),
          );
        }
        if (ledger.length) {
          this.ledger = ledger.map((r) => ({
            id: r.id,
            tenantId: APP_TENANT,
            operatorOrgId: r.operatorOrgId,
            kind: r.kind as OperatorLedgerRow['kind'],
            amountTiyin: Number(r.amountTiyin),
            note: r.note,
            at: r.at.toISOString(),
          }));
        }
        return subs.length + ledger.length;
      },
      save: async (tx, tenantId) => {
        for (const x of this.subs.values()) {
          const data = {
            operatorOrgId: x.operatorOrgId,
            plan: x.plan as never,
            tenantKind: x.tenantKind as never,
            billingUnit: x.billingUnit as never,
            unitsBilled: x.unitsBilled,
            priceTiyin: BigInt(x.priceTiyin),
            periodFrom: new Date(x.periodFrom),
            periodTo: new Date(x.periodTo),
            status: x.status,
          };
          await tx.operatorSubscription.upsert({ where: { id: x.id }, create: { id: x.id, tenantId, ...data }, update: data });
        }
        // Строка расчёта не меняется после записи: это документ, по которому
        // платят. Поэтому create с пропуском уже записанных, а не upsert
        for (const r of this.ledger) {
          await tx.operatorLedgerRow.upsert({
            where: { id: r.id },
            create: {
              id: r.id, tenantId, operatorOrgId: r.operatorOrgId, kind: r.kind,
              amountTiyin: BigInt(r.amountTiyin), note: r.note, at: new Date(r.at),
            },
            update: {},
          });
        }
      },
    });
    this.subscribeToFees();
  }

  /**
   * Сбор приходит событием от billing — модуль не импортируется ни одной стороной
   * (DEV-07 §3 п.2 и п.8). Знак минус: это обязательство платформы перед оператором,
   * оно уменьшает нетто-сумму к оплате.
   */
  private subscribeToFees(): void {
    this.bus.subscribe<{ operatorOrgId: string; amountTiyin: number; number: string; bps: number }>(
      'service_fee.accrued',
      (e) => {
        this.addLedger('t0', e.operatorOrgId, 'service_fee', e.amountTiyin, `Сбор по заявке ${e.number} (${e.bps / 100}%)`);
      },
    );
  }

  get(tenantId: string, operatorOrgId: string): SubscriptionRecord | undefined {
    return [...this.subs.values()].find((s) => s.tenantId === tenantId && s.operatorOrgId === operatorOrgId);
  }

  /**
   * Активация тарифа. Pro без заполненной цены не активируется (параметр 138):
   * это не техническое ограничение, а защита от продажи по неопределённой цене.
   */
  setPlan(
    tenantId: string,
    operatorOrgId: string,
    dto: { plan: SubscriptionPlan; tenantKind: TenantKind; priceTiyin?: number; unitsBilled?: number; billingUnit?: BillingUnit },
  ): SubscriptionRecord {
    const price = dto.priceTiyin ?? 0;
    if (dto.plan !== 'free' && price <= 0) {
      throw new BadRequestException({
        code: 'SubscriptionPriceNotSet',
        message: 'Цена тарифа не задана (параметр 138) — активация платного плана невозможна',
      });
    }
    const existing = this.get(tenantId, operatorOrgId);
    const rec: SubscriptionRecord = existing ?? {
      id: uuidv7(),
      tenantId,
      operatorOrgId,
      plan: 'free',
      tenantKind: dto.tenantKind,
      billingUnit: dto.billingUnit ?? 'per_object',
      priceTiyin: price,
      unitsBilled: dto.unitsBilled ?? 1,
      periodFrom: new Date().toISOString(),
      periodTo: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      status: 'active',
    };
    const prevPlan = rec.plan;
    rec.plan = dto.plan;
    rec.tenantKind = dto.tenantKind;
    rec.billingUnit = dto.billingUnit ?? rec.billingUnit;
    rec.priceTiyin = price || rec.priceTiyin;
    rec.unitsBilled = dto.unitsBilled ?? rec.unitsBilled;
    this.subs.set(rec.id, rec);
    this.mirror.schedule();
    if (prevPlan !== rec.plan) {
      this.bus.publish('subscription.plan_changed', { operatorOrgId, from: prevPlan, to: rec.plan });
    }
    return rec;
  }

  /** Начисление за период. Free не начисляется. */
  charge(tenantId: string, operatorOrgId: string): number {
    const sub = this.get(tenantId, operatorOrgId);
    if (!sub) throw new NotFoundException('Подписка не найдена');
    if (sub.plan === 'free') return 0;
    const amount = Number(
      subscriptionCharge(sub.billingUnit, BigInt(sub.priceTiyin), BigInt(sub.unitsBilled)),
    );
    this.addLedger(tenantId, operatorOrgId, 'subscription', amount, `Подписка ${sub.plan}, ${sub.billingUnit}`);
    this.bus.publish('subscription.charged', { operatorOrgId, amountTiyin: amount });
    return amount;
  }

  /**
   * Неоплата: понижение Pro→Free. Приём заявок жителей НЕ останавливается —
   * жители не сторона договора и не отвечают за просрочку оператора (ТЗ §19.2 п.9).
   */
  markPastDue(tenantId: string, operatorOrgId: string): SubscriptionRecord {
    const sub = this.get(tenantId, operatorOrgId);
    if (!sub) throw new NotFoundException('Подписка не найдена');
    sub.status = 'past_due';
    if (sub.plan !== 'free') {
      const from = sub.plan;
      sub.plan = 'free';
      this.bus.publish('subscription.plan_changed', { operatorOrgId, from, to: 'free', reason: 'past_due' });
    }
    this.subs.set(sub.id, sub);
    this.mirror.schedule();
    return sub;
  }

  addLedger(
    tenantId: string,
    operatorOrgId: string,
    kind: OperatorLedgerRow['kind'],
    amountTiyin: number,
    note: string,
  ): OperatorLedgerRow {
    const row: OperatorLedgerRow = {
      id: uuidv7(),
      tenantId,
      operatorOrgId,
      kind,
      amountTiyin,
      note,
      at: new Date().toISOString(),
    };
    this.ledger.push(row);
    this.mirror.schedule();
    return row;
  }

  /**
   * Нетто-расчёт месяца (U-11): одна сумма вместо двух встречных платежей.
   * Положительная — счёт оператору, отрицательная — выплата ему.
   */
  settlement(tenantId: string, operatorOrgId: string) {
    const rows = this.ledger.filter((r) => r.tenantId === tenantId && r.operatorOrgId === operatorOrgId);
    const sum = (k: OperatorLedgerRow['kind']) =>
      BigInt(rows.filter((r) => r.kind === k).reduce((a, r) => a + r.amountTiyin, 0));
    const net = operatorSettlement({
      subscriptionTiyin: sum('subscription'),
      claimsTiyin: sum('claim'),
      serviceFeeTiyin: sum('service_fee'),
    });
    return {
      subscriptionTiyin: Number(sum('subscription')),
      claimsTiyin: Number(sum('claim')),
      serviceFeeTiyin: Number(sum('service_fee')),
      netTiyin: Number(net),
      direction: net >= 0n ? 'invoice_to_operator' : 'payout_to_operator',
      rows,
    };
  }
}
