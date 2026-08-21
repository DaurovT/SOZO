import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { uuidv7 } from '@sozo/kernel';
import { StateStore } from '../../common/state-store';
import { PrismaService } from '../../common/prisma.service';
import { PgMirror } from '../../common/pg-mirror';
import { CrmService } from '../crm/crm.service';

/**
 * Акт осмотра точки (модуль field, на который ссылается граф from_defect).
 *
 * Цепочка B2B: мастер обходит помещение → собирает чек-лист и дефекты → отправляет
 * акт ответственному на точке → тот подтверждает в клиентском приложении построчно
 * → из принятых позиций рождаются заявки. Мастер не подписывает сам за клиента:
 * его дело — заключение, решение принимает тот, кто отвечает за объект (ТЗ 5.2).
 */

export type ActStatus = 'draft' | 'sent' | 'approved' | 'partially_approved' | 'rejected' | 'expired';
export type ItemDecision = 'pending' | 'accepted' | 'declined';

/** Молчание ответственного не держит акт вечно: 72 ч — та же норма, что у смет B2B */
export const ACT_DECISION_HOURS = 72;

export interface ChecklistZoneRec {
  zone: string;
  ok: boolean;
  note?: string;
}

export interface DefectItemRec {
  id: string;
  category: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
  photoIds: string[];
  /** null — оценить на месте нельзя (нужен замер/подрядчик), цену считает офис */
  estimateTiyin: number | null;
  decision: ItemDecision;
  declineReason?: string;
  /** Заявка, созданная из принятой позиции */
  orderId?: string;
}

export interface ActPartyRec {
  id: string;
  fullName: string;
  phone: string;
}

export interface InspectionActRec {
  id: string;
  number: string;
  orderId: string;
  organizationId: string;
  locationId: string;
  locationName: string;
  masterId: string;
  masterName: string;
  checklist: ChecklistZoneRec[];
  items: DefectItemRec[];
  status: ActStatus;
  createdAt: string;
  sentAt?: string;
  decidedAt?: string;
  /** Кому отправлен — главный на точке на момент отправки */
  representative?: ActPartyRec | null;
  /** Кто фактически решил: может отличаться от адресата, если ответственных несколько */
  decidedBy?: ActPartyRec;
  rejectionReason?: string;
  /** Представителя не было на месте — акт ушёл на удалённое решение */
  representativeAbsent?: boolean;
  expiresAt?: string;
}

@Injectable()
export class FieldService implements OnModuleInit {
  private readonly acts: InspectionActRec[] = [];
  private seq = 1000;
  private readonly mirror: PgMirror;

  constructor(
    private readonly store: StateStore,
    private readonly crm: CrmService,
    prisma: PrismaService,
  ) {
    this.store.register(
      'field',
      () => ({ acts: this.acts, seq: this.seq }),
      (d) => {
        const data = d as { acts?: InspectionActRec[]; seq?: number };
        this.acts.length = 0;
        this.acts.push(...(data.acts ?? []));
        this.seq = data.seq ?? 1000;
      },
    );
    this.mirror = new PgMirror(prisma, 'Field', {
      load: async (tx) => {
        const rows = await tx.inspectionAct.findMany({
          include: { checklist: true, items: true },
          orderBy: { createdAt: 'asc' },
        });
        if (!rows.length) return 0;
        this.acts.length = 0;
        this.acts.push(
          ...rows.map((a) => ({
            id: a.id,
            number: a.number,
            orderId: a.orderId,
            organizationId: a.organizationId,
            locationId: a.locationId,
            locationName: a.locationName,
            masterId: a.masterId,
            masterName: a.masterName,
            checklist: a.checklist.map((z) => ({ zone: z.zone, ok: z.ok, note: z.note ?? undefined })),
            items: a.items.map((i) => ({
              id: i.id,
              category: i.category,
              description: i.description,
              severity: i.severity as DefectItemRec['severity'],
              photoIds: i.photoIds,
              estimateTiyin: i.estimateTiyin === null ? null : Number(i.estimateTiyin),
              decision: i.decision as DefectItemRec['decision'],
              declineReason: i.declineReason ?? undefined,
              orderId: i.orderId ?? undefined,
            })),
            status: a.status as InspectionActRec['status'],
            createdAt: a.createdAt.toISOString(),
            sentAt: a.sentAt?.toISOString(),
            decidedAt: a.decidedAt?.toISOString(),
            representative: a.representativeName
              ? { id: a.id, fullName: a.representativeName, phone: a.representativePhone ?? '' }
              : null,
            decidedBy: a.decidedByName
              ? { id: a.id, fullName: a.decidedByName, phone: a.decidedByPhone ?? '' }
              : undefined,
            rejectionReason: a.rejectionReason ?? undefined,
            representativeAbsent: a.representativeAbsent,
            expiresAt: a.expiresAt?.toISOString(),
          })),
        );
        // Счётчик номеров восстанавливается из самих актов, а не хранится
        // рядом: отдельный счётчик рассыпается ровно тогда, когда нужен —
        // при восстановлении из резервной копии
        this.seq = this.acts.reduce((max, a) => Math.max(max, Number(a.number.split('-').pop()) || 0), 1000);
        return rows.length;
      },
      save: async (tx, tenantId) => {
        for (const a of [...this.acts]) {
          const data = {
            number: a.number,
            orderId: a.orderId,
            organizationId: a.organizationId,
            locationId: a.locationId,
            locationName: a.locationName,
            masterId: a.masterId,
            masterName: a.masterName,
            status: a.status,
            representativeName: a.representative?.fullName ?? null,
            representativePhone: a.representative?.phone ?? null,
            representativeAbsent: Boolean(a.representativeAbsent),
            decidedByName: a.decidedBy?.fullName ?? null,
            decidedByPhone: a.decidedBy?.phone ?? null,
            rejectionReason: a.rejectionReason ?? null,
            sentAt: a.sentAt ? new Date(a.sentAt) : null,
            decidedAt: a.decidedAt ? new Date(a.decidedAt) : null,
            expiresAt: a.expiresAt ? new Date(a.expiresAt) : null,
          };
          await tx.inspectionAct.upsert({
            where: { id: a.id },
            create: { id: a.id, tenantId, createdAt: new Date(a.createdAt), ...data },
            update: data,
          });
          // Чек-лист переписывается целиком: зон в акте единицы, и разницу
          // считать здесь — лишний код там, где ошибка теряет отметку
          await tx.actChecklistZone.deleteMany({ where: { actId: a.id } });
          for (const z of a.checklist) {
            await tx.actChecklistZone.create({
              data: { id: uuidv7(), actId: a.id, zone: z.zone, ok: z.ok, note: z.note ?? null },
            });
          }
          for (const i of a.items) {
            const idata = {
              category: i.category,
              description: i.description,
              severity: i.severity,
              photoIds: i.photoIds,
              estimateTiyin: i.estimateTiyin === null ? null : BigInt(i.estimateTiyin),
              decision: i.decision,
              // CHECK в m27: отклонённая позиция обязана нести причину
              declineReason: i.decision === 'declined' ? (i.declineReason?.trim() || 'без объяснения') : (i.declineReason ?? null),
              orderId: i.orderId ?? null,
            };
            await tx.actDefectItem.upsert({
              where: { id: i.id },
              create: { id: i.id, tenantId, actId: a.id, ...idata },
              update: idata,
            });
          }
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

  // ---------- Чтение ----------

  list(filter?: { locationId?: string; orderId?: string; status?: ActStatus }): InspectionActRec[] {
    return this.acts
      .filter((a) => !filter?.locationId || a.locationId === filter.locationId)
      .filter((a) => !filter?.orderId || a.orderId === filter.orderId)
      .filter((a) => !filter?.status || a.status === filter.status)
      .slice()
      .reverse();
  }

  get(id: string): InspectionActRec {
    const a = this.acts.find((x) => x.id === id);
    if (!a) throw new NotFoundException({ code: 'ACT_NOT_FOUND', message: 'Акт осмотра не найден' });
    return a;
  }

  byOrder(orderId: string): InspectionActRec | null {
    return this.acts.find((a) => a.orderId === orderId) ?? null;
  }

  /** Акты всех точек, где телефон значится ответственным — лента клиентского приложения */
  forPhone(phone: string, onlyPending = false): InspectionActRec[] {
    const locIds = new Set(this.crm.locationsForPhone(phone).map((x) => x.loc.id));
    return this.acts
      .filter((a) => locIds.has(a.locationId))
      .filter((a) => !onlyPending || a.status === 'sent')
      .slice()
      .reverse();
  }

  // ---------- Сбор акта мастером ----------

  /** Черновик заводится при первом действии осмотра — отдельной кнопки «начать акт» нет */
  draftFor(params: {
    orderId: string;
    organizationId: string;
    locationId: string;
    locationName: string;
    masterId: string;
    masterName: string;
  }): InspectionActRec {
    const existing = this.byOrder(params.orderId);
    if (existing) return existing;
    const act: InspectionActRec = {
      id: uuidv7(),
      number: `A-${++this.seq}`,
      orderId: params.orderId,
      organizationId: params.organizationId,
      locationId: params.locationId,
      locationName: params.locationName,
      masterId: params.masterId,
      masterName: params.masterName,
      checklist: [],
      items: [],
      status: 'draft',
      createdAt: new Date().toISOString(),
    };
    this.acts.push(act);
    this.store.persist();
    return act;
  }

  private mutableDraft(actId: string): InspectionActRec {
    const act = this.get(actId);
    if (act.status !== 'draft') {
      throw new BadRequestException({
        code: 'ACT_NOT_DRAFT',
        message: 'Акт уже отправлен ответственному — правки только через новый осмотр',
      });
    }
    return act;
  }

  setChecklist(actId: string, zones: ChecklistZoneRec[]): InspectionActRec {
    const act = this.mutableDraft(actId);
    act.checklist = zones;
    this.store.persist();
    return act;
  }

  addItem(actId: string, item: Omit<DefectItemRec, 'id' | 'decision' | 'orderId'>): DefectItemRec {
    const act = this.mutableDraft(actId);
    const rec: DefectItemRec = { id: uuidv7(), decision: 'pending', ...item };
    act.items.push(rec);
    this.store.persist();
    return rec;
  }

  removeItem(actId: string, itemId: string): { removed: boolean } {
    const act = this.mutableDraft(actId);
    const idx = act.items.findIndex((i) => i.id === itemId);
    if (idx < 0) return { removed: false };
    act.items.splice(idx, 1);
    this.store.persist();
    return { removed: true };
  }

  /**
   * Отправка ответственному. Чек-лист обязателен: акт без обхода — это не заключение.
   * Пустой список дефектов допустим и означает «замечаний нет» — такой акт тоже
   * подписывается, иначе «всё в порядке» нечем подтвердить.
   */
  submit(actId: string, opts: { representativeAbsent?: boolean } = {}): InspectionActRec {
    const act = this.mutableDraft(actId);
    if (act.checklist.length === 0) {
      throw new BadRequestException({ code: 'CHECKLIST_EMPTY', message: 'Чек-лист осмотра не заполнен' });
    }
    const rep = this.crm.primaryRepresentative(act.locationId);
    if (!rep) {
      throw new BadRequestException({
        code: 'NO_REPRESENTATIVE',
        message: 'У точки нет ответственного — акт подписывать некому. Сообщите диспетчеру.',
      });
    }
    const now = new Date();
    act.status = 'sent';
    act.sentAt = now.toISOString();
    act.representative = { id: rep.id, fullName: rep.fullName, phone: rep.phone };
    act.representativeAbsent = !!opts.representativeAbsent;
    act.expiresAt = new Date(now.getTime() + ACT_DECISION_HOURS * 3600_000).toISOString();
    this.store.persist();
    return act;
  }

  // ---------- Решение ответственного ----------

  /**
   * Построчный акцепт: ответственный принимает часть позиций и отклоняет остальные.
   * Полностью пустое решение запрещено — иначе акт «решён», но непонятно как.
   */
  decide(
    actId: string,
    by: ActPartyRec,
    decisions: Array<{ itemId: string; decision: 'accepted' | 'declined'; declineReason?: string }>,
    rejectionReason?: string,
  ): InspectionActRec {
    const act = this.get(actId);
    if (act.status !== 'sent') {
      throw new BadRequestException({ code: 'ACT_NOT_PENDING', message: 'По акту уже принято решение' });
    }
    const byId = new Map(decisions.map((d) => [d.itemId, d]));
    for (const item of act.items) {
      const d = byId.get(item.id);
      if (!d) {
        throw new BadRequestException({
          code: 'DECISION_INCOMPLETE',
          message: `Не принято решение по позиции «${item.description}»`,
        });
      }
      item.decision = d.decision;
      item.declineReason = d.decision === 'declined' ? d.declineReason : undefined;
    }
    const accepted = act.items.filter((i) => i.decision === 'accepted').length;
    const declined = act.items.length - accepted;
    // Акт «замечаний нет» подтверждается как согласованный: подписывать нечего, но факт обхода зафиксирован
    act.status = act.items.length === 0 || declined === 0 ? 'approved' : accepted === 0 ? 'rejected' : 'partially_approved';
    if (act.status === 'rejected' && !rejectionReason) {
      throw new BadRequestException({ code: 'REASON_REQUIRED', message: 'Полный отказ по акту требует причины' });
    }
    act.rejectionReason = rejectionReason;
    act.decidedBy = by;
    act.decidedAt = new Date().toISOString();
    this.store.persist();
    return act;
  }

  /** Позиции, по которым положено завести заявки — принятые и ещё не заведённые */
  acceptedPending(actId: string): DefectItemRec[] {
    return this.get(actId).items.filter((i) => i.decision === 'accepted' && !i.orderId);
  }

  linkOrder(actId: string, itemId: string, orderId: string): void {
    const item = this.get(actId).items.find((i) => i.id === itemId);
    if (item) {
      item.orderId = orderId;
      this.store.persist();
    }
  }

  /**
   * Просрочка решения. Акт не отменяется — он остаётся историей обхода, но уходит
   * из ленты ожидания и попадает диспетчеру: молчание точки решается звонком.
   */
  expireOverdue(now = new Date()): InspectionActRec[] {
    const expired = this.acts.filter((a) => a.status === 'sent' && a.expiresAt && new Date(a.expiresAt) <= now);
    for (const a of expired) a.status = 'expired';
    if (expired.length > 0) this.store.persist();
    return expired;
  }
}
