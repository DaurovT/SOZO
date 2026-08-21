import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { uuidv7 } from '@sozo/kernel';
import { StateStore } from '../../common/state-store';
import { PrismaService } from '../../common/prisma.service';
import { PgMirror } from '../../common/pg-mirror';

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
export class DispatchOpsService implements OnModuleInit {
  readonly replacements: ReplacementRec[] = [];
  readonly incidents: IncidentRec[] = [];
  readonly handovers: HandoverRec[] = [];
  readonly clientRequests: ClientRequestRec[] = [];

  private readonly mirror: PgMirror;

  constructor(
    private readonly store: StateStore,
    prisma: PrismaService,
  ) {
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
    this.mirror = new PgMirror(prisma, 'DispatchOps', {
      load: async (tx) => {
        const [reps, incidents, handovers, requests] = await Promise.all([
          tx.masterReplacement.findMany({ orderBy: { detectedAt: 'asc' } }),
          tx.dispatchIncident.findMany({ include: { orders: true }, orderBy: { openedAt: 'asc' } }),
          tx.shiftHandover.findMany({ include: { items: true }, orderBy: { startedAt: 'asc' } }),
          tx.clientRequest.findMany({ orderBy: { createdAt: 'asc' } }),
        ]);
        const fill = <T>(target: T[], src: T[]) => {
          if (!src.length) return;
          target.length = 0;
          target.push(...src);
        };
        fill(this.replacements, reps.map((r) => ({
          id: r.id,
          orderId: r.orderId,
          orderNumber: r.orderNumber,
          reason: r.reason as ReplacementRec['reason'],
          detectedAt: r.detectedAt.toISOString(),
          fromMasterId: r.fromMasterId ?? undefined,
          fromMasterName: r.fromMasterName ?? undefined,
          stage: r.stage as ReplacementRec['stage'],
          broadcastStartedAt: r.broadcastStartedAt?.toISOString(),
          broadcastSeconds: r.broadcastSeconds,
          toMasterId: r.toMasterId ?? undefined,
          toMasterName: r.toMasterName ?? undefined,
          resolvedAt: r.resolvedAt?.toISOString(),
          clientNotified: r.clientNotified,
          sanction: r.sanction as ReplacementRec['sanction'],
          note: r.note ?? undefined,
        })));
        fill(this.incidents, incidents.map((i) => ({
          id: i.id,
          title: i.title,
          zone: i.zone,
          category: i.category,
          openedAt: i.openedAt.toISOString(),
          closedAt: i.closedAt?.toISOString(),
          orderIds: i.orders.map((o) => o.orderId),
          note: i.note ?? undefined,
          openedBy: i.openedBy,
        })));
        fill(this.handovers, handovers.map((h) => ({
          id: h.id,
          fromPhone: h.fromPhone,
          toPhone: h.toPhone ?? undefined,
          startedAt: h.startedAt.toISOString(),
          acceptedAt: h.acceptedAt?.toISOString(),
          items: h.items.map((it) => ({
            id: it.id,
            kind: it.kind,
            title: it.title,
            detail: it.detail,
            accepted: it.accepted,
            acceptedBy: it.acceptedBy ?? undefined,
            acceptedAt: it.acceptedAt?.toISOString(),
          })),
        })));
        fill(this.clientRequests, requests.map((r) => ({
          id: r.id,
          kind: r.kind as ClientRequestRec['kind'],
          orderId: r.orderId,
          orderNumber: r.orderNumber,
          clientPhone: r.clientPhone,
          clientName: r.clientName ?? undefined,
          masterId: r.masterId ?? undefined,
          masterName: r.masterName ?? undefined,
          title: r.title,
          detail: r.detail,
          dueAt: r.dueAt?.toISOString(),
          status: r.status as ClientRequestRec['status'],
          takenByPhone: r.takenByPhone ?? undefined,
          resolution: r.resolution ?? undefined,
          createdAt: r.createdAt.toISOString(),
          closedAt: r.closedAt?.toISOString(),
        })));
        return reps.length + incidents.length + handovers.length + requests.length;
      },
      save: async (tx, tenantId) => {
        for (const r of this.replacements) {
          const data = {
            orderId: r.orderId, orderNumber: r.orderNumber, reason: r.reason, stage: r.stage,
            fromMasterId: r.fromMasterId ?? null, fromMasterName: r.fromMasterName ?? null,
            toMasterId: r.toMasterId ?? null, toMasterName: r.toMasterName ?? null,
            detectedAt: new Date(r.detectedAt),
            broadcastStartedAt: r.broadcastStartedAt ? new Date(r.broadcastStartedAt) : null,
            broadcastSeconds: r.broadcastSeconds || 120,
            resolvedAt: r.resolvedAt ? new Date(r.resolvedAt) : null,
            clientNotified: r.clientNotified,
            sanction: r.sanction ?? 'none',
            note: r.note ?? null,
          };
          await tx.masterReplacement.upsert({ where: { id: r.id }, create: { id: r.id, tenantId, ...data }, update: data });
        }
        for (const i of this.incidents) {
          const data = {
            title: i.title, zone: i.zone, category: i.category,
            openedAt: new Date(i.openedAt),
            closedAt: i.closedAt ? new Date(i.closedAt) : null,
            openedBy: i.openedBy, note: i.note ?? null,
          };
          await tx.dispatchIncident.upsert({ where: { id: i.id }, create: { id: i.id, tenantId, ...data }, update: data });
          // Связь с заявками переписывается целиком: их единицы, а разницу
          // считать здесь — лишний код там, где ошибка теряет заявку
          await tx.dispatchIncidentOrder.deleteMany({ where: { incidentId: i.id } });
          for (const orderId of i.orderIds) {
            await tx.dispatchIncidentOrder.create({ data: { incidentId: i.id, orderId } });
          }
        }
        for (const h of this.handovers) {
          const data = {
            fromPhone: h.fromPhone,
            toPhone: h.toPhone ?? null,
            startedAt: new Date(h.startedAt),
            acceptedAt: h.acceptedAt ? new Date(h.acceptedAt) : null,
          };
          await tx.shiftHandover.upsert({ where: { id: h.id }, create: { id: h.id, tenantId, ...data }, update: data });
          for (const it of h.items) {
            const idata = {
              kind: it.kind, title: it.title, detail: it.detail, accepted: it.accepted,
              // CHECK в m28: принятый пункт знает, кем и когда принят
              acceptedBy: it.accepted ? (it.acceptedBy ?? h.toPhone ?? h.fromPhone) : null,
              acceptedAt: it.accepted ? new Date(it.acceptedAt ?? new Date().toISOString()) : null,
            };
            await tx.shiftHandoverItem.upsert({
              where: { id: it.id },
              create: { id: it.id, handoverId: h.id, ...idata },
              update: idata,
            });
          }
        }
        for (const r of this.clientRequests) {
          const data = {
            kind: r.kind, orderId: r.orderId, orderNumber: r.orderNumber,
            clientPhone: r.clientPhone, clientName: r.clientName ?? null,
            masterId: r.masterId ?? null, masterName: r.masterName ?? null,
            title: r.title, detail: r.detail,
            dueAt: r.dueAt ? new Date(r.dueAt) : null,
            status: r.status, takenByPhone: r.takenByPhone ?? null,
            resolution: r.resolution ?? null,
            closedAt: r.closedAt ? new Date(r.closedAt) : null,
          };
          await tx.clientRequest.upsert({
            where: { id: r.id },
            create: { id: r.id, tenantId, createdAt: new Date(r.createdAt), ...data },
            update: data,
          });
        }
      },
    });
    this.store.registerMirror(this.mirror);
  }

  onModuleInit(): Promise<void> {
    return this.mirror.init();
  }

  /** Разовый перенос state.json (deploy/import-state) */
  flushToDb(): Promise<void> {
    return this.mirror.flush();
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
