-- Контур «Дом»: сущности, которых схема не знала, и часы объекта.
--
-- Шесть коллекций из четырнадцати жили только в файле, потому что моделей у
-- них не было вовсе: прайс оператора, заявки на подключение, спрос по
-- адресам, маршруты обхода, сами обходы и сессии планового ТО. Это не
-- «дополнительные» данные — на них держатся Free-контур, продажи и надзорная
-- отчётность.
--
-- Плюс семь полей у объекта. Часы работы службы и часы шумных работ — разные
-- вещи: консьерж на месте с 8 до 20, а сверлить можно с 10 до 18, и наряд вне
-- этого окна не согласуется. Счётчики деградации держатся колонками, а не
-- считаются запросом: по ним принимается решение о переводе объекта в
-- деградированный режим, и оно должно быть воспроизводимым, а не зависеть от
-- того, когда посмотрели.

ALTER TABLE building ADD COLUMN IF NOT EXISTS work_from  text;
ALTER TABLE building ADD COLUMN IF NOT EXISTS work_to    text;
ALTER TABLE building ADD COLUMN IF NOT EXISTS noise_from text;
ALTER TABLE building ADD COLUMN IF NOT EXISTS noise_to   text;
ALTER TABLE building ADD COLUMN IF NOT EXISTS permits_total_30d     integer NOT NULL DEFAULT 0;
ALTER TABLE building ADD COLUMN IF NOT EXISTS permits_overdue_30d   integer NOT NULL DEFAULT 0;
ALTER TABLE building ADD COLUMN IF NOT EXISTS emergency_overdue_30d integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS operator_price_item (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL,
  operator_org_id  uuid NOT NULL,
  building_id      uuid,
  name             text NOT NULL,
  unit             text NOT NULL,
  price_from_tiyin bigint NOT NULL,
  price_to_tiyin   bigint NOT NULL,
  scope            text NOT NULL,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- Цена не бывает отрицательной, а верхняя граница не ниже нижней
  CONSTRAINT operator_price_range CHECK (price_from_tiyin >= 0 AND price_to_tiyin >= price_from_tiyin)
);
CREATE INDEX IF NOT EXISTS operator_price_item_tenant_org_idx ON operator_price_item (tenant_id, operator_org_id);

CREATE TABLE IF NOT EXISTS building_claim (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL,
  building_id     uuid NOT NULL,
  operator_org_id uuid NOT NULL,
  operator_name   text NOT NULL,
  applicant_phone text NOT NULL,
  document_kind   text NOT NULL,
  document_id     text,
  contact_phone   text,
  status          text NOT NULL DEFAULT 'pending',
  callback_result text,
  decision_by     text,
  decision_at     timestamptz,
  decision_reason text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS building_claim_tenant_status_idx ON building_claim (tenant_id, status);

CREATE TABLE IF NOT EXISTS demand_signal (
  id         uuid PRIMARY KEY,
  tenant_id  uuid NOT NULL,
  address    text NOT NULL,
  phone      text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS demand_signal_tenant_address_idx ON demand_signal (tenant_id, address);

CREATE TABLE IF NOT EXISTS walkthrough_route (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL,
  building_id   uuid NOT NULL,
  name          text NOT NULL,
  interval_days integer NOT NULL,
  zone_keys     text[] NOT NULL DEFAULT '{}',
  last_walk_at  timestamptz,
  is_active     boolean NOT NULL DEFAULT true,
  -- Обход раз в ноль дней невозможен: периодичность задаёт таймер
  CONSTRAINT walkthrough_route_interval_positive CHECK (interval_days > 0)
);
CREATE INDEX IF NOT EXISTS walkthrough_route_tenant_building_idx ON walkthrough_route (tenant_id, building_id);

CREATE TABLE IF NOT EXISTS walkthrough (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL,
  building_id     uuid NOT NULL,
  route_id        uuid NOT NULL,
  route_name      text NOT NULL,
  walker_phone    text NOT NULL,
  started_at      timestamptz NOT NULL,
  finished_at     timestamptz,
  passed_zones    text[] NOT NULL DEFAULT '{}',
  observation_ids uuid[] NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS walkthrough_tenant_building_idx ON walkthrough (tenant_id, building_id);

CREATE TABLE IF NOT EXISTS maintenance_session (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL,
  building_id     uuid NOT NULL,
  equipment_id    uuid NOT NULL,
  equipment_type  text NOT NULL,
  master_phone    text NOT NULL,
  started_at      timestamptz NOT NULL,
  finished_at     timestamptz,
  items_json      jsonb NOT NULL DEFAULT '[]',
  observation_ids uuid[] NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS maintenance_session_tenant_equipment_idx ON maintenance_session (tenant_id, equipment_id);

-- Город у объекта — как и у точки B2B: справочника городов не существует,
-- объекты заводятся адресом. Пустое поле честнее выдуманного значения.
ALTER TABLE building ALTER COLUMN city_id DROP NOT NULL;
