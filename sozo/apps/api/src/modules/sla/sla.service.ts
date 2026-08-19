import { Injectable } from '@nestjs/common';
import { uuidv7 } from '@sozo/kernel';
import { StateStore } from '../../common/state-store';
import { EventBus } from '../../common/event-bus';

export type SlaPriority = 'critical' | 'high' | 'normal' | 'low';
export type SlaScope = 'private' | 'common_area' | 'both';
export type SlaBreachFlag = 'response' | 'arrival' | 'resolution';

export interface SlaPolicyRecord {
  id: string;
  tenantId: string;
  operatorOrgId: string;
  /** null — политика по умолчанию для всех объектов оператора */
  buildingId: string | null;
  categoryId: string | null;
  priority: SlaPriority;
  responseMin: number;
  arrivalMin: number;
  resolutionMin: number;
  workingHoursOnly: boolean;
  escalationChain: string[];
  appliesToScope: SlaScope;
}

export interface SlaStateRecord {
  orderId: string;
  tenantId: string;
  policyId: string;
  responseDue: string;
  arrivalDue: string;
  resolutionDue: string;
  breached: SlaBreachFlag[];
  /** пройденные этапы — их дедлайны воркер больше не проверяет */
  reached: SlaBreachFlag[];
  /** накопленное время в паузах, не засчитываемое в SLA */
  pausedMs: number;
}

/**
 * Модуль sla (DEV-07 §2.1, правило 7): политики, дедлайны, детект нарушений.
 * Статусы НЕ меняет — только считает и публикует `sla.breached`; реакция — дело orders
 * и движка уведомлений.
 */
@Injectable()
export class SlaService {
  private policies = new Map<string, SlaPolicyRecord>();
  private states = new Map<string, SlaStateRecord>();

  constructor(store: StateStore, private readonly bus: EventBus) {
    store.register(
      'sla',
      () => ({ policies: [...this.policies.values()], states: [...this.states.values()] }),
      (d) => {
        const data = d as { policies?: SlaPolicyRecord[]; states?: SlaStateRecord[] };
        this.policies = new Map((data.policies ?? []).map((x) => [x.id, x]));
        this.states = new Map((data.states ?? []).map((x) => [x.orderId, x]));
      },
    );
  }

  upsertPolicy(tenantId: string, dto: Omit<SlaPolicyRecord, 'id' | 'tenantId'>): SlaPolicyRecord {
    const rec: SlaPolicyRecord = { id: uuidv7(), tenantId, ...dto };
    this.policies.set(rec.id, rec);
    return rec;
  }

  listPolicies(tenantId: string, operatorOrgId: string): SlaPolicyRecord[] {
    return [...this.policies.values()].filter((p) => p.tenantId === tenantId && p.operatorOrgId === operatorOrgId);
  }

  /**
   * Каскад подбора политики (DEV-15 §7.2 п.1):
   * категория+здание → категория+оператор → приоритет+здание → дефолт оператора.
   * Чем конкретнее совпадение, тем выше приоритет — иначе общая политика перекроет частную.
   */
  resolvePolicy(
    tenantId: string,
    operatorOrgId: string,
    ctx: { buildingId?: string; categoryId?: string; priority: SlaPriority; scope: 'private' | 'common_area' },
  ): SlaPolicyRecord | undefined {
    const all = this.listPolicies(tenantId, operatorOrgId).filter(
      (p) => p.appliesToScope === 'both' || p.appliesToScope === ctx.scope,
    );
    const score = (p: SlaPolicyRecord): number => {
      if (p.categoryId && p.categoryId !== ctx.categoryId) return -1;
      if (p.buildingId && p.buildingId !== ctx.buildingId) return -1;
      let s = 0;
      if (p.categoryId) s += 4;
      if (p.buildingId) s += 2;
      if (p.priority === ctx.priority) s += 1;
      return s;
    };
    return all
      .map((p) => ({ p, s: score(p) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)[0]?.p;
  }

  /** Постановка дедлайнов на заявку. Часы считаются от момента принятия. */
  start(tenantId: string, orderId: string, policy: SlaPolicyRecord, at = new Date()): SlaStateRecord {
    const t = at.getTime();
    const rec: SlaStateRecord = {
      orderId,
      tenantId,
      policyId: policy.id,
      responseDue: new Date(t + policy.responseMin * 60_000).toISOString(),
      arrivalDue: new Date(t + policy.arrivalMin * 60_000).toISOString(),
      resolutionDue: new Date(t + policy.resolutionMin * 60_000).toISOString(),
      breached: [],
      reached: [],
      pausedMs: 0,
    };
    this.states.set(orderId, rec);
    return rec;
  }

  /**
   * Пауза засчитывается в SLA только если вина на операторе (DEV-15 §7.2 п.3).
   * `awaiting_materials` — его проблема, засчитывается; ожидание решения клиента — нет.
   * Правило спасает от бессмысленных споров об SLA.
   */
  addPause(tenantId: string, orderId: string, ms: number, blame: 'operator' | 'client' | 'third_party'): void {
    const st = this.states.get(orderId);
    if (!st || st.tenantId !== tenantId) return;
    if (blame === 'operator') return; // время идёт, дедлайны не сдвигаются
    st.pausedMs += ms;
    st.responseDue = new Date(Date.parse(st.responseDue) + ms).toISOString();
    st.arrivalDue = new Date(Date.parse(st.arrivalDue) + ms).toISOString();
    st.resolutionDue = new Date(Date.parse(st.resolutionDue) + ms).toISOString();
    this.states.set(orderId, st);
  }

  /**
   * Этап пройден. Если пройден вовремя — дедлайн больше не может быть нарушен:
   * иначе воркер задним числом пометит нарушением то, что успели сделать.
   */
  markReached(tenantId: string, orderId: string, stage: SlaBreachFlag, at = new Date()): void {
    const st = this.states.get(orderId);
    if (!st || st.tenantId !== tenantId) return;
    const due = stage === 'response' ? st.responseDue : stage === 'arrival' ? st.arrivalDue : st.resolutionDue;
    if (!st.reached.includes(stage)) st.reached.push(stage);
    if (Date.parse(due) < at.getTime() && !st.breached.includes(stage)) {
      st.breached.push(stage);
      this.bus.publish('sla.breached', { orderId, flag: stage, due, lateBy: at.getTime() - Date.parse(due) });
    }
    this.states.set(orderId, st);
  }

  /** Детект нарушений. Нарушение фиксируется в момент истечения, а не при закрытии заявки. */
  check(tenantId: string, now = new Date()): SlaStateRecord[] {
    const breachedNow: SlaStateRecord[] = [];
    for (const st of this.states.values()) {
      if (st.tenantId !== tenantId) continue;
      const flags: Array<[SlaBreachFlag, string]> = [
        ['response', st.responseDue],
        ['arrival', st.arrivalDue],
        ['resolution', st.resolutionDue],
      ];
      for (const [flag, due] of flags) {
        if (!st.reached.includes(flag) && !st.breached.includes(flag) && Date.parse(due) <= now.getTime()) {
          st.breached.push(flag);
          this.bus.publish('sla.breached', { orderId: st.orderId, flag, due });
          if (!breachedNow.includes(st)) breachedNow.push(st);
        }
      }
    }
    return breachedNow;
  }

  /** Светофор для U-01 и D-02: жёлтый на 80% дедлайна, красный при нарушении */
  status(tenantId: string, orderId: string, now = new Date()): 'green' | 'amber' | 'red' | 'none' {
    const st = this.states.get(orderId);
    if (!st || st.tenantId !== tenantId) return 'none';
    if (st.breached.length) return 'red';
    const due = Date.parse(st.resolutionDue);
    const policy = this.policies.get(st.policyId);
    if (!policy) return 'green';
    const total = policy.resolutionMin * 60_000;
    const left = due - now.getTime();
    return left <= total * 0.2 ? 'amber' : 'green';
  }

  get(tenantId: string, orderId: string): SlaStateRecord | undefined {
    const st = this.states.get(orderId);
    return st && st.tenantId === tenantId ? st : undefined;
  }
}
