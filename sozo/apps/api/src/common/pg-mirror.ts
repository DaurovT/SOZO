import { PrismaService } from './prisma.service';
import { currentDbContext, systemContext } from './db-context';
import { dbFailure } from './db-failure';

type Tx = Parameters<Parameters<PrismaService['withContext']>[0]>[0];

/**
 * Зеркало набора в памяти на PostgreSQL.
 *
 * Одиннадцать перенесённых модулей написали этот код одиннадцать раз: флаг
 * загруженности, цепочка промисов вместо таймера, гашение ошибки записи с
 * сообщением в журнал. Различались они ровно двумя вещами — что читать и что
 * писать. Для оставшихся девятнадцати повторять его ещё девятнадцать раз
 * значит девятнадцать раз получить возможность ошибиться в одном и том же.
 *
 * Композиция, а не наследование: сервисы уже наследуют своё, а зеркалу от них
 * нужны только две функции.
 *
 * Три свойства, которые здесь не случайны и повторяют то, что выяснилось при
 * переносе заявок и объектов:
 *
 *   · запись последовательная, а не параллельная — вторая ждёт первую, иначе
 *     на внешних ключах гонка;
 *   · запись без задержки — отложенная на полсекунды создаёт разрыв, в
 *     котором ссылающаяся строка упирается в ещё не записанного родителя;
 *   · ошибка записи гасится, но громко: запрос ронять нельзя (снимок в
 *     памяти уже сделан), а молчать нельзя тем более — прогон e2e падает,
 *     если в журнале была неудачная запись.
 */
export class PgMirror {
  private loaded = false;
  private writing: Promise<void> = Promise.resolve();
  /**
   * Запись уже назначена и ещё не началась.
   *
   * Без этого каждое `persist()` ставило бы в очередь ещё одну полную
   * перезапись набора, а зовут его на каждое изменение — десятки раз за
   * запрос. Склейка не теряет ничего: пишется весь набор целиком, и та
   * запись, что стоит в очереди, увидит и последующие правки.
   */
  private pending = false;

  constructor(
    private readonly prisma: PrismaService,
    /** Имя в журнале: по нему прогон e2e опознаёт, чья запись не удалась */
    private readonly label: string,
    private readonly io: {
      /** Наполнить набор в памяти из базы. Вызывается один раз при старте */
      load: (tx: Tx) => Promise<number>;
      /** Записать набор целиком. Вызывается после каждой правки */
      save: (tx: Tx, tenantId: string) => Promise<void>;
    },
  ) {}

  /** Работает ли модуль на базе. Без неё зеркало молчит и не мешает файлу */
  get enabled(): boolean {
    return this.prisma.enabled;
  }

  /**
   * Загрузка при старте.
   *
   * Пустая база — не повод стирать то, что пришло из файла: так работает
   * переезд, когда снимок уже прочитан, а таблицы ещё пусты.
   */
  async init(): Promise<void> {
    if (!this.prisma.enabled) {
      this.loaded = true;
      return;
    }
    const n = await this.prisma.withContext((tx) => this.io.load(tx));
    this.loaded = true;
    if (n > 0) {
      // eslint-disable-next-line no-console
      console.log(`[${this.label}] из базы: ${n}`);
    }
  }

  /** Записать изменения. Возврат не ждут — ошибка попадёт в журнал */
  schedule(): void {
    if (!this.prisma.enabled || !this.loaded || this.pending) return;
    this.pending = true;
    this.writing = this.writing
      .then(() => {
        this.pending = false;
        return this.prisma.withContext((tx) => this.io.save(tx, tenantOf()));
      })
      .catch((e: unknown) => {
        // eslint-disable-next-line no-console
        console.error(`[${this.label}] запись в базу не удалась:`, dbFailure(e));
      });
  }

  /**
   * Записать и дождаться. Нужно разовому переносу state.json: там важно не
   * «запись назначена», а «запись случилась».
   */
  async flush(): Promise<void> {
    if (!this.prisma.enabled) return;
    this.loaded = true;
    this.pending = false; // перенос обязан записать, а не «уже назначено»
    this.schedule();
    await this.writing;
  }
}

function tenantOf(): string {
  return (currentDbContext() ?? systemContext()).tenantId;
}

/** Арендатор в приложении — литерал 't0', в базе uuid: перевод один на все модули */
export const APP_TENANT = 't0';
