-- RLS для журнала проводок, счетов, плана счетов и прайса.
--
-- Пять таблиц с деньгами и ценами не попали ни в один ENABLE ROW LEVEL
-- SECURITY: transaction, invoice, account, price_list_release, price_item.
-- То есть отсутствие `where: {tenantId}` в чтениях (а его не было в
-- billing.loadFromDb и во всех чтениях pricing) не было прикрыто ничем: в
-- память грузился журнал всех владельцев, ведомость мастеров считалась по
-- объединённым начислениям, счётчик номеров счетов восстанавливался по
-- максимуму обоих, а `active()` возвращал первый активный релиз любого
-- владельца.
--
-- Код уже исправлен и фильтрует сам. Здесь — второй слой: тот, который
-- работает и тогда, когда очередной запрос напишут без фильтра.
--
-- accounting_period включён заодно: закрытие периода одного владельца не
-- должно блокировать проводки другого.

DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'transaction',
    'invoice',
    'account',
    'price_list_release',
    'price_item',
    'accounting_period'
  ] LOOP
    -- Таблицы могли не доехать до этой базы (модуль ещё на файле) — тогда
    -- пропускаем: миграция обязана быть применимой к любой живой базе
    IF to_regclass(t) IS NULL THEN
      RAISE NOTICE 'таблицы % нет — пропускаю', t;
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())',
      t || '_tenant', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO sozo_app', t);
  END LOOP;
END $rls$;

-- Одна бронь на заявку — на уровне базы.
--
-- Единственной защитой от двойной брони была проверка в памяти процесса, и
-- при деплое, когда старый и новый процесс живут вместе, она не работает.
-- Уникальный индекс делает вторую бронь невозможной независимо от того,
-- сколько процессов пишут.
CREATE UNIQUE INDEX IF NOT EXISTS booking_order_unique ON booking (tenant_id, order_id);
