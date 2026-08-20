-- B2B-контур: ответственные, приглашения и недостающие поля договора.
--
-- Ответственного на точке в схеме не было вовсе, хотя на нём держится вся
-- матрица утверждений: потолок решает, кто человек — сотрудник, руководитель
-- точки или руководитель организации. Не путать с building_staff: там штат
-- эксплуатирующей организации контура «Дом», здесь — люди клиента.
--
-- Приглашений тоже не было: код живёт ограниченное время и отзывается.
--
-- У организации не хватало срока договора (годовой замораживает цены),
-- суммы абонентки, замороженного релиза и примечания о расторжении.
--
-- city_id у точки становится nullable: город нужен с первого дня (ТЗ 17.4),
-- но B2B-точки заводятся адресом без выбора города, и пока справочника нет,
-- поле честно пустое, а не заполнено выдуманным значением.

ALTER TABLE organization ADD COLUMN IF NOT EXISTS contract_kind           text;
ALTER TABLE organization ADD COLUMN IF NOT EXISTS subscription_tiyin      bigint;
ALTER TABLE organization ADD COLUMN IF NOT EXISTS price_release_id_frozen uuid;
ALTER TABLE organization ADD COLUMN IF NOT EXISTS termination_note        text;

ALTER TABLE location ALTER COLUMN city_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS representative (
  id                   uuid PRIMARY KEY,
  tenant_id            uuid NOT NULL,
  location_id          uuid NOT NULL REFERENCES location (id),
  full_name            text NOT NULL,
  phone                text NOT NULL,
  role                 text NOT NULL,
  position             text,
  approval_limit_tiyin bigint,
  "primary"            boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, location_id, phone)
);
CREATE INDEX IF NOT EXISTS representative_tenant_phone_idx ON representative (tenant_id, phone);

CREATE TABLE IF NOT EXISTS crm_invite (
  id                   uuid PRIMARY KEY,
  tenant_id            uuid NOT NULL,
  location_id          uuid NOT NULL,
  code                 text NOT NULL,
  full_name            text,
  role                 text NOT NULL,
  position             text,
  approval_limit_tiyin bigint,
  "primary"            boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  expires_at           timestamptz NOT NULL,
  used_at              timestamptz,
  used_by_phone        text,
  revoked_at           timestamptz,
  UNIQUE (tenant_id, code)
);
CREATE INDEX IF NOT EXISTS crm_invite_tenant_location_idx ON crm_invite (tenant_id, location_id);
