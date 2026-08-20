-- Работа мастера на заявке: развилки, выбор запчасти, допработы,
-- рекомендации, этапы и акт осмотра B2B.
--
-- Здесь больше всего денег вне самой заявки: варианты запчастей, сметы
-- допработ, оценки дефектов в акте. Поэтому суммы — колонки с CHECK, а не
-- поля в jsonb: на jsonb не наложить проверку, и отрицательная цена в
-- варианте всплыла бы не здесь, а в счёте клиенту.

-- CreateTable
CREATE TABLE "order_branch" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "master_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reason_code" TEXT,
    "comment" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolution" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ,

    CONSTRAINT "order_branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spare_tier_offer" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "master_id" TEXT NOT NULL,
    "part_name" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'catalog',
    "chosen_tier" TEXT,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "chosen_at" TIMESTAMPTZ,
    "procured_at" TIMESTAMPTZ,
    "procured_note" TEXT,

    CONSTRAINT "spare_tier_offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spare_tier_variant" (
    "id" UUID NOT NULL,
    "offer_id" UUID NOT NULL,
    "tier" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "amount_tiyin" BIGINT NOT NULL,
    "note" TEXT,

    CONSTRAINT "spare_tier_variant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addwork_offer" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "master_id" TEXT NOT NULL,
    "photo_count" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "chosen_variant" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ,

    CONSTRAINT "addwork_offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addwork_variant" (
    "id" UUID NOT NULL,
    "offer_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "total_tiyin" BIGINT NOT NULL,

    CONSTRAINT "addwork_variant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addwork_line" (
    "id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "amount_tiyin" BIGINT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "addwork_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addwork_escalation" (
    "id" UUID NOT NULL,
    "offer_id" UUID NOT NULL,
    "step" TEXT NOT NULL,
    "at" TIMESTAMPTZ NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "addwork_escalation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recommendation" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "master_id" TEXT NOT NULL,
    "comment" TEXT,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recommendation_line" (
    "id" UUID NOT NULL,
    "recommendation_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "amount_tiyin" BIGINT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "recommendation_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stage_plan" (
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "all_slots_confirmed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "stage_plan_pkey" PRIMARY KEY ("tenant_id","order_id")
);

-- CreateTable
CREATE TABLE "stage_plan_stage" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "index" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "norm_hours" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "pause_min_hours" INTEGER NOT NULL DEFAULT 0,
    "pause_max_hours" INTEGER NOT NULL DEFAULT 0,
    "slot_at" TIMESTAMPTZ,
    "status" TEXT NOT NULL DEFAULT 'planned',

    CONSTRAINT "stage_plan_stage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_act" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "order_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "location_name" TEXT NOT NULL,
    "master_id" TEXT NOT NULL,
    "master_name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "representative_name" TEXT,
    "representative_phone" TEXT,
    "representative_absent" BOOLEAN NOT NULL DEFAULT false,
    "decided_by_name" TEXT,
    "decided_by_phone" TEXT,
    "rejection_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ,
    "decided_at" TIMESTAMPTZ,
    "expires_at" TIMESTAMPTZ,

    CONSTRAINT "inspection_act_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "act_checklist_zone" (
    "id" UUID NOT NULL,
    "act_id" UUID NOT NULL,
    "zone" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,

    CONSTRAINT "act_checklist_zone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "act_defect_item" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "act_id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "photo_ids" TEXT[],
    "estimate_tiyin" BIGINT,
    "decision" TEXT NOT NULL DEFAULT 'pending',
    "decline_reason" TEXT,
    "order_id" UUID,

    CONSTRAINT "act_defect_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_branch_tenant_id_order_id_idx" ON "order_branch"("tenant_id", "order_id");

-- CreateIndex
CREATE INDEX "order_branch_tenant_id_status_created_at_idx" ON "order_branch"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "spare_tier_offer_tenant_id_order_id_idx" ON "spare_tier_offer"("tenant_id", "order_id");

-- CreateIndex
CREATE UNIQUE INDEX "spare_tier_variant_offer_id_tier_key" ON "spare_tier_variant"("offer_id", "tier");

-- CreateIndex
CREATE INDEX "addwork_offer_tenant_id_order_id_idx" ON "addwork_offer"("tenant_id", "order_id");

-- CreateIndex
CREATE UNIQUE INDEX "addwork_variant_offer_id_kind_key" ON "addwork_variant"("offer_id", "kind");

-- CreateIndex
CREATE INDEX "recommendation_tenant_id_order_id_idx" ON "recommendation"("tenant_id", "order_id");

-- CreateIndex
CREATE INDEX "recommendation_tenant_id_status_idx" ON "recommendation"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "stage_plan_stage_tenant_id_order_id_index_key" ON "stage_plan_stage"("tenant_id", "order_id", "index");

-- CreateIndex
CREATE INDEX "inspection_act_tenant_id_organization_id_created_at_idx" ON "inspection_act"("tenant_id", "organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "inspection_act_tenant_id_order_id_idx" ON "inspection_act"("tenant_id", "order_id");

-- CreateIndex
CREATE UNIQUE INDEX "inspection_act_tenant_id_number_key" ON "inspection_act"("tenant_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "act_checklist_zone_act_id_zone_key" ON "act_checklist_zone"("act_id", "zone");

-- CreateIndex
CREATE INDEX "act_defect_item_tenant_id_decision_idx" ON "act_defect_item"("tenant_id", "decision");

-- AddForeignKey
ALTER TABLE "spare_tier_variant" ADD CONSTRAINT "spare_tier_variant_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "spare_tier_offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addwork_variant" ADD CONSTRAINT "addwork_variant_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "addwork_offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addwork_line" ADD CONSTRAINT "addwork_line_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "addwork_variant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addwork_escalation" ADD CONSTRAINT "addwork_escalation_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "addwork_offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendation_line" ADD CONSTRAINT "recommendation_line_recommendation_id_fkey" FOREIGN KEY ("recommendation_id") REFERENCES "recommendation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_plan_stage" ADD CONSTRAINT "stage_plan_stage_tenant_id_order_id_fkey" FOREIGN KEY ("tenant_id", "order_id") REFERENCES "stage_plan"("tenant_id", "order_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "act_checklist_zone" ADD CONSTRAINT "act_checklist_zone_act_id_fkey" FOREIGN KEY ("act_id") REFERENCES "inspection_act"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "act_defect_item" ADD CONSTRAINT "act_defect_item_act_id_fkey" FOREIGN KEY ("act_id") REFERENCES "inspection_act"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE spare_tier_variant DROP CONSTRAINT IF EXISTS spare_tier_variant_amount_non_negative;
ALTER TABLE spare_tier_variant ADD CONSTRAINT spare_tier_variant_amount_non_negative
  CHECK (amount_tiyin >= 0);

-- Уровень — один из трёх названных клиенту. Четвёртый уровень означает, что
-- клиент выбирает из того, чего ему не показывали
ALTER TABLE spare_tier_variant DROP CONSTRAINT IF EXISTS spare_tier_variant_tier_known;
ALTER TABLE spare_tier_variant ADD CONSTRAINT spare_tier_variant_tier_known
  CHECK (tier IN ('economy', 'standard', 'premium'));

-- Выбранный уровень обязан быть выбран во времени: без отметки нельзя
-- доказать, что клиент решил до закупки, а не после
ALTER TABLE spare_tier_offer DROP CONSTRAINT IF EXISTS spare_tier_offer_choice_dated;
ALTER TABLE spare_tier_offer ADD CONSTRAINT spare_tier_offer_choice_dated
  CHECK (chosen_tier IS NULL OR chosen_at IS NOT NULL);

ALTER TABLE addwork_variant DROP CONSTRAINT IF EXISTS addwork_variant_total_non_negative;
ALTER TABLE addwork_variant ADD CONSTRAINT addwork_variant_total_non_negative
  CHECK (total_tiyin >= 0);

ALTER TABLE addwork_line DROP CONSTRAINT IF EXISTS addwork_line_sane;
ALTER TABLE addwork_line ADD CONSTRAINT addwork_line_sane
  CHECK (amount_tiyin >= 0 AND qty > 0);

ALTER TABLE recommendation_line DROP CONSTRAINT IF EXISTS recommendation_line_sane;
ALTER TABLE recommendation_line ADD CONSTRAINT recommendation_line_sane
  CHECK (amount_tiyin >= 0 AND qty > 0);

-- Оценка дефекта в акте либо есть, либо её нет — но не отрицательная:
-- по этим числам организация решает, что чинить в этом квартале
ALTER TABLE act_defect_item DROP CONSTRAINT IF EXISTS act_defect_item_estimate_non_negative;
ALTER TABLE act_defect_item ADD CONSTRAINT act_defect_item_estimate_non_negative
  CHECK (estimate_tiyin IS NULL OR estimate_tiyin >= 0);

-- Отклонённая позиция акта обязана нести причину: без неё спор о том, почему
-- дефект не устранён, упирается в пустое поле
ALTER TABLE act_defect_item DROP CONSTRAINT IF EXISTS act_defect_item_decline_explained;
ALTER TABLE act_defect_item ADD CONSTRAINT act_defect_item_decline_explained
  CHECK (decision <> 'declined' OR length(btrim(coalesce(decline_reason, ''))) > 0);

-- Подписанный акт знает, кто подписал. Либо ответственный присутствовал и
-- назван, либо в акте прямо сказано, что его не было
ALTER TABLE inspection_act DROP CONSTRAINT IF EXISTS inspection_act_signed_has_party;
ALTER TABLE inspection_act ADD CONSTRAINT inspection_act_signed_has_party
  CHECK (status <> 'signed'
      OR representative_absent
      OR (decided_by_name IS NOT NULL AND length(btrim(decided_by_name)) > 0));

-- Отклонённый акт обязан нести причину — по ней мастер переделывает работу
ALTER TABLE inspection_act DROP CONSTRAINT IF EXISTS inspection_act_rejection_explained;
ALTER TABLE inspection_act ADD CONSTRAINT inspection_act_rejection_explained
  CHECK (status <> 'rejected' OR length(btrim(coalesce(rejection_reason, ''))) > 0);

-- Пауза между этапами: верх не ниже низа. Перевёрнутая вилка означала бы
-- «не раньше трёх суток и не позже одних» — этап не запланировать вовсе
ALTER TABLE stage_plan_stage DROP CONSTRAINT IF EXISTS stage_plan_pause_ordered;
ALTER TABLE stage_plan_stage ADD CONSTRAINT stage_plan_pause_ordered
  CHECK (pause_max_hours >= pause_min_hours AND pause_min_hours >= 0);

-- Развилка «решена» знает, когда и чем: открытая развилка без резолюции
-- нормальна, закрытая без неё — потерянный ответ диспетчера
ALTER TABLE order_branch DROP CONSTRAINT IF EXISTS order_branch_resolution_complete;
ALTER TABLE order_branch ADD CONSTRAINT order_branch_resolution_complete
  CHECK (status <> 'resolved' OR resolved_at IS NOT NULL);

DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['order_branch','spare_tier_offer','addwork_offer','recommendation',
                           'stage_plan','stage_plan_stage','inspection_act','act_defect_item'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())',
      t || '_tenant', t);
  END LOOP;
END $rls$;
