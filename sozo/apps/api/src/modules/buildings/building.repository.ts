import { Injectable } from '@nestjs/common';
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
export class InMemoryBuildingRepository {
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
  private routes = new Map<string, WalkthroughRoute>();
  private walks = new Map<string, WalkthroughRecord>();

  constructor(store: StateStore) {
    store.register(
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
        routes: [...this.routes.values()],
        walks: [...this.walks.values()],
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
          routes?: WalkthroughRoute[];
          walks?: WalkthroughRecord[];
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
        this.routes = new Map((d.routes ?? []).map((x) => [x.id, x]));
        this.walks = new Map((d.walks ?? []).map((x) => [x.id, x]));
      },
    );
  }

  saveBuilding(b: BuildingRecord): void {
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
    this.zones.set(z.id, z);
  }
  listZones(tenantId: string, buildingId: string): CommonZoneRecord[] {
    return [...this.zones.values()].filter((z) => z.tenantId === tenantId && z.buildingId === buildingId);
  }
  zonesByTypes(tenantId: string, buildingId: string, types: string[]): CommonZoneRecord[] {
    return this.listZones(tenantId, buildingId).filter((z) => types.includes(z.zoneType));
  }

  saveStaff(s: BuildingStaffRecord): void {
    this.staff.set(s.id, s);
  }
  listStaff(tenantId: string, buildingId: string, role?: BuildingStaffRecord['staffRole']): BuildingStaffRecord[] {
    return [...this.staff.values()].filter(
      (s) => s.tenantId === tenantId && s.buildingId === buildingId && (!role || s.staffRole === role),
    );
  }

  saveObservation(o: ObservationRecord): void {
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
    this.routes.set(x.id, x);
  }
  getRoute(tenantId: string, id: string): WalkthroughRoute | undefined {
    const x = this.routes.get(id);
    return x && x.tenantId === tenantId ? x : undefined;
  }
  listRoutes(tenantId: string, buildingId: string): WalkthroughRoute[] {
    return [...this.routes.values()].filter((x) => x.tenantId === tenantId && x.buildingId === buildingId);
  }

  saveWalk(x: WalkthroughRecord): void {
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
    this.demand.set(d.id, d);
  }
  listDemand(tenantId: string): DemandSignal[] {
    return [...this.demand.values()].filter((d) => d.tenantId === tenantId);
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
