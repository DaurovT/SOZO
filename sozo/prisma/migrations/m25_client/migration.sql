-- Профиль клиента B2C: адреса, обращения, кошелёк промокодов, объекты.
--
-- Таблиц не было вовсе: профиль появился в коде вместе с приложением клиента,
-- позже DEV-02. Проектируется здесь целиком, а не достраивается.
--
-- Ключ профиля — телефон, а не выданный uuid. Клиент входит по телефону, по
-- нему же приходят заявки из веб-карточки и по ссылке из SMS, где профиля
-- ещё нет вовсе. Второй способ назвать того же человека означал бы два
-- профиля у одного клиента после первого же импорта.

-- CreateTable
CREATE TABLE "client_profile" (
    "tenant_id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "full_name" TEXT NOT NULL DEFAULT '',
    "locale" TEXT NOT NULL DEFAULT 'ru',
    "consent_personal_data" BOOLEAN NOT NULL DEFAULT false,
    "consent_marketing" BOOLEAN NOT NULL DEFAULT false,
    "consent_at" TIMESTAMPTZ,
    "favorite_master_id" TEXT,
    "favorite_master_name" TEXT,
    "preferred_payment_provider" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "client_profile_pkey" PRIMARY KEY ("tenant_id","phone")
);

-- CreateTable
CREATE TABLE "client_address" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "client_phone" TEXT NOT NULL,
    "label" TEXT,
    "street" TEXT NOT NULL,
    "apartment" TEXT,
    "entrance" TEXT,
    "floor" TEXT,
    "intercom" TEXT,
    "has_lift" BOOLEAN NOT NULL DEFAULT false,
    "comment" TEXT,
    "geo_lat" DOUBLE PRECISION,
    "geo_lng" DOUBLE PRECISION,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_address_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_complaint" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "client_phone" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "order_id" UUID,
    "order_number" TEXT,
    "photo_ids" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'new',
    "resolution" TEXT,
    "quality_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_complaint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_promo_wallet" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "client_phone" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "added_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "used_at" TIMESTAMPTZ,
    "order_number" TEXT,

    CONSTRAINT "client_promo_wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_read_notification" (
    "tenant_id" UUID NOT NULL,
    "client_phone" TEXT NOT NULL,
    "notification_id" TEXT NOT NULL,
    "read_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_read_notification_pkey" PRIMARY KEY ("tenant_id","client_phone","notification_id")
);

-- CreateTable
CREATE TABLE "client_asset" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "client_phone" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "year" INTEGER,
    "plate_unreadable" BOOLEAN NOT NULL DEFAULT false,
    "linked_work" TEXT[],
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_asset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_address_tenant_id_client_phone_idx" ON "client_address"("tenant_id", "client_phone");

-- CreateIndex
CREATE INDEX "client_complaint_tenant_id_client_phone_created_at_idx" ON "client_complaint"("tenant_id", "client_phone", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "client_promo_wallet_tenant_id_client_phone_code_key" ON "client_promo_wallet"("tenant_id", "client_phone", "code");

-- CreateIndex
CREATE INDEX "client_asset_tenant_id_client_phone_idx" ON "client_asset"("tenant_id", "client_phone");

-- AddForeignKey
ALTER TABLE "client_address" ADD CONSTRAINT "client_address_tenant_id_client_phone_fkey" FOREIGN KEY ("tenant_id", "client_phone") REFERENCES "client_profile"("tenant_id", "phone") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_complaint" ADD CONSTRAINT "client_complaint_tenant_id_client_phone_fkey" FOREIGN KEY ("tenant_id", "client_phone") REFERENCES "client_profile"("tenant_id", "phone") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_promo_wallet" ADD CONSTRAINT "client_promo_wallet_tenant_id_client_phone_fkey" FOREIGN KEY ("tenant_id", "client_phone") REFERENCES "client_profile"("tenant_id", "phone") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_read_notification" ADD CONSTRAINT "client_read_notification_tenant_id_client_phone_fkey" FOREIGN KEY ("tenant_id", "client_phone") REFERENCES "client_profile"("tenant_id", "phone") ON DELETE CASCADE ON UPDATE CASCADE;

-- Основной адрес ровно один.
--
-- Частичный уникальный индекс, а не проверка в коде: адрес ставят основным из
-- приложения и из кабинета диспетчера, и две «главные» квартиры означают, что
-- мастер поедет не туда. Обычный UNIQUE здесь не годится — неосновных адресов
-- у клиента сколько угодно.
CREATE UNIQUE INDEX IF NOT EXISTS client_address_one_primary_idx
  ON client_address (tenant_id, client_phone) WHERE is_primary;

-- Согласие с датой: «согласен» без отметки времени в споре с регулятором
-- стоит ровно столько же, сколько отсутствие согласия
ALTER TABLE client_profile DROP CONSTRAINT IF EXISTS client_profile_consent_dated;
ALTER TABLE client_profile ADD CONSTRAINT client_profile_consent_dated
  CHECK (NOT (consent_personal_data OR consent_marketing) OR consent_at IS NOT NULL);

-- Язык — из тех, что система умеет. Незнакомая метка молча откатывает
-- интерфейс на русский, и жалоба приходит не «не тот язык», а «всё сломалось»
ALTER TABLE client_profile DROP CONSTRAINT IF EXISTS client_profile_locale_known;
ALTER TABLE client_profile ADD CONSTRAINT client_profile_locale_known
  CHECK (locale IN ('ru', 'uz', 'en'));

-- Потраченный промокод обязан помнить, когда его потратили
ALTER TABLE client_promo_wallet DROP CONSTRAINT IF EXISTS client_promo_wallet_used_dated;
ALTER TABLE client_promo_wallet ADD CONSTRAINT client_promo_wallet_used_dated
  CHECK (order_number IS NULL OR used_at IS NOT NULL);

DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['client_profile','client_address','client_complaint','client_promo_wallet','client_read_notification','client_asset'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())',
      t || '_tenant', t);
  END LOOP;
END $rls$;
