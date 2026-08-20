-- Изоляция арендаторов на всей схеме, а не только на контуре «Дом».
--
-- Обнаружено при проектировании оставшихся разделов: политики стояли на
-- пятнадцати таблицах — тех, что завела m7 под контур «Дом». У заявки,
-- пользователя, проводки, организации и ещё трёх десятков таблиц RLS не было
-- вовсе, хотя и README, и DEV-02 называют её механизмом изоляции.
--
-- Практического вреда пока не было: арендатор один. Но это ровно тот случай,
-- когда «пока не вредило» — не аргумент: второй арендатор появляется одним
-- INSERT, а изоляция, которой нет, обнаруживается не при его появлении, а
-- когда первый увидит чужие заявки.
--
-- Дочерние таблицы — отдельный разговор. У позиции заявки, варианта допработ
-- и строки акта своего арендатора нет: они принадлежат родителю. Дописывать
-- им tenant_id значило бы хранить его дважды и однажды разойтись. Поэтому
-- политика проверяет арендатора родителя через EXISTS: это дороже сравнения
-- колонки, но дороже ровно на индексный поиск по первичному ключу.

-- ВАЖНОЕ, что выяснилось при первой же настоящей проверке изоляции.
--
-- Одного `ENABLE ROW LEVEL SECURITY` мало: PostgreSQL освобождает владельца
-- таблицы от собственных политик. Приложение подключается ролью `sozo`,
-- которая таблицами и владеет, — то есть политики не действовали ни на одну
-- строку, включая те пятнадцать таблиц, что завела m7. Изоляция была
-- объявлена, но не работала, и проверить это можно было только попыткой
-- прочитать чужую строку — что и обнаружило расширенное db:check:rls.
--
-- Поэтому дальше везде FORCE: политика действует и на владельца. Побочное
-- следствие, о котором надо знать: запрос в psql под `sozo` без
-- `SET app.tenant_id` теперь возвращает ноль строк, а не всё подряд. Это
-- правильно и это же неудобно — обслуживание базы руками требует явно
-- назвать арендатора.

-- 1. Таблицы со своим арендатором.
DO $own$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname AS tbl
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND NOT c.relrowsecurity
      AND EXISTS (
        SELECT 1 FROM information_schema.columns col
        WHERE col.table_schema = 'public' AND col.table_name = c.relname AND col.column_name = 'tenant_id'
      )
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', r.tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', r.tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.tbl || '_tenant', r.tbl);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())',
      r.tbl || '_tenant', r.tbl);
  END LOOP;
END $own$;

-- 2. Дочерние таблицы: арендатор берётся у родителя.
--
-- Пары «таблица → родитель» перечислены явно, а не выведены из внешних
-- ключей: у части таблиц ключей несколько, и автоматический выбор родителя
-- однажды выберет не тот. Список короткий и меняется вместе со схемой.
DO $child$
DECLARE
  pairs text[][] := ARRAY[
    ['act_checklist_zone', 'act_id', 'inspection_act'],
    ['addwork_variant', 'offer_id', 'addwork_offer'],
    ['addwork_escalation', 'offer_id', 'addwork_offer'],
    ['dispatch_incident_order', 'incident_id', 'dispatch_incident'],
    ['equipment_act_item', 'act_id', 'equipment_act'],
    ['master_stock_refill_item', 'refill_id', 'master_stock_refill'],
    ['purchase_invoice_item', 'purchase_code_id', 'purchase_code'],
    ['recommendation_line', 'recommendation_id', 'recommendation'],
    ['shift_handover_item', 'handover_id', 'shift_handover'],
    ['spare_tier_variant', 'offer_id', 'spare_tier_offer']
  ];
  i int;
BEGIN
  FOR i IN 1 .. array_length(pairs, 1) LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', pairs[i][1]);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', pairs[i][1]);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pairs[i][1] || '_tenant', pairs[i][1]);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (EXISTS (SELECT 1 FROM %I p WHERE p.id = %I.%I AND p.tenant_id = app_tenant_id()))'
      || ' WITH CHECK (EXISTS (SELECT 1 FROM %I p WHERE p.id = %I.%I AND p.tenant_id = app_tenant_id()))',
      pairs[i][1] || '_tenant', pairs[i][1],
      pairs[i][3], pairs[i][1], pairs[i][2],
      pairs[i][3], pairs[i][1], pairs[i][2]);
  END LOOP;
END $child$;

-- 3. addwork_line — внук: вариант принадлежит предложению, предложение
--    арендатору. Два перехода, поэтому отдельно от общего списка.
ALTER TABLE addwork_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE addwork_line FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS addwork_line_tenant ON addwork_line;
CREATE POLICY addwork_line_tenant ON addwork_line
  USING (EXISTS (
    SELECT 1 FROM addwork_variant v
    JOIN addwork_offer o ON o.id = v.offer_id
    WHERE v.id = addwork_line.variant_id AND o.tenant_id = app_tenant_id()))
  WITH CHECK (EXISTS (
    SELECT 1 FROM addwork_variant v
    JOIN addwork_offer o ON o.id = v.offer_id
    WHERE v.id = addwork_line.variant_id AND o.tenant_id = app_tenant_id()));

-- 4. permit_sync_op арендатора не имеет и иметь не должен: ключ операции
--    приходит с устройства мастера и уникален сам по себе. Таблица хранит
--    только «этот ключ уже применялся» — по ней нельзя узнать ничего о
--    чужом арендаторе, потому что в ней нет ничего, кроме ключа и наряда.
--    Политика всё равно ставится, но по существованию наряда: так таблица
--    перестаёт быть единственной без изоляции, а значит и единственным
--    местом, о котором надо помнить.
ALTER TABLE permit_sync_op ENABLE ROW LEVEL SECURITY;
ALTER TABLE permit_sync_op FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS permit_sync_op_tenant ON permit_sync_op;
CREATE POLICY permit_sync_op_tenant ON permit_sync_op
  USING (EXISTS (SELECT 1 FROM access_permit p WHERE p.id::text = permit_sync_op.permit_id AND p.tenant_id = app_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM access_permit p WHERE p.id::text = permit_sync_op.permit_id AND p.tenant_id = app_tenant_id()));

-- 5. Таблицы, у которых RLS уже была включена раньше (контур «Дом», m7),
--    но без FORCE — то есть без действия на владельца. Догоняем их тем же.
DO $force$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname AS tbl FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity AND NOT c.relforcerowsecurity
  LOOP
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', r.tbl);
  END LOOP;
END $force$;
