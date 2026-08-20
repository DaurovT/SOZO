-- У памяти офлайн-синка появляется свой арендатор.
--
-- В m32 ей его не дали намеренно: ключ операции приходит с устройства и
-- уникален сам по себе, а строка не содержит ничего, кроме ключа и наряда.
-- Изоляцию сделали через наряд: «видно, если виден наряд».
--
-- Это оказалось неверно, и по причине, которую видно только на работающей
-- RLS. Такая политика превращает идемпотентность в зависимость от порядка
-- записи: строку нельзя записать раньше наряда и нельзя записать вовсе, если
-- наряд по какой-то причине не попал в базу. А смысл этой таблицы ровно
-- обратный — помнить, что операция уже применялась, даже когда всё
-- остальное пошло не так.
--
-- Арендатор у операции есть на самом деле: она пришла от мастера, который
-- работает у конкретного арендатора. Отсутствие колонки было не свойством
-- предметной области, а экономией.

ALTER TABLE permit_sync_op ADD COLUMN IF NOT EXISTS tenant_id uuid;

-- Существующие строки получают арендатора своего наряда; те, чьего наряда уже
-- нет, — арендатора по умолчанию: потерять отметку об идемпотентности хуже,
-- чем приписать её не тому (двойное применение операции — это двойной наряд)
UPDATE permit_sync_op o
   SET tenant_id = p.tenant_id
  FROM access_permit p
 WHERE p.id::text = o.permit_id AND o.tenant_id IS NULL;

UPDATE permit_sync_op
   SET tenant_id = '00000000-0000-0000-0000-000000000001'
 WHERE tenant_id IS NULL;

ALTER TABLE permit_sync_op ALTER COLUMN tenant_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS permit_sync_op_tenant_idx ON permit_sync_op (tenant_id);

DROP POLICY IF EXISTS permit_sync_op_tenant ON permit_sync_op;
CREATE POLICY permit_sync_op_tenant ON permit_sync_op
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
