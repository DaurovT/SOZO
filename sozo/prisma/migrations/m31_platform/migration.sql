-- Платформенное: короткие ссылки, состояние SLA, расчёт с оператором,
-- журнал таймеров.
--
-- Короткие ссылки сведены в одну таблицу из трёх наборов — веб-карточка
-- заявки, согласование наряда-допуска, ответ жителя о доступе. У них
-- одинаковые поля, общий алфавит кода и общая функция выдачи; различались
-- они только тем, на что ведут. Три таблицы означали бы три места, где надо
-- не забыть проверить срок и отзыв.

-- CreateTable
CREATE TABLE "short_link" (
    "code" TEXT NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "target_id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "building_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    "opens" INTEGER NOT NULL DEFAULT 0,
    "last_opened_at" TIMESTAMPTZ,

    CONSTRAINT "short_link_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "sla_state" (
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "policy_id" UUID NOT NULL,
    "response_due" TIMESTAMPTZ NOT NULL,
    "arrival_due" TIMESTAMPTZ NOT NULL,
    "resolution_due" TIMESTAMPTZ NOT NULL,
    "breached" TEXT[],
    "reached" TEXT[],
    "paused_ms" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sla_state_pkey" PRIMARY KEY ("tenant_id","order_id")
);

-- CreateTable
CREATE TABLE "operator_ledger_row" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "operator_org_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount_tiyin" BIGINT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operator_ledger_row_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timer_run" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "timer" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "affected" INTEGER NOT NULL DEFAULT 0,
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "timer_run_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "short_link_tenant_id_kind_target_id_idx" ON "short_link"("tenant_id", "kind", "target_id");

-- CreateIndex
CREATE INDEX "short_link_tenant_id_phone_idx" ON "short_link"("tenant_id", "phone");

-- CreateIndex
CREATE INDEX "sla_state_tenant_id_resolution_due_idx" ON "sla_state"("tenant_id", "resolution_due");

-- CreateIndex
CREATE INDEX "operator_ledger_row_tenant_id_operator_org_id_at_idx" ON "operator_ledger_row"("tenant_id", "operator_org_id", "at" DESC);

-- CreateIndex
CREATE INDEX "timer_run_tenant_id_timer_at_idx" ON "timer_run"("tenant_id", "timer", "at" DESC);

ALTER TABLE short_link DROP CONSTRAINT IF EXISTS short_link_kind_known;
ALTER TABLE short_link ADD CONSTRAINT short_link_kind_known
  CHECK (kind IN ('web_card', 'permit_approval', 'unit_access'));

-- Ссылка живёт вперёд, а не назад: истёкшая в момент выдачи бесполезна и
-- выглядит для человека как сломанная система
ALTER TABLE short_link DROP CONSTRAINT IF EXISTS short_link_expires_after_creation;
ALTER TABLE short_link ADD CONSTRAINT short_link_expires_after_creation
  CHECK (expires_at > created_at);

-- Счётчик открытий не отрицателен, и открытая ссылка помнит, когда открывали
ALTER TABLE short_link DROP CONSTRAINT IF EXISTS short_link_opens_sane;
ALTER TABLE short_link ADD CONSTRAINT short_link_opens_sane
  CHECK (opens >= 0 AND (opens = 0 OR last_opened_at IS NOT NULL));

-- Согласование наряда всегда об объекте: без него очередь согласований не
-- построить, а именно ради неё ссылка и существует
ALTER TABLE short_link DROP CONSTRAINT IF EXISTS short_link_permit_has_building;
ALTER TABLE short_link ADD CONSTRAINT short_link_permit_has_building
  CHECK (kind <> 'permit_approval' OR building_id IS NOT NULL);

-- Сроки SLA идут по порядку: ответ, выезд, устранение. Перевёрнутые означают
-- заявку, просроченную в момент приёма
ALTER TABLE sla_state DROP CONSTRAINT IF EXISTS sla_state_deadlines_ordered;
ALTER TABLE sla_state ADD CONSTRAINT sla_state_deadlines_ordered
  CHECK (arrival_due >= response_due AND resolution_due >= arrival_due);

-- Накопленная пауза не отрицательна: отрицательная пауза удлиняет срок, то
-- есть скрывает просрочку
ALTER TABLE sla_state DROP CONSTRAINT IF EXISTS sla_state_pause_non_negative;
ALTER TABLE sla_state ADD CONSTRAINT sla_state_pause_non_negative CHECK (paused_ms >= 0);

-- Строка расчёта с нулём — запись ни о чём в документе, по которому платят
ALTER TABLE operator_ledger_row DROP CONSTRAINT IF EXISTS operator_ledger_amount_non_zero;
ALTER TABLE operator_ledger_row ADD CONSTRAINT operator_ledger_amount_non_zero
  CHECK (amount_tiyin <> 0);

ALTER TABLE operator_ledger_row DROP CONSTRAINT IF EXISTS operator_ledger_kind_known;
ALTER TABLE operator_ledger_row ADD CONSTRAINT operator_ledger_kind_known
  CHECK (kind IN ('subscription', 'claim', 'service_fee'));

ALTER TABLE timer_run DROP CONSTRAINT IF EXISTS timer_run_affected_non_negative;
ALTER TABLE timer_run ADD CONSTRAINT timer_run_affected_non_negative CHECK (affected >= 0);

DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['short_link','sla_state','operator_ledger_row','timer_run'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())',
      t || '_tenant', t);
  END LOOP;
END $rls$;
