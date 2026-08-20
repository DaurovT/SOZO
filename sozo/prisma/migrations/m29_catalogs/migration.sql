-- Реестры платформы: оборудование, партнёрские магазины, расходники, склад.
--
-- Главное здесь — сведение двух реестров оборудования в один. В коде их было
-- два: в `registry` — с инвентарным номером, стоимостью и датой обслуживания,
-- в `master-api` — с категорией, требуемым навыком и фотографией. Это одна и
-- та же вещь: перфоратор, который выдают мастеру под акт. Два описания
-- означали два ответа на вопрос «где сейчас этот перфоратор», и разошлись бы
-- они ровно в момент спора о пропаже.

-- CreateTable
CREATE TABLE "equipment_unit" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "inventory_no" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT '',
    "required_skill" TEXT,
    "cost_tiyin" BIGINT NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'in_stock',
    "holder_master_id" TEXT,
    "holder_master_name" TEXT,
    "issued_at" TIMESTAMPTZ,
    "next_maintenance_at" TIMESTAMPTZ,
    "photo_file" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "equipment_unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_act" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "equipment_id" UUID NOT NULL,
    "master_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "photos" TEXT[],
    "discrepancy" TEXT,
    "confirm_code" TEXT NOT NULL,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "equipment_act_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_act_item" (
    "id" UUID NOT NULL,
    "act_id" UUID NOT NULL,
    "item" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "equipment_act_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_store" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "categories" TEXT[],
    "credit_limit_tiyin" BIGINT NOT NULL DEFAULT 0,
    "payable_tiyin" BIGINT NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',

    CONSTRAINT "partner_store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consumable_catalog" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "fix_price_tiyin" BIGINT NOT NULL,
    "norm_per_order" TEXT,

    CONSTRAINT "consumable_catalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_item" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "qty_on_hand" INTEGER NOT NULL DEFAULT 0,
    "min_qty" INTEGER NOT NULL DEFAULT 0,
    "cost_tiyin" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "stock_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movement" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "stock_item_id" UUID NOT NULL,
    "item_name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "master_id" TEXT,
    "master_name" TEXT,
    "price_tiyin" BIGINT,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "equipment_unit_tenant_id_status_idx" ON "equipment_unit"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "equipment_unit_tenant_id_holder_master_id_idx" ON "equipment_unit"("tenant_id", "holder_master_id");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_unit_tenant_id_inventory_no_key" ON "equipment_unit"("tenant_id", "inventory_no");

-- CreateIndex
CREATE INDEX "equipment_act_tenant_id_equipment_id_at_idx" ON "equipment_act"("tenant_id", "equipment_id", "at" DESC);

-- CreateIndex
CREATE INDEX "partner_store_tenant_id_status_idx" ON "partner_store"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "consumable_catalog_tenant_id_name_key" ON "consumable_catalog"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "stock_item_tenant_id_category_idx" ON "stock_item"("tenant_id", "category");

-- CreateIndex
CREATE UNIQUE INDEX "stock_item_tenant_id_name_key" ON "stock_item"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "stock_movement_tenant_id_stock_item_id_created_at_idx" ON "stock_movement"("tenant_id", "stock_item_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "equipment_act" ADD CONSTRAINT "equipment_act_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "equipment_unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_act_item" ADD CONSTRAINT "equipment_act_item_act_id_fkey" FOREIGN KEY ("act_id") REFERENCES "equipment_act"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_stock_item_id_fkey" FOREIGN KEY ("stock_item_id") REFERENCES "stock_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Состояния сведены: repair и maintenance — одно и то же. lost и written_off
-- разное: утерянное ищут и взыскивают, списанное закрыто
ALTER TABLE equipment_unit DROP CONSTRAINT IF EXISTS equipment_unit_status_known;
ALTER TABLE equipment_unit ADD CONSTRAINT equipment_unit_status_known
  CHECK (status IN ('in_stock', 'issued', 'maintenance', 'lost', 'written_off'));

-- Выданное оборудование знает, у кого оно и с какого числа. Иначе «выдано» —
-- это просто «нет на складе», и найти вещь не по чему
ALTER TABLE equipment_unit DROP CONSTRAINT IF EXISTS equipment_unit_issued_has_holder;
ALTER TABLE equipment_unit ADD CONSTRAINT equipment_unit_issued_has_holder
  CHECK (status <> 'issued' OR (holder_master_id IS NOT NULL AND issued_at IS NOT NULL));

ALTER TABLE equipment_unit DROP CONSTRAINT IF EXISTS equipment_unit_cost_non_negative;
ALTER TABLE equipment_unit ADD CONSTRAINT equipment_unit_cost_non_negative CHECK (cost_tiyin >= 0);

-- Расхождение в акте требует объяснения: «не сошлось» без текста не годится
-- ни для взыскания, ни для списания
ALTER TABLE equipment_act DROP CONSTRAINT IF EXISTS equipment_act_kind_known;
ALTER TABLE equipment_act ADD CONSTRAINT equipment_act_kind_known CHECK (kind IN ('issue', 'return'));

-- Задолженность магазину не превышает кредитного лимита. Правило в базе, а не
-- только в коде: закупка идёт из приложения мастера, из кабинета снабжения и
-- по коду закупки — три пути, и проверять в каждом значит однажды забыть
ALTER TABLE partner_store DROP CONSTRAINT IF EXISTS partner_store_within_credit;
ALTER TABLE partner_store ADD CONSTRAINT partner_store_within_credit
  CHECK (credit_limit_tiyin >= 0 AND payable_tiyin >= 0 AND payable_tiyin <= credit_limit_tiyin);

ALTER TABLE consumable_catalog DROP CONSTRAINT IF EXISTS consumable_catalog_price_positive;
ALTER TABLE consumable_catalog ADD CONSTRAINT consumable_catalog_price_positive
  CHECK (fix_price_tiyin > 0);

-- Остаток склада не уходит в минус, а порог пополнения не отрицателен
ALTER TABLE stock_item DROP CONSTRAINT IF EXISTS stock_item_qty_sane;
ALTER TABLE stock_item ADD CONSTRAINT stock_item_qty_sane
  CHECK (qty_on_hand >= 0 AND min_qty >= 0 AND cost_tiyin >= 0);

-- Количество в движении положительно: направление задаётся типом движения,
-- а отрицательное количество — второй, необъявленный способ сказать то же
ALTER TABLE stock_movement DROP CONSTRAINT IF EXISTS stock_movement_qty_positive;
ALTER TABLE stock_movement ADD CONSTRAINT stock_movement_qty_positive CHECK (qty > 0);

-- Продажа мастеру знает цену и покупателя: без них удержание из выплаты
-- посчитать не из чего (ТЗ 17.16)
ALTER TABLE stock_movement DROP CONSTRAINT IF EXISTS stock_movement_sale_complete;
ALTER TABLE stock_movement ADD CONSTRAINT stock_movement_sale_complete
  CHECK (type <> 'sale_to_master' OR (master_id IS NOT NULL AND price_tiyin IS NOT NULL AND price_tiyin >= 0));

DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['equipment_unit','equipment_act','partner_store','consumable_catalog',
                           'stock_item','stock_movement'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())',
      t || '_tenant', t);
  END LOOP;
END $rls$;
