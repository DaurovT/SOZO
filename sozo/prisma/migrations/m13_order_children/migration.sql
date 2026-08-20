-- Вложенные таблицы заявки: недостающие поля.
--
-- По одному-два на таблицу, но каждое несёт смысл, который иначе теряется:
--
--   order_line   — прайс хранит вилку, а не одну цену: в схеме была
--                  price_tiyin_copy, и нижняя с верхней границей схлопывались
--                  в одно число, то есть заявка теряла «от и до»;
--   quote        — пояснение к смете, его читает клиент;
--   order_photo  — источник снимка: приложение мастера, отметка диспетчера
--                  или витрина; без него не отличить фото от заглушки;
--   order_material — признак чека. Запчасть без чека не принимается (ТЗ 8.4),
--                  и это булево правило, а не ссылка на фото;
--   order_status_log — телефон действующего лица: разбор «кто двигал заявку»
--                  начинается с номера, как и в аудите.

ALTER TABLE order_line ADD COLUMN IF NOT EXISTS price_from_tiyin_copy bigint NOT NULL DEFAULT 0;
ALTER TABLE order_line ADD COLUMN IF NOT EXISTS price_to_tiyin_copy   bigint NOT NULL DEFAULT 0;

ALTER TABLE quote            ADD COLUMN IF NOT EXISTS note        text;
ALTER TABLE order_photo      ADD COLUMN IF NOT EXISTS source      text NOT NULL DEFAULT '';
ALTER TABLE order_material   ADD COLUMN IF NOT EXISTS has_receipt boolean NOT NULL DEFAULT false;
ALTER TABLE order_status_log ADD COLUMN IF NOT EXISTS actor_phone text;

-- Запчасть без чека не принимается: правило держится кодом и теперь базой
ALTER TABLE order_material DROP CONSTRAINT IF EXISTS material_spare_part_needs_receipt;
ALTER TABLE order_material ADD CONSTRAINT material_spare_part_needs_receipt CHECK (
  kind <> 'spare_part' OR has_receipt
);
