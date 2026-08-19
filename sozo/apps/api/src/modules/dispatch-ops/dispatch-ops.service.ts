import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { uuidv7 } from '@sozo/kernel';
import { StateStore } from '../../common/state-store';

/**
 * Операционные протоколы диспетчерской (PRD-03):
 * D-12 протокол замены (цель — новый мастер за 15 минут, ТЗ 17.3),
 * D-13 режим массового инцидента,
 * D-17 передача смены (handover).
 */

export interface ReplacementRec {
  id: string;
  orderId: string;
  orderNumber: string;
  reason: 'no_departure' | 'declined' | 'geo_stale' | 'manual';
  detectedAt: string;
  fromMasterId?: string;
  fromMasterName?: string;
  /** Уровни поиска по ТЗ 17.3: дежурный → свободные рядом → завершающие → бродкаст */
  stage: 'detected' | 'broadcast' | 'assigned' | 'escalated' | 'closed';
  broadcastStartedAt?: string;
  broadcastSeconds: number; // 120 сек — первый принявший забирает
  toMasterId?: string;
  toMasterName?: string;
  resolvedAt?: string;
  clientNotified: boolean; // «молчание запрещено» — клиенту push сразу
  sanction?: 'none' | 'warning' | 'no_show' | 'blocked';
  note?: string;
}

export interface IncidentRec {
  id: string;
  title: string;
  zone: string;
  category: string;
  openedAt: string;
  closedAt?: string;
  orderIds: string[];
  note?: string;
  openedBy: string;
}

export interface HandoverItem {
  id: string;
  kind: string; // replacement | incident | blocked | dispute | complaint | awaiting_payment | approval
  title: string;
  detail: string;
  accepted: boolean;
  acceptedBy?: string;
  acceptedAt?: string;
}

export interface HandoverRec {
  id: string;
  fromPhone: string;
  toPhone?: string;
  startedAt: string;
  acceptedAt?: string;
  items: HandoverItem[];
}

/**
 * Обращение клиента, которое требует человека в диспетчерской.
 *
 * Раньше каждое из них умирало на своём месте: перенос ложился в поле заявки,
 * низкая оценка — в другое поле, быстрое сообщение уходило пушем мастеру и
 * пропадало, если тот не в сети. Теперь у них одна очередь: клиент попросил —
 * диспетчер видит, берёт и закрывает.
 */
export interface ClientRequestRec {
  id: string;
  kind: 'reschedule' | 'low_rating' | 'message';
  orderId: string;
  orderNumber: string;
  clientPhone: string;
  clientName?: string;
  masterId?: string;
  masterName?: string;
  title: string;
  detail: string;
  /** Срок, к которому надо ответить: у оценки 1–2 это 2 часа (ТЗ 7.4) */
  dueAt?: string;
  status: 'new' | 'in_work' | 'done';
  takenByPhone?: string;
  resolution?: string;
  createdAt: string;
  closedAt?: string;
}

@Injectable()
export class DispatchOpsService {
  readonly replacements: ReplacementRec[] = [];
  readonly incidents: IncidentRec[] = [];
  readonly handovers: HandoverRec[] = [];
  readonly clientRequests: ClientRequestRec[] = [];

  constructor(private readonly store: StateStore) {
    this.store.register(
      'dispatchOps',
      () => ({
        replacements: this.replacements,
        incidents: this.incidents,
        handovers: this.handovers,
        clientRequests: this.clientRequests,
      }),
      (d) => {
        const data = d as {
          replacements: ReplacementRec[];
          incidents: IncidentRec[];
          handovers: HandoverRec[];
          clientRequests?: ClientRequestRec[];
        };
        this.replacements.length = 0;
        this.replacements.push(...(data.replacements ?? []));
        this.incidents.length = 0;
        this.incidents.push(...(data.incidents ?? []));
        this.handovers.length = 0;
        this.handovers.push(...(data.handovers ?? []));
        this.clientRequests.length = 0;
        this.clientRequests.push(...(data.clientRequests ?? []));
      },
    );
  }

  // ---------- Очередь обращений клиента ----------

  fileClientRequest(data: Omit<ClientRequestRec, 'id' | 'status' | 'createdAt'>): ClientRequestRec {
    const rec: ClientRequestRec = {
      id: uuidv7(),
      ...data,
      status: 'new',
      createdAt: new Date().toISOString(),
    };
    this.clientRequests.push(rec);
    this.store.persist();
    return rec;
  }

  /** Открытые — вперёд, просроченные — в самом верху: у них уже сорван срок */
  openClientRequests(): ClientRequestRec[] {
    const now = Date.now();
    const overdue = (r: ClientRequestRec) => !!r.dueAt && new Date(r.dueAt).getTime() < now;
    return this.clientRequests
      .filter((r) => r.status !== 'done')
      .sort((a, b) => {
        if (overdue(a) !== overdue(b)) return overdue(a) ? -1 : 1;
        return a.createdAt.localeCompare(b.createdAt);
      });
  }

  clientRequest(id: string): ClientRequestRec {
    const r = this.clientRequests.find((x) => x.id === id);
    if (!r) throw new NotFoundException({ code: 'CLIENT_REQUEST_NOT_FOUND' });
    return r;
  }

  takeClientRequest(id: string, phone: string): ClientRequestRec {
    const r = this.clientRequest(id);
    if (r.status === 'done') throw new BadRequestException({ code: 'ALREADY_DONE' });
    r.status = 'in_work';
    r.takenByPhone = phone;
    this.store.persist();
    return r;
  }

  closeClientRequest(id: string, phone: string, resolution: string): ClientRequestRec {
    const r = this.clientRequest(id);
    if (!resolution?.trim()) {
      throw new BadRequestException({ code: 'RESOLUTION_REQUIRED', message: 'Напишите, чем закончилось' });
    }
    r.status = 'done';
    r.takenByPhone = r.takenByPhone ?? phone;
    r.resolution = resolution.trim();
    r.closedAt = new Date().toISOString();
    this.store.persist();
    return r;
  }

  touch(): void {
    this.store.persist();
  }

  // ---------- D-12 протокол замены ----------

  openReplacement(data: Omit<ReplacementRec, 'id' | 'stage' | 'detectedAt' | 'broadcastSeconds' | 'clientNotified'>): ReplacementRec {
    const existing = this.replacements.find((r) => r.orderId === data.orderId && r.stage !== 'closed');
    if (existing) return existing;
    const rec: ReplacementRec = {
      id: uuidv7(),
      ...data,
      stage: 'detected',
      detectedAt: new Date().toISOString(),
      broadcastSeconds: 120, // параметр №32
      clientNotified: false,
    };
    this.replacements.push(rec);
    this.store.persist();
    return rec;
  }

  get(id: string): ReplacementRec {
    const r = this.replacements.find((x) => x.id === id);
    if (!r) throw new NotFoundException({ code: 'REPLACEMENT_NOT_FOUND' });
    return r;
  }

  /** Бродкаст-оффер всем подходящим сразу: первый принявший забирает (ТЗ 17.3) */
  startBroadcast(id: string): ReplacementRec {
    const r = this.get(id);
    if (r.stage === 'closed') throw new BadRequestException({ code: 'ALREADY_CLOSED' });
    r.stage = 'broadcast';
    r.broadcastStartedAt = new Date().toISOString();
    this.store.persist();
    return r;
  }

  assign(id: string, masterId: string, masterName: string): ReplacementRec {
    const r = this.get(id);
    r.stage = 'assigned';
    r.toMasterId = masterId;
    r.toMasterName = masterName;
    r.resolvedAt = new Date().toISOString();
    r.clientNotified = true; // «Мастер заменён, едет {имя}» — молчание запрещено
    this.store.persist();
    return r;
  }

  /** 15 минут без результата → задача звонка клиенту (перенос/сдвиг) */
  escalate(id: string, note: string): ReplacementRec {
    const r = this.get(id);
    r.stage = 'escalated';
    r.note = note;
    this.store.persist();
    return r;
  }

  /** Квалификация невыхода: 2-й за 90 дней — снятие, 3-й — блокировка (ТЗ 17.3) */
  close(id: string, sanction: ReplacementRec['sanction'], note?: string): ReplacementRec {
    const r = this.get(id);
    r.stage = 'closed';
    r.sanction = sanction;
    if (note) r.note = note;
    r.resolvedAt = r.resolvedAt ?? new Date().toISOString();
    this.store.persist();
    return r;
  }

  /** Счётчик невыходов мастера за 90 дней — основание санкции */
  noShowCount(masterId: string): number {
    const since = Date.now() - 90 * 86_400_000;
    return this.replacements.filter(
      (r) => r.fromMasterId === masterId && (r.sanction === 'no_show' || r.sanction === 'blocked') && new Date(r.detectedAt).getTime() >= since,
    ).length;
  }

  activeReplacements(): ReplacementRec[] {
    return this.replacements.filter((r) => r.stage !== 'closed');
  }

  // ---------- D-13 инциденты ----------

  openIncident(data: Omit<IncidentRec, 'id' | 'openedAt' | 'orderIds'> & { orderIds?: string[] }): IncidentRec {
    const rec: IncidentRec = { id: uuidv7(), openedAt: new Date().toISOString(), orderIds: data.orderIds ?? [], ...data };
    this.incidents.push(rec);
    this.store.persist();
    return rec;
  }

  attachToIncident(id: string, orderId: string): IncidentRec {
    const inc = this.incidents.find((x) => x.id === id);
    if (!inc) throw new NotFoundException({ code: 'INCIDENT_NOT_FOUND' });
    if (!inc.orderIds.includes(orderId)) inc.orderIds.push(orderId);
    this.store.persist();
    return inc;
  }

  closeIncident(id: string, note?: string): IncidentRec {
    const inc = this.incidents.find((x) => x.id === id);
    if (!inc) throw new NotFoundException({ code: 'INCIDENT_NOT_FOUND' });
    inc.closedAt = new Date().toISOString();
    if (note) inc.note = note;
    this.store.persist();
    return inc;
  }

  // ---------- D-17 передача смены ----------

  startHandover(fromPhone: string, items: Array<Omit<HandoverItem, 'id' | 'accepted'>>): HandoverRec {
    const open = this.handovers.find((h) => !h.acceptedAt);
    if (open) throw new BadRequestException({ code: 'HANDOVER_OPEN', message: 'Есть несданная смена — примите её сначала' });
    const rec: HandoverRec = {
      id: uuidv7(),
      fromPhone,
      startedAt: new Date().toISOString(),
      items: items.map((i) => ({ id: uuidv7(), accepted: false, ...i })),
    };
    this.handovers.push(rec);
    this.store.persist();
    return rec;
  }

  currentHandover(): HandoverRec | null {
    return this.handovers.find((h) => !h.acceptedAt) ?? null;
  }

  acceptItem(handoverId: string, itemId: string, byPhone: string): HandoverRec {
    const h = this.handovers.find((x) => x.id === handoverId);
    if (!h) throw new NotFoundException({ code: 'HANDOVER_NOT_FOUND' });
    const item = h.items.find((i) => i.id === itemId);
    if (!item) throw new NotFoundException({ code: 'ITEM_NOT_FOUND' });
    item.accepted = true;
    item.acceptedBy = byPhone;
    item.acceptedAt = new Date().toISOString();
    this.store.persist();
    return h;
  }

  /** Смена не считается сданной, пока не приняты ВСЕ пункты (PRD-03 D-17) */
  acceptHandover(handoverId: string, byPhone: string): HandoverRec {
    const h = this.handovers.find((x) => x.id === handoverId);
    if (!h) throw new NotFoundException({ code: 'HANDOVER_NOT_FOUND' });
    const pending = h.items.filter((i) => !i.accepted);
    if (pending.length) {
      throw new BadRequestException({
        code: 'ITEMS_PENDING',
        message: `Не принято пунктов: ${pending.length}. Смена не считается сданной, пока каждый пункт не отмечен явно (PRD-03 D-17)`,
      });
    }
    h.acceptedAt = new Date().toISOString();
    h.toPhone = byPhone;
    this.store.persist();
    return h;
  }
}
