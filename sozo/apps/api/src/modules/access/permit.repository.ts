import { Injectable } from '@nestjs/common';
import type { PermitStatus, PermitApprovalKind, PassType, ShutdownStatus, ResourceType } from '@sozo/contracts';
import { StateStore } from '../../common/state-store';

@Injectable()
export class InMemoryPermitRepository {
  private permits = new Map<string, PermitRecord>();
  private passes = new Map<string, PassRecord>();
  private shutdowns = new Map<string, ShutdownRecord>();
  private unitAccess = new Map<string, UnitAccessRequest>();
  /** идемпотентность офлайн-синка мастера: client_op_uuid → результат перехода */
  private ops = new Map<string, string>();

  constructor(store: StateStore) {
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

  save(p: PermitRecord): void {
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
