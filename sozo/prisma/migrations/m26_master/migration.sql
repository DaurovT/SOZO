-- Мастер: предложения, смена, уведомления, апелляции, анкета, ресурсы.
--
-- Всё это появилось в коде вместе с приложением мастера — в DEV-02 таблиц
-- нет ни под одно. Общий принцип тот же, что в наряде-допуске: мастер
-- опознаётся идентификатором карточки, но карточки может не быть (кандидат,
-- штатный работник оператора), поэтому внешних ключей на master_profile
-- здесь нет, а есть колонки.

-- CreateTable
CREATE TABLE "master_offer" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "order_number" TEXT NOT NULL,
    "master_id" TEXT NOT NULL,
    "master_name" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '',
    "district" TEXT NOT NULL DEFAULT '',
    "urgency" TEXT NOT NULL DEFAULT 'normal',
    "slot_start" TIMESTAMPTZ,
    "slot_end" TIMESTAMPTZ,
    "estimate_from_tiyin" BIGINT NOT NULL DEFAULT 0,
    "estimate_to_tiyin" BIGINT NOT NULL DEFAULT 0,
    "master_share_from_tiyin" BIGINT NOT NULL DEFAULT 0,
    "distance_hint" TEXT,
    "is_paired" BOOLEAN NOT NULL DEFAULT false,
    "kind" TEXT NOT NULL DEFAULT 'personal',
    "ttl_seconds" INTEGER NOT NULL DEFAULT 60,
    "waiting_since" TIMESTAMPTZ,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decline_reason" TEXT,
    "responded_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "master_offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master_shift_state" (
    "tenant_id" UUID NOT NULL,
    "master_id" TEXT NOT NULL,
    "online" BOOLEAN NOT NULL DEFAULT false,
    "since" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_lat" DOUBLE PRECISION,
    "last_lng" DOUBLE PRECISION,
    "last_accuracy" DOUBLE PRECISION,
    "last_ping_at" TIMESTAMPTZ,

    CONSTRAINT "master_shift_state_pkey" PRIMARY KEY ("tenant_id","master_id")
);

-- CreateTable
CREATE TABLE "master_geo_event" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "master_id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "order_id" UUID,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "master_geo_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master_notification" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "master_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "body_args" JSONB NOT NULL DEFAULT '[]',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "deep_link" TEXT,
    "order_id" UUID,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "master_notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master_appeal" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "master_id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolution" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ,

    CONSTRAINT "master_appeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master_tip" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "master_id" TEXT NOT NULL,
    "order_id" UUID NOT NULL,
    "order_number" TEXT NOT NULL,
    "amount_tiyin" BIGINT NOT NULL,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "master_tip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master_application" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "master_id" TEXT,
    "full_name" TEXT NOT NULL,
    "experience_years" INTEGER NOT NULL DEFAULT 0,
    "about" TEXT,
    "skill_tags" TEXT[],
    "zones" TEXT[],
    "transport" TEXT NOT NULL DEFAULT 'public',
    "tax_mode" TEXT NOT NULL DEFAULT 'self_employed',
    "referral_code" TEXT,
    "face_photo" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'new',
    "interview_at" TIMESTAMPTZ,
    "rejection_reason" TEXT,
    "training_done" TEXT[],
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "master_application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master_application_document" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'missing',
    "file" TEXT,
    "comment" TEXT,

    CONSTRAINT "master_application_document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master_application_tool_check" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "skill" TEXT NOT NULL,
    "items" TEXT[],
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "photo" TEXT,

    CONSTRAINT "master_application_tool_check_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master_application_exam" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "wrong_topics" TEXT[],
    "passed_at" TIMESTAMPTZ,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "master_application_exam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master_stock" (
    "tenant_id" UUID NOT NULL,
    "master_id" TEXT NOT NULL,
    "catalog_id" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "master_stock_pkey" PRIMARY KEY ("tenant_id","master_id","catalog_id")
);

-- CreateTable
CREATE TABLE "master_stock_refill" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "master_id" TEXT NOT NULL,
    "receipt_file" TEXT,
    "total_tiyin" BIGINT NOT NULL DEFAULT 0,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "master_stock_refill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master_stock_refill_item" (
    "id" UUID NOT NULL,
    "refill_id" UUID NOT NULL,
    "catalog_id" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "cost_tiyin" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "master_stock_refill_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_code" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "order_id" UUID NOT NULL,
    "master_id" TEXT NOT NULL,
    "limit_tiyin" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "invoice_file" TEXT,
    "invoice_total_tiyin" BIGINT,
    "invoice_at" TIMESTAMPTZ,

    CONSTRAINT "purchase_code_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_invoice_item" (
    "id" UUID NOT NULL,
    "purchase_code_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "amount_tiyin" BIGINT NOT NULL,

    CONSTRAINT "purchase_invoice_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "master_offer_tenant_id_master_id_status_idx" ON "master_offer"("tenant_id", "master_id", "status");

-- CreateIndex
CREATE INDEX "master_offer_tenant_id_order_id_idx" ON "master_offer"("tenant_id", "order_id");

-- CreateIndex
CREATE INDEX "master_offer_tenant_id_expires_at_idx" ON "master_offer"("tenant_id", "expires_at");

-- CreateIndex
CREATE INDEX "master_geo_event_tenant_id_master_id_at_idx" ON "master_geo_event"("tenant_id", "master_id", "at" DESC);

-- CreateIndex
CREATE INDEX "master_notification_tenant_id_master_id_created_at_idx" ON "master_notification"("tenant_id", "master_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "master_appeal_tenant_id_master_id_status_idx" ON "master_appeal"("tenant_id", "master_id", "status");

-- CreateIndex
CREATE INDEX "master_tip_tenant_id_master_id_at_idx" ON "master_tip"("tenant_id", "master_id", "at" DESC);

-- CreateIndex
CREATE INDEX "master_application_tenant_id_stage_idx" ON "master_application"("tenant_id", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "master_application_tenant_id_phone_key" ON "master_application"("tenant_id", "phone");

-- CreateIndex
CREATE INDEX "master_application_document_tenant_id_status_idx" ON "master_application_document"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "master_application_document_application_id_code_key" ON "master_application_document"("application_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "master_application_tool_check_application_id_skill_key" ON "master_application_tool_check"("application_id", "skill");

-- CreateIndex
CREATE INDEX "master_application_exam_tenant_id_application_id_at_idx" ON "master_application_exam"("tenant_id", "application_id", "at");

-- CreateIndex
CREATE INDEX "master_stock_refill_tenant_id_master_id_at_idx" ON "master_stock_refill"("tenant_id", "master_id", "at" DESC);

-- CreateIndex
CREATE INDEX "purchase_code_tenant_id_master_id_status_idx" ON "purchase_code"("tenant_id", "master_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_code_tenant_id_code_key" ON "purchase_code"("tenant_id", "code");

-- AddForeignKey
ALTER TABLE "master_application_document" ADD CONSTRAINT "master_application_document_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "master_application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master_application_tool_check" ADD CONSTRAINT "master_application_tool_check_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "master_application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master_application_exam" ADD CONSTRAINT "master_application_exam_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "master_application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master_stock_refill_item" ADD CONSTRAINT "master_stock_refill_item_refill_id_fkey" FOREIGN KEY ("refill_id") REFERENCES "master_stock_refill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_item" ADD CONSTRAINT "purchase_invoice_item_purchase_code_id_fkey" FOREIGN KEY ("purchase_code_id") REFERENCES "purchase_code"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Деньги неотрицательны. Вилка оценки — снимок на момент предложения, и
-- отрицательная её граница означала бы, что мастеру предлагают доплатить
ALTER TABLE master_offer DROP CONSTRAINT IF EXISTS master_offer_money_non_negative;
ALTER TABLE master_offer ADD CONSTRAINT master_offer_money_non_negative
  CHECK (estimate_from_tiyin >= 0 AND estimate_to_tiyin >= 0 AND master_share_from_tiyin >= 0);

-- Верх вилки не ниже низа: перевёрнутая вилка показывается мастеру как
-- «от 200 000 до 50 000» и делает предложение неотличимым от ошибки
ALTER TABLE master_offer DROP CONSTRAINT IF EXISTS master_offer_range_ordered;
ALTER TABLE master_offer ADD CONSTRAINT master_offer_range_ordered
  CHECK (estimate_to_tiyin >= estimate_from_tiyin);

-- Срок жизни предложения положителен: нулевой TTL — предложение, которое
-- истекло раньше, чем дошло
ALTER TABLE master_offer DROP CONSTRAINT IF EXISTS master_offer_ttl_positive;
ALTER TABLE master_offer ADD CONSTRAINT master_offer_ttl_positive CHECK (ttl_seconds > 0);

-- Ответ на предложение обязан иметь время: без него нельзя посчитать, сколько
-- мастер думал, а по этому считается скорость реакции в рейтинге
ALTER TABLE master_offer DROP CONSTRAINT IF EXISTS master_offer_response_dated;
ALTER TABLE master_offer ADD CONSTRAINT master_offer_response_dated
  CHECK (status NOT IN ('accepted', 'declined') OR responded_at IS NOT NULL);

-- Одному мастеру одно живое предложение на заявку. Второе означало бы, что
-- он может принять одну и ту же работу дважды, а веерная рассылка при
-- повторе выдала бы её и другому
CREATE UNIQUE INDEX IF NOT EXISTS master_offer_one_pending_idx
  ON master_offer (tenant_id, order_id, master_id) WHERE status = 'pending';

-- Чаевые не бывают отрицательными: это подарок, а не корректировка счёта
ALTER TABLE master_tip DROP CONSTRAINT IF EXISTS master_tip_positive;
ALTER TABLE master_tip ADD CONSTRAINT master_tip_positive CHECK (amount_tiyin > 0);

-- Остаток в сумке мастера не уходит в минус: отрицательный остаток означает,
-- что списали то, чего не было, и следующая закупка посчитается неверно
ALTER TABLE master_stock DROP CONSTRAINT IF EXISTS master_stock_qty_non_negative;
ALTER TABLE master_stock ADD CONSTRAINT master_stock_qty_non_negative CHECK (qty >= 0);

ALTER TABLE master_stock_refill_item DROP CONSTRAINT IF EXISTS refill_item_positive;
ALTER TABLE master_stock_refill_item ADD CONSTRAINT refill_item_positive
  CHECK (qty > 0 AND cost_tiyin >= 0);

-- Лимит кода закупки строго положителен: код с нулевым лимитом бесполезен,
-- а с отрицательным — открытый кошелёк наоборот
ALTER TABLE purchase_code DROP CONSTRAINT IF EXISTS purchase_code_limit_positive;
ALTER TABLE purchase_code ADD CONSTRAINT purchase_code_limit_positive CHECK (limit_tiyin > 0);

-- Накладная либо есть целиком, либо её нет: файл без суммы и сумма без файла
-- одинаково не годятся для сверки
ALTER TABLE purchase_code DROP CONSTRAINT IF EXISTS purchase_code_invoice_complete;
ALTER TABLE purchase_code ADD CONSTRAINT purchase_code_invoice_complete
  CHECK ((invoice_file IS NULL AND invoice_total_tiyin IS NULL AND invoice_at IS NULL)
      OR (invoice_file IS NOT NULL AND invoice_total_tiyin IS NOT NULL AND invoice_at IS NOT NULL));

-- Опыт в годах — не отрицательный и не фантастический
ALTER TABLE master_application DROP CONSTRAINT IF EXISTS master_application_experience_sane;
ALTER TABLE master_application ADD CONSTRAINT master_application_experience_sane
  CHECK (experience_years BETWEEN 0 AND 60);

-- Оценка экзамена в процентах
ALTER TABLE master_application_exam DROP CONSTRAINT IF EXISTS master_application_exam_score_range;
ALTER TABLE master_application_exam ADD CONSTRAINT master_application_exam_score_range
  CHECK (score BETWEEN 0 AND 100);

-- Отказ обязан быть объяснён: анкета, отклонённая без причины, оставляет
-- человека без ответа на вопрос «что мне исправить»
ALTER TABLE master_application DROP CONSTRAINT IF EXISTS master_application_rejection_explained;
ALTER TABLE master_application ADD CONSTRAINT master_application_rejection_explained
  CHECK (stage <> 'rejected' OR length(btrim(coalesce(rejection_reason, ''))) > 0);

DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['master_offer','master_shift_state','master_geo_event','master_notification',
                           'master_appeal','master_tip','master_application','master_application_document',
                           'master_application_tool_check','master_application_exam','master_stock',
                           'master_stock_refill','purchase_code'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())',
      t || '_tenant', t);
  END LOOP;
END $rls$;
