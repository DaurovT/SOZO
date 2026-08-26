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

  /**
   * Зеркала на PostgreSQL.
   *
   * Модуль, переехавший в базу, регистрирует здесь свою запись — и она
   * вызывается тем же `persist()`, что и запись в файл. Иначе пришлось бы
   * дописывать вызов в каждое место, где меняется набор, а меняют его и
   * сервисы, и контроллеры: одно забытое место означает молча потерянную
   * строку, которую заметят через месяц.
   */
  private readonly mirrors: Array<{ schedule: () => void }> = [];

  registerMirror(m: { schedule: () => void }): void {
    this.mirrors.push(m);
  }

  /** Отложенная запись: вызывается после каждой мутации, склеивает всплески */
  persist(): void {
    // Зеркала пишут сразу, а не через полсекунды: отложенная запись создаёт
    // разрыв, в котором ссылающаяся строка упирается в ещё не записанного
    // родителя. Склейку зеркало делает своим способом — см. PgMirror
    for (const m of this.mirrors) m.schedule();
    if (!this.ready) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 500);
  }

  flush(): void {
    const data: Record<string, unknown> = {};
    let failed = 0;
    for (const [key, part] of this.parts) {
      try {
        data[key] = part.snapshot();
      } catch (e) {
        failed += 1;
        /**
         * Раздел, чей снимок упал, берётся из ПРЕДЫДУЩЕГО состояния.
         *
         * Раньше он просто выпадал: файл атомарно подменялся без него, и на
         * следующем старте модуль поднимался с сида — то есть одна ошибка в
         * сборке снимка стирала весь раздел молча. Данные, которые не удалось
         * сериализовать сейчас, никуда не делись: последний удачный снимок
         * ближе к правде, чем пустота.
         */
        const previous = this.loaded[key];
        if (previous !== undefined) data[key] = previous;
        // eslint-disable-next-line no-console
        console.error(`[StateStore] снимок раздела ${key} не собран, оставляю прежний:`, e);
      }
    }
    if (failed) {
      // eslint-disable-next-line no-console
      console.error(`[StateStore] разделов с неудачным снимком: ${failed} — состояние записано частично устаревшим`);
    }
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(data, null, 1), 'utf8');
      renameSync(tmp, this.file); // атомарная подмена — файл не бьётся при падении
      // Запомненное состояние — то, что реально записано: следующий неудачный
      // снимок должен опираться на него, а не на то, что было при старте
      this.loaded = data;
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
