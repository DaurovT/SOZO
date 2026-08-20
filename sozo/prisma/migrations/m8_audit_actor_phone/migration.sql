-- Телефон действующего лица в аудите.
--
-- Схема писалась по DEV-02 раньше сервиса аудита, и они разошлись: код везде
-- пишет actorPhone, а actor_id — uuid, куда телефон не ложится. Разбор
-- инцидента начинается с номера, по которому пришла жалоба, поэтому колонка
-- нужна отдельная, а не «положим в actor_id как текст».
--
-- Таблица append-only (ТЗ 14): добавление колонки не нарушает инвариант,
-- существующие строки её просто не имеют.

ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS actor_phone text;

CREATE INDEX IF NOT EXISTS audit_log_tenant_actor_phone_idx
  ON audit_log (tenant_id, actor_phone);
