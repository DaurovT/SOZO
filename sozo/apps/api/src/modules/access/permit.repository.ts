import { Injectable, OnModuleInit } from '@nestjs/common';
import type { PermitStatus, PermitApprovalKind, PassType, ShutdownStatus, ResourceType } from '@sozo/contracts';
import { StateStore } from '../../common/state-store';
import { dbFailure } from '../../common/db-failure';
import { PrismaService } from '../../common/prisma.service';
import { currentDbContext, systemContext } from '../../common/db-context';

/**
 * Наряд-допуск, пропуска, отключения и запросы доступа в помещение.
 *
 * Форма та же, что у объектов: рабочий набор в памяти, запись насквозь без
 * задержки. Читают отсюда синхронно и из глубины (гейты переходов заявки,
 * страница ответа жителя, воркеры таймеров), а откладывать запись нельзя —
 * на наряд ссылается запрос доступа внешним ключом, и созданный сразу после
 * наряда запрос упирался бы в строку, которой в базе ещё нет. Ровно та же
 * гонка, что разобрана в building.repository.
 */
@Injectable()
export class InMemoryPermitRepository implements OnModuleInit {
  private permits = new Map<string, PermitRecord>();
  private passes = new Map<string, PassRecord>();
  private shutdowns = new Map<string, ShutdownRecord>();
  private unitAccess = new Map<string, UnitAccessRequest>();
  /** идемпотентность офлайн-синка мастера: client_op_uuid → результат перехода */
  private ops = new Map<string, string>();

  private loaded = false;

  constructor(store: StateStore, private readonly prisma: PrismaService) {
    store.register(
      'access',
      () => ({
        permits: [...this.permits.values()],
        passes: [...this.passes.values()],
        shutdowns: [...this.shutdowns.values()],
        unitAccess: [...this.unitAccess.values()],
        ops: [...this.ops],
      }),
      (data) => {
        const d = data as {
          permits?: PermitRecord[];
          passes?: PassRecord[];
          shutdowns?: ShutdownRecord[];
          unitAccess?: UnitAccessRequest[];
          ops?: [string, string][];
        };
        this.permits = new Map((d.permits ?? []).map((p) => [p.id, p]));
        this.passes = new Map((d.passes ?? []).map((p) => [p.id, p]));
        this.shutdowns = new Map((d.shutdowns ?? []).map((p) => [p.id, p]));
        this.unitAccess = new Map((d.unitAccess ?? []).map((p) => [p.id, p]));
        this.ops = new Map(d.ops ?? []);
      },
    );
  }

  /**
   * Загрузка с базы. Полная и в конце старта: коллекций пять, все мелкие,
   * а точечная дозагрузка потребовала бы знать, что уже в памяти.
   */
  async onModuleInit(): Promise<void> {
    if (!this.prisma.enabled) {
      this.loaded = true;
      return;
    }
    const d = await this.prisma.withContext(async (tx) => ({
      permits: await tx.accessPermit.findMany(),
      passes: await tx.visitPass.findMany(),
      shutdowns: await tx.resourceShutdown.findMany(),
      unitAccess: await tx.unitAccessRequest.findMany(),
      ops: await tx.permitSyncOp.findMany(),
    }));
    if (d.permits.length) {
      this.permits.clear();
      for (const x of d.permits) this.permits.set(x.id, fromDbPermit(x));
    }
    if (d.passes.length) {
      this.passes.clear();
      for (const x of d.passes) this.passes.set(x.id, fromDbPass(x));
    }
    if (d.shutdowns.length) {
      this.shutdowns.clear();
      for (const x of d.shutdowns) this.shutdowns.set(x.id, fromDbShutdown(x));
    }
    if (d.unitAccess.length) {
      this.unitAccess.clear();
      for (const x of d.unitAccess) this.unitAccess.set(x.id, fromDbUnitAccess(x));
    }
    for (const x of d.ops) this.ops.set(x.clientOpUuid, x.permitId);
    this.loaded = true;
    if (d.permits.length || d.passes.length) {
      // eslint-disable-next-line no-console
      console.log(`[Access] из базы: нарядов ${this.permits.size}, пропусков ${this.passes.size}, отключений ${this.shutdowns.size}`);
    }
  }

  /** Разовый перенос нарядов и пропусков в базу (deploy/import-state) */
  async flushToDb(): Promise<{ permits: number; passes: number; shutdowns: number; unitAccess: number }> {
    this.loaded = true;
    this.scheduleWrite();
    await this.writing;
    return {
      permits: this.permits.size,
      passes: this.passes.size,
      shutdowns: this.shutdowns.size,
      unitAccess: this.unitAccess.size,
    };
  }

  /** Последовательная цепочка, а не таймер — см. комментарий класса */
  private writing: Promise<void> = Promise.resolve();

  private scheduleWrite(): void {
    if (!this.prisma.enabled || !this.loaded) return;
    this.writing = this.writing
      .then(() => this.writeAll())
      .catch((e: unknown) => {
        // eslint-disable-next-line no-console
        console.error('[Access] запись в базу не удалась:', dbFailure(e));
      });
  }

  private async writeAll(): Promise<void> {
    const tenantId = (currentDbContext() ?? systemContext()).tenantId;
    /**
     * Снимок наборов до первого await.
     *
     * Перебор живой карты внутри асинхронной записи — гонка, которая
     * проявляется редко и потому дорого: между записью нарядов и записью
     * запросов доступа успевает прийти запрос, добавляющий и наряд, и
     * ссылку на него. Наряд в цикл уже не попадает, а запрос попадает — и
     * запись падает на внешнем ключе. В прогоне это выглядело как
     * «иногда одна потерянная запись».
     */
    const permits = [...this.permits.values()];
    const passes = [...this.passes.values()];
    const shutdowns = [...this.shutdowns.values()];
    const unitAccess = [...this.unitAccess.values()];
    const ops = [...this.ops];
    await this.prisma.withContext(async (tx) => {
      for (const p of permits) {
        const data = {
          orderId: p.orderId,
          buildingId: p.buildingId,
          requestedByPhone: p.requestedByPhone,
          status: p.status,
          version: p.version,
          zoneTypes: p.zoneTypes,
          hasCriticalZone: p.hasCriticalZone,
          hasLicensedZone: p.hasLicensedZone,
          requiresShutdown: p.requiresShutdown,
          affectedUnitIds: p.affectedUnitIds,
          windowFrom: p.windowFrom ? new Date(p.windowFrom) : null,
          windowTo: p.windowTo ? new Date(p.windowTo) : null,
          approverName: p.approverName,
          approvedAt: p.approvedAt ? new Date(p.approvedAt) : null,
          approvalKind: p.approvalKind,
          rejectReason: p.rejectReason,
          openedAt: p.openedAt ? new Date(p.openedAt) : null,
          closedAt: p.closedAt ? new Date(p.closedAt) : null,
          slaDeadline: p.slaDeadline ? new Date(p.slaDeadline) : null,
          isEmergency: p.isEmergency,
          masterId: p.masterId,
          masterIsPlatform: p.masterIsPlatform,
          // Два основания допуска исключают друг друга — CHECK в m21.
          // Признак платформы главнее: самодекларация оператора относится
          // только к его штатному работнику
          operatorSelfDeclared: p.masterIsPlatform ? false : p.operatorSelfDeclared,
          qualificationOk: p.masterIsPlatform ? p.qualificationOk : false,
        };
        await tx.accessPermit.upsert({
          where: { id: p.id },
          create: { id: p.id, tenantId, commonZoneIds: [], ...data },
          update: data,
        });
      }
      for (const x of passes) {
        const data = {
          buildingId: x.buildingId,
          orderId: x.orderId,
          masterId: x.masterId,
          passType: x.passType,
          qrToken: x.qrToken,
          fallbackCode: x.fallbackCode,
          validFrom: new Date(x.validFrom),
          validTo: new Date(x.validTo),
          status: x.status,
          guestName: x.guestName ?? null,
          carPlate: x.carPlate ?? null,
          issuedByPhone: x.issuedByPhone ?? null,
          unitLabel: x.unitLabel ?? null,
        };
        await tx.visitPass.upsert({ where: { id: x.id }, create: { id: x.id, tenantId, ...data }, update: data });
      }
      for (const x of shutdowns) {
        const data = {
          buildingId: x.buildingId,
          resourceType: x.resourceType,
          scope: x.scope,
          riserId: x.riserId,
          affectedUnitIds: x.affectedUnitIds,
          plannedFrom: new Date(x.plannedFrom),
          plannedTo: new Date(x.plannedTo),
          actualFrom: x.actualFrom ? new Date(x.actualFrom) : null,
          actualTo: x.actualTo ? new Date(x.actualTo) : null,
          reason: x.reason,
          initiator: x.initiator,
          orderId: x.orderId,
          status: x.status,
          notifiedAt: x.notifiedAt ? new Date(x.notifiedAt) : null,
          lateNotice: x.lateNotice,
          isEmergency: x.isEmergency,
        };
        await tx.resourceShutdown.upsert({ where: { id: x.id }, create: { id: x.id, tenantId, ...data }, update: data });
      }
      for (const x of unitAccess) {
        const data = {
          buildingId: x.buildingId,
          unitId: x.unitId,
          unitLabel: x.unitLabel,
          permitId: x.permitId,
          orderId: x.orderId,
          requestedByPhone: x.requestedByPhone,
          masterId: x.masterId,
          masterName: x.masterName,
          reason: x.reason,
          windowFrom: new Date(x.windowFrom),
          windowTo: new Date(x.windowTo),
          status: x.status,
          decidedByPhone: x.decidedByPhone,
          decidedAt: x.decidedAt ? new Date(x.decidedAt) : null,
          // Пустая строка — не причина, а её видимость: CHECK в m22
          declineReason: x.declineReason?.trim() ? x.declineReason : null,
          proposedFrom: x.proposedFrom ? new Date(x.proposedFrom) : null,
          proposedTo: x.proposedTo ? new Date(x.proposedTo) : null,
          expiresAt: new Date(x.expiresAt),
          accessCode: x.accessCode,
        };
        await tx.unitAccessRequest.upsert({ where: { id: x.id }, create: { id: x.id, tenantId, ...data }, update: data });
      }
      for (const [key, permitId] of ops) {
        await tx.permitSyncOp.upsert({
          where: { clientOpUuid: key },
          create: { clientOpUuid: key, tenantId, permitId },
          update: {},
        });
      }
    });
  }

  save(p: PermitRecord): void {
    this.scheduleWrite();
    this.permits.set(p.id, p);
  }
  get(tenantId: string, id: string): PermitRecord | undefined {
    const p = this.permits.get(id);
    return p && p.tenantId === tenantId ? p : undefined;
  }
  byOrder(tenantId: string, orderId: string): PermitRecord[] {
    return [...this.permits.values()].filter((p) => p.tenantId === tenantId && p.orderId === orderId);
  }
  /** Очередь согласования U-02 / D-21 — по остатку SLA */
  queue(tenantId: string, buildingIds: string[], onlyOverdue = false): PermitRecord[] {
    const now = Date.now();
    return [...this.permits.values()]
      .filter(
        (p) =>
          p.tenantId === tenantId &&
          buildingIds.includes(p.buildingId) &&
          (p.status === 'requested' || p.status === 'rescheduled'),
      )
      .filter((p) => !onlyOverdue || (p.slaDeadline !== null && Date.parse(p.slaDeadline) < now))
      .sort((a, b) => Date.parse(a.slaDeadline ?? '') - Date.parse(b.slaDeadline ?? ''));
  }
  /** Наряды, у которых истёк SLA согласования — для воркера авто-согласия */
  overdueRequested(tenantId: string, now: Date): PermitRecord[] {
    return [...this.permits.values()].filter(
      (p) =>
        p.tenantId === tenantId &&
        p.status === 'requested' &&
        p.slaDeadline !== null &&
        Date.parse(p.slaDeadline) <= now.getTime(),
    );
  }

  savePass(p: PassRecord): void {
    this.scheduleWrite();
    this.passes.set(p.id, p);
  }
  passesByOrder(tenantId: string, orderId: string): PassRecord[] {
    return [...this.passes.values()].filter((x) => x.tenantId === tenantId && x.orderId === orderId);
  }
  activePassFor(tenantId: string, orderId: string, masterId: string): PassRecord | undefined {
    return [...this.passes.values()].find(
      (x) =>
        x.tenantId === tenantId &&
        x.orderId === orderId &&
        x.masterId === masterId &&
        x.status === 'active',
    );
  }
  revokePassesOfMaster(tenantId: string, masterId: string): number {
    this.scheduleWrite();
    let n = 0;
    for (const p of this.passes.values()) {
      if (p.tenantId === tenantId && p.masterId === masterId && p.status === 'active') {
        p.status = 'revoked';
        n += 1;
      }
    }
    return n;
  }

  saveUnitAccess(x: UnitAccessRequest): void {
    this.scheduleWrite();
    this.unitAccess.set(x.id, x);
  }
  getUnitAccess(tenantId: string, id: string): UnitAccessRequest | undefined {
    const x = this.unitAccess.get(id);
    return x && x.tenantId === tenantId ? x : undefined;
  }
  /** Запросы по помещению — их видит житель */
  unitAccessByUnits(tenantId: string, unitIds: string[]): UnitAccessRequest[] {
    return [...this.unitAccess.values()]
      .filter((x) => x.tenantId === tenantId && unitIds.includes(x.unitId))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }
  unitAccessByCode(code: string): UnitAccessRequest | undefined {
    return [...this.unitAccess.values()].find((x) => x.accessCode === code);
  }
  unitAccessByPermit(tenantId: string, permitId: string): UnitAccessRequest[] {
    return [...this.unitAccess.values()].filter((x) => x.tenantId === tenantId && x.permitId === permitId);
  }
  /** Просроченные ожидания — для прогона таймером */
  unitAccessExpired(tenantId: string, now: Date): UnitAccessRequest[] {
    return [...this.unitAccess.values()].filter(
      (x) => x.tenantId === tenantId && x.status === 'requested' && Date.parse(x.expiresAt) <= now.getTime(),
    );
  }

  saveShutdown(x: ShutdownRecord): void {
    this.scheduleWrite();
    this.shutdowns.set(x.id, x);
  }
  getShutdown(tenantId: string, id: string): ShutdownRecord | undefined {
    const x = this.shutdowns.get(id);
    return x && x.tenantId === tenantId ? x : undefined;
  }
  listShutdowns(tenantId: string, buildingId: string): ShutdownRecord[] {
    return [...this.shutdowns.values()]
      .filter((x) => x.tenantId === tenantId && x.buildingId === buildingId)
      .sort((a, b) => Date.parse(a.plannedFrom) - Date.parse(b.plannedFrom));
  }
  /**
   * Инвариант DEV-02 §4.4 п.9: один стояк — одно отключение в пересекающемся окне.
   * В БД это EXCLUDE-ограничение; здесь — проверка перед записью.
   */
  overlappingShutdown(
    tenantId: string,
    buildingId: string,
    riserId: string | null,
    from: string,
    to: string,
    exceptId?: string,
  ): ShutdownRecord | undefined {
    if (!riserId) return undefined;
    const f = Date.parse(from);
    const t = Date.parse(to);
    return this.listShutdowns(tenantId, buildingId).find(
      (x) =>
        x.id !== exceptId &&
        x.riserId === riserId &&
        (x.status === 'scheduled' || x.status === 'active') &&
        Date.parse(x.plannedFrom) < t &&
        f < Date.parse(x.plannedTo),
    );
  }

  /** Все пропуска тенанта — проверка по токену и по числовому коду */
  allPasses(tenantId: string): PassRecord[] {
    return [...this.passes.values()].filter((x) => x.tenantId === tenantId);
  }

  /** Все пропуска объекта — журнал доступа U-10 */
  passesByBuilding(tenantId: string, buildingId: string): PassRecord[] {
    return [...this.passes.values()].filter((x) => x.tenantId === tenantId && x.buildingId === buildingId);
  }

  /** Наряды объекта — для журнала вскрытий */
  permitsByBuilding(tenantId: string, buildingId: string): PermitRecord[] {
    return [...this.permits.values()].filter((p) => p.tenantId === tenantId && p.buildingId === buildingId);
  }

  rememberOp(key: string, permitId: string): void {
    this.scheduleWrite();
    this.ops.set(key, permitId);
  }
  recallOp(key: string): string | undefined {
    return this.ops.get(key);
  }
}

export interface PermitRecord {
  id: string;
  tenantId: string;
  orderId: string;
  buildingId: string;
  requestedByPhone: string;
  status: PermitStatus;
  version: number;
  zoneTypes: string[];
  hasCriticalZone: boolean;
  hasLicensedZone: boolean;
  requiresShutdown: boolean;
  affectedUnitIds: string[];
  windowFrom: string | null;
  windowTo: string | null;
  approverName: string | null;
  approvedAt: string | null;
  approvalKind: PermitApprovalKind | null;
  rejectReason: string | null;
  openedAt: string | null;
  closedAt: string | null;
  slaDeadline: string | null;
  isEmergency: boolean;
  /** мастер платформы (true) или штатный мастер оператора (false) */
  masterIsPlatform: boolean;
  masterId: string | null;
  /** оператор задекларировал квалификацию своего работника (DEV-15 §7.1.2) */
  operatorSelfDeclared: boolean;
  /** квалификация мастера платформы покрывает зоны наряда */
  qualificationOk: boolean;
}

export interface PassRecord {
  id: string;
  tenantId: string;
  buildingId: string;
  /**
   * Заявка и мастер — только у пропуска исполнителя. У гостевого (C-54) их нет
   * и быть не может: житель зовёт гостя, а не оформляет работу. Раньше поля
   * были обязательными, и гостевой пропуск пришлось бы выписывать с
   * выдуманными идентификаторами — то есть врать журналу проходов.
   */
  orderId: string | null;
  masterId: string | null;
  passType: PassType;
  qrToken: string;
  fallbackCode: string;
  validFrom: string;
  validTo: string;
  status: 'active' | 'used' | 'revoked' | 'expired';
  /** Гостевой пропуск: кого ждут, на чём приедет и кто выписал */
  guestName?: string | null;
  carPlate?: string | null;
  issuedByPhone?: string | null;
  unitLabel?: string | null;
}

export interface UnitAccessRequest {
  id: string;
  tenantId: string;
  buildingId: string;
  /** чьё помещение: доступ просят именно сюда */
  unitId: string;
  unitLabel: string;
  /** наряд, ради которого нужен доступ; null — работа без наряда (частная заявка соседа) */
  permitId: string | null;
  orderId: string | null;
  /** кто просит: мастер или диспетчер от его имени */
  requestedByPhone: string;
  masterId: string | null;
  masterName: string | null;
  /** зачем — прямым текстом для жителя, без канцелярита */
  reason: string;
  windowFrom: string;
  windowTo: string;
  status: UnitAccessStatus;
  decidedByPhone: string | null;
  decidedAt: string | null;
  declineReason: string | null;
  /** предложенное жителем окно, когда он не может в исходное */
  proposedFrom: string | null;
  proposedTo: string | null;
  /** до какого момента ждём ответа; после — запрос протухает, а не висит */
  expiresAt: string;
  /**
   * Код ссылки для жителя. Спецификация говорит «уходит пушем», но FCM в
   * системе нет, и обещать доставку, которой не существует, нельзя. Пока
   * работает тот же механизм, что у W-06: короткая ссылка в SMS, открываемая
   * без установки приложения. Появится push — ссылка останется запасным
   * каналом, а не исчезнет: у части жителей приложения не будет никогда.
   */
  accessCode: string;
  createdAt: string;
}

export type UnitAccessStatus = 'requested' | 'approved' | 'declined' | 'rescheduled' | 'expired' | 'cancelled';

export interface ShutdownRecord {
  id: string;
  tenantId: string;
  buildingId: string;
  resourceType: ResourceType;
  scope: 'building' | 'entrance' | 'riser' | 'units';
  riserId: string | null;
  affectedUnitIds: string[];
  plannedFrom: string;
  plannedTo: string;
  actualFrom: string | null;
  actualTo: string | null;
  reason: string;
  initiator: 'operator' | 'platform' | 'utility';
  orderId: string | null;
  status: ShutdownStatus;
  notifiedAt: string | null;
  /** создано позже срока публикации — метка для индикатора объекта (таймер 62) */
  lateNotice: boolean;
  isEmergency: boolean;
}

/**
 * Обратные преобразования из строк базы.
 *
 * Времена в записях — строки ISO, потому что они же уходят в JSON ответа;
 * в базе это timestamptz. Массивы идентификаторов приходят как есть.
 * Арендатор берётся из строки, а не из контекста: строка могла быть
 * записана другим процессом.
 */
// Арендатор в приложении — литерал 't0', в базе uuid, на котором стоят
// политики RLS. Перевод держится здесь, как в объектах и заявках.
const APP_TENANT = 't0';
type DbRow = Record<string, unknown>;
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : null);

function fromDbPermit(x: DbRow): PermitRecord {
  return {
    id: x.id as string,
    tenantId: APP_TENANT,
    orderId: x.orderId as string,
    buildingId: x.buildingId as string,
    requestedByPhone: x.requestedByPhone as string,
    status: x.status as PermitStatus,
    version: x.version as number,
    zoneTypes: (x.zoneTypes as string[]) ?? [],
    hasCriticalZone: x.hasCriticalZone as boolean,
    hasLicensedZone: x.hasLicensedZone as boolean,
    requiresShutdown: x.requiresShutdown as boolean,
    affectedUnitIds: (x.affectedUnitIds as string[]) ?? [],
    windowFrom: iso(x.windowFrom),
    windowTo: iso(x.windowTo),
    approverName: (x.approverName as string) ?? null,
    approvedAt: iso(x.approvedAt),
    approvalKind: (x.approvalKind as PermitApprovalKind) ?? null,
    rejectReason: (x.rejectReason as string) ?? null,
    openedAt: iso(x.openedAt),
    closedAt: iso(x.closedAt),
    slaDeadline: iso(x.slaDeadline),
    isEmergency: x.isEmergency as boolean,
    masterIsPlatform: x.masterIsPlatform as boolean,
    masterId: (x.masterId as string) ?? null,
    operatorSelfDeclared: x.operatorSelfDeclared as boolean,
    qualificationOk: x.qualificationOk as boolean,
  };
}

function fromDbPass(x: DbRow): PassRecord {
  return {
    id: x.id as string,
    tenantId: APP_TENANT,
    buildingId: x.buildingId as string,
    orderId: (x.orderId as string) ?? null,
    masterId: (x.masterId as string) ?? null,
    passType: x.passType as PassType,
    qrToken: x.qrToken as string,
    fallbackCode: x.fallbackCode as string,
    validFrom: iso(x.validFrom) ?? '',
    validTo: iso(x.validTo) ?? '',
    status: x.status as PassRecord['status'],
    guestName: (x.guestName as string) ?? null,
    carPlate: (x.carPlate as string) ?? null,
    issuedByPhone: (x.issuedByPhone as string) ?? null,
    unitLabel: (x.unitLabel as string) ?? null,
  };
}

function fromDbShutdown(x: DbRow): ShutdownRecord {
  return {
    id: x.id as string,
    tenantId: APP_TENANT,
    buildingId: x.buildingId as string,
    resourceType: x.resourceType as ResourceType,
    scope: x.scope as ShutdownRecord['scope'],
    riserId: (x.riserId as string) ?? null,
    affectedUnitIds: (x.affectedUnitIds as string[]) ?? [],
    plannedFrom: iso(x.plannedFrom) ?? '',
    plannedTo: iso(x.plannedTo) ?? '',
    actualFrom: iso(x.actualFrom),
    actualTo: iso(x.actualTo),
    reason: x.reason as string,
    initiator: x.initiator as ShutdownRecord['initiator'],
    orderId: (x.orderId as string) ?? null,
    status: x.status as ShutdownStatus,
    notifiedAt: iso(x.notifiedAt),
    lateNotice: x.lateNotice as boolean,
    isEmergency: x.isEmergency as boolean,
  };
}

function fromDbUnitAccess(x: DbRow): UnitAccessRequest {
  return {
    id: x.id as string,
    tenantId: APP_TENANT,
    buildingId: x.buildingId as string,
    unitId: x.unitId as string,
    unitLabel: x.unitLabel as string,
    permitId: (x.permitId as string) ?? null,
    orderId: (x.orderId as string) ?? null,
    requestedByPhone: x.requestedByPhone as string,
    masterId: (x.masterId as string) ?? null,
    masterName: (x.masterName as string) ?? null,
    reason: x.reason as string,
    windowFrom: iso(x.windowFrom) ?? '',
    windowTo: iso(x.windowTo) ?? '',
    status: x.status as UnitAccessStatus,
    decidedByPhone: (x.decidedByPhone as string) ?? null,
    decidedAt: iso(x.decidedAt),
    declineReason: (x.declineReason as string) ?? null,
    proposedFrom: iso(x.proposedFrom),
    proposedTo: iso(x.proposedTo),
    expiresAt: iso(x.expiresAt) ?? '',
    accessCode: x.accessCode as string,
    createdAt: iso(x.createdAt) ?? '',
  };
}
