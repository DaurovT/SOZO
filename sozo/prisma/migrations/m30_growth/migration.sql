-- Рост: лиды, обзвон, промокоды, лояльность, ваучеры, неудовлетворённый спрос.
--
-- Здесь два вида денег, и они разные. Промокод — скидка, то есть недополученная
-- выручка; ваучер — обязательство, выданное клиенту, то есть долг. Поэтому
-- ваучер неизменяем после выпуска, а промокод правится, пока действует.

-- CreateTable
CREATE TABLE "lead" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company" TEXT NOT NULL,
    "contact_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "points_count" INTEGER NOT NULL DEFAULT 1,
    "object_type" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'new',
    "reject_reason" TEXT,
    "utm" JSONB NOT NULL DEFAULT '{}',
    "note" TEXT,
    "organization_id" UUID,
    "next_touch_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_task" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "sla_minutes" INTEGER NOT NULL DEFAULT 15,
    "due_at" TIMESTAMPTZ NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "source" TEXT NOT NULL,
    "utm" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "done_at" TIMESTAMPTZ,
    "result" TEXT,

    CONSTRAINT "call_task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_code" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "discount_percent" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "max_uses" INTEGER,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "comment" TEXT,
    "first_order_only" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_code_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_use" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "promo_code_id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "order_id" UUID,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_use_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_account" (
    "tenant_id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "balance_tiyin" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "loyalty_account_pkey" PRIMARY KEY ("tenant_id","phone")
);

-- CreateTable
CREATE TABLE "loyalty_entry" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount_tiyin" BIGINT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voucher" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "nominal_tiyin" BIGINT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'free',
    "issued_to_phone" TEXT,
    "issued_at" TIMESTAMPTZ,

    CONSTRAINT "voucher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "demand_miss" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "category" TEXT,
    "zone" TEXT,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "demand_miss_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lead_tenant_id_stage_next_touch_at_idx" ON "lead"("tenant_id", "stage", "next_touch_at");

-- CreateIndex
CREATE INDEX "call_task_tenant_id_status_due_at_idx" ON "call_task"("tenant_id", "status", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "promo_code_tenant_id_code_key" ON "promo_code"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "promo_use_promo_code_id_phone_key" ON "promo_use"("promo_code_id", "phone");

-- CreateIndex
CREATE INDEX "loyalty_entry_tenant_id_phone_at_idx" ON "loyalty_entry"("tenant_id", "phone", "at" DESC);

-- CreateIndex
CREATE INDEX "voucher_tenant_id_status_expires_at_idx" ON "voucher"("tenant_id", "status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "voucher_tenant_id_code_key" ON "voucher"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "demand_miss_tenant_id_date_idx" ON "demand_miss"("tenant_id", "date");

-- CreateIndex
CREATE INDEX "demand_miss_tenant_id_reason_at_idx" ON "demand_miss"("tenant_id", "reason", "at");

-- AddForeignKey
ALTER TABLE "promo_use" ADD CONSTRAINT "promo_use_promo_code_id_fkey" FOREIGN KEY ("promo_code_id") REFERENCES "promo_code"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_entry" ADD CONSTRAINT "loyalty_entry_tenant_id_phone_fkey" FOREIGN KEY ("tenant_id", "phone") REFERENCES "loyalty_account"("tenant_id", "phone") ON DELETE CASCADE ON UPDATE CASCADE;;

-- Скидка 1–50%. Сто процентов — это не промокод, а бесплатная работа, и
-- решаться она должна не опечаткой в поле ввода
ALTER TABLE promo_code DROP CONSTRAINT IF EXISTS promo_code_discount_range;
ALTER TABLE promo_code ADD CONSTRAINT promo_code_discount_range
  CHECK (discount_percent BETWEEN 1 AND 50);

-- Счётчик использований не отрицателен и не больше предела
ALTER TABLE promo_code DROP CONSTRAINT IF EXISTS promo_code_uses_within_limit;
ALTER TABLE promo_code ADD CONSTRAINT promo_code_uses_within_limit
  CHECK (used_count >= 0 AND (max_uses IS NULL OR used_count <= max_uses));

ALTER TABLE voucher DROP CONSTRAINT IF EXISTS voucher_nominal_positive;
ALTER TABLE voucher ADD CONSTRAINT voucher_nominal_positive CHECK (nominal_tiyin > 0);

-- Выданный ваучер знает кому и когда: без этого он не обязательство, а
-- запись в справочнике
ALTER TABLE voucher DROP CONSTRAINT IF EXISTS voucher_issued_complete;
ALTER TABLE voucher ADD CONSTRAINT voucher_issued_complete
  CHECK (status <> 'issued' OR (issued_to_phone IS NOT NULL AND issued_at IS NOT NULL));

-- Баланс лояльности не уходит в минус: отрицательный означал бы, что клиент
-- должен нам баллы, а такого обязательства не существует
ALTER TABLE loyalty_account DROP CONSTRAINT IF EXISTS loyalty_account_balance_non_negative;
ALTER TABLE loyalty_account ADD CONSTRAINT loyalty_account_balance_non_negative
  CHECK (balance_tiyin >= 0);

-- Движение с нулевой суммой — запись ни о чём, она только мешает сверке
ALTER TABLE loyalty_entry DROP CONSTRAINT IF EXISTS loyalty_entry_amount_non_zero;
ALTER TABLE loyalty_entry ADD CONSTRAINT loyalty_entry_amount_non_zero CHECK (amount_tiyin <> 0);

ALTER TABLE loyalty_entry DROP CONSTRAINT IF EXISTS loyalty_entry_kind_known;
ALTER TABLE loyalty_entry ADD CONSTRAINT loyalty_entry_kind_known
  CHECK (kind IN ('accrual', 'voucher', 'storno'));

-- Число точек у лида положительно: ноль точек — это не лид B2B
ALTER TABLE lead DROP CONSTRAINT IF EXISTS lead_points_positive;
ALTER TABLE lead ADD CONSTRAINT lead_points_positive CHECK (points_count > 0);

-- Отказ по лиду объяснён — по причинам отказа правят предложение
ALTER TABLE lead DROP CONSTRAINT IF EXISTS lead_reject_explained;
ALTER TABLE lead ADD CONSTRAINT lead_reject_explained
  CHECK (stage <> 'rejected' OR length(btrim(coalesce(reject_reason, ''))) > 0);

-- Закрытая задача обзвона знает время и результат: «обзвонили» без результата
-- не отличимо от «закрыли, чтобы не мозолило»
ALTER TABLE call_task DROP CONSTRAINT IF EXISTS call_task_done_complete;
ALTER TABLE call_task ADD CONSTRAINT call_task_done_complete
  CHECK (status <> 'done' OR (done_at IS NOT NULL AND length(btrim(coalesce(result, ''))) > 0));

ALTER TABLE call_task DROP CONSTRAINT IF EXISTS call_task_sla_positive;
ALTER TABLE call_task ADD CONSTRAINT call_task_sla_positive CHECK (sla_minutes > 0);

ALTER TABLE demand_miss DROP CONSTRAINT IF EXISTS demand_miss_reason_known;
ALTER TABLE demand_miss ADD CONSTRAINT demand_miss_reason_known
  CHECK (reason IN ('no_windows', 'window_taken', 'out_of_zone'));

DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['lead','call_task','promo_code','promo_use','loyalty_account',
                           'loyalty_entry','voucher','demand_miss'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())',
      t || '_tenant', t);
  END LOOP;
END $rls$;
