import { Inject, Injectable } from '@nestjs/common';
import type { AuditEntry, AuditFilter, AuditRepository } from './audit.repository';

export const AUDIT_REPOSITORY = Symbol('AUDIT_REPOSITORY');
export type { AuditEntry } from './audit.repository';

/**
 * Append-only аудит (ТЗ 14): значимые действия пишутся всегда (DoD п.7).
 *
 * Сервис стал тонкой обёрткой над репозиторием — хранилище выбирается один раз
 * на процесс: PostgreSQL, если задан DATABASE_URL, иначе файл.
 *
 * `write` возвращает промис, но 159 мест в коде вызывают его без `await`, и
 * переписывать их все ради журнала неправильно: аудит не должен менять форму
 * бизнес-кода. Поэтому ошибка записи не всплывает наверх, а громко пишется в
 * журнал процесса — потерять запись аудита молча нельзя, но и уронить из-за
 * неё оплату заявки тоже.
 */
@Injectable()
export class AuditService {
  constructor(@Inject(AUDIT_REPOSITORY) private readonly repo: AuditRepository) {}

  write(entry: Omit<AuditEntry, 'id' | 'createdAt'>): void {
    void this.repo.write(entry).catch((e: unknown) => {
      // eslint-disable-next-line no-console
      console.error('[Audit] запись не сохранена:', (e as Error).message, JSON.stringify(entry));
    });
  }

  recent(limit = 100): Promise<AuditEntry[]> {
    return this.repo.search({ limit });
  }

  /**
   * Поиск по журналу. Фильтры складываются: телефон И сущность И действие.
   * Свободный запрос `q` идёт поверх и ищет по всем полям сразу, включая
   * payload, — разбирающий помнит номер заявки, а не то, в каком поле он записан.
   */
  search(f: AuditFilter): Promise<AuditEntry[]> {
    return this.repo.search(f);
  }

  /** Значения, которые реально встречались, — для выпадающих списков фильтра */
  facets() {
    return this.repo.facets();
  }

  /** Записи по префиксу действия — на этом строятся сводки телеметрии */
  byPrefix(prefix: string, sinceMs?: number): Promise<AuditEntry[]> {
    return this.repo.byPrefix(prefix, sinceMs);
  }
}
