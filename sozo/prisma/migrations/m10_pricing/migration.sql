-- Прайс: расхождения схемы и кода.
--
-- Схему писали по DEV-02 раньше, чем сервис прайса обрёл окончательный вид.
-- Не хватало четырёх вещей, и каждая нужна не «для полноты»:
--
--   num       — номер позиции в каталоге, по нему владелец находит строку;
--   name_uz   — узбекское название, его ведёт владелец, а не разработчик;
--   is_staged — этапная работа с паузами (ТЗ 4.1), от неё зависит планировщик;
--   note      — примечание владельца к позиции.
--
-- Плюс два уточнения:
--   norm_hours становится nullable: пока владелец не заполнил нормо-часы,
--   значение неизвестно, а NOT NULL означал бы ноль — работу, которая якобы
--   не занимает времени, и планировщик поставил бы её в любой слот;
--   activated_at — факт активации в отличие от планового activates_at:
--   без него нельзя ответить, по какому релизу считали заявку.

ALTER TABLE price_item ADD COLUMN IF NOT EXISTS num       integer NOT NULL DEFAULT 0;
ALTER TABLE price_item ADD COLUMN IF NOT EXISTS name_uz   text;
ALTER TABLE price_item ADD COLUMN IF NOT EXISTS is_staged boolean NOT NULL DEFAULT false;
ALTER TABLE price_item ADD COLUMN IF NOT EXISTS note      text;
ALTER TABLE price_item ALTER COLUMN norm_hours DROP NOT NULL;

ALTER TABLE price_list_release ADD COLUMN IF NOT EXISTS activated_at timestamptz;

CREATE INDEX IF NOT EXISTS price_item_tenant_num_idx ON price_item (tenant_id, num);
