import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { uuidv7 } from '@sozo/kernel';
import { StateStore } from '../../common/state-store';
import { PrismaService } from '../../common/prisma.service';
import { PgMirror } from '../../common/pg-mirror';

/**
 * Качество: жалобы (D-10, ТЗ 17.10) и споры (D-11, ТЗ 4.2).
 *
 * Жалобы: SLA первый ответ ≤2 ч в окне 8:00–22:00 (ночная — таймер с 8:00),
 * резолюция ≤24 ч, сложные ≤72 ч. Резолюция обязана ссылаться на метод плейбука.
 * Подтверждённая жалоба на качество/поведение = событие уровня «оценка 1» в рейтинге —
 * ПОСЛЕ резолюции, не в момент подачи; неподтверждённые на рейтинг не влияют.
 *
 * Споры: окно 72 ч после «Выполнена», блокируют начисление доли мастера до резолюции;
 * возвраты — только refund-API + сторно; «диспетчер не судит собственные заявки».
 */

export const COMPLAINT_TYPES = ['quality', 'behavior', 'deadline', 'money', 'service', 'app', 'other'] as const;
export type ComplaintType = (typeof COMPLAINT_TYPES)[number];

/** Плейбук методов резолюции (ТЗ 17.10) — резолюция обязана ссылаться на метод */
export const PLAYBOOK = [
  { code: 'apology_vip', title: 'Извинение + VIP-контроль следующей заявки' },
  { code: 'redo', title: 'Переделка работ за счёт компании' },
  { code: 'partial_refund', title: 'Частичный возврат' },
  { code: 'full_refund', title: 'Полный возврат' },
  { code: 'master_change', title: 'Замена закреплённого мастера точки' },
  { code: 'b2b_call', title: 'Звонок руководству + официальный ответ письмом (B2B)' },
] as const;

export interface ComplaintRec {
  id: string;
  orderId?: string;
  orderNumber?: string;
  complainantPhone: string;
  complainantName?: string;
  isOrgManager: boolean; // жалоба руководителя организации → сразу старшему смены
  type: ComplaintType;
  text: string;
  masterId?: string;
  masterName?: string;
  status: 'new' | 'in_progress' | 'resolved' | 'rejected';
  slaFirstResponseAt: string; // дедлайн первого ответа
  slaResolutionAt: string; // дедлайн резолюции
  firstResponseAt?: string;
  resolvedAt?: string;
  playbookCode?: string;
  resolution?: string;
  confirmed?: boolean; // подтверждена ли вина — только после этого влияет на рейтинг
  createdAt: string;
}

export interface DisputeRec {
  id: string;
  orderId: string;
  orderNumber: string;
  openedByPhone: string;
  openedByRole: 'client' | 'dispatcher';
  reason: string;
  amountTiyin: number;
  status: 'open' | 'escalated' | 'resolved';
  resolution?: 'for_client' | 'for_master' | 'compromise';
  refundTiyin?: number;
  masterShareBlocked: boolean; // доля заблокирована до резолюции (ТЗ 4.2)
  handledByPhone?: string;
  comment?: string;
  escalationReason?: string;
  createdAt: string;
  resolvedAt?: string;
}

const HOUR = 3_600_000;

@Injectable()
export class QualityService implements OnModuleInit {
  readonly complaints: ComplaintRec[] = [];
  readonly disputes: DisputeRec[] = [];

  private readonly mirror: PgMirror;

  constructor(
    private readonly store: StateStore,
    prisma: PrismaService,
  ) {
    this.store.register(
      'quality',
      () => ({ complaints: this.complaints, disputes: this.disputes }),
      (d) => {
        const data = d as { complaints: ComplaintRec[]; disputes: DisputeRec[] };
        this.complaints.length = 0;
        this.complaints.push(...(data.complaints ?? []));
        this.disputes.length = 0;
        this.disputes.push(...(data.disputes ?? []));
      },
    );
    this.mirror = new PgMirror(prisma, 'Quality', {
      load: async (tx) => {
        const [complaints, disputes] = await Promise.all([
          tx.qualityComplaint.findMany({ orderBy: { createdAt: 'asc' } }),
          tx.dispute.findMany({ orderBy: { createdAt: 'asc' } }),
        ]);
        if (complaints.length) {
          this.complaints.length = 0;
          this.complaints.push(
            ...complaints.map((c) => ({
              id: c.id,
              orderId: c.orderId ?? undefined,
              orderNumber: c.orderNumber ?? undefined,
              complainantPhone: c.complainantPhone,
              complainantName: c.complainantName ?? undefined,
              isOrgManager: c.isOrgManager,
              type: c.type as ComplaintRec['type'],
              text: c.text,
              masterId: c.masterId ?? undefined,
              masterName: c.masterName ?? undefined,
              status: c.status as ComplaintRec['status'],
              slaFirstResponseAt: c.slaFirstResponseAt.toISOString(),
              slaResolutionAt: c.slaResolutionAt.toISOString(),
              firstResponseAt: c.firstResponseAt?.toISOString(),
              resolvedAt: c.resolvedAt?.toISOString(),
              playbookCode: c.playbookCode ?? undefined,
              resolution: c.resolution ?? undefined,
              confirmed: c.confirmed ?? undefined,
              createdAt: c.createdAt.toISOString(),
            })),
          );
        }
        if (disputes.length) {
          this.disputes.length = 0;
          this.disputes.push(
            ...disputes.map((d) => ({
              id: d.id,
              orderId: d.orderId,
              orderNumber: d.orderNumber,
              openedByPhone: d.openedByPhone,
              openedByRole: d.openedByRole as DisputeRec['openedByRole'],
              reason: d.reason,
              amountTiyin: Number(d.amountTiyin),
              status: d.status as DisputeRec['status'],
              resolution: (d.resolution ?? undefined) as DisputeRec['resolution'],
              refundTiyin: d.refundTiyin === null ? undefined : Number(d.refundTiyin),
              masterShareBlocked: d.masterShareBlocked,
              handledByPhone: d.handledByPhone ?? undefined,
              comment: d.comment ?? undefined,
              escalationReason: d.escalationReason ?? undefined,
              createdAt: d.createdAt.toISOString(),
              resolvedAt: d.resolvedAt?.toISOString(),
            })),
          );
        }
        return complaints.length + disputes.length;
      },
      save: async (tx, tenantId) => {
        for (const c of this.complaints) {
          const data = {
            orderId: c.orderId ?? null,
            orderNumber: c.orderNumber ?? null,
            complainantPhone: c.complainantPhone,
            complainantName: c.complainantName ?? null,
            isOrgManager: c.isOrgManager,
            type: c.type,
            text: c.text,
            masterId: c.masterId ?? null,
            masterName: c.masterName ?? null,
            status: c.status,
            slaFirstResponseAt: new Date(c.slaFirstResponseAt),
            slaResolutionAt: new Date(c.slaResolutionAt),
            firstResponseAt: c.firstResponseAt ? new Date(c.firstResponseAt) : null,
            resolvedAt: c.resolvedAt ? new Date(c.resolvedAt) : null,
            playbookCode: c.playbookCode ?? null,
            // Пустая резолюция — не резолюция: CHECK в m28 требует текст у
            // закрытой жалобы
            resolution: c.resolution?.trim() ? c.resolution : null,
            confirmed: c.confirmed ?? null,
          };
          await tx.qualityComplaint.upsert({
            where: { id: c.id },
            create: { id: c.id, tenantId, createdAt: new Date(c.createdAt), ...data },
            update: data,
          });
        }
        for (const d of this.disputes) {
          const data = {
            orderId: d.orderId,
            orderNumber: d.orderNumber,
            openedByPhone: d.openedByPhone,
            openedByRole: d.openedByRole,
            reason: d.reason,
            amountTiyin: BigInt(d.amountTiyin),
            status: d.status,
            resolution: d.resolution ?? null,
            refundTiyin: d.refundTiyin === undefined ? null : BigInt(d.refundTiyin),
            masterShareBlocked: d.masterShareBlocked,
            handledByPhone: d.handledByPhone ?? null,
            comment: d.comment ?? null,
            escalationReason: d.escalationReason ?? null,
            resolvedAt: d.resolvedAt ? new Date(d.resolvedAt) : null,
          };
          await tx.dispute.upsert({
            where: { id: d.id },
            create: { id: d.id, tenantId, createdAt: new Date(d.createdAt), ...data },
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

  // ---------- Жалобы ----------

  /** Окно работы с жалобами 8:00–22:00: ночная жалоба стартует таймер с 8:00 (ТЗ 17.10) */
  private slaStart(now: Date): Date {
    const h = now.getHours();
    if (h >= 8 && h < 22) return now;
    const next = new Date(now);
    if (h >= 22) next.setDate(next.getDate() + 1);
    next.setHours(8, 0, 0, 0);
    return next;
  }

  fileComplaint(data: {
    orderId?: string;
    orderNumber?: string;
    complainantPhone: string;
    complainantName?: string;
    isOrgManager?: boolean;
    type: ComplaintType;
    text: string;
    masterId?: string;
    masterName?: string;
  }): ComplaintRec {
    if (!COMPLAINT_TYPES.includes(data.type)) throw new BadRequestException({ code: 'TYPE_UNKNOWN' });
    if (!data.text?.trim()) throw new BadRequestException({ code: 'TEXT_REQUIRED' });
    const now = new Date();
    const start = this.slaStart(now);
    // сложные (деньги, приложение) — резолюция 72 ч, остальные 24 ч
    const complex = data.type === 'money' || data.type === 'app';
    const rec: ComplaintRec = {
      id: uuidv7(),
      ...data,
      isOrgManager: !!data.isOrgManager,
      status: 'new',
      slaFirstResponseAt: new Date(start.getTime() + 2 * HOUR).toISOString(),
      slaResolutionAt: new Date(start.getTime() + (complex ? 72 : 24) * HOUR).toISOString(),
      createdAt: now.toISOString(),
    };
    this.complaints.push(rec);
    this.store.persist();
    return rec;
  }

  complaint(id: string): ComplaintRec {
    const c = this.complaints.find((x) => x.id === id);
    if (!c) throw new NotFoundException({ code: 'COMPLAINT_NOT_FOUND' });
    return c;
  }

  respond(id: string): ComplaintRec {
    const c = this.complaint(id);
    if (!c.firstResponseAt) {
      c.firstResponseAt = new Date().toISOString();
      c.status = 'in_progress';
      this.store.persist();
    }
    return c;
  }

  /** Резолюция обязана ссылаться на метод плейбука (ТЗ 17.10) */
  resolve(id: string, playbookCode: string, resolution: string, confirmed: boolean): ComplaintRec {
    const c = this.complaint(id);
    if (!PLAYBOOK.some((p) => p.code === playbookCode)) {
      throw new BadRequestException({ code: 'PLAYBOOK_REQUIRED', message: `Метод из плейбука обязателен: ${PLAYBOOK.map((p) => p.code).join(', ')}` });
    }
    if (!resolution?.trim()) throw new BadRequestException({ code: 'RESOLUTION_REQUIRED' });
    c.status = confirmed ? 'resolved' : 'rejected';
    c.playbookCode = playbookCode;
    c.resolution = resolution;
    c.confirmed = confirmed;
    c.resolvedAt = new Date().toISOString();
    c.firstResponseAt = c.firstResponseAt ?? c.resolvedAt;
    this.store.persist();
    return c;
  }

  /** Паттерн-детект: 3+ подтверждённых жалобы на мастера за 30 дней → авто-разбор (ТЗ 17.10, фаза 2) */
  patternCheck(): Array<{ masterId: string; masterName: string; count: number; types: string[] }> {
    const since = Date.now() - 30 * 86_400_000;
    const byMaster = new Map<string, { name: string; items: ComplaintRec[] }>();
    for (const c of this.complaints) {
      if (!c.masterId || !c.confirmed) continue;
      if (new Date(c.createdAt).getTime() < since) continue;
      const e = byMaster.get(c.masterId) ?? { name: c.masterName ?? '', items: [] };
      e.items.push(c);
      byMaster.set(c.masterId, e);
    }
    return [...byMaster.entries()]
      .filter(([, e]) => e.items.length >= 3)
      .map(([masterId, e]) => ({ masterId, masterName: e.name, count: e.items.length, types: [...new Set(e.items.map((c) => c.type))] }));
  }

  complaintStats() {
    const now = Date.now();
    const open = this.complaints.filter((c) => c.status === 'new' || c.status === 'in_progress');
    return {
      total: this.complaints.length,
      open: open.length,
      overdueFirstResponse: open.filter((c) => !c.firstResponseAt && new Date(c.slaFirstResponseAt).getTime() < now).length,
      overdueResolution: open.filter((c) => new Date(c.slaResolutionAt).getTime() < now).length,
      byType: COMPLAINT_TYPES.map((t) => ({ type: t, count: this.complaints.filter((c) => c.type === t).length })).filter((x) => x.count > 0),
      confirmedShare: this.complaints.length
        ? Math.round((this.complaints.filter((c) => c.confirmed).length / this.complaints.length) * 100)
        : 0,
      patterns: this.patternCheck(),
    };
  }

  // ---------- Споры ----------

  openDispute(data: { orderId: string; orderNumber: string; openedByPhone: string; openedByRole: 'client' | 'dispatcher'; reason: string; amountTiyin: number; completedAt?: string }): DisputeRec {
    if (this.disputes.some((d) => d.orderId === data.orderId && d.status !== 'resolved')) {
      throw new BadRequestException({ code: 'DISPUTE_OPEN', message: 'По заявке уже открыт спор' });
    }
    if (data.completedAt && Date.now() - new Date(data.completedAt).getTime() > 72 * HOUR) {
      throw new BadRequestException({ code: 'WINDOW_CLOSED', message: 'Окно спора 72 ч после «Выполнена» истекло (ТЗ 4.2)' });
    }
    if (!data.reason?.trim()) throw new BadRequestException({ code: 'REASON_REQUIRED' });
    const rec: DisputeRec = {
      id: uuidv7(),
      ...data,
      status: 'open',
      masterShareBlocked: true, // доля мастера заблокирована до резолюции
      createdAt: new Date().toISOString(),
    };
    this.disputes.push(rec);
    this.store.persist();
    return rec;
  }

  /**
   * Убрать только что заведённый спор.
   *
   * Нужен ровно для одного случая: спор зарегистрировали, а заявка его не
   * приняла (конвейер не пустил переход). Оставлять запись нельзя — она
   * заблокирует долю мастера по заявке, в которой спора нет. Разбирать
   * начатый спор этим методом не получится: он отказывает, если по спору
   * уже что-то происходило.
   */
  discard(id: string): void {
    const i = this.disputes.findIndex((d) => d.id === id);
    if (i < 0) return;
    if (this.disputes[i].status !== 'open' || this.disputes[i].handledByPhone) {
      throw new BadRequestException({ code: 'DISPUTE_IN_WORK', message: 'Спор уже в работе — его нельзя убрать' });
    }
    this.disputes.splice(i, 1);
    this.store.persist();
  }

  dispute(id: string): DisputeRec {
    const d = this.disputes.find((x) => x.id === id);
    if (!d) throw new NotFoundException({ code: 'DISPUTE_NOT_FOUND' });
    return d;
  }

  /** «Диспетчер не судит собственные заявки» — эскалация старшему (ТЗ 4.2) */
  escalate(id: string, reason: string): DisputeRec {
    const d = this.dispute(id);
    d.status = 'escalated';
    d.escalationReason = reason;
    this.store.persist();
    return d;
  }

  resolveDispute(id: string, params: { resolution: 'for_client' | 'for_master' | 'compromise'; refundTiyin?: number; comment: string; handledByPhone: string }): DisputeRec {
    const d = this.dispute(id);
    if (!params.comment?.trim()) throw new BadRequestException({ code: 'COMMENT_REQUIRED', message: 'Комментарий резолюции обязателен (уходит в аудит)' });
    if (params.resolution !== 'for_master' && !params.refundTiyin) {
      throw new BadRequestException({ code: 'REFUND_REQUIRED', message: 'Для резолюции в пользу клиента или компромисса укажите сумму возврата' });
    }
    if ((params.refundTiyin ?? 0) > d.amountTiyin) {
      throw new BadRequestException({ code: 'REFUND_TOO_BIG', message: 'Возврат больше суммы заявки' });
    }
    d.status = 'resolved';
    d.resolution = params.resolution;
    d.refundTiyin = params.refundTiyin ?? 0;
    d.comment = params.comment;
    d.handledByPhone = params.handledByPhone;
    d.masterShareBlocked = false; // блокировка снимается резолюцией
    d.resolvedAt = new Date().toISOString();
    this.store.persist();
    return d;
  }

  openDisputes(): DisputeRec[] {
    return this.disputes.filter((d) => d.status !== 'resolved');
  }
}
