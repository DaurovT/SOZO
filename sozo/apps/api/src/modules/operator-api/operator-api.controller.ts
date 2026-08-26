import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../identity/auth.guard';
import { OperatorScopeGuard } from './operator-scope.guard';
import type { JwtClaims } from '../../common/jwt';
import { BuildingsService } from '../buildings/buildings.service';
import { AccessService } from '../access/access.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { OrdersService } from '../orders/orders.service';
import { MastersService } from '../masters/masters.module';
import { AffiliationService } from '../masters/affiliation.service';
import { SchedulingService } from '../scheduling/scheduling.service';
import { localDateKey } from '../../common/tz';

/**
 * Кабинет эксплуатирующей организации (PRD-07). Модуль агрегирует данные доменных
 * модулей и не содержит бизнес-логики: правила живут там, где им место.
 * Скоуп по оператору — до RLS проверяется здесь; после M7-E0-S5 останется как первый слой.
 */
@Controller('operator')
@UseGuards(AuthGuard, OperatorScopeGuard)
export class OperatorApiController {
  constructor(
    private readonly buildings: BuildingsService,
    private readonly access: AccessService,
    private readonly subs: SubscriptionsService,
    private readonly orders: OrdersService,
    private readonly masters: MastersService,
    private readonly affiliation: AffiliationService,
    private readonly scheduling: SchedulingService,
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

  /**
   * U-05: свои мастера — реестр, загрузка, ленты.
   *
   * Оператор видит только своих: чужой мастер для него не существует, и
   * показать его значит дать возможность поставить на свою заявку человека,
   * с которым у оператора нет договора.
   *
   * Загрузка берётся из планировщика на сегодня — это то, ради чего экран
   * открывают: кого ещё можно нагрузить, а кто уже не тянет.
   */
  @Get(':orgId/masters')
  operatorMasters(@Param('orgId') orgId: string, @Query('date') date?: string) {
    const day = date ?? localDateKey();
    const affiliations = this.affiliation.listByOrg('t0', orgId);
    const all = this.masters.list();
    const rows = affiliations.map((a) => {
      const m = all.find((x) => x.id === a.masterId);
      const lane = this.scheduling.lane(a.masterId, day);
      return {
        masterId: a.masterId,
        fullName: m?.fullName ?? 'мастер не найден',
        phone: m?.phone ?? null,
        // Статус в платформе и статус у оператора — разные вещи: мастер может
        // быть активен у нас и приостановлен оператором, и наоборот
        platformStatus: m?.status ?? null,
        status: a.status,
        suspendReason: a.suspendReason,
        since: a.since,
        until: a.until,
        skillTags: a.skillTags.length ? a.skillTags : (m?.skillTags ?? []),
        hourlyCostTiyin: a.hourlyCostTiyin,
        objectIds: a.objectIds,
        load: {
          date: day,
          hasShift: Boolean(lane.shift),
          bookings: lane.bookings.length,
          busyMin: lane.busyMin,
          loadPercent: lane.loadPercent,
          capReached: lane.capReached,
        },
      };
    });
    const active = rows.filter((r) => r.status === 'active');
    return {
      total: rows.length,
      active: active.length,
      // Без смены на сегодня мастер не получит ни одной заявки — это первое,
      // что смотрят утром
      withoutShift: active.filter((r) => !r.load.hasShift).length,
      rows,
    };
  }

  /**
   * Завести штатного мастера.
   *
   * Двумя путями: по телефону существующего мастера платформы (он работает и
   * там, и здесь — мультиаффилиация) или заведением нового. Второй случай —
   * обычный для оператора: человек уже работает у него годами и в платформе
   * его нет.
   *
   * Экзамен для штатного мастера оператора необязателен — решение владельца
   * (DEV-15 §7.1.1). Поэтому карточка сразу активна, а не «кандидат»:
   * иначе оператор не смог бы поставить на заявку собственного слесаря.
   */
  @Post(':orgId/masters')
  hireMaster(
    @Param('orgId') orgId: string,
    @Body() body: {
      masterId?: string;
      fullName?: string;
      phone?: string;
      skillTags?: string[];
      hourlyCostTiyin?: number;
      since?: string;
      until?: string | null;
      objectIds?: string[];
    },
  ) {
    let masterId = body.masterId;
    if (!masterId) {
      if (!body.phone?.match(/^\+998\d{9}$/)) {
        throw new BadRequestException({ code: 'PHONE_INVALID', message: 'Телефон мастера: +998XXXXXXXXX' });
      }
      const existing = this.masters.list().find((m) => m.phone === body.phone);
      if (existing) {
        masterId = existing.id;
      } else {
        if (!body.fullName?.trim()) {
          throw new BadRequestException({ code: 'NAME_REQUIRED', message: 'Имя мастера обязательно' });
        }
        const created = this.masters.create({
          fullName: body.fullName.trim(),
          phone: body.phone,
          skillTags: body.skillTags ?? [],
          taxMode: 'gph',
          hasVehicle: false,
        });
        // Экзамен необязателен — карточка сразу рабочая (DEV-15 §7.1.1).
        // Иначе оператор не смог бы поставить на заявку собственного слесаря,
        // который работает у него годами
        this.masters.update(created.id, { status: 'active' });
        masterId = created.id;
      }
    }
    const rec = this.affiliation.hire('t0', orgId, masterId, body);
    const m = this.masters.list().find((x) => x.id === masterId);
    return { ...rec, fullName: m?.fullName ?? null, phone: m?.phone ?? null };
  }

  @Post(':orgId/masters/:masterId/suspend')
  suspendMaster(@Param('orgId') orgId: string, @Param('masterId') masterId: string, @Body() body: { reason?: string }) {
    return this.affiliation.suspend('t0', orgId, masterId, body?.reason ?? '');
  }

  @Post(':orgId/masters/:masterId/resume')
  resumeMaster(@Param('orgId') orgId: string, @Param('masterId') masterId: string) {
    return this.affiliation.resume('t0', orgId, masterId);
  }

  @Post(':orgId/masters/:masterId/terminate')
  terminateMaster(@Param('orgId') orgId: string, @Param('masterId') masterId: string, @Body() body: { until?: string }) {
    return this.affiliation.terminate('t0', orgId, masterId, body?.until);
  }

  /**
   * Назначить своего мастера на заявку.
   *
   * Три проверки, и каждая закрывает свой способ ошибиться: заявка должна
   * быть на объекте оператора, мастер — числиться за ним действующим
   * договором, а сама заявка — принадлежать оператору (общее имущество или
   * взятая по праву первой руки). Иначе оператор смог бы поставить своего
   * человека на чужую работу и на чужие деньги.
   */
  @Post(':orgId/orders/:orderId/assign')
  async assignOwnMaster(
    @Param('orgId') orgId: string,
    @Param('orderId') orderId: string,
    @Body() body: { masterId: string },
    @Req() req: { auth: JwtClaims },
  ) {
    const order = await this.orders.get('t0', orderId);
    if (!order.buildingId || !this.buildingIds(orgId).includes(order.buildingId)) {
      throw new ForbiddenException({ code: 'NOT_YOUR_BUILDING', message: 'Заявка не на вашем объекте' });
    }
    if (order.orderScope !== 'common_area' && order.claimedByOperator !== orgId) {
      throw new ForbiddenException({
        code: 'NOT_YOUR_ORDER',
        message: 'Частная заявка жителя достаётся вам только по праву первой руки',
      });
    }
    if (!this.affiliation.isActive('t0', body?.masterId, orgId)) {
      throw new ForbiddenException({
        code: 'NOT_YOUR_MASTER',
        message: 'Мастер за вами не числится или его договор приостановлен',
      });
    }
    const master = this.masters.get(body.masterId);
    // Первое назначение и переназначение — разные действия конвейера.
    // Переназначение возможно только на статусах «Назначена»…«Доп-согласование»
    // (ТЗ 4.5), и звать его для новой заявки значит получить отказ по стадии
    // вместо назначения.
    //
    // Неоценённая заявка отклоняется отдельным сообщением: граф вернул бы
    // «нарушение конвейера», а человеку нужно знать не это, а что сделать
    if (order.status === 'new' && order.graphType !== 'emergency') {
      throw new BadRequestException({
        code: 'ORDER_NOT_ESTIMATED',
        message: 'Заявка ещё не оценена — назначить мастера можно после оценки',
      });
    }
    if (order.status === 'estimated' || order.status === 'approved' || order.status === 'new') {
      return this.orders.transition(
        't0',
        orderId,
        { action: 'assign', version: order.version },
        req.auth.phone,
        { masterId: master.id, masterName: master.fullName },
      );
    }
    return this.orders.reassign('t0', orderId, master.id, master.fullName, 'назначен службой объекта', req.auth.phone);
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
