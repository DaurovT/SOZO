-- Инвариант DEV-02 §4.4 п.9: один стояк — одно отключение в пересекающемся окне.
-- ТРЕБУЕТ расширения btree_gist (пакет postgresql-contrib, в образе postgres:16-alpine есть).
-- Применяется отдельно: без него остальные политики и CHECK-и работают, а этот инвариант
-- временно держится проверкой в коде (AccessService.createShutdown).

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- п.9: один стояк — одно отключение в пересекающемся окне
ALTER TABLE resource_shutdown ADD CONSTRAINT shutdown_no_riser_overlap
  EXCLUDE USING gist (
    tenant_id WITH =,
    riser_id WITH =,
    tstzrange(planned_from, planned_to) WITH &&
  ) WHERE (status IN ('scheduled', 'active') AND riser_id IS NOT NULL);
