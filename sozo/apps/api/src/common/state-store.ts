import { Injectable, OnModuleInit } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Файловое хранилище состояния — dev-персистентность до перехода на PostgreSQL (M0-E2-S1).
 * Каждый модуль регистрирует снимок своего состояния; запись атомарная (temp + rename),
 * дебаунс 500 мс. BigInt не используется — суммы уже number в тийинах.
 *
 * ВАЖНО: это НЕ замена БД. Инварианты append-only и транзакционность обеспечивает
 * код сервисов; после миграции на Prisma этот слой удаляется целиком.
 */
type Snapshot = () => unknown;
type Restore = (data: unknown) => void;

@Injectable()
export class StateStore implements OnModuleInit {
  private readonly file = resolve(process.env.STATE_FILE ?? 'data/state.json');
  private readonly parts = new Map<string, { snapshot: Snapshot; restore: Restore }>();
  private loaded: Record<string, unknown> = {};
  private timer: NodeJS.Timeout | null = null;
  private ready = false;

  /** Файл читается в конструкторе: модули регистрируются раньше onModuleInit */
  constructor() {
    if (existsSync(this.file)) {
      try {
        this.loaded = JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, unknown>;
        // eslint-disable-next-line no-console
        console.log(`[StateStore] состояние восстановлено из ${this.file}`);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[StateStore] файл состояния повреждён, старт с сида:', e);
        this.loaded = {};
      }
    }
    this.ready = true;
  }

  onModuleInit(): void {
    // Первый снимок после старта: фиксируем сид, если файла ещё не было
    this.flush();
  }

  /**
   * Регистрация раздела состояния. Если в файле есть сохранённые данные — они
   * применяются немедленно (перекрывая сид конструктора сервиса).
   */
  register(key: string, snapshot: Snapshot, restore: Restore): void {
    this.parts.set(key, { snapshot, restore });
    const saved = this.loaded[key];
    if (saved !== undefined) {
      try {
        restore(saved);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(`[StateStore] не удалось восстановить раздел ${key}:`, e);
      }
    }
  }

  /** Отложенная запись: вызывается после каждой мутации, склеивает всплески */
  persist(): void {
    if (!this.ready) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 500);
  }

  flush(): void {
    const data: Record<string, unknown> = {};
    for (const [key, part] of this.parts) {
      try {
        data[key] = part.snapshot();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(`[StateStore] снимок раздела ${key} не собран:`, e);
      }
    }
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(data, null, 1), 'utf8');
      renameSync(tmp, this.file); // атомарная подмена — файл не бьётся при падении
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[StateStore] запись состояния не удалась:', e);
    }
  }

  /** Полный сброс к сид-состоянию (кнопка в админке) */
  reset(): void {
    this.loaded = {};
    try {
      if (existsSync(this.file)) writeFileSync(this.file, '{}', 'utf8');
    } catch {
      /* игнорируем */
    }
  }
}
