import { Injectable } from '@nestjs/common';
import { StateStore } from '../../common/state-store';

/**
 * Журнал применённых операций офлайн-очереди мастера.
 *
 * Идемпотентность синка была неполной: для фото и действий ключ операции
 * подмешивался в тело и доезжал до статусной машины, а смета, материал,
 * приёмка и замечание уходили голым payload — и повтор после потерянного
 * ответа заводил второй материал с той же суммой, вторую смету и вторую
 * приёмку. Приложение при этом ведёт себя честно: не получив ответа, оно
 * обязано отправить пакет заново.
 *
 * Поэтому ключ проверяется один раз и для всех видов сразу — на входе в синк,
 * а не внутри каждого из полутора десятков обработчиков. Хранится результат,
 * а не только факт: повтор должен вернуть то же самое, что вернул оригинал,
 * иначе приложение решит, что операция не прошла, и покажет мастеру ошибку
 * там, где всё в порядке.
 */
export interface SyncOpRecord {
  clientOpUuid: string;
  masterId: string;
  kind: string;
  orderId: string;
  at: string;
  status: 'applied' | 'failed';
  code?: string;
  message?: string;
}

/** Сколько ключей помним. Очередь мастера за смену — десятки, не тысячи */
const KEEP = 5000;

@Injectable()
export class SyncLogService {
  private readonly ops = new Map<string, SyncOpRecord>();

  constructor(private readonly store: StateStore) {
    this.store.register(
      'master_sync_ops',
      () => [...this.ops.values()],
      (d) => {
        this.ops.clear();
        for (const r of (d as SyncOpRecord[]) ?? []) this.ops.set(this.key(r.masterId, r.clientOpUuid), r);
      },
    );
  }

  private key(masterId: string, clientOpUuid: string): string {
    // Ключ с мастером: два мастера на одном аппарате не должны глушить
    // операции друг друга совпавшим идентификатором
    return `${masterId}:${clientOpUuid}`;
  }

  seen(masterId: string, clientOpUuid: string): SyncOpRecord | undefined {
    return this.ops.get(this.key(masterId, clientOpUuid));
  }

  remember(rec: SyncOpRecord): void {
    this.ops.set(this.key(rec.masterId, rec.clientOpUuid), rec);
    if (this.ops.size > KEEP) {
      // Подрезаем самые старые: журнал нужен на время жизни очереди, а не вечно
      const excess = this.ops.size - KEEP;
      const oldest = [...this.ops.entries()].sort((a, b) => a[1].at.localeCompare(b[1].at)).slice(0, excess);
      for (const [k] of oldest) this.ops.delete(k);
    }
    this.store.persist();
  }
}
