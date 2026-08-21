import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../identity/auth.guard';
import { BuildingsService } from '../buildings/buildings.service';
import { AccessService } from '../access/access.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { OrdersService } from '../orders/orders.service';

/**
 * Кабинет эксплуатирующей организации (PRD-07). Модуль агрегирует данные доменных
 * модулей и не содержит бизнес-логики: правила живут там, где им место.
 * Скоуп по оператору — до RLS проверяется здесь; после M7-E0-S5 останется как первый слой.
 */
@Controller('operator')
@UseGuards(AuthGuard)
export class OperatorApiController {
  constructor(
    private readonly buildings: BuildingsService,
    private readonly access: AccessService,
    private readonly subs: SubscriptionsService,
    private readonly orders: OrdersService,
  ) {}

  /**
   * Объекты оператора одним списком.
   *
   * Вынесено в помощник, а не переписано в каждом экране: скоуп по оператору
   * — это правило доступа, и повторять его семь раз значит однажды забыть.
   */
  private buildingIds(orgId: string): string[] {
    return this.buildings.listBuildings('t0', orgId).map((b) => b.id);
  }

  /**
   * U-03: заявки по общему имуществу.
   *
   * Только общее имущество и только объекты этого оператора. Частные заявки
   * жителей сюда не попадают никогда: оператор их не видит по определению —
   * это чужая работа в чужой квартире (ТЗ §19.3).
   */
  @Get(':orgId/orders')
  async commonAreaOrders(
    @Param('orgId') orgId: string,
    @Query('buildingId') buildingId?: string,
    @Query('status') status?: string,
  ) {
    const ids = buildingId ? [buildingId] : this.buildingIds(orgId);
    const all = await this.orders.list('t0');
    const rows = all
      .filter((o) => o.buildingId && ids.includes(o.buildingId) && o.orderScope === 'common_area')
      .filter((o) => !status || o.status === status)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((o) => ({
        id: o.id,
        number: o.number,
        buildingId: o.buildingId,
        status: o.status,
        urgency: o.urgency,
        description: o.description,
        address: o.address,
        masterName: o.masterName ?? null,
        laborSettlement: o.laborSettlement ?? null,
        createdAt: o.createdAt.toISOString(),
      }));
    // Разбивка по статусам — то, ради чего экран открывают: видно, что висит
    const byStatus: Record<string, number> = {};
    for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    return { total: rows.length, byStatus, rows };
  }

  /**
   * U-08: паспорт здания.
   *
   * Зоны, стояки, оборудование и регламенты ТО в одном ответе: это
   * справочная страница, её открывают целиком и читают глазами, а не
   * фильтруют. Четыре запроса ради одного экрана — четыре повода получить
   * несогласованный снимок.
   */
  @Get(':orgId/buildings/:buildingId/passport')
  passport(@Param('orgId') orgId: string, @Param('buildingId') buildingId: string) {
    const b = this.buildings.get('t0', buildingId);
    const zones = this.buildings.listZones('t0', buildingId);
    const units = this.buildings.listUnits('t0', buildingId);
    // Стояки не хранятся отдельной сущностью: они собираются из помещений и
    // зон, потому что стояк — это то, что их связывает, а не самостоятельный
    // объект учёта
    const risers = [...new Set([...units.flatMap((u) => u.riserIds), ...zones.map((z) => z.riserId).filter(Boolean)])];
    return {
      building: {
        id: b.id,
        name: b.name,
        address: b.address,
        connectionStatus: b.connectionStatus,
        workFrom: b.workFrom ?? null,
        workTo: b.workTo ?? null,
        noiseFrom: b.noiseFrom ?? null,
        noiseTo: b.noiseTo ?? null,
        emergencyPhone: b.emergencyPhone ?? null,
        dispatchPhone: b.dispatchPhone ?? null,
      },
      zones: zones.map((z) => ({
        id: z.id,
        zoneType: z.zoneType,
        label: z.label,
        riserId: z.riserId ?? null,
        isCritical: z.isCritical,
        isLicensed: z.isLicensed,
      })),
      risers,
      unitsTotal: units.length,
      equipment: this.buildings.listEquipment('t0', buildingId),
      maintenance: this.buildings.maintenancePlan('t0', buildingId),
    };
  }

  /**
   * U-09: техдолг объекта.
   *
   * Дефекты, их стоимость и то, по скольким решение ещё не принято. Последнее
   * — главное число экрана: незакрытый дефект без решения не стоит ничего в
   * плане и всплывает аварией.
   */
  @Get(':orgId/buildings/:buildingId/tech-debt')
  techDebt(@Param('orgId') orgId: string, @Param('buildingId') buildingId: string) {
    return {
      summary: this.buildings.defectSummary('t0', buildingId),
      defects: this.buildings.listDefects('t0', buildingId),
      observations: this.buildings.listObservations('t0', buildingId, 'open'),
    };
  }

  /**
   * U-15: подписка, тариф, расчёт.
   *
   * Нетто-расчёт показывается одной суммой со знаком: у оператора и
   * платформы встречные обязательства, и два платежа навстречу друг другу —
   * это две комиссии банка и два повода не сойтись.
   */
  // Не `:orgId/subscription`: этот адрес уже занят записью подписки в модуле
  // subscriptions, и второй обработчик на нём молча не вызывался бы. Здесь
  // экран, а там сущность — разные вещи и разные адреса
  @Get(':orgId/billing-overview')
  subscription(@Param('orgId') orgId: string) {
    const sub = this.subs.get('t0', orgId);
    const settlement = this.subs.settlement('t0', orgId);
    return {
      subscription: sub ?? null,
      settlement,
      objectsTotal: this.buildingIds(orgId).length,
    };
  }

  /**
   * U-14: люди оператора и их роли.
   *
   * Собирается по объектам, а не из отдельного реестра: человек в этом
   * контуре существует как роль на объекте — согласующий, консьерж, инженер.
   * Один и тот же телефон может быть согласующим на одном объекте и
   * консьержем на другом, и «пользователь оператора» без объекта не значит
   * ничего.
   */
  @Get(':orgId/people')
  people(@Param('orgId') orgId: string) {
    const buildings = this.buildings.listBuildings('t0', orgId);
    const byPhone = new Map<string, { phone: string; fullName: string; roles: Array<{ buildingId: string; buildingName: string; staffRole: string; isBackup: boolean }> }>();
    for (const b of buildings) {
      for (const s of this.buildings.listStaff('t0', b.id)) {
        const rec = byPhone.get(s.userPhone) ?? { phone: s.userPhone, fullName: s.fullName, roles: [] };
        rec.roles.push({ buildingId: b.id, buildingName: b.name, staffRole: s.staffRole, isBackup: Boolean(s.isBackup) });
        byPhone.set(s.userPhone, rec);
      }
    }
    const people = [...byPhone.values()].sort((a, b) => a.fullName.localeCompare(b.fullName));
    return {
      total: people.length,
      // Объект без согласующего не может активироваться и не согласует наряды
      // — это первое, что смотрят на этом экране
      buildingsWithoutApprover: buildings
        .filter((b) => !this.buildings.listStaff('t0', b.id).some((s) => s.staffRole === 'approver'))
        .map((b) => ({ id: b.id, name: b.name })),
      people,
    };
  }

  /** U-01: дашборд объекта или портфеля — ответ на вопрос «что горит прямо сейчас» */
  @Get(':orgId/dashboard')
  dashboard(@Param('orgId') orgId: string, @Query('buildingId') buildingId?: string) {
    const all = this.buildings.listBuildings('t0', orgId);
    const scope = buildingId ? all.filter((b) => b.id === buildingId) : all;
    const ids = scope.map((b) => b.id);

    const permitsQueue = this.access.queue('t0', ids);
    const permitsOverdue = this.access.queue('t0', ids, true);
    const sub = this.subs.get('t0', orgId);

    const objects = scope.map((b) => {
      const shutdowns = this.access.listShutdowns('t0', b.id);
      const observations = this.buildings.listObservations('t0', b.id, 'open');
      const gaps = this.buildings.readinessGaps('t0', b);
      const overdueShare = b.permitsTotal30d ? b.permitsOverdue30d / b.permitsTotal30d : 0;
      return {
        buildingId: b.id,
        name: b.name,
        connectionStatus: b.connectionStatus,
        readinessGaps: gaps,
        permitsPending: permitsQueue.filter((p) => p.buildingId === b.id).length,
        permitsOverdue: permitsOverdue.filter((p) => p.buildingId === b.id).length,
        criticalPending: permitsQueue.filter((p) => p.buildingId === b.id && p.hasCriticalZone).length,
        shutdownsActive: shutdowns.filter((s) => s.status === 'active').length,
        shutdownsPlanned: shutdowns.filter((s) => s.status === 'scheduled').length,
        shutdownsLateNotice: shutdowns.filter((s) => s.lateNotice).length,
        observationsOpen: observations.length,
        observationsEmergency: observations.filter((o) => o.severity === 'emergency').length,
        health: this.health({
          degraded: b.connectionStatus === 'degraded',
          emergencyOverdue: b.emergencyOverdue30d > 0,
          emergencyObservations: observations.filter((o) => o.severity === 'emergency').length,
          overdueShare,
          criticalPending: permitsQueue.filter((p) => p.buildingId === b.id && p.hasCriticalZone).length,
          lateNotice: shutdowns.filter((s) => s.lateNotice).length,
          notActive: b.connectionStatus !== 'active',
        }),
      };
    });

    return {
      operatorOrgId: orgId,
      plan: sub?.plan ?? 'free',
      objectsTotal: all.length,
      scope: buildingId ? 'building' : 'portfolio',
      totals: {
        permitsPending: permitsQueue.length,
        permitsOverdue: permitsOverdue.length,
        criticalPending: permitsQueue.filter((p) => p.hasCriticalZone).length,
        objectsDegraded: scope.filter((b) => b.connectionStatus === 'degraded').length,
        objectsNotActive: scope.filter((b) => b.connectionStatus !== 'active').length,
      },
      objects,
    };
  }

  /**
   * Светофор объекта для U-01. Правило простое: красный — то, что требует действия
   * сегодня; жёлтый — то, что станет красным, если не тронуть.
   * Открытое аварийное замечание — всегда красный: экран отвечает на вопрос
   * «что горит прямо сейчас», и незамеченная авария обесценивает весь дашборд.
   */
  private health(x: {
    degraded: boolean;
    emergencyOverdue: boolean;
    emergencyObservations: number;
    overdueShare: number;
    criticalPending: number;
    lateNotice: number;
    notActive: boolean;
  }): 'red' | 'amber' | 'green' {
    if (x.degraded || x.emergencyOverdue || x.emergencyObservations > 0) return 'red';
    if (x.overdueShare > 0.2 || x.criticalPending > 0 || x.lateNotice > 0 || x.notActive) return 'amber';
    return 'green';
  }

  /** U-04: очередь заявок в окне первой руки */
  @Get(':orgId/first-refusal')
  async firstRefusal(@Param('orgId') orgId: string) {
    const ids = this.buildings.listBuildings('t0', orgId).map((b) => b.id);
    const [queue, stats] = await Promise.all([
      this.orders.firstRefusalQueue('t0', ids),
      this.orders.firstRefusalStats('t0', ids),
    ]);
    return { queue, stats };
  }

  /** U-04: забрать заявку своей службой в окне первой руки */
  @Post(':orgId/orders/:orderId/claim')
  claim(@Param('orgId') orgId: string, @Param('orderId') orderId: string) {
    return this.orders.claimByOperator('t0', orderId, orgId);
  }

  /** U-04: отпустить в общий пул с причиной */
  @Post(':orgId/orders/:orderId/release')
  release(@Param('orderId') orderId: string, @Body() body: { reason: string }) {
    return this.orders.releaseByOperator('t0', orderId, body.reason);
  }

  /** U-06: реестр помещений объекта */
  @Get(':orgId/buildings/:buildingId/units')
  units(@Param('buildingId') buildingId: string) {
    return this.buildings.listUnits('t0', buildingId);
  }

  /** U-16: замечания объекта */
  @Get(':orgId/buildings/:buildingId/observations')
  observations(
    @Param('buildingId') buildingId: string,
    @Query('status') status?: 'open' | 'routed' | 'resolved' | 'rejected',
  ) {
    return this.buildings.listObservations('t0', buildingId, status);
  }

  /** U-07: календарь отключений объекта */
  @Get(':orgId/buildings/:buildingId/shutdowns')
  shutdowns(@Param('buildingId') buildingId: string) {
    return this.access.listShutdowns('t0', buildingId);
  }

  // ---------- U-12: отчёты ----------

  /**
   * Отчёт по объекту за период. Три адресата, три акцента (DEV-15 §7.6):
   *   board  — правлению ЖК: что сделано, что в долгах, доказательство обходов;
   *   owner  — собственнику здания: деньги и SLA;
   *   tenant — арендаторам БЦ: только их SLA, без внутренней кухни.
   *
   * Отчёт содержит операционные и обезличенные данные. Персональные данные жителей
   * в выгрузки не попадают ни при каких настройках — это техническое ограничение,
   * а не политика (DEV-15 §12 п.4).
   */
  @Get(':orgId/buildings/:buildingId/report')
  report(
    @Param('buildingId') buildingId: string,
    @Query('audience') audience: 'board' | 'owner' | 'tenant' = 'board',
  ) {
    const b = this.buildings.get('t0', buildingId);
    const defects = this.buildings.defectSummary('t0', buildingId);
    const walks = this.buildings.listWalks('t0', buildingId).filter((w) => w.finishedAt);
    const walksDue = this.buildings.walkthroughsDue('t0', buildingId);
    const maintenance = this.buildings.maintenanceDue('t0', buildingId);
    const shutdowns = this.access.listShutdowns('t0', buildingId);
    const obsAll = this.buildings.listObservations('t0', buildingId);
    const obsResolved = obsAll.filter((o) => o.status === 'resolved');

    const common = {
      buildingId,
      buildingName: b.name,
      audience,
      generatedAt: new Date().toISOString(),
      connectionStatus: b.connectionStatus,
    };

    const maintenanceBlock = {
      overdue: maintenance.filter((m) => m.overdue).length,
      dueSoon: maintenance.filter((m) => m.dueSoon).length,
    };

    if (audience === 'tenant') {
      // Арендатору — только то, что касается его: сроки и предупреждения.
      // Техдолг и внутренние показатели службы ему не показываются.
      return {
        ...common,
        shutdowns: shutdowns.map((s) => ({
          resourceType: s.resourceType,
          plannedFrom: s.plannedFrom,
          plannedTo: s.plannedTo,
          status: s.status,
        })),
        maintenance: maintenanceBlock,
      };
    }

    const base = {
      ...common,
      observations: {
        total: obsAll.length,
        resolved: obsResolved.length,
        open: obsAll.length - obsResolved.length,
        // доля устранённого — главный показатель содержания объекта
        resolvedShare: obsAll.length ? Math.round((obsResolved.length / obsAll.length) * 100) : null,
      },
      walkthroughs: {
        completed: walks.length,
        overdueRoutes: walksDue.length,
        // обход с пропущенными зонами показывается как есть: правление должно
        // видеть не только факт обхода, но и его полноту
        withMissedZones: walks.filter((w) => {
          const route = this.buildings.listRoutes('t0', buildingId).find((r) => r.id === w.routeId);
          return route ? route.zoneKeys.some((z) => !w.passedZones.includes(z)) : false;
        }).length,
      },
      shutdowns: {
        total: shutdowns.length,
        emergency: shutdowns.filter((s) => s.isEmergency).length,
        lateNotice: shutdowns.filter((s) => s.lateNotice).length,
      },
      maintenance: maintenanceBlock,
      defects,
    };

    if (audience === 'owner') {
      const fin = this.subs.settlement('t0', b.operatorOrgId ?? '');
      return {
        ...base,
        finance: {
          subscriptionTiyin: fin.subscriptionTiyin,
          serviceFeeTiyin: fin.serviceFeeTiyin,
          netTiyin: fin.netTiyin,
        },
        techDebtCostTiyin: defects.totalCostTiyin,
      };
    }
    return base;
  }
}
