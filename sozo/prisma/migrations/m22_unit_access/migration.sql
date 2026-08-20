-- Доступ в чужое помещение (C-56) и память офлайн-синка мастера.
--
-- Двух таблиц в DEV-02 нет вовсе: обе появились позже схемы, когда стало
-- ясно, что наряд на стояке упирается в закрытую дверь соседа, а мастер
-- работает в подвале без сети.

-- 1. Запрос доступа.
--    Житель отвечает по короткой ссылке из SMS — учётной записи у него может
--    не быть, поэтому все стороны здесь телефоны, а не ссылки на user.
--    permit_id и order_id обнуляемы: доступ просят и без наряда — например,
--    сосед заливает, а работа частная.
CREATE TABLE IF NOT EXISTS unit_access_request (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL,
  building_id       uuid NOT NULL REFERENCES building (id),
  unit_id           uuid NOT NULL,
  -- Подпись помещения — строкой: запрос переживает перенумерацию, а житель
  -- должен видеть ту же подпись, что была в SMS
  unit_label        text NOT NULL DEFAULT '',
  permit_id         uuid REFERENCES access_permit (id),
  order_id          uuid,
  requested_by_phone text NOT NULL,
  master_id         text,
  master_name       text,
  reason            text NOT NULL,
  window_from       timestamptz NOT NULL,
  window_to         timestamptz NOT NULL,
  status            text NOT NULL DEFAULT 'requested',
  decided_by_phone  text,
  decided_at        timestamptz,
  decline_reason    text,
  proposed_from     timestamptz,
  proposed_to       timestamptz,
  -- Ожидание протухает, а не висит бесконечно: мастер не может ждать сутки
  expires_at        timestamptz NOT NULL,
  -- Код ссылки уникален глобально: по нему открывается страница ответа,
  -- и два запроса с одним кодом означали бы, что житель решает за чужой
  access_code       text NOT NULL UNIQUE,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS unit_access_unit_idx ON unit_access_request (tenant_id, unit_id, created_at DESC);
CREATE INDEX IF NOT EXISTS unit_access_permit_idx ON unit_access_request (tenant_id, permit_id);
-- Прогон таймером ищет только просроченные ожидания
CREATE INDEX IF NOT EXISTS unit_access_expiry_idx ON unit_access_request (tenant_id, expires_at) WHERE status = 'requested';

-- Окно ответа не может быть вывернутым: иначе житель согласует пустоту
ALTER TABLE unit_access_request DROP CONSTRAINT IF EXISTS unit_access_window_ordered;
ALTER TABLE unit_access_request ADD CONSTRAINT unit_access_window_ordered CHECK (window_from < window_to);
-- Отказ без причины житель дать может, а вот отказ с пустой строкой — это
-- не причина, а видимость: в кабинете оператора она выглядит как объяснение
ALTER TABLE unit_access_request DROP CONSTRAINT IF EXISTS unit_access_decline_reason_meaningful;
ALTER TABLE unit_access_request ADD CONSTRAINT unit_access_decline_reason_meaningful
  CHECK (decline_reason IS NULL OR length(btrim(decline_reason)) > 0);

-- 2. Память офлайн-синка.
--    Мастер в подвале копит операции и отправляет пачкой; при повторной
--    отправке переход не должен примениться дважды. Ключ приходит с клиента,
--    поэтому таблица, а не расчёт: результат первой попытки надо ВЕРНУТЬ,
--    а не просто отклонить повтор.
CREATE TABLE IF NOT EXISTS permit_sync_op (
  client_op_uuid text PRIMARY KEY,
  permit_id      text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE unit_access_request ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS unit_access_request_tenant ON unit_access_request;
CREATE POLICY unit_access_request_tenant ON unit_access_request
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
