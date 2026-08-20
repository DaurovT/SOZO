import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { uuidv7 } from '@sozo/kernel';
import { SERVICE_FEE_CAP_BPS } from '@sozo/kernel';
import { EventBus } from '../../common/event-bus';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { CrmService } from '../crm/crm.service';
import type { ObservationSeverity, ObservationSource } from '@sozo/contracts';
import {
  InMemoryBuildingRepository,
  type ObservationRecord,
  type EquipmentRecord,
  type DefectRecord,
  type DefectSeverity,
  type OperatorPriceItem,
  type WalkthroughRoute,
  type WalkthroughRecord,
  type ClaimRequest,
  type DemandSignal,
  type ResidentRecord,
  type BuildingRecord,
  type BuildingStaffRecord,
} from './building.repository';

/**
 * Справочник A-41, значения по умолчанию.
 * Критичные — авто-согласие молчанием запрещено всегда (DEV-15 §9.3).
 * Лицензируемые — наряд мастеру платформы не выдаётся никогда (ТЗ 17.8).
 */
export const DEFAULT_CRITICAL_ZONES = [
  'electrical_panel', 'gas_equipment', 'lift_machine_room', 'roof', 'fire_system', 'heat_point', 'ventilation_chamber',
];
export const DEFAULT_LICENSED_ZONES = ['gas_equipment', 'lift_machine_room', 'fire_system'];

export interface ResolveResult {
  match: 'exact' | 'candidates' | 'none';
  buildingId: string | null;
  unitId: string | null;
  connectionStatus: BuildingRecord['connectionStatus'];
  candidates: Array<{ buildingId: string; name: string; address: string }>;
}

/**
 * Модуль buildings (DEV-07 §2.1): объекты, помещения, зоны, персонал оператора,
 * адресный матчинг и жизненный цикл подключения (DEV-15 §2, §10.9).
 * Статусы подключения меняются только здесь.
 */
@Injectable()
export class BuildingsService {
  constructor(
    private readonly repo: InMemoryBuildingRepository,
    private readonly bus: EventBus,
    private readonly subs: SubscriptionsService,
    private readonly crm: CrmService,
  ) {}

  /**
   * Матчинг адреса заявки на объект (DEV-15 §2).
   * Неоднозначность не блокирует создание заявки — возвращаются кандидаты,
   * привязку делает клиент подтверждением или диспетчер в D-06.
   */
  resolve(tenantId: string, address: string): ResolveResult {
    const found = this.repo.findByAddress(tenantId, address);
    if (found.length === 1) {
      return {
        match: 'exact',
        buildingId: found[0].id,
        unitId: null,
        connectionStatus: found[0].connectionStatus,
        candidates: [],
      };
    }
    if (found.length > 1) {
      return {
        match: 'candidates',
        buildingId: null,
        unitId: null,
        connectionStatus: 'unmanaged',
        candidates: found.map((b) => ({ buildingId: b.id, name: b.name, address: b.address })),
      };
    }
    return { match: 'none', buildingId: null, unitId: null, connectionStatus: 'unmanaged', candidates: [] };
  }

  /** Заведение объекта (A-39 / импорт реестра M7-E0-S7) */
  createBuilding(
    tenantId: string,
    dto: Partial<BuildingRecord> & { name: string; address: string },
  ): BuildingRecord {
    const rec: BuildingRecord = {
      id: uuidv7(),
      tenantId,
      operatorOrgId: dto.operatorOrgId ?? null,
      name: dto.name,
      address: dto.address,
      buildingType: dto.buildingType ?? 'residential',
      connectionStatus: 'unmanaged',
      workFrom: dto.workFrom ?? '08:00',
      workTo: dto.workTo ?? '20:00',
      noiseFrom: dto.noiseFrom ?? '09:00',
      noiseTo: dto.noiseTo ?? '19:00',
      internalBufferMin: dto.internalBufferMin ?? 10,
      hasServiceLift: dto.hasServiceLift ?? false,
      parkingRules: dto.parkingRules ?? null,
      wasteRules: dto.wasteRules ?? null,
      emergencyPhone: dto.emergencyPhone ?? null,
      dispatchPhone: dto.dispatchPhone ?? null,
      serviceFeeBps: dto.serviceFeeBps ?? 500,
      verifiedBy: null,
      verifiedAt: null,
      permitsTotal30d: 0,
      permitsOverdue30d: 0,
      emergencyOverdue30d: 0,
    };
    this.repo.saveBuilding(rec);
    return rec;
  }

  addUnit(
    tenantId: string,
    buildingId: string,
    dto: { number: string; entrance?: string; floor?: number; unitType?: 'apartment' | 'office' | 'storage' | 'parking'; riserIds?: string[] },
  ) {
    this.get(tenantId, buildingId);
    const rec = {
      id: uuidv7(),
      tenantId,
      buildingId,
      entrance: dto.entrance ?? null,
      floor: dto.floor ?? null,
      number: dto.number,
      unitType: dto.unitType ?? ('apartment' as const),
      riserIds: dto.riserIds ?? [],
    };
    this.repo.saveUnit(rec);
    return rec;
  }

  addZone(
    tenantId: string,
    buildingId: string,
    dto: { zoneType: string; label: string; riserId?: string; isCritical?: boolean; isLicensed?: boolean },
  ) {
    this.get(tenantId, buildingId);
    const rec = {
      id: uuidv7(),
      tenantId,
      buildingId,
      zoneType: dto.zoneType,
      label: dto.label,
      riserId: dto.riserId ?? null,
      // критичность и лицензируемость по умолчанию берутся из справочника A-41
      isCritical: dto.isCritical ?? DEFAULT_CRITICAL_ZONES.includes(dto.zoneType),
      isLicensed: dto.isLicensed ?? DEFAULT_LICENSED_ZONES.includes(dto.zoneType),
    };
    this.repo.saveZone(rec);
    return rec;
  }

  listUnits(tenantId: string, buildingId: string) {
    return this.repo.listUnits(tenantId, buildingId);
  }

  listZones(tenantId: string, buildingId: string) {
    return this.repo.listZones(tenantId, buildingId);
  }

  /**
   * Эффективная ставка сервисного сбора (ТЗ §19.3 п.4а).
   *
   * Две модели монетизации взаимоисключающи — это осознанное правило, а не следствие:
   *   • **Pro** (бизнес-центр, свой техотдел): оператор платит подписку, обслуживает объект
   *     сам; если вызвал мастера платформы — платформа получает заявку целиком и делит
   *     её с мастером. Сбор оператору **не начисляется**.
   *   • **Free** (ЖК с управляющей компанией): оператор не платит ничего, работает своими
   *     мастерами; когда житель вызывает мастера платформы — оператор получает **5%**.
   *
   * Иначе оператор получал бы и подписку, и процент, а платформа платила бы дважды
   * за одного и того же клиента.
   */
  effectiveServiceFeeBps(tenantId: string, building: BuildingRecord): number {
    if (!building.operatorOrgId) return 0;
    const sub = this.subs.get(tenantId, building.operatorOrgId);
    const plan = sub?.plan ?? 'free';
    return plan === 'free' ? building.serviceFeeBps : 0;
  }

  addResident(
    tenantId: string,
    unitId: string,
    dto: { userPhone: string; fullName?: string; residentRole?: ResidentRecord['residentRole'] },
  ): ResidentRecord {
    const rec: ResidentRecord = {
      id: uuidv7(),
      tenantId,
      unitId,
      userPhone: dto.userPhone,
      fullName: dto.fullName ?? null,
      residentRole: dto.residentRole ?? 'owner',
      // заведён оператором — самый надёжный из способов подтверждения
      verifiedBy: 'operator',
      createdAt: new Date().toISOString(),
    };
    this.repo.saveResident(rec);
    return rec;
  }

  listResidents(tenantId: string, unitId: string) {
    return this.repo.listResidents(tenantId, unitId);
  }

  /** Сводка заселённости объекта для U-06 */
  residentsSummary(tenantId: string, buildingId: string) {
    const units = this.repo.listUnits(tenantId, buildingId);
    const residents = this.repo.residentsOfBuilding(tenantId, units.map((u) => u.id));
    const byUnit = new Map<string, number>();
    for (const r of residents) byUnit.set(r.unitId, (byUnit.get(r.unitId) ?? 0) + 1);
    return {
      unitsTotal: units.length,
      unitsWithResidents: byUnit.size,
      residentsTotal: residents.length,
      units: units.map((u) => ({
        id: u.id,
        number: u.number,
        entrance: u.entrance,
        floor: u.floor,
        unitType: u.unitType,
        riserIds: u.riserIds,
        residentsCount: byUnit.get(u.id) ?? 0,
      })),
    };
  }

  /** Портфель объектов оператора — U-01 в режиме портфеля */
  listBuildings(tenantId: string, operatorOrgId?: string): BuildingRecord[] {
    return this.repo.listBuildings(tenantId, operatorOrgId);
  }

  get(tenantId: string, id: string): BuildingRecord {
    const b = this.repo.getBuilding(tenantId, id);
    if (!b) throw new NotFoundException('Объект не найден');
    return b;
  }

  /**
   * Заявка организации на подключение объекта (self-serve, DEV-15 §10.9.1).
   *
   * Заявка НЕ даёт прав: она только встаёт в очередь модерации. Право
   * появляется решением человека — иначе любой заявит чужой дом и начнёт
   * согласовывать допуски в жилое здание.
   *
   * Второй заявитель не отклоняется: **замораживаются обе заявки**. Платформа
   * не арбитр в споре хозяйствующих субъектов, и молча отдать объект тому,
   * кто успел первым, — худшее из решений.
   */
  claim(
    tenantId: string,
    buildingId: string,
    dto: {
      operatorOrgId: string;
      operatorName?: string;
      applicantPhone: string;
      documentKind: string;
      documentId?: string;
      contactPhone?: string;
    },
  ): { claim: ClaimRequest; frozen: boolean; building: BuildingRecord } {
    const b = this.get(tenantId, buildingId);

    const existing = this.repo
      .claimsForBuilding(tenantId, buildingId)
      .filter((c) => c.status === 'pending' || c.status === 'frozen');

    const own = existing.find((c) => c.operatorOrgId === dto.operatorOrgId);
    if (own) return { claim: own, frozen: own.status === 'frozen', building: b };

    const rec: ClaimRequest = {
      id: uuidv7(),
      tenantId,
      buildingId,
      operatorOrgId: dto.operatorOrgId,
      operatorName: dto.operatorName ?? dto.operatorOrgId,
      applicantPhone: dto.applicantPhone,
      documentKind: dto.documentKind,
      documentId: dto.documentId ?? null,
      contactPhone: dto.contactPhone ?? null,
      status: existing.length > 0 ? 'frozen' : 'pending',
      callbackResult: null,
      decisionBy: null,
      decisionAt: null,
      decisionReason: null,
      createdAt: new Date().toISOString(),
    };
    this.repo.saveClaim(rec);

    // конфликт: замораживаем и ранее поданные — обе стороны ждут разбора
    if (existing.length > 0) {
      for (const c of existing) {
        c.status = 'frozen';
        this.repo.saveClaim(c);
      }
      this.bus.publish('building.claim_conflict', { buildingId, claims: existing.length + 1 });
    }

    if (b.connectionStatus === 'unmanaged') {
      b.connectionStatus = 'claimed';
      this.repo.saveBuilding(b);
    }
    this.bus.publish('building.claimed', { buildingId: b.id, operatorOrgId: dto.operatorOrgId });
    return { claim: rec, frozen: rec.status === 'frozen', building: b };
  }

  /**
   * Сигналы верификации для модератора (A-39). Ни один не решает сам —
   * они лишь показывают, сходится ли картина.
   *
   * Главный из них: контакт ТСЖ/УК, накопленный мастерами при первых осмотрах
   * (A-09). Эти данные старше любой заявки, и подделать их задним числом нельзя.
   */
  claimSignals(tenantId: string, claimId: string) {
    const c = this.repo.getClaim(tenantId, claimId);
    if (!c) throw new NotFoundException('Заявка не найдена');
    const b = this.get(tenantId, c.buildingId);

    const digits = (s: string | null) => (s ?? '').replace(/\D/g, '').slice(-9);
    const claimed = digits(c.contactPhone);

    // точки в этом же доме: сверяем накопленный контакт ТСЖ/УК с заявленным
    const known: Array<{ locationName: string; hoaContact: string; matches: boolean }> = [];
    const needle = b.address.toLowerCase().slice(0, 12);
    for (const loc of this.crm.allLocations()) {
      const sameAddress = typeof loc.address === 'string' && loc.address.toLowerCase().includes(needle);
      const hoa = loc.access?.hoaContact ?? null;
      if (sameAddress && hoa) {
        known.push({ locationName: loc.name, hoaContact: hoa, matches: digits(hoa) === claimed && claimed !== '' });
      }
    }

    const residents = this.repo
      .listUnits(tenantId, c.buildingId)
      .length;

    const competing = this.repo
      .claimsForBuilding(tenantId, c.buildingId)
      .filter((x) => x.id !== c.id && (x.status === 'pending' || x.status === 'frozen'));

    return {
      claim: c,
      building: { id: b.id, name: b.name, address: b.address, connectionStatus: b.connectionStatus },
      signals: {
        /** совпадение с контактом, собранным мастерами до заявки */
        knownContacts: known,
        contactMatches: known.some((k) => k.matches),
        callbackResult: c.callbackResult,
        unitsRegistered: residents,
        demandFromResidents: this.repo
          .listDemand(tenantId)
          .filter((d) => d.address.toLowerCase().includes(b.address.toLowerCase().slice(0, 12))).length,
      },
      competing: competing.map((x) => ({
        id: x.id,
        operatorName: x.operatorName,
        documentKind: x.documentKind,
        createdAt: x.createdAt,
      })),
    };
  }

  listClaims(tenantId: string, status?: ClaimRequest['status']) {
    return this.repo.listClaims(tenantId, status);
  }

  /** Результат обратного звонка на телефон объекта из открытых источников */
  setCallback(tenantId: string, claimId: string, result: NonNullable<ClaimRequest['callbackResult']>): ClaimRequest {
    const c = this.repo.getClaim(tenantId, claimId);
    if (!c) throw new NotFoundException('Заявка не найдена');
    c.callbackResult = result;
    this.repo.saveClaim(c);
    return c;
  }

  /**
   * Решение модератора. Автоматически объект выше `claimed` не поднимается
   * никогда — только здесь, с записью кто и на каком основании.
   */
  decideClaim(
    tenantId: string,
    claimId: string,
    decision: 'approve' | 'reject',
    reason: string,
    moderatorPhone: string,
  ): ClaimRequest {
    const c = this.repo.getClaim(tenantId, claimId);
    if (!c) throw new NotFoundException('Заявка не найдена');
    if (c.status === 'approved' || c.status === 'rejected') {
      throw new BadRequestException('По заявке уже принято решение');
    }
    if (decision === 'reject' && !reason) {
      throw new BadRequestException('Отклонение требует причины — она остаётся в аудите');
    }

    c.status = decision === 'approve' ? 'approved' : 'rejected';
    c.decisionBy = moderatorPhone;
    c.decisionAt = new Date().toISOString();
    c.decisionReason = reason || null;
    this.repo.saveClaim(c);

    if (decision === 'approve') {
      const b = this.get(tenantId, c.buildingId);
      b.operatorOrgId = c.operatorOrgId;
      b.connectionStatus = 'verified';
      b.verifiedBy = moderatorPhone;
      b.verifiedAt = c.decisionAt;
      this.repo.saveBuilding(b);
      // конкурирующие заявки закрываются той же причиной: объект отдан другому
      for (const other of this.repo.claimsForBuilding(tenantId, c.buildingId)) {
        if (other.id !== c.id && (other.status === 'pending' || other.status === 'frozen')) {
          other.status = 'rejected';
          other.decisionBy = moderatorPhone;
          other.decisionAt = c.decisionAt;
          other.decisionReason = 'Объект передан другой организации по решению модератора';
          this.repo.saveClaim(other);
        }
      }
      this.bus.publish('building.verified', { buildingId: b.id, by: moderatorPhone });
    } else {
      // если других живых заявок не осталось — объект возвращается в unmanaged
      const alive = this.repo
        .claimsForBuilding(tenantId, c.buildingId)
        .filter((x) => x.status === 'pending' || x.status === 'frozen');
      if (alive.length === 0) {
        const b = this.get(tenantId, c.buildingId);
        if (b.connectionStatus === 'claimed') {
          b.connectionStatus = 'unmanaged';
          b.operatorOrgId = null;
          this.repo.saveBuilding(b);
        }
      } else if (alive.length === 1) {
        // конфликт разрешился сам: оставшаяся заявка выходит из заморозки
        alive[0].status = 'pending';
        this.repo.saveClaim(alive[0]);
      }
    }
    return c;
  }

  /** Обращение «моего дома здесь нет» с публичной страницы объекта (L-10) */
  addDemand(tenantId: string, address: string, phone?: string): DemandSignal {
    const rec: DemandSignal = {
      id: uuidv7(),
      tenantId,
      address,
      phone: phone ?? null,
      createdAt: new Date().toISOString(),
    };
    this.repo.saveDemand(rec);
    return rec;
  }

  /** Спрос по адресам: где жители просят подключить дом (вкладка A-39) */
  demandByAddress(tenantId: string) {
    const groups = new Map<string, { address: string; count: number; lastAt: string }>();
    for (const d of this.repo.listDemand(tenantId)) {
      const key = d.address.trim().toLowerCase();
      const g = groups.get(key) ?? { address: d.address, count: 0, lastAt: d.createdAt };
      g.count += 1;
      if (d.createdAt > g.lastAt) g.lastAt = d.createdAt;
      groups.set(key, g);
    }
    return [...groups.values()].sort((a, b) => b.count - a.count);
  }

  /**
   * Верификация модератором (A-39), быстрый путь: когда заявка одна и разбирать
   * нечего. Оператор назначается **из заявки**, а не подразумевается: объект,
   * верифицированный без оператора, невозможно ни настроить, ни активировать.
   *
   * При конфликте заявок этот путь закрыт — решение принимается в очереди
   * модерации, где видны документы и сигналы обеих сторон.
   */
  verify(tenantId: string, buildingId: string, moderatorPhone: string): BuildingRecord {
    const b = this.get(tenantId, buildingId);
    if (b.connectionStatus !== 'claimed') {
      throw new BadRequestException('Верифицировать можно только объект в статусе claimed');
    }
    const alive = this.repo
      .claimsForBuilding(tenantId, buildingId)
      .filter((c) => c.status === 'pending' || c.status === 'frozen');
    if (alive.length > 1) {
      throw new ConflictException({
        code: 'ClaimConflict',
        message: 'На объект несколько заявок — решение принимается в очереди модерации A-39',
      });
    }
    if (alive.length === 1) {
      // проводим через общее решение: одна запись в аудите, один путь
      this.decideClaim(tenantId, alive[0].id, 'approve', 'Единственная заявка, конфликта нет', moderatorPhone);
      return this.get(tenantId, buildingId);
    }
    b.connectionStatus = 'verified';
    b.verifiedBy = moderatorPhone;
    b.verifiedAt = new Date().toISOString();
    this.repo.saveBuilding(b);
    this.bus.publish('building.verified', { buildingId: b.id, by: moderatorPhone });
    return b;
  }

  /**
   * Активация объекта. Чек-лист готовности (DEV-15 §9.3, инвариант DEV-02 §4.4 п.10):
   * согласующий + резервный + круглосуточный аварийный телефон.
   */
  activate(tenantId: string, buildingId: string): BuildingRecord {
    const b = this.get(tenantId, buildingId);
    if (b.connectionStatus !== 'verified' && b.connectionStatus !== 'degraded') {
      throw new BadRequestException('Активировать можно только верифицированный объект');
    }
    const missing = this.readinessGaps(tenantId, b);
    if (missing.length) {
      throw new BadRequestException(`Объект не готов к активации: ${missing.join('; ')}`);
    }
    b.connectionStatus = 'active';
    this.repo.saveBuilding(b);
    this.bus.publish('building.status_changed', { buildingId: b.id, status: 'active' });
    return b;
  }

  /** Что мешает активации — возвращается в U-13 как чек-лист, а не как «ошибка» */
  readinessGaps(tenantId: string, b: BuildingRecord): string[] {
    const gaps: string[] = [];
    const approvers = this.repo.listStaff(tenantId, b.id, 'approver');
    if (!approvers.length) gaps.push('не назначен согласующий доступ');
    if (!approvers.some((a) => a.isBackup)) gaps.push('не назначен резервный согласующий');
    if (!b.emergencyPhone) gaps.push('не указан круглосуточный аварийный телефон');
    if (!this.repo.listUnits(tenantId, b.id).length) gaps.push('не заполнен реестр помещений');
    return gaps;
  }

  /**
   * Деградация по SLA согласования (DEV-15 §9.3).
   * Важно: деградация снимает гарантии, но НЕ передаёт платформе обязанности оператора
   * по общему имуществу и не останавливает обслуживание жителей.
   */
  recheckDegradation(tenantId: string, buildingId: string): BuildingRecord {
    const b = this.get(tenantId, buildingId);
    if (b.connectionStatus !== 'active' && b.connectionStatus !== 'degraded') return b;
    // Минимальная выборка: доля просрочек ничего не значит на двух нарядах.
    // Без этого порога новый объект уходит в degraded от первого же молчания
    // согласующего — и онбординг ломается ровно там, где он самый хрупкий.
    const enoughData = b.permitsTotal30d >= MIN_PERMITS_FOR_DEGRADATION;
    const share = b.permitsTotal30d ? b.permitsOverdue30d / b.permitsTotal30d : 0;
    // Просрочка АВАРИЙНЫХ согласований выборки не требует: два случая — уже система,
    // и цена ошибки здесь несопоставима с неудобством оператора.
    const shouldDegrade = (enoughData && share > 0.4) || b.emergencyOverdue30d >= 2;
    const next = shouldDegrade ? 'degraded' : 'active';
    if (next !== b.connectionStatus) {
      b.connectionStatus = next;
      this.repo.saveBuilding(b);
      this.bus.publish('building.status_changed', { buildingId: b.id, status: next });
    }
    return b;
  }

  /** Ставка сервисного сбора: потолок жёсткий, торгу не подлежит (DEV-15 §8.2) */
  setServiceFee(tenantId: string, buildingId: string, bps: number): BuildingRecord {
    if (!Number.isInteger(bps) || bps < 0 || BigInt(bps) > SERVICE_FEE_CAP_BPS) {
      throw new BadRequestException(
        `ServiceFeeAboveCap: ставка ${bps} б.п. вне допустимого диапазона 0…${SERVICE_FEE_CAP_BPS}`,
      );
    }
    const b = this.get(tenantId, buildingId);
    b.serviceFeeBps = bps;
    this.repo.saveBuilding(b);
    return b;
  }

  addStaff(tenantId: string, buildingId: string, dto: Omit<BuildingStaffRecord, 'id' | 'tenantId' | 'buildingId'>): BuildingStaffRecord {
    this.get(tenantId, buildingId);
    const rec: BuildingStaffRecord = { id: uuidv7(), tenantId, buildingId, ...dto };
    this.repo.saveStaff(rec);
    return rec;
  }

  listStaff(tenantId: string, buildingId: string) {
    return this.repo.listStaff(tenantId, buildingId);
  }

  /** Согласующие объекта в порядке эскалации: основной → резервный (DEV-15 §4.4) */
  approvers(tenantId: string, buildingId: string): BuildingStaffRecord[] {
    return this.repo
      .listStaff(tenantId, buildingId, 'approver')
      .sort((a, b) => Number(a.isBackup) - Number(b.isBackup));
  }

  zonesByTypes(tenantId: string, buildingId: string, types: string[]) {
    return this.repo.zonesByTypes(tenantId, buildingId, types);
  }

  /** Помещения, затронутые работами на указанных стояках (DEV-15 §5) */
  affectedUnits(tenantId: string, buildingId: string, riserIds: string[]) {
    return this.repo.unitsByRisers(tenantId, buildingId, riserIds);
  }

  bumpPermitCounters(tenantId: string, buildingId: string, overdue: boolean, emergency: boolean): void {
    const b = this.repo.getBuilding(tenantId, buildingId);
    if (!b) return;
    b.permitsTotal30d += 1;
    if (overdue) b.permitsOverdue30d += 1;
    if (overdue && emergency) b.emergencyOverdue30d += 1;
    this.repo.saveBuilding(b);
    this.recheckDegradation(tenantId, buildingId);
  }

  // ============================================================
  // Замечания и обходы (DEV-15 §7.7)
  // ============================================================

  /** Окно дедупликации по зоне, параметр 135 */
  private readonly dedupDays = 14;

  /**
   * Фиксация замечания. Обязательны только фото и категория — всё остальное
   * дозаполняется в кабинете. Форма на десять полей означает, что через неделю
   * руководитель вернётся в WhatsApp (DEV-15 §7.7.3).
   *
   * Дубликаты по зоне не отклоняются, а предлагаются к присоединению: обходящих
   * несколько, и «уже есть такое» без возможности подтвердить — худший вариант.
   */
  addObservation(
    tenantId: string,
    buildingId: string,
    dto: {
      zoneKey: string;
      categoryId: string;
      photoIds: string[];
      severity?: ObservationSeverity;
      source?: ObservationSource;
      unitId?: string;
      comment?: string;
      authorPhone: string;
      joinObservationId?: string;
    },
  ): { observation: ObservationRecord; duplicates: ObservationRecord[]; joined: boolean } {
    this.get(tenantId, buildingId);
    if (!dto.photoIds.length) {
      throw new BadRequestException('Замечание фиксируется только с фотографией');
    }

    if (dto.joinObservationId) {
      const target = this.repo.getObservation(tenantId, dto.joinObservationId);
      if (!target) throw new NotFoundException('Замечание для присоединения не найдено');
      target.joinedBy.push(dto.authorPhone);
      target.photoIds.push(...dto.photoIds);
      this.repo.saveObservation(target);
      return { observation: target, duplicates: [], joined: true };
    }

    const duplicates = this.repo.openInZone(tenantId, buildingId, dto.zoneKey, this.dedupDays);

    const rec: ObservationRecord = {
      id: uuidv7(),
      tenantId,
      buildingId,
      zoneKey: dto.zoneKey,
      unitId: dto.unitId ?? null,
      authorPhone: dto.authorPhone,
      source: dto.source ?? 'walkthrough',
      categoryId: dto.categoryId,
      severity: dto.severity ?? 'housekeeping',
      photoIds: dto.photoIds,
      comment: dto.comment ?? null,
      status: 'open',
      routedTo: null,
      resolvedPhotoId: null,
      resolvedAt: null,
      joinedBy: [],
      createdAt: new Date().toISOString(),
    };
    this.repo.saveObservation(rec);
    this.bus.publish('observation.created', {
      observationId: rec.id,
      buildingId,
      severity: rec.severity,
      source: rec.source,
    });
    return { observation: rec, duplicates, joined: false };
  }

  listObservations(tenantId: string, buildingId: string, status?: ObservationRecord['status']) {
    return this.repo.listObservations(tenantId, buildingId, status);
  }

  routeObservation(
    tenantId: string,
    id: string,
    routedTo: NonNullable<ObservationRecord['routedTo']>,
  ): ObservationRecord {
    const o = this.repo.getObservation(tenantId, id);
    if (!o) throw new NotFoundException('Замечание не найдено');
    o.routedTo = routedTo;
    o.status = 'routed';
    this.repo.saveObservation(o);
    return o;
  }

  /**
   * Приёмка замечания. Закрыть можно ТОЛЬКО фотографией устранения —
   * инвариант DEV-02 §4.4 п.13, перенос продуктового принципа №2 ТЗ
   * с заявок на содержание объекта.
   */
  resolveObservation(tenantId: string, id: string, resolvedPhotoId: string): ObservationRecord {
    const o = this.repo.getObservation(tenantId, id);
    if (!o) throw new NotFoundException('Замечание не найдено');
    if (!resolvedPhotoId) {
      throw new BadRequestException('Замечание закрывается только фотографией устранения');
    }
    o.status = 'resolved';
    o.resolvedPhotoId = resolvedPhotoId;
    o.resolvedAt = new Date().toISOString();
    this.repo.saveObservation(o);
    this.bus.publish('observation.resolved', { observationId: o.id, buildingId: o.buildingId });
    return o;
  }

  // ============================================================
  // Паспорт здания, оборудование и плановое ТО (DEV-15 §7.4)
  // ============================================================

  addEquipment(
    tenantId: string,
    buildingId: string,
    dto: {
      equipmentType: string;
      model?: string;
      serial?: string;
      commissionedAt?: string;
      intervalDays?: number;
      commonZoneId?: string;
      isLicensed?: boolean;
    },
  ): EquipmentRecord {
    this.get(tenantId, buildingId);
    const rec: EquipmentRecord = {
      id: uuidv7(),
      tenantId,
      buildingId,
      commonZoneId: dto.commonZoneId ?? null,
      equipmentType: dto.equipmentType,
      model: dto.model ?? null,
      serial: dto.serial ?? null,
      commissionedAt: dto.commissionedAt ?? null,
      intervalDays: dto.intervalDays ?? null,
      lastServiceAt: null,
      isLicensed: dto.isLicensed ?? DEFAULT_LICENSED_EQUIPMENT.includes(dto.equipmentType),
    };
    this.repo.saveEquipment(rec);
    return rec;
  }

  listEquipment(tenantId: string, buildingId: string): EquipmentRecord[] {
    return this.repo.listEquipment(tenantId, buildingId);
  }

  /** Отметка выполненного ТО — сдвигает следующий срок */
  markServiced(tenantId: string, equipmentId: string, at = new Date()): EquipmentRecord {
    const e = this.repo.getEquipment(tenantId, equipmentId);
    if (!e) throw new NotFoundException('Оборудование не найдено');
    e.lastServiceAt = at.toISOString();
    this.repo.saveEquipment(e);
    return e;
  }

  /**
   * Оборудование с подошедшим или просроченным ТО (таймер 63).
   * Для лифтов, ИТП и пожарных систем срок обычно нормативный — просрочка это риск
   * предписания надзора, поэтому она выносится отдельным признаком, а не «скоро».
   */
  maintenanceDue(tenantId: string, buildingId: string, aheadDays = 7, now = new Date()) {
    return this.listEquipment(tenantId, buildingId)
      .filter((e) => e.intervalDays)
      .map((e) => {
        const base = e.lastServiceAt ?? e.commissionedAt;
        if (!base) return { equipment: e, dueAt: null, overdue: false, dueSoon: true };
        const dueAt = new Date(Date.parse(base) + e.intervalDays! * 86_400_000);
        const diffDays = (dueAt.getTime() - now.getTime()) / 86_400_000;
        return {
          equipment: e,
          dueAt: dueAt.toISOString(),
          overdue: diffDays < 0,
          dueSoon: diffDays >= 0 && diffDays <= aheadDays,
        };
      })
      .filter((x) => x.overdue || x.dueSoon);
  }

  // ============================================================
  // Техдолг объекта (DEV-15 §7.3)
  // ============================================================

  addDefect(
    tenantId: string,
    buildingId: string,
    dto: {
      title: string;
      severity?: DefectSeverity;
      estimatedCostTiyin?: number;
      deadline?: string;
      responsible?: string;
      source?: DefectRecord['source'];
      commonZoneId?: string;
      equipmentId?: string;
      observationId?: string;
    },
  ): DefectRecord {
    this.get(tenantId, buildingId);
    const rec: DefectRecord = {
      id: uuidv7(),
      tenantId,
      buildingId,
      commonZoneId: dto.commonZoneId ?? null,
      equipmentId: dto.equipmentId ?? null,
      title: dto.title,
      severity: dto.severity ?? 'substantial',
      estimatedCostTiyin: dto.estimatedCostTiyin ?? 0,
      deadline: dto.deadline ?? null,
      responsible: dto.responsible ?? null,
      source: dto.source ?? 'inspection',
      observationId: dto.observationId ?? null,
      decision: null,
      decisionReason: null,
      decisionBy: null,
      decisionAt: null,
      status: 'open',
      createdAt: new Date().toISOString(),
    };
    this.repo.saveDefect(rec);
    this.bus.publish('defect.created', { defectId: rec.id, buildingId, severity: rec.severity });
    return rec;
  }

  /**
   * Решение по дефекту. Отклонённый дефект **не удаляется** — остаётся с датой и
   * формулировкой отказа. Это юридическая защита оператора перед правлением и
   * надзором («мы предупреждали {дата}»), механика ТЗ §14.
   */
  decideDefect(
    tenantId: string,
    defectId: string,
    decision: NonNullable<DefectRecord['decision']>,
    reason: string,
    by: string,
  ): DefectRecord {
    const d = this.repo.getDefect(tenantId, defectId);
    if (!d) throw new NotFoundException('Дефект не найден');
    if (decision === 'rejected' && !reason) {
      throw new BadRequestException('Отклонение дефекта требует формулировки причины — она остаётся в аудите');
    }
    if (d.severity === 'emergency' && decision !== 'planned') {
      throw new BadRequestException('Аварийный дефект нельзя отложить или отклонить');
    }
    d.decision = decision;
    d.decisionReason = reason || null;
    d.decisionBy = by;
    d.decisionAt = new Date().toISOString();
    this.repo.saveDefect(d);
    return d;
  }

  listDefects(tenantId: string, buildingId: string): DefectRecord[] {
    return this.repo.listDefects(tenantId, buildingId);
  }

  /** Свод техдолга для U-09 и отчёта правлению */
  defectSummary(tenantId: string, buildingId: string) {
    const all = this.listDefects(tenantId, buildingId);
    const open = all.filter((d) => d.status !== 'fixed');
    const bySeverity: Record<string, { count: number; costTiyin: number }> = {};
    for (const d of open) {
      const b = (bySeverity[d.severity] ??= { count: 0, costTiyin: 0 });
      b.count += 1;
      b.costTiyin += d.estimatedCostTiyin;
    }
    return {
      total: all.length,
      open: open.length,
      totalCostTiyin: open.reduce((a, d) => a + d.estimatedCostTiyin, 0),
      bySeverity,
      undecided: open.filter((d) => !d.decision).length,
      rejected: all.filter((d) => d.decision === 'rejected').length,
    };
  }

  // ============================================================
  // Собственный прайс оператора и витрина услуг жителю (DEV-15 §8.6)
  // ============================================================

  addOperatorPrice(
    tenantId: string,
    operatorOrgId: string,
    dto: { name: string; unit?: string; priceFromTiyin: number; priceToTiyin?: number; scope?: 'private' | 'common_area'; buildingId?: string },
  ): OperatorPriceItem {
    const rec: OperatorPriceItem = {
      id: uuidv7(),
      tenantId,
      operatorOrgId,
      buildingId: dto.buildingId ?? null,
      name: dto.name,
      unit: dto.unit ?? 'усл.',
      priceFromTiyin: dto.priceFromTiyin,
      priceToTiyin: dto.priceToTiyin ?? dto.priceFromTiyin,
      scope: dto.scope ?? 'private',
      isActive: true,
    };
    this.repo.saveOperatorPrice(rec);
    return rec;
  }

  listOperatorPrices(tenantId: string, operatorOrgId: string, buildingId?: string): OperatorPriceItem[] {
    return this.repo.listOperatorPrices(tenantId, operatorOrgId, buildingId);
  }

  /**
   * Витрина услуг для жителя (C-07): что можно заказать в этом доме и у кого.
   *
   * Ключевой экран всей модели «Доступ»: житель выбирает не только работу, но и
   * исполнителя. Выбор мастера платформы порождает сервисный сбор управляющей
   * компании, выбор её собственного мастера — не порождает ничего, деньги идут
   * мимо платформы. Прятать этот выбор нельзя: он и есть предмет договорённости
   * с оператором.
   */
  servicesForResident(tenantId: string, buildingId: string) {
    const b = this.get(tenantId, buildingId);
    const operatorItems =
      b.operatorOrgId && b.connectionStatus === 'active'
        ? this.listOperatorPrices(tenantId, b.operatorOrgId, buildingId)
        : [];
    return {
      buildingId,
      operatorOrgId: b.operatorOrgId,
      connectionStatus: b.connectionStatus,
      /** услуги платформы берутся из активного релиза прайса — отдаёт модуль pricing */
      platform: { source: 'price_release' as const },
      operator: operatorItems.map((x) => ({
        id: x.id,
        name: x.name,
        unit: x.unit,
        priceFromTiyin: x.priceFromTiyin,
        priceToTiyin: x.priceToTiyin,
        scope: x.scope,
        provider: 'operator' as const,
      })),
    };
  }

  // ============================================================
  // Обходы по расписанию (DEV-15 §7.7.6)
  // ============================================================

  addRoute(
    tenantId: string,
    buildingId: string,
    dto: { name: string; intervalDays: number; zoneKeys: string[] },
  ): WalkthroughRoute {
    this.get(tenantId, buildingId);
    if (!dto.zoneKeys.length) throw new BadRequestException('Маршрут обхода без зон бессмысленен');
    const rec: WalkthroughRoute = {
      id: uuidv7(),
      tenantId,
      buildingId,
      name: dto.name,
      intervalDays: dto.intervalDays,
      zoneKeys: dto.zoneKeys,
      lastWalkAt: null,
      isActive: true,
    };
    this.repo.saveRoute(rec);
    return rec;
  }

  listRoutes(tenantId: string, buildingId: string): WalkthroughRoute[] {
    return this.repo.listRoutes(tenantId, buildingId);
  }

  /**
   * Маршруты, по которым обход просрочен или подходит срок (таймер 63).
   * Просрочка обхода — не «забыли галочку», а отсутствие данных о состоянии объекта:
   * именно она объясняет, почему замечания появляются только после жалоб жителей.
   */
  walkthroughsDue(tenantId: string, buildingId: string, now = new Date()) {
    return this.listRoutes(tenantId, buildingId)
      .filter((r) => r.isActive)
      .map((r) => {
        if (!r.lastWalkAt) return { route: r, dueAt: null, overdue: true, neverWalked: true };
        const dueAt = new Date(Date.parse(r.lastWalkAt) + r.intervalDays * 86_400_000);
        return {
          route: r,
          dueAt: dueAt.toISOString(),
          overdue: dueAt.getTime() < now.getTime(),
          neverWalked: false,
        };
      })
      .filter((x) => x.overdue);
  }

  startWalk(tenantId: string, routeId: string, walkerPhone: string): WalkthroughRecord {
    const route = this.repo.getRoute(tenantId, routeId);
    if (!route) throw new NotFoundException('Маршрут обхода не найден');
    const rec: WalkthroughRecord = {
      id: uuidv7(),
      tenantId,
      buildingId: route.buildingId,
      routeId: route.id,
      routeName: route.name,
      walkerPhone,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      passedZones: [],
      observationIds: [],
    };
    this.repo.saveWalk(rec);
    return rec;
  }

  /** Отметка зоны пройденной; замечание, снятое в зоне, привязывается к обходу */
  passZone(tenantId: string, walkId: string, zoneKey: string, observationId?: string): WalkthroughRecord {
    const w = this.repo.getWalk(tenantId, walkId);
    if (!w) throw new NotFoundException('Обход не найден');
    if (!w.passedZones.includes(zoneKey)) w.passedZones.push(zoneKey);
    if (observationId && !w.observationIds.includes(observationId)) w.observationIds.push(observationId);
    this.repo.saveWalk(w);
    return w;
  }

  /**
   * Завершение обхода. Незакрытые зоны не блокируют завершение, но попадают в отчёт:
   * обход, в котором прошли половину зон, — это факт, который правление должно видеть,
   * а не повод не дать сохранить результат.
   */
  finishWalk(tenantId: string, walkId: string) {
    const w = this.repo.getWalk(tenantId, walkId);
    if (!w) throw new NotFoundException('Обход не найден');
    const route = this.repo.getRoute(tenantId, w.routeId);
    w.finishedAt = new Date().toISOString();
    this.repo.saveWalk(w);
    if (route) {
      route.lastWalkAt = w.finishedAt;
      this.repo.saveRoute(route);
    }
    const planned = route?.zoneKeys ?? [];
    const missed = planned.filter((z) => !w.passedZones.includes(z));
    this.bus.publish('walkthrough.finished', { walkId: w.id, buildingId: w.buildingId, missed: missed.length });
    return {
      ...w,
      zonesPlanned: planned.length,
      zonesPassed: w.passedZones.length,
      zonesMissed: missed,
      observations: w.observationIds.length,
    };
  }

  listWalks(tenantId: string, buildingId: string): WalkthroughRecord[] {
    return this.repo.listWalks(tenantId, buildingId);
  }
}

/** Минимум нарядов за 30 дней, при котором доля просрочек становится показательной */
export const MIN_PERMITS_FOR_DEGRADATION = 5;

/** Лицензируемые виды оборудования (ТЗ 17.8) */
export const DEFAULT_LICENSED_EQUIPMENT = ['lift', 'gas_boiler', 'gas_meter', 'fire_alarm', 'fire_suppression'];
