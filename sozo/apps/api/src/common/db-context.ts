import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Контекст запроса для политик RLS (DEV-07 §8, prisma/migrations/README).
 *
 * Политики читают четыре переменные сессии, и устанавливать их надо через
 * `SET LOCAL` внутри транзакции: вне транзакции значение живёт до конца
 * соединения, а соединение берётся из пула — следующий запрос получил бы
 * чужой tenant. Это не теория: пулер обязан работать в transaction mode,
 * иначе изоляция арендаторов ломается тихо и выборочно.
 *
 * Контекст хранится в AsyncLocalStorage по той же причине, что и локаль:
 * репозитории лежат на пять слоёв ниже контроллера, и тащить `req` через
 * всю цепочку ради четырёх строк дороже, чем держать их в контексте.
 */
export interface DbContext {
  /** арендатор; для оператора платформы — тенант №1 */
  tenantId: string;
  /**
   * Роль в терминах политик: `platform_*` видит всё в своём тенанте,
   * `operator` — только свои объекты, `resident` и `master` — только своё.
   */
  role: 'platform_admin' | 'platform_dispatcher' | 'operator' | 'resident' | 'master';
  /** организация оператора; пусто для ролей платформы */
  operatorOrgId?: string | null;
  /** пользователь — им политики проверяют «своё» у жителя и мастера */
  userId?: string | null;
}

const storage = new AsyncLocalStorage<DbContext>();

export const DEFAULT_TENANT = process.env.TENANT_ID ?? '00000000-0000-0000-0000-000000000001';

export function runWithDbContext<T>(ctx: DbContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function currentDbContext(): DbContext | undefined {
  return storage.getStore();
}

/**
 * Контекст для фоновой работы: воркеры таймеров и обработчики событий бегут
 * вне запроса, и без явного контекста их запросы вернули бы пусто, а не
 * упали — самый неприятный вид ошибки.
 */
export function systemContext(tenantId = DEFAULT_TENANT): DbContext {
  return { tenantId, role: 'platform_admin', operatorOrgId: null, userId: null };
}
