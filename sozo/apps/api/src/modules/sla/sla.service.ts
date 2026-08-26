import { Injectable, OnModuleInit } from '@nestjs/common';
import { uuidv7 } from '@sozo/kernel';
import { StateStore } from '../../common/state-store';
import { PrismaService } from '../../common/prisma.service';
import { PgMirror, APP_TENANT } from '../../common/pg-mirror';
import { EventBus } from '../../common/event-bus';
import { fromLocal, localDateKey, localMinutesOfDay } from '../../common/tz';

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
  /**
   * Когда работа устранена.
   *
   * Нужен светофору: список нарушений только пополнялся, и заявка оставалась
   * красной навсегда — даже после того, как её сделали. Нарушение остаётся в
   * истории (по нему считают штрафы), а гореть перестаёт.
   */
  closedAt?: string;
}

/**
 * Модуль sla (DEV-07 §2.1, правило 7): политики, дедлайны, детект нарушений.
 * Статусы НЕ меняет — только считает и публикует `sla.breached`; реакция — дело orders
 * и движка уведомлений.
 */
@Injectable()
export class SlaService implements OnModuleInit {
  private policies = new Map<string, SlaPolicyRecord>();
  private states = new Map<string, SlaStateRecord>();
  private readonly mirror: PgMirror;

  constructor(private readonly store: StateStore, private readonly bus: EventBus, prisma: PrismaService) {
    store.register(
      'sla',
      () => ({ policies: [...this.policies.values()], states: [...this.states.values()] }),
      (d) => {
        const data = d as { policies?: SlaPolicyRecord[]; states?: SlaStateRecord[] };
        this.policies = new Map((data.policies ?? []).map((x) => [x.id, x]));
        this.states = new Map((data.states ?? []).map((x) => [x.orderId, x]));
      },
    );
    this.mirror = new PgMirror(prisma, 'SLA', {
      load: async (tx) => {
        const [policies, states] = await Promise.all([tx.slaPolicy.findMany(), tx.slaState.findMany()]);
        if (policies.length) {
          this.policies = new Map(
            policies.map((p) => [
              p.id,
              {
                id: p.id,
                tenantId: APP_TENANT,
                operatorOrgId: p.operatorOrgId,
                buildingId: p.buildingId,
                categoryId: p.categoryId,
                priority: p.priority as SlaPolicyRecord['priority'],
                responseMin: p.responseMin,
                arrivalMin: p.arrivalMin,
                resolutionMin: p.resolutionMin,
                workingHoursOnly: p.workingHoursOnly,
                escalationChain: (p.escalationChain as string[]) ?? [],
                appliesToScope: p.appliesToScope as SlaPolicyRecord['appliesToScope'],
              },
            ]),
          );
        }
        if (states.length) {
          this.states = new Map(
            states.map((x) => [
              x.orderId,
              {
                orderId: x.orderId,
                tenantId: APP_TENANT,
                policyId: x.policyId,
                responseDue: x.responseDue.toISOString(),
                arrivalDue: x.arrivalDue.toISOString(),
                resolutionDue: x.resolutionDue.toISOString(),
                breached: x.breached as SlaStateRecord['breached'],
                reached: x.reached as SlaStateRecord['reached'],
                pausedMs: x.pausedMs,
              },
            ]),
          );
        }
        return policies.length + states.length;
      },
      save: async (tx, tenantId) => {
        for (const p of this.policies.values()) {
          const data = {
            operatorOrgId: p.operatorOrgId,
            buildingId: p.buildingId,
            categoryId: p.categoryId,
            priority: p.priority,
            responseMin: p.responseMin,
            arrivalMin: p.arrivalMin,
            resolutionMin: p.resolutionMin,
            workingHoursOnly: p.workingHoursOnly,
            escalationChain: p.escalationChain as unknown as object,
            appliesToScope: p.appliesToScope,
          };
          await tx.slaPolicy.upsert({ where: { id: p.id }, create: { id: p.id, tenantId, ...data }, update: data });
        }
        for (const x of this.states.values()) {
          const data = {
            policyId: x.policyId,
            responseDue: new Date(x.responseDue),
            arrivalDue: new Date(x.arrivalDue),
            resolutionDue: new Date(x.resolutionDue),
            breached: x.breached,
            reached: x.reached,
            pausedMs: x.pausedMs,
          };
          await tx.slaState.upsert({
            where: { tenantId_orderId: { tenantId, orderId: x.orderId } },
            create: { tenantId, orderId: x.orderId, ...data },
            update: data,
          });
        }
      },
    });
  }

  onModuleInit(): Promise<void> {
    return this.mirror.init();
  }

  /** Разовый перенос state.json (deploy/import-state) */
  flushToDb(): Promise<void> {
    return this.mirror.flush();
  }

  upsertPolicy(tenantId: string, dto: Omit<SlaPolicyRecord, 'id' | 'tenantId'>): SlaPolicyRecord {
    const rec: SlaPolicyRecord = { id: uuidv7(), tenantId, ...dto };
    this.policies.set(rec.id, rec);
    this.mirror.schedule();
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

  /**
   * Рабочие часы обслуживания, местное время.
   *
   * Настройка `workingHoursOnly` у политики загружалась и не использовалась
   * ни в одном расчёте: срок «устранение за 8 ч, только рабочие часы» у
   * заявки, принятой в 17:00 пятницы, давал дедлайн 01:00 субботы — SLA
   * сгорал ночью, когда никто не работает. Теперь минуты действительно
   * отсчитываются по рабочему окну.
   */
  private static readonly WORK_FROM_MIN = 9 * 60;
  private static readonly WORK_TO_MIN = 18 * 60;

  /**
   * Прибавить рабочие минуты к моменту.
   *
   * Считает по местному времени (сервер живёт в UTC — см. common/tz) и
   * перешагивает через нерабочие часы, а не через календарные сутки: важно
   * не «через сколько дней», а «сколько человек реально мог работать».
   */
  private addWorkingMinutes(from: Date, minutes: number): Date {
    const { WORK_FROM_MIN: open, WORK_TO_MIN: close } = SlaService;
    let cursor = from.getTime();
    let left = minutes;
    // Ограничение на случай кривой политики: год рабочих часов — заведомо
    // ошибка ввода, и вечный цикл здесь хуже неверного дедлайна
    for (let guard = 0; guard < 2000 && left > 0; guard += 1) {
      const day = localDateKey(cursor);
      const nowMin = localMinutesOfDay(cursor) ?? 0;
      if (nowMin < open) {
        cursor = fromLocal(day, open).getTime();
        continue;
      }
      if (nowMin >= close) {
        cursor = fromLocal(localDateKey(cursor + 86_400_000), open).getTime();
        continue;
      }
      const availableToday = close - nowMin;
      if (left <= availableToday) return new Date(cursor + left * 60_000);
      left -= availableToday;
      cursor = fromLocal(localDateKey(cursor + 86_400_000), open).getTime();
    }
    return new Date(cursor);
  }

  /** Постановка дедлайнов на заявку. Часы считаются от момента принятия. */
  start(tenantId: string, orderId: string, policy: SlaPolicyRecord, at = new Date()): SlaStateRecord {
    const t = at.getTime();
    const due = (min: number): string =>
      policy.workingHoursOnly ? this.addWorkingMinutes(at, min).toISOString() : new Date(t + min * 60_000).toISOString();
    const rec: SlaStateRecord = {
      orderId,
      tenantId,
      policyId: policy.id,
      responseDue: due(policy.responseMin),
      arrivalDue: due(policy.arrivalMin),
      resolutionDue: due(policy.resolutionMin),
      breached: [],
      reached: [],
      pausedMs: 0,
    };
    this.states.set(orderId, rec);
    this.mirror.schedule();
    this.store.persist();
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
    this.mirror.schedule();
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
    this.mirror.schedule();
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
          // Ключ события — заявка и этап: повторный прогон проверки не
          // публикует то же нарушение второй раз
          this.bus.publish('sla.breached', { orderId: st.orderId, flag, due }, `sla.breached:${st.orderId}:${flag}`);
          if (!breachedNow.includes(st)) breachedNow.push(st);
        }
      }
    }
    /**
     * Выставленные флаги сохраняются.
     *
     * Раньше проверка правила состояние в памяти и не записывала его: после
     * рестарта те же нарушения публиковались заново — и заново уходили
     * уведомления по каждому. Здесь это особенно заметно, потому что рестарт
     * на этой машине происходит при каждой сборке.
     */
    if (breachedNow.length) {
      this.mirror.schedule();
      this.store.persist();
    }
    return breachedNow;
  }

  /**
   * Пересчёт после устранения: заявка перестаёт быть красной.
   *
   * Список нарушений только пополнялся, и заявка оставалась красной навсегда
   * — даже когда работу давно сделали. Нарушение из истории не стирается (это
   * факт, по которому считают штрафы оператору), но текущее состояние
   * перестаёт быть «горит»: горит то, что ещё не сделано.
   */
  resolved(tenantId: string, orderId: string, at = new Date()): void {
    const st = this.states.get(orderId);
    if (!st || st.tenantId !== tenantId) return;
    if (!st.reached.includes('resolution')) this.markReached(tenantId, orderId, 'resolution', at);
    st.closedAt = at.toISOString();
    this.states.set(orderId, st);
    this.mirror.schedule();
    this.store.persist();
  }

  /** Светофор для U-01 и D-02: жёлтый на 80% дедлайна, красный при нарушении */
  status(tenantId: string, orderId: string, now = new Date()): 'green' | 'amber' | 'red' | 'done' | 'none' {
    const st = this.states.get(orderId);
    if (!st || st.tenantId !== tenantId) return 'none';
    // Работа устранена — светофор гаснет. Нарушения остаются в истории и в
    // отчёте оператору, но «красным» помечают то, что ещё горит
    if (st.closedAt || st.reached.includes('resolution')) return 'done';
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
