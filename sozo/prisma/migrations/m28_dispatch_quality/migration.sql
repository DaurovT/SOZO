-- Диспетчерская и качество: замены, инциденты, передача смены, обращения,
-- жалобы, споры, дела о возмещении.
--
-- Общее у всех — срок и ответственный. Именно поэтому сроки хранятся
-- моментами, а не длительностями: они посчитаны по политике, действовавшей
-- в момент события, и правка политики не должна задним числом делать
-- вчерашнюю жалобу просроченной.

-- CreateTable
CREATE TABLE "master_replacement" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "order_number" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'detected',
    "from_master_id" TEXT,
    "from_master_name" TEXT,
    "to_master_id" TEXT,
    "to_master_name" TEXT,
    "detected_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "broadcast_started_at" TIMESTAMPTZ,
    "broadcast_seconds" INTEGER NOT NULL DEFAULT 120,
    "resolved_at" TIMESTAMPTZ,
    "client_notified" BOOLEAN NOT NULL DEFAULT false,
    "sanction" TEXT NOT NULL DEFAULT 'none',
    "note" TEXT,

    CONSTRAINT "master_replacement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispatch_incident" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "zone" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "opened_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ,
    "opened_by" TEXT NOT NULL,
    "note" TEXT,

    CONSTRAINT "dispatch_incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispatch_incident_order" (
    "incident_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,

    CONSTRAINT "dispatch_incident_order_pkey" PRIMARY KEY ("incident_id","order_id")
);

-- CreateTable
CREATE TABLE "shift_handover" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "from_phone" TEXT NOT NULL,
    "to_phone" TEXT,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMPTZ,

    CONSTRAINT "shift_handover_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_handover_item" (
    "id" UUID NOT NULL,
    "handover_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "accepted" BOOLEAN NOT NULL DEFAULT false,
    "accepted_by" TEXT,
    "accepted_at" TIMESTAMPTZ,

    CONSTRAINT "shift_handover_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_request" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "order_id" UUID NOT NULL,
    "order_number" TEXT NOT NULL,
    "client_phone" TEXT NOT NULL,
    "client_name" TEXT,
    "master_id" TEXT,
    "master_name" TEXT,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "due_at" TIMESTAMPTZ,
    "status" TEXT NOT NULL DEFAULT 'new',
    "taken_by_phone" TEXT,
    "resolution" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ,

    CONSTRAINT "client_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_complaint" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID,
    "order_number" TEXT,
    "complainant_phone" TEXT NOT NULL,
    "complainant_name" TEXT,
    "is_org_manager" BOOLEAN NOT NULL DEFAULT false,
    "type" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "master_id" TEXT,
    "master_name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "sla_first_response_at" TIMESTAMPTZ NOT NULL,
    "sla_resolution_at" TIMESTAMPTZ NOT NULL,
    "first_response_at" TIMESTAMPTZ,
    "resolved_at" TIMESTAMPTZ,
    "playbook_code" TEXT,
    "resolution" TEXT,
    "confirmed" BOOLEAN,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quality_complaint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispute" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "order_number" TEXT NOT NULL,
    "opened_by_phone" TEXT NOT NULL,
    "opened_by_role" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "amount_tiyin" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolution" TEXT,
    "refund_tiyin" BIGINT,
    "master_share_blocked" BOOLEAN NOT NULL DEFAULT true,
    "handled_by_phone" TEXT,
    "comment" TEXT,
    "escalation_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ,

    CONSTRAINT "dispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "damage_case" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID,
    "description" TEXT NOT NULL,
    "claimant_name" TEXT NOT NULL,
    "amount_tiyin" BIGINT NOT NULL,
    "regress_tiyin" BIGINT NOT NULL DEFAULT 0,
    "master_id" TEXT,
    "master_name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'filed',
    "resolution" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "damage_case_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "master_replacement_tenant_id_stage_idx" ON "master_replacement"("tenant_id", "stage");

-- CreateIndex
CREATE INDEX "master_replacement_tenant_id_order_id_idx" ON "master_replacement"("tenant_id", "order_id");

-- CreateIndex
CREATE INDEX "dispatch_incident_tenant_id_opened_at_idx" ON "dispatch_incident"("tenant_id", "opened_at" DESC);

-- CreateIndex
CREATE INDEX "shift_handover_tenant_id_started_at_idx" ON "shift_handover"("tenant_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "client_request_tenant_id_status_due_at_idx" ON "client_request"("tenant_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "quality_complaint_tenant_id_status_sla_first_response_at_idx" ON "quality_complaint"("tenant_id", "status", "sla_first_response_at");

-- CreateIndex
CREATE INDEX "quality_complaint_tenant_id_master_id_idx" ON "quality_complaint"("tenant_id", "master_id");

-- CreateIndex
CREATE INDEX "dispute_tenant_id_status_idx" ON "dispute"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "dispute_tenant_id_order_id_idx" ON "dispute"("tenant_id", "order_id");

-- CreateIndex
CREATE INDEX "damage_case_tenant_id_status_idx" ON "damage_case"("tenant_id", "status");

-- AddForeignKey
ALTER TABLE "dispatch_incident_order" ADD CONSTRAINT "dispatch_incident_order_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "dispatch_incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_handover_item" ADD CONSTRAINT "shift_handover_item_handover_id_fkey" FOREIGN KEY ("handover_id") REFERENCES "shift_handover"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Окно веерной рассылки положительно: нулевое означает, что предложение
-- истекает раньше, чем доходит до телефона мастера
ALTER TABLE master_replacement DROP CONSTRAINT IF EXISTS master_replacement_broadcast_positive;
ALTER TABLE master_replacement ADD CONSTRAINT master_replacement_broadcast_positive
  CHECK (broadcast_seconds > 0);

-- Замена, доведённая до назначения, знает нового мастера
ALTER TABLE master_replacement DROP CONSTRAINT IF EXISTS master_replacement_assigned_has_master;
ALTER TABLE master_replacement ADD CONSTRAINT master_replacement_assigned_has_master
  CHECK (stage <> 'assigned' OR to_master_id IS NOT NULL);

-- Одна открытая замена на заявку: две означают, что заявку одновременно
-- раздают двум мастерам, и приедут оба или ни одного
CREATE UNIQUE INDEX IF NOT EXISTS master_replacement_one_open_idx
  ON master_replacement (tenant_id, order_id) WHERE stage <> 'closed';

-- Принятый пункт передачи смены знает, кем и когда принят: «принял» без
-- подписи — это способ закрыть смену, не разобрав висящее
ALTER TABLE shift_handover_item DROP CONSTRAINT IF EXISTS shift_handover_item_accepted_signed;
ALTER TABLE shift_handover_item ADD CONSTRAINT shift_handover_item_accepted_signed
  CHECK (NOT accepted OR (accepted_by IS NOT NULL AND accepted_at IS NOT NULL));

-- Срок резолюции не раньше срока первого ответа: перевёрнутые сроки делают
-- жалобу просроченной в момент подачи
ALTER TABLE quality_complaint DROP CONSTRAINT IF EXISTS quality_complaint_sla_ordered;
ALTER TABLE quality_complaint ADD CONSTRAINT quality_complaint_sla_ordered
  CHECK (sla_resolution_at >= sla_first_response_at);

-- Закрытая жалоба знает, когда закрыта и чем
ALTER TABLE quality_complaint DROP CONSTRAINT IF EXISTS quality_complaint_resolution_complete;
ALTER TABLE quality_complaint ADD CONSTRAINT quality_complaint_resolution_complete
  CHECK (status <> 'resolved' OR (resolved_at IS NOT NULL AND length(btrim(coalesce(resolution, ''))) > 0));

-- Деньги спора неотрицательны, а возврат не больше спорной суммы: вернуть
-- больше, чем взяли, — это не резолюция спора, а новая ошибка
ALTER TABLE dispute DROP CONSTRAINT IF EXISTS dispute_money_sane;
ALTER TABLE dispute ADD CONSTRAINT dispute_money_sane
  CHECK (amount_tiyin >= 0 AND (refund_tiyin IS NULL OR (refund_tiyin >= 0 AND refund_tiyin <= amount_tiyin)));

-- Решённый спор знает решение: без него доля мастера остаётся заблокированной
-- навсегда, и человек не получает деньги ни за что
ALTER TABLE dispute DROP CONSTRAINT IF EXISTS dispute_resolved_has_outcome;
ALTER TABLE dispute ADD CONSTRAINT dispute_resolved_has_outcome
  CHECK (status <> 'resolved' OR (resolution IS NOT NULL AND resolved_at IS NOT NULL));

-- Один открытый спор на заявку
CREATE UNIQUE INDEX IF NOT EXISTS dispute_one_open_idx
  ON dispute (tenant_id, order_id) WHERE status <> 'resolved';

-- Регресс к мастеру — не больше 30% суммы ущерба (ТЗ 17.7).
--
-- Правило держится базой, а не только кодом: это зарплата человека, и
-- ошибка здесь стоит ему месяца работы. Отдельно проверяется, что регресс
-- есть только там, где назван мастер: взыскивать не с кого иначе.
ALTER TABLE damage_case DROP CONSTRAINT IF EXISTS damage_case_regress_capped;
ALTER TABLE damage_case ADD CONSTRAINT damage_case_regress_capped
  CHECK (amount_tiyin >= 0 AND regress_tiyin >= 0 AND regress_tiyin * 10 <= amount_tiyin * 3);

ALTER TABLE damage_case DROP CONSTRAINT IF EXISTS damage_case_regress_has_master;
ALTER TABLE damage_case ADD CONSTRAINT damage_case_regress_has_master
  CHECK (regress_tiyin = 0 OR master_id IS NOT NULL);

DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['master_replacement','dispatch_incident','shift_handover','client_request',
                           'quality_complaint','dispute','damage_case'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())',
      t || '_tenant', t);
  END LOOP;
END $rls$;
