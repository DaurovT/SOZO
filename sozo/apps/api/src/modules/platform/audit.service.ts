import { Injectable } from '@nestjs/common';
import { uuidv7 } from '@sozo/kernel';
import { StateStore } from '../../common/state-store';

export interface AuditEntry {
  id: string;
  actorPhone: string;
  action: string;
  entity: string;
  entityId?: string;
  payload?: unknown;
  createdAt: string;
}

/** Append-only аудит (ТЗ 14): значимые действия админки пишутся всегда (DoD п.7) */
@Injectable()
export class AuditService {
  private readonly log: AuditEntry[] = [];

  constructor(private readonly store: StateStore) {
    this.store.register(
      'audit',
      () => this.log,
      (d) => {
        this.log.length = 0;
        this.log.push(...(d as AuditEntry[]));
      },
    );
  }

  write(entry: Omit<AuditEntry, 'id' | 'createdAt'>): void {
    this.log.push({ id: uuidv7(), createdAt: new Date().toISOString(), ...entry });
    this.store.persist(); // append-only журнал переживает рестарт (ТЗ 14)
  }

  recent(limit = 100): AuditEntry[] {
    return this.log.slice(-limit).reverse();
  }

  /**
   * Поиск по журналу.
   *
   * Фильтры складываются: телефон И сущность И действие. Свободный запрос `q`
   * идёт поверх и ищет по всем полям сразу, включая payload, — разбирающий
   * помнит номер заявки, а не то, в каком поле он записан.
   */
  search(f: { limit?: number; actor?: string; entity?: string; entityId?: string; action?: string; q?: string }): AuditEntry[] {
    const q = f.q?.trim().toLowerCase();
    const rows = this.log.filter((e) => {
      if (f.actor && e.actorPhone !== f.actor) return false;
      if (f.entity && e.entity !== f.entity) return false;
      if (f.entityId && e.entityId !== f.entityId) return false;
      if (f.action && !e.action.startsWith(f.action)) return false;
      if (!q) return true;
      const hay = `${e.actorPhone} ${e.action} ${e.entity} ${e.entityId ?? ''} ${JSON.stringify(e.payload ?? {})}`.toLowerCase();
      return hay.includes(q);
    });
    return rows.slice(-(f.limit ?? 100)).reverse();
  }

  /** Значения, которые реально встречались, — для выпадающих списков фильтра */
  facets(): { actors: string[]; entities: string[]; actionGroups: string[] } {
    const actors = new Set<string>();
    const entities = new Set<string>();
    const groups = new Set<string>();
    for (const e of this.log) {
      if (e.actorPhone) actors.add(e.actorPhone);
      if (e.entity) entities.add(e.entity);
      // Группа — часть до точки: «client», «master», «billing». По ней ищут
      // «что делали клиенты», а не конкретное действие
      groups.add(e.action.includes('.') ? e.action.split('.')[0] : 'order');
    }
    return {
      actors: [...actors].sort(),
      entities: [...entities].sort(),
      actionGroups: [...groups].sort(),
    };
  }

  /** Записи по префиксу действия — на этом строятся сводки телеметрии */
  byPrefix(prefix: string, sinceMs?: number): AuditEntry[] {
    return this.log.filter(
      (e) => e.action.startsWith(prefix) && (sinceMs === undefined || new Date(e.createdAt).getTime() >= sinceMs),
    );
  }
}
