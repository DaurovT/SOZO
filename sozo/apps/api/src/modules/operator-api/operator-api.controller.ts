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
