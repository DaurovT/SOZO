-- Идемпотентность фоновых правил.
--
-- В DEV-19 таймерам спроектировали журнал прогонов, но не отметки «сделано».
-- Разница между ними существенная: журнал отвечает на вопрос «что вчера
-- отработало», а отметка — на вопрос «слать ли это напоминание второй раз».
-- Без второго перенос таймеров означал бы, что после каждой выкладки клиенты
-- получают повторные напоминания об оплате, а наряды закрываются дважды.

CREATE TABLE IF NOT EXISTS timer_done (
  tenant_id uuid NOT NULL,
  -- Ключ собирается из кода таймера и того, к чему он применён: заявки,
  -- наряда, календарного дня
  key       text NOT NULL,
  at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);

ALTER TABLE timer_done ENABLE ROW LEVEL SECURITY;
ALTER TABLE timer_done FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS timer_done_tenant ON timer_done;
CREATE POLICY timer_done_tenant ON timer_done
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON timer_done TO sozo_app;
