-- Оператор адресуется кодом: тип колонок и функция контекста RLS.
--
-- Контур «Дом» опознаёт оператора кодом — «uk1», «bc1», — и код стоит в
-- адресах кабинета. В схеме же operator_org_id был uuid и внешним ключом на
-- organization.id, поэтому запись падала на разборе uuid, а заявка не
-- включалась на PostgreSQL.
--
-- Менять код на uuid нельзя: он часть интерфейса. Значит меняется тип колонок
-- и функция контекста — политики сравнивают операторов, и типы по обе стороны
-- сравнения обязаны совпадать. Сами тела политик не меняются ни в чём.
--
-- Политики приходится снять и вернуть: PostgreSQL не даёт менять тип колонки,
-- от которой зависит политика. Их пятнадцать, и часть создаётся циклом по
-- дочерним таблицам объекта — восстанавливаются тем же кодом, что в m7.

DO $drop$
DECLARE r record;
BEGIN
  FOR r IN SELECT schemaname, tablename, policyname FROM pg_policies WHERE schemaname = 'public' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $drop$;

-- Внешние ключи на organization.id снимаются: они связывали оператора по
-- идентификатору строки, а он адресуется кодом. Целостность вернётся ссылкой
-- на organization.code, когда порядок записи между CRM и объектами будет
-- гарантирован — сейчас CRM пишет отложенно, и жёсткая связь вернула бы
-- гонку, из-за которой заявка ссылалась бы на ещё не записанную организацию.
ALTER TABLE building              DROP CONSTRAINT IF EXISTS building_operator_org_id_fkey;
ALTER TABLE master_affiliation    DROP CONSTRAINT IF EXISTS master_affiliation_org_id_fkey;
ALTER TABLE sla_policy            DROP CONSTRAINT IF EXISTS sla_policy_operator_org_id_fkey;
ALTER TABLE operator_subscription DROP CONSTRAINT IF EXISTS operator_subscription_operator_org_id_fkey;

ALTER TABLE building              ALTER COLUMN operator_org_id TYPE text USING operator_org_id::text;
ALTER TABLE building_claim        ALTER COLUMN operator_org_id TYPE text USING operator_org_id::text;
ALTER TABLE operator_price_item   ALTER COLUMN operator_org_id TYPE text USING operator_org_id::text;
ALTER TABLE master_affiliation    ALTER COLUMN org_id          TYPE text USING org_id::text;
ALTER TABLE sla_policy            ALTER COLUMN operator_org_id TYPE text USING operator_org_id::text;
ALTER TABLE operator_subscription ALTER COLUMN operator_org_id TYPE text USING operator_org_id::text;

-- Функция обязана вернуть тот же тип, с которым сравнивают
DROP FUNCTION IF EXISTS app_operator_org_id();
CREATE FUNCTION app_operator_org_id() RETURNS text
  LANGUAGE sql STABLE AS $fn$
    SELECT NULLIF(current_setting('app.operator_org_id', true), '')
  $fn$;

CREATE POLICY building_tenant ON building
  USING (tenant_id = app_tenant_id()
         AND (app_is_platform() OR operator_org_id = app_operator_org_id()));

CREATE POLICY affiliation_tenant ON master_affiliation
  USING (tenant_id = app_tenant_id()
         AND (app_is_platform() OR org_id = app_operator_org_id()));

CREATE POLICY sla_policy_tenant ON sla_policy
  USING (tenant_id = app_tenant_id()
         AND (app_is_platform() OR operator_org_id = app_operator_org_id()));

CREATE POLICY subscription_tenant ON operator_subscription
  USING (tenant_id = app_tenant_id()
         AND (app_is_platform() OR operator_org_id = app_operator_org_id()));

-- ============================================================
-- 3. Политики: таблицы, привязанные к оператору через building
-- ============================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'unit', 'common_zone', 'building_staff', 'building_equipment',
    'building_announcement', 'resource_shutdown', 'building_observation',
    'access_permit', 'visit_pass'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY %1$I_tenant ON %1$I
        USING (tenant_id = app_tenant_id()
               AND (app_is_platform() OR EXISTS (
                     SELECT 1 FROM building b
                      WHERE b.id = %1$I.building_id
                        AND b.operator_org_id = app_operator_org_id())))
    $f$, t);
  END LOOP;
END $$;

-- unit_resident — через unit → building
ALTER TABLE unit_resident ENABLE ROW LEVEL SECURITY;
CREATE POLICY unit_resident_tenant ON unit_resident
  USING (tenant_id = app_tenant_id()
         AND (app_is_platform()
              OR EXISTS (SELECT 1 FROM unit u JOIN building b ON b.id = u.building_id
                          WHERE u.id = unit_resident.unit_id
                            AND b.operator_org_id = app_operator_org_id())
              OR user_id::text = coalesce(current_setting('app.user_id', true), '')));

-- order — оператор видит только заявки своих объектов
ALTER TABLE "order" ENABLE ROW LEVEL SECURITY;
CREATE POLICY order_tenant ON "order"
  USING (tenant_id = app_tenant_id()
         AND (app_is_platform()
              OR building_id IS NULL           -- заявки вне контура «Дом» оператору не видны политикой ниже
              OR EXISTS (SELECT 1 FROM building b
                          WHERE b.id = "order".building_id
                            AND b.operator_org_id = app_operator_org_id())));

-- ============================================================
-- 4. Инварианты контура (DEV-02 §4.4)
-- ============================================================

-- п.7: сервисный сбор не начисляется на общее имущество
ALTER TABLE "order" DROP CONSTRAINT IF EXISTS order_common_area_no_fee;
ALTER TABLE "order" ADD CONSTRAINT order_common_area_no_fee
  CHECK (order_scope <> 'common_area' OR service_fee_tiyin = 0);

-- п.14: ставка сбора в границах 0..10%
ALTER TABLE building DROP CONSTRAINT IF EXISTS building_service_fee_cap;
ALTER TABLE building ADD CONSTRAINT building_service_fee_cap
  CHECK (service_fee_bps BETWEEN 0 AND 1000);

-- п.10: условия статуса active
ALTER TABLE building DROP CONSTRAINT IF EXISTS building_active_needs_emergency_phone;
ALTER TABLE building ADD CONSTRAINT building_active_needs_emergency_phone
  CHECK (connection_status <> 'active' OR emergency_phone IS NOT NULL);
-- (наличие согласующего проверяется триггером: CHECK не умеет обращаться к другой таблице)

-- п.13: замечание закрывается только фотографией устранения
ALTER TABLE building_observation DROP CONSTRAINT IF EXISTS observation_resolved_needs_photo;
ALTER TABLE building_observation ADD CONSTRAINT observation_resolved_needs_photo
  CHECK (status <> 'resolved' OR resolved_photo_id IS NOT NULL);

-- п.9: один стояк — одно отключение в пересекающемся окне
-- Вынесено в отдельную миграцию m7_shutdown_exclusion: требует расширения btree_gist
-- (контриб-пакет postgresql-contrib). Отделено сознательно, чтобы отсутствие расширения
-- не блокировало применение политик RLS и остальных инвариантов.

-- п.11 — ЗАМЕТКА: exclusion на пересечение смен разных работодателей одного мастера
-- добавляется вместе с таблицей shift (майлстоун планировщика):
--   ALTER TABLE shift ADD CONSTRAINT shift_no_employer_overlap
--     EXCLUDE USING gist (master_id WITH =, hours WITH &&)
--     WHERE (employer_org_id IS NOT NULL);

-- ============================================================
-- 5. Права
-- ============================================================
-- Сервисная роль приложения НЕ получает BYPASSRLS и не является владельцем таблиц,
-- иначе политики к ней не применятся:
--   ALTER ROLE sozo_app NOBYPASSRLS;
-- Роли платформы работают через app.role = 'platform_*' и политику выше, а не в обход RLS.
