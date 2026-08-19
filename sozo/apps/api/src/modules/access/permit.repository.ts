import { Injectable } from '@nestjs/common';
import type { PermitStatus, PermitApprovalKind, PassType, ShutdownStatus, ResourceType } from '@sozo/contracts';
import { StateStore } from '../../common/state-store';

@Injectable()
export class InMemoryPermitRepository {
  private permits = new Map<string, PermitRecord>();
  private passes = new Map<string, PassRecord>();
  private shutdowns = new Map<string, ShutdownRecord>();
  /** идемпотентность офлайн-синка мастера: client_op_uuid → результат перехода */
  private ops = new Map<string, string>();

  constructor(store: StateStore) {
    store.register(
      'access',
      () => ({
        permits: [...this.permits.values()],
        passes: [...this.passes.values()],
        shutdowns: [...this.shutdowns.values()],
        ops: [...this.ops],
      }),
      (data) => {
        const d = data as {
          permits?: PermitRecord[];
          passes?: PassRecord[];
          shutdowns?: ShutdownRecord[];
          ops?: [string, string][];
        };
        this.permits = new Map((d.permits ?? []).map((p) => [p.id, p]));
        this.passes = new Map((d.passes ?? []).map((p) => [p.id, p]));
        this.shutdowns = new Map((d.shutdowns ?? []).map((p) => [p.id, p]));
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
  orderId: string;
  masterId: string;
  passType: PassType;
  qrToken: string;
  fallbackCode: string;
  validFrom: string;
  validTo: string;
  status: 'active' | 'used' | 'revoked' | 'expired';
}

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
