import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { dbFailure } from '../../common/db-failure';
import { queue } from '../../common/pg-mirror';
import { currentDbContext, systemContext } from '../../common/db-context';
import type { BuildingConnectionStatus, ObservationSeverity, ObservationSource } from '@sozo/contracts';
import { StateStore } from '../../common/state-store';

export const BUILDING_REPOSITORY = Symbol('BUILDING_REPOSITORY');

export interface BuildingRecord {
  id: string;
  tenantId: string;
  operatorOrgId: string | null;
  name: string;
  address: string;
  buildingType: 'residential' | 'business_center' | 'mixed';
  connectionStatus: BuildingConnectionStatus;
  /** часы работ и шумных работ: 'HH:MM' */
  workFrom: string;
  workTo: string;
  noiseFrom: string;
  noiseTo: string;
  /** проход охрана → лифт → помещение; добавляется к дорожному буферу планировщика */
  internalBufferMin: number;
  /** правила пропуска — мастер читает их на экране M-44 перед приездом */
  hasServiceLift: boolean;
  parkingRules: string | null;
  wasteRules: string | null;
  emergencyPhone: string | null;
  dispatchPhone: string | null;
  /** базисные пункты, 500 = 5%; потолок 1000 (DEV-15 §8.2) */
  serviceFeeBps: number;
  verifiedBy: string | null;
  verifiedAt: string | null;
  /** счётчики деградации SLA за 30 дней (DEV-15 §9.3) */
  permitsTotal30d: number;
  permitsOverdue30d: number;
  emergencyOverdue30d: number;
}

export interface UnitRecord {
  id: string;
  tenantId: string;
  buildingId: string;
  entrance: string | null;
  floor: number | null;
  number: string;
  unitType: 'apartment' | 'office' | 'storage' | 'parking';
  /** стояки помещения — по ним считается зона влияния отключения */
  riserIds: string[];
}

export interface CommonZoneRecord {
  id: string;
  tenantId: string;
  buildingId: string;
  zoneType: string;
  label: string;
  riserId: string | null;
  /** запрещает авто-согласие молчанием всегда (DEV-15 §9.3) */
  isCritical: boolean;
  /** мастерам платформы наряд не выдаётся никогда (ТЗ 17.8) */
  isLicensed: boolean;
}

export interface BuildingStaffRecord {
  id: string;
  tenantId: string;
  buildingId: string;
  userPhone: string;
  fullName: string;
  staffRole: 'master' | 'approver' | 'dispatcher' | 'engineer' | 'head' | 'admin';
  isBackup: boolean;
  isDuty: boolean;
}

/**
 * In-memory реестр объектов контура «Дом» (M7-E0). Замещается Prisma-репозиторием
 * в той же стори, что и остальные (DEV-15 §14, M7-E0-S3).
 */
@Injectable()
export class InMemoryBuildingRepository implements OnModuleInit {
  private buildings = new Map<string, BuildingRecord>();
  private units = new Map<string, UnitRecord>();
  private zones = new Map<string, CommonZoneRecord>();
  private staff = new Map<string, BuildingStaffRecord>();
  private observations = new Map<string, ObservationRecord>();
  private equipment = new Map<string, EquipmentRecord>();
  private defects = new Map<string, DefectRecord>();
  private opPrices = new Map<string, OperatorPriceItem>();
  private claims = new Map<string, ClaimRequest>();
  private demand = new Map<string, DemandSignal>();
  private residents = new Map<string, ResidentRecord>();
  private routes = new Map<string, WalkthroughRoute>();
  private walks = new Map<string, WalkthroughRecord>();
  private maintenance = new Map<string, MaintenanceRecord>();

  private readonly store: StateStore;
  private loaded = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(store: StateStore, private readonly prisma: PrismaService) {
    this.store = store;
    if (!this.prisma.enabled) store.register(
      'buildings',
      () => ({
        buildings: [...this.buildings.values()],
        units: [...this.units.values()],
        zones: [...this.zones.values()],
        staff: [...this.staff.values()],
        observations: [...this.observations.values()],
        equipment: [...this.equipment.values()],
        defects: [...this.defects.values()],
        opPrices: [...this.opPrices.values()],
        claims: [...this.claims.values()],
        demand: [...this.demand.values()],
        residents: [...this.residents.values()],
        routes: [...this.routes.values()],
        walks: [...this.walks.values()],
        maintenance: [...this.maintenance.values()],
      }),
      (data) => {
        const d = data as {
          buildings?: BuildingRecord[];
          units?: UnitRecord[];
          zones?: CommonZoneRecord[];
          staff?: BuildingStaffRecord[];
          observations?: ObservationRecord[];
          equipment?: EquipmentRecord[];
          defects?: DefectRecord[];
          opPrices?: OperatorPriceItem[];
          claims?: ClaimRequest[];
          demand?: DemandSignal[];
          residents?: ResidentRecord[];
          routes?: WalkthroughRoute[];
          walks?: WalkthroughRecord[];
          maintenance?: MaintenanceRecord[];
        };
        this.buildings = new Map((d.buildings ?? []).map((b) => [b.id, b]));
        this.units = new Map((d.units ?? []).map((u) => [u.id, u]));
        this.zones = new Map((d.zones ?? []).map((z) => [z.id, z]));
        this.staff = new Map((d.staff ?? []).map((s) => [s.id, s]));
        this.observations = new Map((d.observations ?? []).map((o) => [o.id, o]));
        this.equipment = new Map((d.equipment ?? []).map((e) => [e.id, e]));
        this.defects = new Map((d.defects ?? []).map((x) => [x.id, x]));
        this.opPrices = new Map((d.opPrices ?? []).map((x) => [x.id, x]));
        this.claims = new Map((d.claims ?? []).map((x) => [x.id, x]));
        this.demand = new Map((d.demand ?? []).map((x) => [x.id, x]));
        this.residents = new Map((d.residents ?? []).map((x) => [x.id, x]));
        this.routes = new Map((d.routes ?? []).map((x) => [x.id, x]));
        this.walks = new Map((d.walks ?? []).map((x) => [x.id, x]));
        this.maintenance = new Map((d.maintenance ?? []).map((x) => [x.id, x]));
      },
    );
  }


  /**
   * Загрузка и запись при работе на базе.
   *
   * Репозиторий держит четырнадцать коллекций, и точечная запись потребовала бы
   * знать, что именно изменилось, — то есть второй модели предметной области.
   * Поэтому запись отложенная и полная, ровно как делает файловое хранилище,
   * которое переписывает весь снимок. Объектов в системе единицы, коллекции
   * мелкие: цена этого решения — доли секунды раз в полсекунды.
   */
  async onModuleInit(): Promise<void> {
    if (!this.prisma.enabled) {
      this.loaded = true;
      return;
    }
    const d = await this.prisma.withContext(async (tx) => ({
      buildings: await tx.building.findMany(),
      opPrices: await tx.operatorPriceItem.findMany(),
      claims: await tx.buildingClaim.findMany(),
      demand: await tx.demandSignal.findMany(),
      routes: await tx.walkthroughRoute.findMany(),
      walks: await tx.walkthrough.findMany(),
      maintenance: await tx.maintenanceSession.findMany(),
    }));
    const rows = d.buildings.length + d.opPrices.length + d.claims.length + d.demand.length;
    if (rows === 0 && this.buildings.size === 0) {
      this.loaded = true;
      return;
    }
    if (d.buildings.length) {
      // База — источник истины: то, что собрано в конструкторе, замещается
      this.buildings.clear();
      for (const b of d.buildings) this.buildings.set(b.id, fromDbBuilding(b));
    }
    this.opPrices.clear();
    for (const x of d.opPrices) this.opPrices.set(x.id, fromDbOpPrice(x));
    this.claims.clear();
    for (const x of d.claims) this.claims.set(x.id, fromDbClaim(x));
    this.demand.clear();
    for (const x of d.demand) this.demand.set(x.id, { id: x.id, tenantId: APP_TENANT, address: x.address, phone: x.phone, createdAt: x.createdAt.toISOString() } as DemandSignal);
    this.routes.clear();
    for (const x of d.routes) this.routes.set(x.id, fromDbRoute(x));
    this.walks.clear();
    for (const x of d.walks) this.walks.set(x.id, fromDbWalk(x));
    this.maintenance.clear();
    for (const x of d.maintenance) this.maintenance.set(x.id, fromDbMaintenance(x));
    this.loaded = true;
    // eslint-disable-next-line no-console
    console.log(`[Buildings] из базы: объектов ${this.buildings.size}, обходов ${this.walks.size}, сессий ТО ${this.maintenance.size}`);
  }

  /**
   * Запись без задержки, в отличие от файлового хранилища.
   *
   * Отложенная запись здесь создаёт гонку: на объект ссылается заявка через
   * внешний ключ, и созданная сразу после объекта заявка упиралась в строку,
   * которой в базе ещё нет. Полсекунды дебаунса — это десятки запросов.
   * Поэтому пишем сразу, а последовательность гарантируется цепочкой
   * промисов: вторая запись ждёт первую, а не идёт параллельно.
   */
  /**
   * Разовый перенос объектов в базу (deploy/import-state).
   *
   * Объекты, в отличие от планировщика, с включённой базой файл не читают —
   * снимок приходит параметром. Заполняется тот же набор в памяти, что и при
   * загрузке из файла, и пишется тем же writeAll.
   */
  async importFromState(data: unknown): Promise<Record<string, number>> {
    const d = data as Record<string, Array<{ id: string }>>;
    const fill = <T extends { id: string }>(name: string): Map<string, T> =>
      new Map(((d?.[name] ?? []) as T[]).map((x) => [x.id, x]));
    this.buildings = fill('buildings');
    this.units = fill('units');
    this.zones = fill('zones');
    this.staff = fill('staff');
    this.observations = fill('observations');
    this.equipment = fill('equipment');
    this.defects = fill('defects');
    this.opPrices = fill('opPrices');
    this.claims = fill('claims');
    this.demand = fill('demand');
    this.residents = fill('residents');
    this.routes = fill('routes');
    this.walks = fill('walks');
    this.maintenance = fill('maintenance');
    this.loaded = true;
    this.scheduleWrite();
    await this.writing;
    return {
      объектов: this.buildings.size,
      помещений: this.units.size,
      зон: this.zones.size,
      замечаний: this.observations.size,
      обходов: this.walks.size,
    };
  }

  private writing: Promise<void> = Promise.resolve();

  private scheduleWrite(): void {
    if (!this.prisma.enabled || !this.loaded) return;
    // Общая очередь на процесс: своя цепочка соблюдала порядок внутри
    // модуля, но не между модулями — наряд успевал записаться раньше
    // объекта, на который ссылается (см. WriteQueue)
    // Снимок берётся в момент постановки в очередь, а не выполнения: иначе
    // задача, поставленная раньше, захватывает записи, созданные позже, чьи
    // зависимости стоят в очереди дальше (разобрано в permit.repository)
    const snap = this.snapshot();
    this.writing = queue().add(async () => {
      try {
        await this.writeAll(snap);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[Buildings] запись в базу не удалась:', dbFailure(e));
      }
    });
  }

  /** Состояние на момент постановки в очередь — см. scheduleWrite */
  private snapshot() {
    return {
      buildings: [...this.buildings.values()],
      units: [...this.units.values()],
      zones: [...this.zones.values()],
      staff: [...this.staff.values()],
      observations: [...this.observations.values()],
      equipment: [...this.equipment.values()],
      defects: [...this.defects.values()],
      opPrices: [...this.opPrices.values()],
      claims: [...this.claims.values()],
      demand: [...this.demand.values()],
      residents: [...this.residents.values()],
      routes: [...this.routes.values()],
      walks: [...this.walks.values()],
      maintenance: [...this.maintenance.values()],
    };
  }

  private async writeAll(snap: ReturnType<InMemoryBuildingRepository['snapshot']>): Promise<void> {
    const tenantId = (currentDbContext() ?? systemContext()).tenantId;
    await this.prisma.withContext(async (tx) => {
      for (const b of snap.buildings) {
        const data = {
          name: b.name,
          address: b.address,
          connectionStatus: b.connectionStatus,
          operatorOrgId: b.operatorOrgId ?? null,
          emergencyPhone: b.emergencyPhone ?? null,
          dispatchPhone: b.dispatchPhone ?? null,
          serviceFeeBps: b.serviceFeeBps ?? 0,
          workFrom: b.workFrom ?? null,
          workTo: b.workTo ?? null,
          noiseFrom: b.noiseFrom ?? null,
          noiseTo: b.noiseTo ?? null,
          permitsTotal30d: b.permitsTotal30d ?? 0,
          permitsOverdue30d: b.permitsOverdue30d ?? 0,
          emergencyOverdue30d: b.emergencyOverdue30d ?? 0,
        };
        await tx.building.upsert({ where: { id: b.id }, create: { id: b.id, tenantId, ...data }, update: data });
      }
      // Дети объекта: помещения, зоны, персонал, жители, оборудование,
      // дефекты, замечания.
      //
      // Их не писали вовсе — семь коллекций из четырнадцати. Записать было
      // нельзя: у пяти моделей схема расходилась с кодом настолько, что
      // запись не собиралась (разобрано в m40). На базе они жили только в
      // памяти процесса и исчезали при перезапуске.
      for (const u of snap.units) {
        const data = {
          buildingId: u.buildingId, entrance: u.entrance, floor: u.floor,
          number: u.number, unitType: u.unitType, riserIds: u.riserIds,
        };
        await tx.unit.upsert({ where: { id: u.id }, create: { id: u.id, tenantId, ...data }, update: data });
      }
      for (const z of snap.zones) {
        const data = {
          buildingId: z.buildingId, zoneType: z.zoneType, label: z.label,
          riserId: z.riserId, isCritical: z.isCritical, isLicensed: z.isLicensed,
        };
        await tx.commonZone.upsert({ where: { id: z.id }, create: { id: z.id, tenantId, ...data }, update: data });
      }
      for (const st of snap.staff) {
        const data = {
          buildingId: st.buildingId, userPhone: st.userPhone, fullName: st.fullName,
          staffRole: st.staffRole as never, isBackup: Boolean(st.isBackup), isDuty: Boolean(st.isDuty),
          skillTags: [],
        };
        await tx.buildingStaff.upsert({ where: { id: st.id }, create: { id: st.id, tenantId, ...data }, update: data });
      }
      for (const r of snap.residents) {
        const data = {
          unitId: r.unitId, userPhone: r.userPhone, fullName: r.fullName ?? '',
          residentRole: r.residentRole as never, verifiedBy: r.verifiedBy,
        };
        await tx.unitResident.upsert({ where: { id: r.id }, create: { id: r.id, tenantId, ...data }, update: data });
      }
      for (const e of snap.equipment) {
        const data = {
          buildingId: e.buildingId, commonZoneId: e.commonZoneId, equipmentType: e.equipmentType,
          model: e.model, serial: e.serial,
          commissionedAt: e.commissionedAt ? new Date(e.commissionedAt) : null,
          intervalDays: e.intervalDays,
          lastServiceAt: e.lastServiceAt ? new Date(e.lastServiceAt) : null,
          isLicensed: e.isLicensed,
        };
        await tx.buildingEquipment.upsert({ where: { id: e.id }, create: { id: e.id, tenantId, ...data }, update: data });
      }
      for (const d of snap.defects) {
        const data = {
          buildingId: d.buildingId, commonZoneId: d.commonZoneId, equipmentId: d.equipmentId,
          title: d.title, severity: d.severity as string,
          // Дефект дома точки B2B не имеет — колонка обнуляема с m40
          locationId: null,
          description: d.title,
          estimatedCostTiyin: BigInt(Math.max(0, d.estimatedCostTiyin)),
          // CHECK в m40: отложенный дефект обязан иметь срок — «потом» без
          // даты это не решение, а способ его не принимать
          deadline: d.decision === 'postponed' ? new Date(d.deadline ?? Date.now() + 30 * 86_400_000) : (d.deadline ? new Date(d.deadline) : null),
          responsible: d.responsible, source: d.source, observationId: d.observationId,
          decision: d.decision, decisionReason: d.decisionReason, decisionBy: d.decisionBy,
          decisionAt: d.decisionAt ? new Date(d.decisionAt) : null,
          status: d.status as never,
          priority: d.severity === 'emergency' || d.severity === 'critical' ? 'critical' : 'medium',
        };
        await tx.defect.upsert({ where: { id: d.id }, create: { id: d.id, tenantId, ...data }, update: data });
      }
      for (const o of snap.observations) {
        const data = {
          buildingId: o.buildingId, zoneKey: o.zoneKey, unitId: o.unitId,
          authorPhone: o.authorPhone, source: o.source as never, categoryId: o.categoryId,
          severity: o.severity as never, photoIds: o.photoIds, comment: o.comment,
          status: o.status, suggestedRoute: o.suggestedRoute, joinedBy: o.joinedBy,
          routedTo: o.routedTo, routedEntityId: o.routedEntityId,
          resolvedAt: o.resolvedAt ? new Date(o.resolvedAt) : null,
          resolvedPhotoId: o.resolvedPhotoId,
        };
        await tx.buildingObservation.upsert({
          where: { id: o.id },
          create: { id: o.id, tenantId, createdAt: new Date(o.createdAt), ...data },
          update: data,
        });
      }

      await tx.operatorPriceItem.deleteMany({});
      for (const x of snap.opPrices) {
        await tx.operatorPriceItem.create({
          data: {
            id: x.id, tenantId, operatorOrgId: x.operatorOrgId, buildingId: x.buildingId,
            name: x.name, unit: x.unit, priceFromTiyin: BigInt(x.priceFromTiyin),
            priceToTiyin: BigInt(x.priceToTiyin), scope: x.scope, isActive: x.isActive,
          },
        });
      }
      await tx.buildingClaim.deleteMany({});
      for (const x of snap.claims) {
        await tx.buildingClaim.create({
          data: {
            id: x.id, tenantId, buildingId: x.buildingId, operatorOrgId: x.operatorOrgId,
            operatorName: x.operatorName, applicantPhone: x.applicantPhone, documentKind: x.documentKind,
            documentId: x.documentId, contactPhone: x.contactPhone, status: x.status,
            callbackResult: x.callbackResult, decisionBy: x.decisionBy,
            decisionAt: x.decisionAt ? new Date(x.decisionAt) : null, decisionReason: x.decisionReason,
          },
        });
      }
      await tx.demandSignal.deleteMany({});
      for (const x of snap.demand) {
        await tx.demandSignal.create({ data: { id: x.id, tenantId, address: x.address, phone: x.phone, createdAt: new Date(x.createdAt) } });
      }
      await tx.walkthroughRoute.deleteMany({});
      for (const x of snap.routes) {
        await tx.walkthroughRoute.create({
          data: {
            id: x.id, tenantId, buildingId: x.buildingId, name: x.name, intervalDays: x.intervalDays,
            zoneKeys: x.zoneKeys, lastWalkAt: x.lastWalkAt ? new Date(x.lastWalkAt) : null, isActive: x.isActive,
          },
        });
      }
      await tx.walkthrough.deleteMany({});
      for (const x of snap.walks) {
        await tx.walkthrough.create({
          data: {
            id: x.id, tenantId, buildingId: x.buildingId, routeId: x.routeId, routeName: x.routeName,
            walkerPhone: x.walkerPhone, startedAt: new Date(x.startedAt),
            finishedAt: x.finishedAt ? new Date(x.finishedAt) : null,
            passedZones: x.passedZones, observationIds: [],
          },
        });
      }
      await tx.maintenanceSession.deleteMany({});
      for (const x of snap.maintenance) {
        await tx.maintenanceSession.create({
          data: {
            id: x.id, tenantId, buildingId: x.buildingId, equipmentId: x.equipmentId,
            equipmentType: x.equipmentType, masterPhone: x.masterPhone, startedAt: new Date(x.startedAt),
            finishedAt: x.finishedAt ? new Date(x.finishedAt) : null,
            itemsJson: x.items as unknown as Prisma.InputJsonValue, observationIds: [],
          },
        });
      }
    });
  }

  saveBuilding(b: BuildingRecord): void {
    this.scheduleWrite();
    this.buildings.set(b.id, b);
  }
  getBuilding(tenantId: string, id: string): BuildingRecord | undefined {
    const b = this.buildings.get(id);
    return b && b.tenantId === tenantId ? b : undefined;
  }
  listBuildings(tenantId: string, operatorOrgId?: string): BuildingRecord[] {
    return [...this.buildings.values()].filter(
      (b) => b.tenantId === tenantId && (!operatorOrgId || b.operatorOrgId === operatorOrgId),
    );
  }
  /** Матчинг адреса: точное совпадение, затем частичное (dev-заглушка гео-полигонов) */
  findByAddress(tenantId: string, address: string): BuildingRecord[] {
    const q = address.trim().toLowerCase();
    if (!q) return [];
    const all = [...this.buildings.values()].filter((b) => b.tenantId === tenantId);
    const exact = all.filter((b) => b.address.toLowerCase() === q);
    if (exact.length) return exact;
    return all.filter((b) => b.address.toLowerCase().includes(q) || q.includes(b.address.toLowerCase()));
  }

  saveUnit(u: UnitRecord): void {
    this.scheduleWrite();
    this.units.set(u.id, u);
  }
  getUnit(tenantId: string, id: string): UnitRecord | undefined {
    const u = this.units.get(id);
    return u && u.tenantId === tenantId ? u : undefined;
  }
  listUnits(tenantId: string, buildingId: string): UnitRecord[] {
    return [...this.units.values()].filter((u) => u.tenantId === tenantId && u.buildingId === buildingId);
  }
  /** Помещения на указанных стояках — зона влияния отключения (DEV-15 §5) */
  unitsByRisers(tenantId: string, buildingId: string, riserIds: string[]): UnitRecord[] {
    if (!riserIds.length) return this.listUnits(tenantId, buildingId);
    return this.listUnits(tenantId, buildingId).filter((u) =>
      u.riserIds.some((r) => riserIds.includes(r)),
    );
  }

  saveZone(z: CommonZoneRecord): void {
    this.scheduleWrite();
    this.zones.set(z.id, z);
  }
  listZones(tenantId: string, buildingId: string): CommonZoneRecord[] {
    return [...this.zones.values()].filter((z) => z.tenantId === tenantId && z.buildingId === buildingId);
  }
  zonesByTypes(tenantId: string, buildingId: string, types: string[]): CommonZoneRecord[] {
    return this.listZones(tenantId, buildingId).filter((z) => types.includes(z.zoneType));
  }

  saveStaff(s: BuildingStaffRecord): void {
    this.scheduleWrite();
    this.staff.set(s.id, s);
  }
  listStaff(tenantId: string, buildingId: string, role?: BuildingStaffRecord['staffRole']): BuildingStaffRecord[] {
    return [...this.staff.values()].filter(
      (s) => s.tenantId === tenantId && s.buildingId === buildingId && (!role || s.staffRole === role),
    );
  }

  saveObservation(o: ObservationRecord): void {
    this.scheduleWrite();
    this.observations.set(o.id, o);
  }
  getObservation(tenantId: string, id: string): ObservationRecord | undefined {
    const o = this.observations.get(id);
    return o && o.tenantId === tenantId ? o : undefined;
  }
  listObservations(tenantId: string, buildingId: string, status?: ObservationRecord['status']): ObservationRecord[] {
    return [...this.observations.values()]
      .filter((o) => o.tenantId === tenantId && o.buildingId === buildingId && (!status || o.status === status))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }
  /** Открытые замечания той же зоны за N дней — основа дедупликации (DEV-15 §7.7.5) */
  openInZone(tenantId: string, buildingId: string, zoneKey: string, days: number): ObservationRecord[] {
    const since = Date.now() - days * 86_400_000;
    return this.listObservations(tenantId, buildingId).filter(
      (o) => o.zoneKey === zoneKey && o.status !== 'resolved' && Date.parse(o.createdAt) >= since,
    );
  }

  saveEquipment(e: EquipmentRecord): void {
    this.scheduleWrite();
    this.equipment.set(e.id, e);
  }
  getEquipment(tenantId: string, id: string): EquipmentRecord | undefined {
    const e = this.equipment.get(id);
    return e && e.tenantId === tenantId ? e : undefined;
  }
  listEquipment(tenantId: string, buildingId: string): EquipmentRecord[] {
    return [...this.equipment.values()].filter((e) => e.tenantId === tenantId && e.buildingId === buildingId);
  }

  saveDefect(d: DefectRecord): void {
    this.scheduleWrite();
    this.defects.set(d.id, d);
  }
  getDefect(tenantId: string, id: string): DefectRecord | undefined {
    const d = this.defects.get(id);
    return d && d.tenantId === tenantId ? d : undefined;
  }
  listDefects(tenantId: string, buildingId: string): DefectRecord[] {
    return [...this.defects.values()]
      .filter((d) => d.tenantId === tenantId && d.buildingId === buildingId)
      .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
  }

  saveOperatorPrice(x: OperatorPriceItem): void {
    this.scheduleWrite();
    this.opPrices.set(x.id, x);
  }
  getOperatorPrice(tenantId: string, id: string): OperatorPriceItem | undefined {
    const x = this.opPrices.get(id);
    return x && x.tenantId === tenantId ? x : undefined;
  }
  /** Прайс оператора: общий для всех его объектов + переопределения на конкретный объект */
  listOperatorPrices(tenantId: string, operatorOrgId: string, buildingId?: string): OperatorPriceItem[] {
    return [...this.opPrices.values()].filter(
      (x) =>
        x.tenantId === tenantId &&
        x.operatorOrgId === operatorOrgId &&
        x.isActive &&
        (!x.buildingId || !buildingId || x.buildingId === buildingId),
    );
  }

  saveRoute(x: WalkthroughRoute): void {
    this.scheduleWrite();
    this.routes.set(x.id, x);
  }
  getRoute(tenantId: string, id: string): WalkthroughRoute | undefined {
    const x = this.routes.get(id);
    return x && x.tenantId === tenantId ? x : undefined;
  }
  listRoutes(tenantId: string, buildingId: string): WalkthroughRoute[] {
    return [...this.routes.values()].filter((x) => x.tenantId === tenantId && x.buildingId === buildingId);
  }

  saveMaintenance(x: MaintenanceRecord): void {
    this.scheduleWrite();
    this.maintenance.set(x.id, x);
  }
  getMaintenance(tenantId: string, id: string): MaintenanceRecord | undefined {
    const x = this.maintenance.get(id);
    return x && x.tenantId === tenantId ? x : undefined;
  }
  /** История по оборудованию — свежие сверху: её читают, чтобы понять, что было в прошлый раз */
  listMaintenance(tenantId: string, equipmentId: string): MaintenanceRecord[] {
    return [...this.maintenance.values()]
      .filter((x) => x.tenantId === tenantId && x.equipmentId === equipmentId)
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  }

  saveWalk(x: WalkthroughRecord): void {
    this.scheduleWrite();
    this.walks.set(x.id, x);
  }
  getWalk(tenantId: string, id: string): WalkthroughRecord | undefined {
    const x = this.walks.get(id);
    return x && x.tenantId === tenantId ? x : undefined;
  }
  listWalks(tenantId: string, buildingId: string): WalkthroughRecord[] {
    return [...this.walks.values()]
      .filter((x) => x.tenantId === tenantId && x.buildingId === buildingId)
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  }

  saveClaim(c: ClaimRequest): void {
    this.scheduleWrite();
    this.claims.set(c.id, c);
  }
  getClaim(tenantId: string, id: string): ClaimRequest | undefined {
    const c = this.claims.get(id);
    return c && c.tenantId === tenantId ? c : undefined;
  }
  listClaims(tenantId: string, status?: ClaimRequest['status']): ClaimRequest[] {
    return [...this.claims.values()]
      .filter((c) => c.tenantId === tenantId && (!status || c.status === status))
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  }
  claimsForBuilding(tenantId: string, buildingId: string): ClaimRequest[] {
    return [...this.claims.values()].filter((c) => c.tenantId === tenantId && c.buildingId === buildingId);
  }

  saveDemand(d: DemandSignal): void {
    this.scheduleWrite();
    this.demand.set(d.id, d);
  }
  listDemand(tenantId: string): DemandSignal[] {
    return [...this.demand.values()].filter((d) => d.tenantId === tenantId);
  }

  saveResident(r: ResidentRecord): void {
    this.scheduleWrite();
    this.residents.set(r.id, r);
  }
  listResidents(tenantId: string, unitId: string): ResidentRecord[] {
    return [...this.residents.values()].filter((r) => r.tenantId === tenantId && r.unitId === unitId);
  }
  residentsOfBuilding(tenantId: string, unitIds: string[]): ResidentRecord[] {
    return [...this.residents.values()].filter((r) => r.tenantId === tenantId && unitIds.includes(r.unitId));
  }
}

export interface ObservationRecord {
  id: string;
  tenantId: string;
  buildingId: string;
  /** зона или место: id общей зоны либо свободная метка («двор», «подъезд 2») */
  zoneKey: string;
  unitId: string | null;
  authorPhone: string;
  source: ObservationSource;
  categoryId: string;
  severity: ObservationSeverity;
  photoIds: string[];
  comment: string | null;
  status: 'open' | 'routed' | 'resolved' | 'rejected';
  routedTo: 'task' | 'defect' | 'order' | 'contractor' | 'journal' | null;
  /** маршрут из категории A-44 — предложение кабинету, решение за человеком */
  suggestedRoute: 'task' | 'defect' | 'order' | 'contractor' | 'journal';
  /** заявка, созданная по этому замечанию (аварийное — автоматически) */
  routedEntityId: string | null;
  resolvedPhotoId: string | null;
  resolvedAt: string | null;
  /** к какому замечанию присоединились дубликаты */
  joinedBy: string[];
  createdAt: string;
}

/** Порядок сортировки техдолга: аварийное всегда сверху */
export const SEVERITY_ORDER = ['emergency', 'critical', 'substantial', 'cosmetic'] as const;
export type DefectSeverity = (typeof SEVERITY_ORDER)[number];

export interface EquipmentRecord {
  id: string;
  tenantId: string;
  buildingId: string;
  commonZoneId: string | null;
  equipmentType: string;
  model: string | null;
  serial: string | null;
  commissionedAt: string | null;
  /** регламент ТО в днях; null — обслуживание по факту */
  intervalDays: number | null;
  lastServiceAt: string | null;
  /** газ, лифты, пожарные системы — мастерам платформы не назначается (ТЗ 17.8) */
  isLicensed: boolean;
}

/**
 * Сессия планового ТО (M-47). Отдельная сущность, а не поле у оборудования:
 * `lastServiceAt` отвечает на вопрос «когда», а надзору и правлению нужен
 * ответ на «что именно проверили и кто» — с отметками по пунктам и фото.
 */
export interface MaintenanceRecord {
  id: string;
  tenantId: string;
  buildingId: string;
  equipmentId: string;
  /** копия типа на момент работы: регламент может смениться, запись — нет */
  equipmentType: string;
  masterPhone: string;
  startedAt: string;
  finishedAt: string | null;
  items: MaintenanceItemMark[];
  /** замечания, зафиксированные в ходе ТО */
  observationIds: string[];
}

export interface MaintenanceItemMark {
  itemId: string;
  done: boolean;
  note: string | null;
  photoIds: string[];
  at: string;
}

export interface DefectRecord {
  id: string;
  tenantId: string;
  buildingId: string;
  commonZoneId: string | null;
  equipmentId: string | null;
  title: string;
  severity: DefectSeverity;
  estimatedCostTiyin: number;
  deadline: string | null;
  responsible: string | null;
  source: 'inspection' | 'order' | 'observation' | 'complaint' | 'supervision' | 'maintenance';
  observationId: string | null;
  /** решение оператора; отклонённый дефект НЕ удаляется — юридическая защита */
  decision: 'planned' | 'postponed' | 'rejected' | null;
  decisionReason: string | null;
  decisionBy: string | null;
  decisionAt: string | null;
  status: 'open' | 'in_progress' | 'fixed';
  createdAt: string;
}

/**
 * Позиция собственного прайса эксплуатирующей организации (DEV-15 §8.6).
 * Это НЕ прайс платформы: работы по нему выполняет служба оператора, деньги
 * идут мимо платформы. Нужен, чтобы житель видел в приложении оба предложения
 * и осознанно выбирал исполнителя — именно этот выбор определяет, будет ли
 * начислен сервисный сбор.
 */
export interface OperatorPriceItem {
  id: string;
  tenantId: string;
  operatorOrgId: string;
  /** null — прайс на все объекты оператора; иначе переопределение на объект */
  buildingId: string | null;
  name: string;
  unit: string;
  priceFromTiyin: number;
  priceToTiyin: number;
  /** работа в помещении жителя или по общему имуществу */
  scope: 'private' | 'common_area';
  isActive: boolean;
}

/**
 * Регламент обхода (DEV-15 §7.7.6). Строится на существующих чек-листах осмотров A-26 —
 * новых сущностей для самого чек-листа не вводится, здесь только периодичность и зоны.
 */
export interface WalkthroughRoute {
  id: string;
  tenantId: string;
  buildingId: string;
  name: string;
  /** периодичность в днях: двор — 1, кровля и техэтаж — 7 */
  intervalDays: number;
  /** зоны маршрута: id общих зон либо свободные метки («двор», «подъезд 1») */
  zoneKeys: string[];
  lastWalkAt: string | null;
  isActive: boolean;
}

export interface WalkthroughRecord {
  id: string;
  tenantId: string;
  buildingId: string;
  routeId: string;
  routeName: string;
  walkerPhone: string;
  startedAt: string;
  finishedAt: string | null;
  /** зоны, отмеченные пройденными */
  passedZones: string[];
  /** замечания, зафиксированные в этом обходе */
  observationIds: string[];
}

/**
 * Заявка организации на подключение объекта (DEV-15 §10.9).
 *
 * Отдельная сущность, а не поле здания: заявок на один объект может быть
 * несколько, и решение по каждой должно храниться со своей причиной.
 * Отклонённая заявка не удаляется — она защита от повторной попытки того же
 * заявителя и материал для чёрного списка.
 */
export interface ClaimRequest {
  id: string;
  tenantId: string;
  buildingId: string;
  operatorOrgId: string;
  operatorName: string;
  applicantPhone: string;
  /** договор управления · протокол ОСС · свидетельство · договор ТО */
  documentKind: string;
  documentId: string | null;
  /** телефон, указанный заявителем — сверяется с накопленным контактом */
  contactPhone: string | null;
  status: 'pending' | 'frozen' | 'approved' | 'rejected';
  /** результат обратного звонка на телефон объекта из открытых источников */
  callbackResult: 'confirmed' | 'denied' | 'no_answer' | null;
  decisionBy: string | null;
  decisionAt: string | null;
  decisionReason: string | null;
  createdAt: string;
}

/** Обращение «моего дома здесь нет» с публичной страницы объекта (L-10) */
export interface DemandSignal {
  id: string;
  tenantId: string;
  address: string;
  phone: string | null;
  createdAt: string;
}

/**
 * Житель помещения. Арендатор ограничен в правах по общему имуществу
 * (DEV-15 §12 п.6): распоряжаться им вправе собственник.
 */
export interface ResidentRecord {
  id: string;
  tenantId: string;
  unitId: string;
  userPhone: string;
  fullName: string | null;
  residentRole: 'owner' | 'tenant' | 'family';
  verifiedBy: 'operator' | 'document' | 'self' | 'crowd';
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Строка базы → запись приложения
// ---------------------------------------------------------------------------
//
// Арендатор в приложении обозначается литералом 't0', в базе это uuid, на
// котором стоят политики RLS. Перевод держится здесь, как и в репозитории
// заявок: наружу отдаём то, что ожидает остальной код.

const APP_TENANT = 't0';

function fromDbBuilding(b: Record<string, unknown>): BuildingRecord {
  return {
    id: b.id as string,
    tenantId: APP_TENANT,
    name: b.name as string,
    address: b.address as string,
    connectionStatus: b.connectionStatus as BuildingRecord['connectionStatus'],
    operatorOrgId: (b.operatorOrgId ?? null) as string | null,
    emergencyPhone: (b.emergencyPhone ?? null) as string | null,
    dispatchPhone: (b.dispatchPhone ?? null) as string | null,
    serviceFeeBps: Number(b.serviceFeeBps ?? 0),
    workFrom: (b.workFrom ?? null) as string | null,
    workTo: (b.workTo ?? null) as string | null,
    noiseFrom: (b.noiseFrom ?? null) as string | null,
    noiseTo: (b.noiseTo ?? null) as string | null,
    permitsTotal30d: Number(b.permitsTotal30d ?? 0),
    permitsOverdue30d: Number(b.permitsOverdue30d ?? 0),
    emergencyOverdue30d: Number(b.emergencyOverdue30d ?? 0),
  } as unknown as BuildingRecord;
}

function fromDbOpPrice(x: Record<string, unknown>): OperatorPriceItem {
  return {
    id: x.id as string,
    tenantId: APP_TENANT,
    operatorOrgId: x.operatorOrgId as string,
    buildingId: (x.buildingId ?? null) as string | null,
    name: x.name as string,
    unit: x.unit as string,
    priceFromTiyin: Number(x.priceFromTiyin),
    priceToTiyin: Number(x.priceToTiyin),
    scope: x.scope as OperatorPriceItem['scope'],
    isActive: Boolean(x.isActive),
  };
}

function fromDbClaim(x: Record<string, unknown>): ClaimRequest {
  return {
    id: x.id as string,
    tenantId: APP_TENANT,
    buildingId: x.buildingId as string,
    operatorOrgId: x.operatorOrgId as string,
    operatorName: x.operatorName as string,
    applicantPhone: x.applicantPhone as string,
    documentKind: x.documentKind as string,
    documentId: (x.documentId ?? null) as string | null,
    contactPhone: (x.contactPhone ?? null) as string | null,
    status: x.status as ClaimRequest['status'],
    callbackResult: (x.callbackResult ?? null) as ClaimRequest['callbackResult'],
    decisionBy: (x.decisionBy ?? null) as string | null,
    decisionAt: (x.decisionAt as Date | null)?.toISOString() ?? null,
    decisionReason: (x.decisionReason ?? null) as string | null,
  } as unknown as ClaimRequest;
}

function fromDbRoute(x: Record<string, unknown>): WalkthroughRoute {
  return {
    id: x.id as string,
    tenantId: APP_TENANT,
    buildingId: x.buildingId as string,
    name: x.name as string,
    intervalDays: Number(x.intervalDays),
    zoneKeys: x.zoneKeys as string[],
    lastWalkAt: (x.lastWalkAt as Date | null)?.toISOString() ?? null,
    isActive: Boolean(x.isActive),
  };
}

function fromDbWalk(x: Record<string, unknown>): WalkthroughRecord {
  return {
    id: x.id as string,
    tenantId: APP_TENANT,
    buildingId: x.buildingId as string,
    routeId: x.routeId as string,
    routeName: x.routeName as string,
    walkerPhone: x.walkerPhone as string,
    startedAt: (x.startedAt as Date).toISOString(),
    finishedAt: (x.finishedAt as Date | null)?.toISOString() ?? null,
    passedZones: x.passedZones as string[],
    observationIds: (x.observationIds ?? []) as string[],
  } as unknown as WalkthroughRecord;
}

function fromDbMaintenance(x: Record<string, unknown>): MaintenanceRecord {
  return {
    id: x.id as string,
    tenantId: APP_TENANT,
    buildingId: x.buildingId as string,
    equipmentId: x.equipmentId as string,
    equipmentType: x.equipmentType as string,
    masterPhone: x.masterPhone as string,
    startedAt: (x.startedAt as Date).toISOString(),
    finishedAt: (x.finishedAt as Date | null)?.toISOString() ?? null,
    items: (x.itemsJson ?? []) as MaintenanceRecord['items'],
    observationIds: (x.observationIds ?? []) as string[],
  } as unknown as MaintenanceRecord;
}
