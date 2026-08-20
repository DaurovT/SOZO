-- Заявка: поля, которых схема не знала.
--
-- Тридцать полей из пятидесяти восьми не имели колонок. Деление сделано по
-- правилу DEV-02, а не по удобству: деньги, время, ключи и всё, по чему ищут
-- или что ограничивают — колонки, потому что на jsonb не наложить CHECK и не
-- построить внятный индекс. Структурные снимки — jsonb, как уже сделано для
-- coefficients_copy, positions и passport.
--
-- Отдельно про client_phone. В ER заявка ссылается на client_id, но B2C-клиент
-- заводится самим фактом заявки, и телефон — единственный устойчивый
-- идентификатор: по нему собирается личная лента, а это самый частый запрос
-- в системе. Поэтому колонка и индекс, а не связь.

ALTER TABLE "order" ADD COLUMN IF NOT EXISTS client_phone             text NOT NULL DEFAULT '';
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS client_name              text;
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS organization_id          uuid;
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS description              text;
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS address                  text NOT NULL DEFAULT '';
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS geo_lat                  numeric(9,6);
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS geo_lng                  numeric(9,6);
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS master_name              text;
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS helper_name              text;
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS restricted_site          boolean NOT NULL DEFAULT false;
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS arrived_at               timestamptz;
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS claimed_by_operator      text;
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS released_reason          text;

ALTER TABLE "order" ADD COLUMN IF NOT EXISTS base_from_tiyin          bigint NOT NULL DEFAULT 0;
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS base_to_tiyin            bigint NOT NULL DEFAULT 0;
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS total_from_tiyin         bigint NOT NULL DEFAULT 0;
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS total_to_tiyin           bigint NOT NULL DEFAULT 0;
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS tip_tiyin                bigint NOT NULL DEFAULT 0;

ALTER TABLE "order" ADD COLUMN IF NOT EXISTS promo_discount_percent   integer NOT NULL DEFAULT 0;
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS urgent_surcharge_percent integer NOT NULL DEFAULT 0;
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS preferred_master_id      uuid;
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS sla_due_at               timestamptz;
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS reschedule_count         integer NOT NULL DEFAULT 0;
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS acceptance_code          text;

ALTER TABLE "order" ADD COLUMN IF NOT EXISTS acceptance_json          jsonb;
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS acceptance_request_json  jsonb;
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS address_details_json     jsonb;
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS payment_json             jsonb;
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS requested_window_json    jsonb;
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS common_area_access_json  jsonb;

-- Личная лента клиента — самый частый запрос системы
CREATE INDEX IF NOT EXISTS order_tenant_client_phone_idx ON "order" (tenant_id, client_phone);
-- Поиск заявки по коду приёмки: код диктуют голосом, и он должен находиться
CREATE INDEX IF NOT EXISTS order_tenant_acceptance_code_idx ON "order" (tenant_id, acceptance_code)
  WHERE acceptance_code IS NOT NULL;

-- Деньги не бывают отрицательными: вилка и итог проверяются базой, а не только кодом
ALTER TABLE "order" DROP CONSTRAINT IF EXISTS order_money_non_negative;
ALTER TABLE "order" ADD CONSTRAINT order_money_non_negative CHECK (
  base_from_tiyin >= 0 AND base_to_tiyin >= 0 AND
  total_from_tiyin >= 0 AND total_to_tiyin >= 0 AND tip_tiyin >= 0
);
