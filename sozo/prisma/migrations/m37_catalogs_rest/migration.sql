-- Два справочника, не попавшие в DEV-19: запчасти и зоны.
--
-- Нашлись при переносе реестра: в разделе состояния лежали пять коллекций, а
-- спроектированы были три. Пропустить их значило бы оставить модуль
-- наполовину на файле — то есть в худшем из состояний: часть данных в базе,
-- часть в снимке, и ни одно из двух не полное.

CREATE TABLE IF NOT EXISTS spare_part_catalog (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL,
  name           text NOT NULL,
  unit           text NOT NULL DEFAULT 'шт',
  econom_tiyin   bigint NOT NULL,
  standard_tiyin bigint NOT NULL,
  premium_tiyin  bigint NOT NULL,
  UNIQUE (tenant_id, name)
);

-- Уровни идут по возрастанию. «Эконом» дороже «премиума» — это не редкая
-- цена, а опечатка, и увидит её клиент, а не тот, кто её сделал
ALTER TABLE spare_part_catalog DROP CONSTRAINT IF EXISTS spare_part_tiers_ordered;
ALTER TABLE spare_part_catalog ADD CONSTRAINT spare_part_tiers_ordered
  CHECK (econom_tiyin > 0 AND standard_tiyin >= econom_tiyin AND premium_tiyin >= standard_tiyin);

CREATE TABLE IF NOT EXISTS service_zone (
  id        uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  -- Город с первого дня: районы с одинаковыми названиями есть в разных
  -- городах, и «Чиланзар» без города — адрес, по которому никто не приедет
  city      text NOT NULL,
  name      text NOT NULL,
  active    boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, city, name)
);

CREATE INDEX IF NOT EXISTS service_zone_active_idx ON service_zone (tenant_id, active);

DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['spare_part_catalog', 'service_zone'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())',
      t || '_tenant', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO sozo_app', t);
  END LOOP;
END $rls$;
