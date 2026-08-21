import { Body, Controller, Get, Injectable, Module, Post, UseGuards, OnModuleInit } from '@nestjs/common';
import { uuidv7 } from '@sozo/kernel';
import { AuthGuard, Roles } from '../identity/auth.guard';
import { StateStore } from '../../common/state-store';
import { PrismaService } from '../../common/prisma.service';
import { PgMirror } from '../../common/pg-mirror';
import { OrdersModule } from '../orders/orders.module';
import { OrdersService } from '../orders/orders.service';
import { BillingModule } from '../billing/billing.module';
import { BillingService } from '../billing/billing.service';
import { QualityModule } from '../quality/quality.module';
import { QualityService } from '../quality/quality.service';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { SchedulingService } from '../scheduling/scheduling.service';

/**
 * Аналитика дашборда (PRD-04 A-01): P&L-виджет (F-007), NPS (F-008),
 * упущенный спрос (F-003), follow-up метрики (F-005), доля парных заявок (F-004).
 */

export interface DemandMissRec {
  id: string;
  date: string; // запрошенная дата
  reason: 'no_windows' | 'window_taken' | 'out_of_zone';
  category?: string;
  zone?: string;
  at: string;
}

@Injectable()
export class AnalyticsService implements OnModuleInit {
  readonly demandMisses: DemandMissRec[] = [];

  private readonly mirror: PgMirror;

  constructor(
    private readonly store: StateStore,
    prisma: PrismaService,
  ) {
    this.store.register(
      'analytics',
      () => this.demandMisses.slice(-2000),
      (d) => {
        this.demandMisses.length = 0;
        this.demandMisses.push(...(d as DemandMissRec[]));
      },
    );
    this.mirror = new PgMirror(prisma, 'Analytics', {
      load: async (tx) => {
        // Последние две тысячи: неудовлетворённый спрос смотрят за неделю, а
        // не за всё время, и держать в памяти весь архив незачем
        const rows = await tx.demandMiss.findMany({ orderBy: { at: 'desc' }, take: 2000 });
        if (!rows.length) return 0;
        this.demandMisses.length = 0;
        this.demandMisses.push(
          ...rows.reverse().map((r) => ({
            id: r.id,
            date: r.date.toISOString().slice(0, 10),
            reason: r.reason as DemandMissRec['reason'],
            category: r.category ?? undefined,
            zone: r.zone ?? undefined,
            at: r.at.toISOString(),
          })),
        );
        return rows.length;
      },
      save: async (tx, tenantId) => {
        for (const r of this.demandMisses) {
          await tx.demandMiss.upsert({
            where: { id: r.id },
            create: {
              id: r.id, tenantId, date: new Date(`${r.date}T00:00:00Z`), reason: r.reason,
              category: r.category ?? null, zone: r.zone ?? null, at: new Date(r.at),
            },
            update: {},
          });
        }
      },
    });
  }

  onModuleInit(): Promise<void> {
    return this.mirror.init();
  }

  /** Разовый перенос state.json (deploy/import-state) */
  flushToDb(): Promise<void> {
    return this.mirror.flush();
  }

  /** F-003: клик по недоступному окну — сигнал найма (ТЗ 17.3) */
  recordMiss(rec: Omit<DemandMissRec, 'id' | 'at'>): DemandMissRec {
    const r: DemandMissRec = { id: uuidv7(), at: new Date().toISOString(), ...rec };
    this.demandMisses.push(r);
    if (this.demandMisses.length > 2000) this.demandMisses.splice(0, this.demandMisses.length - 2000);
    this.mirror.schedule();
    this.store.persist();
    return r;
  }
}

@Controller('admin/analytics')
@UseGuards(AuthGuard)
@Roles('admin', 'accountant')
class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly orders: OrdersService,
    private readonly billing: BillingService,
    private readonly quality: QualityService,
    private readonly scheduling: SchedulingService,
  ) {}

  /**
   * F-007: P&L-виджет — выручка минус доли мастеров, комиссии провайдеров,
   * отчисления в резервный фонд и амортизация (ТЗ 13, PRD-04 A-01).
   */
  @Get('pnl')
  pnl() {
    const acc = this.billing.accounts();
    const val = (code: string) => acc.find((a) => a.code === code)?.balanceTiyin ?? 0;
    const revenue = val('revenue');
    const masterShare = val('master_share_expense');
    const providerFees = val('provider_fees');
    const reserveFund = val('reserve_expense');
    const depreciation = 0; // амортизация — фаза 2 (F-052), пока не начисляется
    const gross = revenue - masterShare;
    const operating = gross - providerFees - reserveFund - depreciation;
    return {
      revenueTiyin: revenue,
      masterShareTiyin: masterShare,
      providerFeesTiyin: providerFees,
      reserveFundTiyin: reserveFund,
      depreciationTiyin: depreciation,
      grossTiyin: gross,
      operatingTiyin: operating,
      grossMarginPercent: revenue ? Math.round((gross / revenue) * 100) : 0,
      operatingMarginPercent: revenue ? Math.round((operating / revenue) * 100) : 0,
      note: 'Амортизация оборудования начисляется с фазы 2 (F-052). Выручка — по проводкам закрытых заявок.',
    };
  }

  /** F-008: NPS по оценкам клиентов (промоутеры 5, нейтралы 4, критики ≤3) */
  @Get('nps')
  async nps() {
    const all = await this.orders.list('t0');
    const rated = all.filter((o) => typeof o.rating === 'number');
    const promoters = rated.filter((o) => (o.rating ?? 0) >= 5).length;
    const passives = rated.filter((o) => o.rating === 4).length;
    const detractors = rated.filter((o) => (o.rating ?? 0) <= 3).length;
    const closed = all.filter((o) => ['closed', 'rated'].includes(o.status)).length;
    return {
      ratedCount: rated.length,
      closedCount: closed,
      coveragePercent: closed ? Math.round((rated.length / closed) * 100) : 0,
      promoters,
      passives,
      detractors,
      nps: rated.length ? Math.round(((promoters - detractors) / rated.length) * 100) : null,
      note: rated.length === 0 ? 'Оценки появятся с клиентским приложением и веб-карточкой (окно 72 ч, ТЗ 4.1)' : undefined,
    };
  }

  /** F-003: упущенный спрос — сигнал найма */
  @Get('demand-miss')
  demandMiss() {
    const items = this.analytics.demandMisses;
    const byReason = new Map<string, number>();
    const byCategory = new Map<string, number>();
    const byDate = new Map<string, number>();
    for (const m of items) {
      byReason.set(m.reason, (byReason.get(m.reason) ?? 0) + 1);
      if (m.category) byCategory.set(m.category, (byCategory.get(m.category) ?? 0) + 1);
      const d = m.at.slice(0, 10);
      byDate.set(d, (byDate.get(d) ?? 0) + 1);
    }
    return {
      total: items.length,
      byReason: [...byReason.entries()].map(([reason, count]) => ({ reason, count })),
      byCategory: [...byCategory.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count),
      byDate: [...byDate.entries()].sort().map(([date, count]) => ({ date, count })),
      hint: 'Рост упущенного спроса — сигнал найма мастеров (ТЗ 17.3)',
    };
  }

  /** F-005: follow-up — доля повторных клиентов и выручка повторных заявок */
  @Get('follow-up')
  async followUp() {
    const all = await this.orders.list('t0');
    const byClient = new Map<string, typeof all>();
    for (const o of all) {
      const list = byClient.get(o.clientPhone) ?? [];
      list.push(o);
      byClient.set(o.clientPhone, list);
    }
    const repeatClients = [...byClient.values()].filter((list) => list.length > 1);
    const repeatOrders = repeatClients.flatMap((list) => list.slice(1));
    const closedRepeat = repeatOrders.filter((o) => ['closed', 'rated'].includes(o.status));
    return {
      clientsTotal: byClient.size,
      repeatClients: repeatClients.length,
      repeatSharePercent: byClient.size ? Math.round((repeatClients.length / byClient.size) * 100) : 0,
      repeatOrders: repeatOrders.length,
      repeatRevenueTiyin: closedRepeat.reduce((s, o) => s + o.totalFromTiyin, 0),
      warrantyOrders: all.filter((o) => o.graphType === 'warranty').length,
    };
  }

  /** F-004: доля парных заявок — триггер «экипажа дня» (ТЗ 17.3) */
  @Get('pairs')
  async pairs() {
    const all = await this.orders.list('t0');
    const paired = all.filter((o) => o.helperId);
    return {
      ordersTotal: all.length,
      pairedOrders: paired.length,
      pairedSharePercent: all.length ? Math.round((paired.length / all.length) * 100) : 0,
      hint: 'Доля парных выше порога — повод собрать стабильный «экипаж дня» (фаза 2, ТЗ 17.3)',
    };
  }

  /** Сводка для дашборда: всё вместе одним запросом */
  @Get()
  async summary() {
    const [nps, followUp, pairs] = await Promise.all([this.nps(), this.followUp(), this.pairs()]);
    return {
      pnl: this.pnl(),
      nps,
      demandMiss: this.demandMiss(),
      followUp,
      pairs,
      complaints: this.quality.complaintStats(),
      capacity: this.scheduling.capacity(new Date().toISOString().slice(0, 10)),
    };
  }

  /** Регистрация упущенного спроса (вызывает планировщик/лендинг при отсутствии окон) */
  @Post('demand-miss')
  @Roles('admin', 'accountant', 'dispatcher')
  record(@Body() b: { date?: string; reason?: DemandMissRec['reason']; category?: string; zone?: string }) {
    return this.analytics.recordMiss({
      date: b?.date ?? new Date().toISOString().slice(0, 10),
      reason: b?.reason ?? 'no_windows',
      category: b?.category,
      zone: b?.zone,
    });
  }
}

@Module({
  imports: [OrdersModule, BillingModule, QualityModule, SchedulingModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
