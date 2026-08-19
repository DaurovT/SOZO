import { Controller, Get, Module, Param, UseGuards } from '@nestjs/common';
import { AuthGuard, Roles } from '../identity/auth.guard';
import { OrdersModule } from '../orders/orders.module';
import { OrdersService } from '../orders/orders.service';
import type { OrderRecord } from '../orders/order.repository';
import { BillingModule } from '../billing/billing.module';
import { BillingService } from '../billing/billing.service';
import { MastersModule, MastersService } from '../masters/masters.module';
import { CrmModule } from '../crm/crm.module';
import { CrmService } from '../crm/crm.service';
import { PricingModule } from '../pricing/pricing.module';
import { PricingService } from '../pricing/pricing.service';
import { RatingService, RATING_COMPONENTS } from '../master-api/rating.service';
import { MasterOffersService } from '../master-api/offers.service';
import { MasterApiModule } from '../master-api/master-api.module';
import { QualityService } from '../quality/quality.service';
import { QualityModule } from '../quality/quality.module';
import { DispatchOpsModule } from '../dispatch-ops/dispatch-ops.module';
import { DispatchOpsService } from '../dispatch-ops/dispatch-ops.service';
import { MasterOpsService } from '../master-api/master-ops.service';
import { FieldModule } from '../field/field.module';
import { FieldService } from '../field/field.service';
import { RegistryModule, RegistryService } from '../registry/registry.module';

/** A-01: дашборд бизнеса — read-only агрегатор поверх модулей (BFF-слой) */
@Controller('admin/dashboard')
@UseGuards(AuthGuard)
@Roles('admin', 'accountant')
class DashboardController {
  constructor(
    private readonly orders: OrdersService,
    private readonly billing: BillingService,
    private readonly masters: MastersService,
    private readonly crm: CrmService,
    private readonly pricing: PricingService,
    private readonly rating: RatingService,
    private readonly offers: MasterOffersService,
    private readonly quality: QualityService,
    private readonly ops: DispatchOpsService,
    private readonly masterOps: MasterOpsService,
    private readonly field: FieldService,
    private readonly registry: RegistryService,
  ) {}

  /** A-11: полная карточка мастера — агрегат по всем модулям (BFF) */
  @Get('masters/:id/card')
  async masterCard(@Param('id') id: string) {
    const master = this.masters.get(id);
    const all = await this.orders.list('t0');
    const masterOrders = all.filter((o) => o.masterId === id);
    const closed = masterOrders.filter((o) => ['closed', 'rated'].includes(o.status));
    const payout = this.billing.payouts().find((p) => p.masterId === id);
    const gphDaysLeft = master.gphContractUntil
      ? Math.ceil((new Date(master.gphContractUntil).getTime() - Date.now()) / 86_400_000)
      : null;
    return {
      master,
      alerts: {
        gphExpiring: gphDaysLeft !== null && gphDaysLeft <= 14, // алерт за 14 дней (A-11)
        gphDaysLeft,
        cashDebtNearLimit: master.cashDebtTiyin >= 200_000_000 * 0.8, // 80% лимита 2 млн
        documentsMissing: master.documents.filter((d) => d.status === 'missing').length,
      },
      orders: {
        total: masterOrders.length,
        active: masterOrders.filter((o) => !['closed', 'rated', 'cancelled'].includes(o.status)).length,
        closed: closed.length,
        recent: masterOrders.slice(0, 20),
      },
      money: {
        accruedTiyin: payout?.accruedTiyin ?? 0,
        paidTiyin: payout?.paidTiyin ?? 0,
        dueTiyin: payout?.dueTiyin ?? 0,
        cashDebtTiyin: master.cashDebtTiyin,
        cashDebtLimitTiyin: 200_000_000,
      },
      equipment: [], // акты выдачи — A-13; появится с реестром EquipmentIssuance
      /**
       * Расчётная справка рейтинга (ТЗ 7.4).
       *
       * Раньше здесь стояла заглушка с подписью «рейтинг вручную, формула —
       * фаза 2». Формула к тому моменту уже считалась в `RatingService` и
       * показывалась самому мастеру — админка утверждала обратное о том, что
       * работает у неё под носом.
       */
      ratingBreakdown: this.ratingOf(master.id, all),
    };
  }

  /**
   * Разбор рейтинга по той же формуле, что видит сам мастер.
   *
   * Считаем на лету, а не храним: окно 56 дней сдвигается каждый день, и
   * сохранённое значение к утру становится неправдой.
   */
  private ratingOf(masterId: string, orders: OrderRecord[]) {
    const stats = this.offers.responseStats(masterId);
    const confirmed = this.quality.complaints.filter((c) => c.masterId === masterId && c.confirmed).length;
    const rework = orders.filter((o) => o.masterId === masterId && o.graphType === 'warranty').length;
    const r = this.rating.compute({
      orders,
      masterId,
      offerStats: { offers: stats.offers, accepted: stats.accepted },
      confirmedComplaints: confirmed,
      reworkOrders: rework,
    });
    return { ...r, definitions: RATING_COMPONENTS };
  }

  /**
   * Рейтинг всех мастеров одной таблицей.
   *
   * Карточка отвечает на вопрос «почему у него столько», а этот список — на
   * вопрос «у кого проблемы»: без него приходится открывать сорок карточек.
   */
  @Get('rating')
  async ratingAll() {
    const orders = await this.orders.list('t0');
    const rows = this.masters
      .list()
      .filter((m) => m.status !== 'offboarding')
      .map((m) => {
        const r = this.ratingOf(m.id, orders);
        return {
          masterId: m.id,
          fullName: m.fullName,
          status: m.status,
          storedRating: m.rating,
          storedGrade: m.grade,
          ...r,
          // Расхождение между сохранённым и расчётным: карточка обновляется,
          // когда мастер сам открывает свой рейтинг. Кто давно не заходил —
          // ходит со старым грейдом, и от него зависит доля
          drifted: m.rating !== r.score || m.grade !== r.grade,
        };
      })
      .sort((a, b) => a.score - b.score);
    return {
      masters: rows,
      definitions: RATING_COMPONENTS,
      drifted: rows.filter((r) => r.drifted).length,
      note: 'Расчёт по окну 56 дней. Сохранённый грейд обновляется, когда мастер открывает свой рейтинг',
    };
  }

  /**
   * Дырки в справочниках, из-за которых платформа однажды встанет.
   *
   * Позиции без нормо-часов дашборд считал и раньше, но остальное не проверял
   * никто: зона без мастеров означает заявки, которые некому взять, точка без
   * ответственного — акт, который некому подписать. Всё это заметно только
   * тогда, когда уже поздно.
   *
   * Не чиним автоматически: за каждой дыркой стоит решение человека, и
   * подставить недостающее значит спрятать проблему, а не решить.
   */
  @Get('integrity')
  async integrity() {
    const release = this.pricing.active();
    const masters = this.masters.list().filter((m) => m.status === 'active');
    const orgs = this.crm.list().map((o) => this.crm.get(o.id));

    const zonesWithoutMasters = this.registry.zones
      .filter((z) => z.active)
      .filter((z) => !masters.some((m) => m.zones.some((mz) => mz.toLowerCase() === z.name.toLowerCase())))
      .map((z) => `${z.city}, ${z.name}`);

    const locationsWithoutRep = orgs.flatMap((o) =>
      o.locations
        .filter((l) => (l.representatives ?? []).length === 0)
        .map((l) => `${o.name} · ${l.name}`),
    );
    const locationsWithoutPassport = orgs.flatMap((o) =>
      o.locations.filter((l) => l.passport.areaM2 === null).map((l) => `${o.name} · ${l.name}`),
    );
    const subscriptionsWithoutAmount = orgs
      .filter((o) => o.contractType === 'subscription' && !o.subscriptionTiyin)
      .map((o) => o.name);
    const skillsWithoutMasters = [...new Set(release.items.flatMap((i) => i.requiredSkills))]
      .filter((skill) => !masters.some((m) => m.skillTags.includes(skill)));

    const checks = [
      {
        code: 'norm_hours',
        title: 'Позиции прайса без нормо-часов',
        note: 'Планировщик считает такую работу за час — окна поедут',
        items: release.items.filter((i) => i.normHours == null).map((i) => i.name),
      },
      {
        code: 'name_uz',
        title: 'Позиции прайса без узбекского названия',
        note: 'Мастер и клиент на узбекском видят их по-русски',
        items: release.items.filter((i) => !i.nameUz).map((i) => i.name),
      },
      {
        code: 'zones',
        title: 'Активные зоны без мастеров',
        note: 'Заявку из этой зоны некому взять',
        items: zonesWithoutMasters,
      },
      {
        code: 'skills',
        title: 'Навыки из прайса, которых нет ни у кого',
        note: 'Позиция продаётся, а выполнить её некому',
        items: skillsWithoutMasters,
      },
      {
        code: 'representatives',
        title: 'Точки без ответственного',
        note: 'Акт осмотра и приёмку работ подписывать некому',
        items: locationsWithoutRep,
      },
      {
        code: 'subscription',
        title: 'Абонентские договоры без суммы',
        note: 'Счёт выставить не из чего',
        items: subscriptionsWithoutAmount,
      },
      {
        code: 'passport',
        title: 'Точки без паспорта объекта',
        note: 'Абонентка считается по типовой площади вместо настоящей',
        items: locationsWithoutPassport,
      },
    ];

    return {
      checks: checks.map((c) => ({ ...c, count: c.items.length, items: c.items.slice(0, 50) })),
      problems: checks.filter((c) => c.items.length > 0).length,
      note: 'Ничего не исправляется само: за каждой дыркой решение человека',
    };
  }

  /** A-07/A-16: финансы организации — баланс абонентки с прогнозом */
  @Get('organizations/:id/finance')
  async orgFinance(@Param('id') id: string) {
    const org = this.crm.get(id);
    const paid = this.billing
      .invoicesList()
      .filter((i) => i.organizationId === id && i.kind === 'subscription' && i.status === 'paid')
      .reduce((s, i) => s + i.amountTiyin, 0);
    const all = await this.orders.list('t0');
    const consumed = all
      .filter((o) => o.organizationId === id && ['closed', 'rated'].includes(o.status))
      .reduce((s, o) => s + o.totalFromTiyin, 0);
    const balance = paid - consumed;
    const daysInMonth = 30;
    const dayOfMonth = new Date().getDate();
    const burnPerDay = dayOfMonth > 0 ? consumed / dayOfMonth : 0;
    return {
      subscriptionTiyin: org.subscriptionTiyin,
      paidTiyin: paid,
      consumedTiyin: consumed,
      balanceTiyin: balance,
      forecastDay: burnPerDay > 0 ? Math.min(31, Math.floor(dayOfMonth + balance / burnPerDay)) : null, // «хватит до ~N числа»
      overlimit: balance < 0, // сверхлимит → отдельная СФ по ценам B2B разовой (ТЗ 8.3)
      contractKind: org.contractKind,
      priceFreeze: org.contractKind === 'annual' ? 'Цены заморожены на срок договора' : 'Перевод на текущий релиз при продлении',
    };
  }

  /** Карта: точки B2B + заявки B2C/B2B с гео (слой поверх агрегатора) */
  @Get('map')
  async map() {
    const all = await this.orders.list('t0');
    const orgs = this.crm.list();
    const locations = orgs.flatMap((o) => {
      const full = this.crm.get(o.id);
      return full.locations
        .filter((l) => l.lat != null && l.lng != null)
        .map((l) => ({
          id: l.id,
          name: l.name,
          address: l.address,
          organization: full.name,
          orgStatus: full.status,
          lat: l.lat,
          lng: l.lng,
        }));
    });
    return {
      locations,
      orders: all
        .filter((o) => o.lat != null && o.lng != null)
        .map((o) => ({
          id: o.id,
          number: o.number,
          graphType: o.graphType,
          status: o.status,
          urgency: o.urgency,
          clientPhone: o.clientPhone,
          address: o.address,
          totalFromTiyin: o.totalFromTiyin,
          lat: o.lat,
          lng: o.lng,
          active: !['closed', 'rated', 'cancelled'].includes(o.status),
        })),
    };
  }

  @Get()
  async summary() {
    const all = await this.orders.list('t0');
    const today = new Date().toDateString();
    const closed = all.filter((o) => o.status === 'closed' || o.status === 'rated');
    const closedToday = closed.filter((o) => o.statusLog.some((l) => l.to === 'closed' && new Date(l.at).toDateString() === today));
    const accounts = this.billing.accounts();
    const revenue = accounts.find((a) => a.code === 'revenue')?.balanceTiyin ?? 0;
    const check = this.billing.balanceCheck();
    return {
      orders: {
        total: all.length,
        b2c: all.filter((o) => o.graphType !== 'b2b').length,
        b2b: all.filter((o) => o.graphType === 'b2b').length,
        active: all.filter((o) => !['closed', 'rated', 'cancelled'].includes(o.status)).length,
        unassigned: all.filter((o) => ['new', 'estimated'].includes(o.status)).length,
        /**
         * Заявки без мастера дольше часа.
         *
         * «Неназначенных» рядом обычно много и это нормально — их только что
         * создали. Тревожит другое: заявка висит час и её никто не взял.
         * Смешивать одно с другим значит прятать вторую цифру за первой.
         */
        stuck: all.filter(
          (o) =>
            ['new', 'estimated'].includes(o.status) &&
            Date.now() - new Date(o.createdAt).getTime() > 3_600_000,
        ).length,
        /** Сорванный срок выезда по договору — за это организация вправе спросить */
        slaOverdue: all.filter(
          (o) =>
            o.slaDueAt &&
            new Date(o.slaDueAt).getTime() < Date.now() &&
            !['in_progress', 'completed', 'verified', 'closed', 'rated', 'cancelled'].includes(o.status),
        ).length,
        emergencies: all.filter((o) => o.urgency === 'emergency' && !['closed', 'rated', 'cancelled'].includes(o.status)).length,
        closedToday: closedToday.length,
        cancelled: all.filter((o) => o.status === 'cancelled').length,
      },
      /**
       * Что горит прямо сейчас.
       *
       * Дашборд считал всего понемногу и ничего не выделял: зависшая заявка
       * и сорванный SLA терялись среди двадцати плиток. Здесь только то,
       * из-за чего кто-то уже ждёт дольше обещанного.
       */
      urgent: {
        clientRequests: this.ops.openClientRequests().length,
        clientRequestsOverdue: this.ops
          .openClientRequests()
          .filter((r) => !!r.dueAt && new Date(r.dueAt).getTime() < Date.now()).length,
        partsToBuy: this.masterOps.toProcure().length,
        actsWaiting: this.field.list({ status: 'sent' }).length,
        actsExpired: this.field.list({ status: 'expired' }).length,
      },
      finance: {
        revenueTiyin: revenue,
        avgCheckTiyin: closed.length ? Math.round(closed.reduce((s, o) => s + o.totalFromTiyin, 0) / closed.length) : 0,
        masterPayableTiyin: accounts.find((a) => a.code === 'master_payable')?.balanceTiyin ?? 0,
        reserveFundTiyin: accounts.find((a) => a.code === 'reserve_fund')?.balanceTiyin ?? 0,
        arTiyin: accounts.find((a) => a.code === 'ar')?.balanceTiyin ?? 0,
        balanceCheckOk: check.ok,
      },
      people: {
        mastersActive: this.masters.list().filter((m) => m.status === 'active').length,
        mastersCandidates: this.masters.list().filter((m) => m.status !== 'active' && m.status !== 'blocked').length,
        organizations: this.crm.list().length,
      },
      pricing: {
        activeReleaseNumber: this.pricing.active().number,
        itemsCount: this.pricing.active().items.length,
        itemsWithoutNormHours: this.pricing.active().items.filter((i) => i.normHours == null).length,
      },
    };
  }
}

@Module({
  imports: [OrdersModule, BillingModule, MastersModule, CrmModule, PricingModule, MasterApiModule, QualityModule, DispatchOpsModule, FieldModule, RegistryModule],
  controllers: [DashboardController],
})
export class DashboardModule {}
