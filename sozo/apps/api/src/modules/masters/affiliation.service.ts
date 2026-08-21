import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { uuidv7 } from '@sozo/kernel';
import { StateStore } from '../../common/state-store';
import { PrismaService } from '../../common/prisma.service';
import { PgMirror } from '../../common/pg-mirror';

/**
 * Принадлежность мастера оператору (DEV-15 §7.1, экран U-05).
 *
 * Отдельная сущность, а не поле в карточке мастера, и это главное решение
 * здесь. Мастер может работать у двух операторов сразу — управляющая компания
 * и подрядчик, — и у каждого своя ставка, свой набор объектов и свой срок
 * договора. Поле в карточке заставило бы выбрать одного и потерять второго.
 *
 * Что принадлежность НЕ делает:
 *
 *   · не меняет расчёт денег. Кто платит за работу, решает происхождение
 *     заявки, а не исполнитель: общее имущество и заявка, взятая по праву
 *     первой руки, идут окладом всегда (DEV-15 §8.5), и это уже работает в
 *     orders. Принадлежность отвечает на другой вопрос — кого оператор
 *     вправе поставить на свою заявку;
 *   · не создаёт второго мастера. Приложение «Мастер» не форкается
 *     (DEV-15 §7.1): штатный мастер оператора — тот же MasterProfile с тем же
 *     конвейером и теми же гейтами фотофиксации;
 *   · не отменяет экзамен для мастеров платформы. Экзамен необязателен
 *     только для штатных мастеров оператора — решение владельца, и
 *     компенсируется контролем на выходе (§7.1.1).
 */
export interface AffiliationRec {
  id: string;
  tenantId: string;
  masterId: string;
  /** Бизнес-код оператора: «uk1», как везде в контуре «Дом» */
  orgId: string;
  status: 'active' | 'suspended' | 'terminated';
  since: string;
  until: string | null;
  skillTags: string[];
  /**
   * Себестоимость часа у этого оператора. У разных операторов разная, поэтому
   * живёт в принадлежности, а не в карточке мастера. Платформа её только
   * считает: оклад платит оператор.
   */
  hourlyCostTiyin: number;
  /** Объекты, на которых работает. Пусто — все объекты оператора */
  objectIds: string[];
  /** Почему приостановлен: причина обязательна, иначе это не решение */
  suspendReason: string | null;
  createdAt: string;
}

@Injectable()
export class AffiliationService implements OnModuleInit {
  private readonly items: AffiliationRec[] = [];
  private readonly mirror: PgMirror;

  constructor(
    private readonly store: StateStore,
    prisma: PrismaService,
  ) {
    this.store.register(
      'masterAffiliations',
      () => this.items,
      (d) => {
        this.items.length = 0;
        this.items.push(...((d ?? []) as AffiliationRec[]));
      },
    );
    this.mirror = new PgMirror(prisma, 'Affiliations', {
      load: async (tx) => {
        const rows = await tx.masterAffiliation.findMany({ orderBy: { createdAt: 'asc' } });
        if (!rows.length) return 0;
        this.items.length = 0;
        this.items.push(
          ...rows.map((r) => ({
            id: r.id,
            tenantId: 't0',
            masterId: r.masterId,
            orgId: r.orgId,
            status: r.status as AffiliationRec['status'],
            since: r.since.toISOString().slice(0, 10),
            until: r.until ? r.until.toISOString().slice(0, 10) : null,
            skillTags: r.skillTags,
            hourlyCostTiyin: Number(r.hourlyCostTiyin),
            objectIds: r.objectIds,
            suspendReason: r.suspendReason ?? null,
            createdAt: r.createdAt.toISOString(),
          })),
        );
        return rows.length;
      },
      save: async (tx, tenantId) => {
        for (const a of [...this.items]) {
          const data = {
            masterId: a.masterId,
            orgId: a.orgId,
            status: a.status,
            since: new Date(`${a.since}T00:00:00Z`),
            until: a.until ? new Date(`${a.until}T00:00:00Z`) : null,
            skillTags: a.skillTags,
            hourlyCostTiyin: BigInt(Math.max(0, a.hourlyCostTiyin)),
            objectIds: a.objectIds,
            // CHECK в m41: приостановка обязана нести причину
            suspendReason: a.status === 'suspended' ? (a.suspendReason?.trim() || 'без объяснения') : null,
          };
          await tx.masterAffiliation.upsert({
            where: { id: a.id },
            create: { id: a.id, tenantId, createdAt: new Date(a.createdAt), ...data },
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

  /** Все принадлежности оператора, включая прекращённые — реестр U-05 */
  listByOrg(tenantId: string, orgId: string): AffiliationRec[] {
    return this.items.filter((a) => a.tenantId === tenantId && a.orgId === orgId);
  }

  /** Операторы этого мастера. Их может быть несколько — см. комментарий класса */
  listByMaster(tenantId: string, masterId: string): AffiliationRec[] {
    return this.items.filter((a) => a.tenantId === tenantId && a.masterId === masterId);
  }

  /**
   * Работает ли мастер на оператора прямо сейчас.
   *
   * Приостановленный и прекращённый не работают, и это разные вещи:
   * приостановка снимается, прекращение — нет. Срок договора тоже проверяется:
   * истёкший ГПХ означает, что человек юридически не оформлен, и ставить его
   * на заявку нельзя, даже если он в реестре.
   */
  isActive(tenantId: string, masterId: string, orgId: string, now = new Date()): boolean {
    const a = this.items.find((x) => x.tenantId === tenantId && x.masterId === masterId && x.orgId === orgId);
    if (!a || a.status !== 'active') return false;
    if (a.until && Date.parse(a.until) < now.getTime()) return false;
    return true;
  }

  /** Мастера, которых оператор вправе поставить на заявку сегодня */
  activeMasterIds(tenantId: string, orgId: string, now = new Date()): string[] {
    return this.items
      .filter((a) => a.tenantId === tenantId && a.orgId === orgId)
      .filter((a) => a.status === 'active' && (!a.until || Date.parse(a.until) >= now.getTime()))
      .map((a) => a.masterId);
  }

  hire(
    tenantId: string,
    orgId: string,
    masterId: string,
    dto: { since?: string; until?: string | null; skillTags?: string[]; hourlyCostTiyin?: number; objectIds?: string[] },
  ): AffiliationRec {
    const exists = this.items.find((a) => a.tenantId === tenantId && a.masterId === masterId && a.orgId === orgId);
    if (exists && exists.status !== 'terminated') {
      throw new ConflictException({
        code: 'ALREADY_AFFILIATED',
        message: 'Этот мастер уже числится за оператором',
      });
    }
    const since = dto.since ?? new Date().toISOString().slice(0, 10);
    if (dto.until && dto.until < since) {
      throw new BadRequestException({ code: 'PERIOD_INVERTED', message: 'Договор не может кончаться раньше, чем начался' });
    }
    // Прекращённую принадлежность заводим заново, а не воскрешаем: у нового
    // договора свои даты и своя ставка, и переписать старую запись означало бы
    // стереть след того, что человек уже уходил
    if (exists) this.items.splice(this.items.indexOf(exists), 1);
    const rec: AffiliationRec = {
      id: uuidv7(),
      tenantId,
      masterId,
      orgId,
      status: 'active',
      since,
      until: dto.until ?? null,
      skillTags: dto.skillTags ?? [],
      hourlyCostTiyin: Math.max(0, dto.hourlyCostTiyin ?? 0),
      objectIds: dto.objectIds ?? [],
      suspendReason: null,
      createdAt: new Date().toISOString(),
    };
    this.items.push(rec);
    this.store.persist();
    return rec;
  }

  suspend(tenantId: string, orgId: string, masterId: string, reason: string): AffiliationRec {
    const a = this.mustFind(tenantId, orgId, masterId);
    if (!reason?.trim()) {
      throw new BadRequestException({
        code: 'REASON_REQUIRED',
        message: 'Причина приостановки обязательна: человек должен знать, что исправить',
      });
    }
    a.status = 'suspended';
    a.suspendReason = reason.trim();
    this.store.persist();
    return a;
  }

  resume(tenantId: string, orgId: string, masterId: string): AffiliationRec {
    const a = this.mustFind(tenantId, orgId, masterId);
    if (a.status === 'terminated') {
      throw new ConflictException({
        code: 'TERMINATED',
        message: 'Договор прекращён — вернуть можно только новым оформлением',
      });
    }
    a.status = 'active';
    a.suspendReason = null;
    this.store.persist();
    return a;
  }

  terminate(tenantId: string, orgId: string, masterId: string, until?: string): AffiliationRec {
    const a = this.mustFind(tenantId, orgId, masterId);
    a.status = 'terminated';
    a.until = until ?? new Date().toISOString().slice(0, 10);
    this.store.persist();
    return a;
  }

  private mustFind(tenantId: string, orgId: string, masterId: string): AffiliationRec {
    const a = this.items.find((x) => x.tenantId === tenantId && x.masterId === masterId && x.orgId === orgId);
    if (!a) throw new NotFoundException({ code: 'AFFILIATION_NOT_FOUND', message: 'Мастер за этим оператором не числится' });
    return a;
  }
}
