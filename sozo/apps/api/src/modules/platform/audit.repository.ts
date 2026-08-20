import { Injectable } from '@nestjs/common';
import { uuidv7 } from '@sozo/kernel';
import { StateStore } from '../../common/state-store';
import { PrismaService } from '../../common/prisma.service';
import { currentDbContext, systemContext } from '../../common/db-context';

export interface AuditEntry {
  id: string;
  actorPhone: string;
  action: string;
  entity: string;
  entityId?: string;
  payload?: unknown;
  createdAt: string;
}

export interface AuditFilter {
  limit?: number;
  actor?: string;
  entity?: string;
  entityId?: string;
  action?: string;
  q?: string;
}

/**
 * Хранилище аудита. Две реализации за одним интерфейсом — это переходный слой
 * миграции на PostgreSQL (M0-E2-S1), а не постоянная архитектура.
 *
 * Выбор делается один раз на процесс по наличию `DATABASE_URL`, а не помодульно:
 * половина модулей в базе и половина в файле — то состояние, которого README
 * велит избегать. Пока база не задана, работает файловая реализация, и
 * поведение ровно прежнее.
 */
export interface AuditRepository {
  write(entry: Omit<AuditEntry, 'id' | 'createdAt'>): Promise<void>;
  search(f: AuditFilter): Promise<AuditEntry[]>;
  facets(): Promise<{ actors: string[]; entities: string[]; actionGroups: string[] }>;
  byPrefix(prefix: string, sinceMs?: number): Promise<AuditEntry[]>;
}

/** Совпадение по свободному запросу: разбирающий помнит номер, а не поле */
export function matchesFilter(e: AuditEntry, f: AuditFilter, q?: string): boolean {
  if (f.actor && e.actorPhone !== f.actor) return false;
  if (f.entity && e.entity !== f.entity) return false;
  if (f.entityId && e.entityId !== f.entityId) return false;
  if (f.action && e.action !== f.action) return false;
  if (!q) return true;
  return JSON.stringify(e).toLowerCase().includes(q);
}

@Injectable()
export class InMemoryAuditRepository implements AuditRepository {
  private readonly log: AuditEntry[] = [];

  constructor(private readonly store: StateStore) {
    this.store.register(
      'audit',
      () => this.log,
      (d) => {
        this.log.length = 0;
        this.log.push(...((d ?? []) as AuditEntry[]));
      },
    );
  }

  async write(entry: Omit<AuditEntry, 'id' | 'createdAt'>): Promise<void> {
    this.log.push({ id: uuidv7(), createdAt: new Date().toISOString(), ...entry });
    this.store.persist(); // append-only журнал переживает рестарт (ТЗ 14)
  }

  async search(f: AuditFilter): Promise<AuditEntry[]> {
    const q = f.q?.trim().toLowerCase();
    return this.log
      .filter((e) => matchesFilter(e, f, q))
      .slice(-(f.limit ?? 100))
      .reverse();
  }

  async facets() {
    return facetsOf(this.log);
  }

  async byPrefix(prefix: string, sinceMs?: number): Promise<AuditEntry[]> {
    return this.log.filter(
      (e) => e.action.startsWith(prefix) && (sinceMs === undefined || Date.parse(e.createdAt) >= sinceMs),
    );
  }
}

@Injectable()
export class PrismaAuditRepository implements AuditRepository {
  constructor(private readonly prisma: PrismaService) {}

  async write(entry: Omit<AuditEntry, 'id' | 'createdAt'>): Promise<void> {
    const ctx = currentDbContext() ?? systemContext();
    await this.prisma.withContext(async (tx) => {
      await tx.auditLog.create({
        data: {
          id: uuidv7(),
          tenantId: ctx.tenantId,
          actorPhone: entry.actorPhone,
          action: entry.action,
          entity: entry.entity,
          // entityId в схеме — uuid; наши идентификаторы такие и есть, но
          // часть кода пишет туда телефон или номер заявки, и падать на
          // записи аудита нельзя: журнал важнее строгости поля
          entityId: isUuid(entry.entityId) ? entry.entityId : null,
          payload: (entry.payload ?? {}) as object,
        },
      });
    });
  }

  /**
   * Разовый перенос журнала из state.json (deploy/import-state).
   *
   * Пачками, а не по одной: записей десятки тысяч, и транзакция на каждую
   * превратила бы перенос в получасовое ожидание. Идентификаторы и время
   * сохраняются как есть — журнал аудита тем и ценен, что не переписывается.
   */
  async importFromState(raw: unknown, batch = 500): Promise<number> {
    const list = (raw ?? []) as AuditEntry[];
    const ctx = currentDbContext() ?? systemContext();
    let n = 0;
    for (let i = 0; i < list.length; i += batch) {
      const chunk = list.slice(i, i + batch);
      await this.prisma.withContext(async (tx) => {
        await tx.auditLog.createMany({
          data: chunk.map((e) => ({
            id: isUuid(e.id) ? e.id : uuidv7(),
            tenantId: ctx.tenantId,
            actorPhone: e.actorPhone,
            action: e.action,
            entity: e.entity,
            entityId: isUuid(e.entityId) ? e.entityId : null,
            payload: (e.payload ?? {}) as object,
            createdAt: e.createdAt ? new Date(e.createdAt) : new Date(),
          })),
          skipDuplicates: true,
        });
      });
      n += chunk.length;
    }
    return n;
  }

  async search(f: AuditFilter): Promise<AuditEntry[]> {
    return this.prisma.withContext(async (tx) => {
      const rows = await tx.auditLog.findMany({
        where: {
          actorPhone: f.actor,
          entity: f.entity,
          action: f.action,
          ...(isUuid(f.entityId) ? { entityId: f.entityId } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: f.limit ?? 100,
      });
      const q = f.q?.trim().toLowerCase();
      return rows
        .map(
          (r): AuditEntry => ({
            id: r.id,
            actorPhone: r.actorPhone ?? '',
            action: r.action,
            entity: r.entity,
            entityId: r.entityId ?? undefined,
            payload: r.payload,
            createdAt: r.createdAt.toISOString(),
          }),
        )
        // Свободный запрос ищет и по payload: вынести его в SQL можно, но
        // JSONB-поиск по подстроке без индекса медленнее, чем фильтр по уже
        // отобранной сотне строк
        .filter((e) => (q ? JSON.stringify(e).toLowerCase().includes(q) : true));
    });
  }

  async facets() {
    // Значения берём из последней тысячи записей, а не из всей таблицы:
    // журнал append-only навсегда, и полный DISTINCT по нему со временем
    // станет самым тяжёлым запросом в админке ради выпадающего списка
    const rows = await this.search({ limit: 1000 });
    return facetsOf(rows);
  }

  async byPrefix(prefix: string, sinceMs?: number): Promise<AuditEntry[]> {
    return this.prisma.withContext(async (tx) => {
      const rows = await tx.auditLog.findMany({
        where: {
          action: { startsWith: prefix },
          ...(sinceMs === undefined ? {} : { createdAt: { gte: new Date(sinceMs) } }),
        },
        orderBy: { createdAt: 'desc' },
        take: 5000,
      });
      return rows.map((r): AuditEntry => ({
        id: r.id,
        actorPhone: r.actorPhone ?? '',
        action: r.action,
        entity: r.entity,
        entityId: r.entityId ?? undefined,
        payload: r.payload,
        createdAt: r.createdAt.toISOString(),
      }));
    });
  }
}

/**
 * Значения, которые реально встречались, — для выпадающих списков фильтра.
 * Группа действия — часть до точки: по ней ищут «что делали клиенты», а не
 * конкретное действие.
 */
export function facetsOf(rows: AuditEntry[]) {
  const actors = new Set<string>();
  const entities = new Set<string>();
  const groups = new Set<string>();
  for (const e of rows) {
    if (e.actorPhone) actors.add(e.actorPhone);
    if (e.entity) entities.add(e.entity);
    groups.add(e.action.includes('.') ? e.action.split('.')[0] : 'order');
  }
  return { actors: [...actors].sort(), entities: [...entities].sort(), actionGroups: [...groups].sort() };
}

function isUuid(v: string | undefined): v is string {
  return !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
