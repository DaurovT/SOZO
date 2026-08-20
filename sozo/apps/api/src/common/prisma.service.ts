import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { currentDbContext, systemContext, type DbContext } from './db-context';

/** Транзакционный клиент: то же API, но без вложенных транзакций */
export type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/**
 * Доступ к PostgreSQL (M0-E2-S1).
 *
 * Подключение НЕОБЯЗАТЕЛЬНО. Пока модули живут на `state.json`, приложение
 * обязано подниматься и без базы: иначе первый же шаг миграции обрушил бы
 * работающий сервер. Нет `DATABASE_URL` — сервис остаётся выключенным, а
 * попытка им воспользоваться падает с внятной причиной, а не с `undefined`.
 *
 * Правило работы: **всё через `withContext`**. Прямой доступ к клиенту
 * оставлен только для миграционных скриптов и проверок, потому что запрос
 * вне транзакции не видит `SET LOCAL` и вернёт пустой результат вместо
 * ошибки — то есть тихо покажет пользователю чужие или никакие данные.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  readonly enabled = Boolean(process.env.DATABASE_URL);
  private connected = false;

  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      // eslint-disable-next-line no-console
      console.log('[Prisma] DATABASE_URL не задан — работаем на файловом хранилище');
      return;
    }
    await this.$connect();
    this.connected = true;
    // eslint-disable-next-line no-console
    console.log('[Prisma] подключение к PostgreSQL установлено');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.connected) await this.$disconnect();
  }

  /**
   * Транзакция с контекстом RLS.
   *
   * `SET LOCAL` действует только внутри транзакции — это проверенный факт, а
   * не рекомендация: без транзакции политики не видят контекст, и запрос
   * возвращает пусто. Поэтому контекст ставится здесь, первым делом, и
   * ровно один раз на транзакцию.
   */
  async withContext<T>(fn: (tx: Tx) => Promise<T>, ctx?: DbContext): Promise<T> {
    if (!this.enabled) {
      throw new Error('PrismaService выключен: DATABASE_URL не задан, а модуль уже требует базу');
    }
    const c = ctx ?? currentDbContext() ?? systemContext();
    return this.$transaction(async (tx: Tx) => {
      // Параметризация через $executeRaw невозможна: SET LOCAL не принимает
      // placeholder'ы. Поэтому значения проверяем сами и экранируем кавычки —
      // сюда приходят uuid и роль из фиксированного перечня, но полагаться
      // на это молча нельзя
      await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${safe(c.tenantId)}'`);
      await tx.$executeRawUnsafe(`SET LOCAL app.role = '${safe(c.role)}'`);
      await tx.$executeRawUnsafe(`SET LOCAL app.operator_org_id = '${safe(c.operatorOrgId ?? '')}'`);
      await tx.$executeRawUnsafe(`SET LOCAL app.user_id = '${safe(c.userId ?? '')}'`);
      return fn(tx as Tx);
    });
  }

  /** Живо ли соединение — для /health и диагностики выкладки */
  async ping(): Promise<{ enabled: boolean; ok: boolean; error?: string }> {
    if (!this.enabled) return { enabled: false, ok: false };
    try {
      await this.$queryRawUnsafe('SELECT 1');
      return { enabled: true, ok: true };
    } catch (e) {
      return { enabled: true, ok: false, error: (e as Error).message };
    }
  }
}

/**
 * Значение для SET LOCAL. Разрешаем только то, что там и бывает: uuid, роль
 * из перечня, пустую строку. Всё остальное — отказ, а не экранирование:
 * если сюда прилетело неожиданное, это ошибка вызывающего, и молча
 * подставить её в SQL нельзя.
 */
function safe(v: string): string {
  const s = String(v ?? '');
  if (s === '') return s;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(s)) {
    throw new Error(`Недопустимое значение контекста RLS: ${JSON.stringify(s)}`);
  }
  return s;
}
