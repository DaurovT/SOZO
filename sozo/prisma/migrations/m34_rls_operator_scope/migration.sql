-- Ограничение по оператору применяется, когда оператор известен.
--
-- Обнаружено сразу после того, как RLS начала действовать по-настоящему
-- (m33): пятнадцать политик контура «Дом» требуют либо платформенной роли,
-- либо совпадения оператора в контексте. А контекст оператора приложение не
-- заполняет никогда — в main.ts стоит `operatorOrgId: null`, и другого места,
-- где он мог бы взяться, нет.
--
-- Пока всё ходило суперпользователем, это не проявлялось. Как только политики
-- заработали, любой запрос жителя или мастера стал получать отказ на записи в
-- таблицы объекта: роль у них не платформенная, оператор пуст — значит ни
-- одно из двух условий не выполнено.
--
-- Правило исправляется, а не отключается. Оно должно звучать так: изоляцию
-- арендаторов держим всегда, а сужение до оператора — тогда, когда оператор
-- в контексте назван. У жителя и мастера оператора нет и быть не может: у
-- жителя вообще одна квартира, а у мастера наряд на чужом объекте. Их доступ
-- ограничивает приложение по другому признаку — по помещению и по заявке.
--
-- Что это НЕ делает: не даёт жителю читать чужие объекты через API — там свои
-- проверки. RLS здесь стоит последней преградой на случай ошибки в них, и
-- преграда «чужой арендатор» остаётся абсолютной.

DO $fix$
DECLARE
  r record;
  tenant_only text;
BEGIN
  FOR r IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (qual LIKE '%app_operator_org_id%' OR with_check LIKE '%app_operator_org_id%')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.policyname, r.tablename);

    -- Оператор у таблицы может называться по-разному или отсутствовать вовсе
    -- (у заявки, например, его нет). Проверяем наличие колонки, а не гадаем
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = r.tablename AND column_name = 'operator_org_id'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I'
        || ' USING (tenant_id = app_tenant_id()'
        || '        AND (app_is_platform() OR app_operator_org_id() IS NULL OR operator_org_id IS NOT DISTINCT FROM app_operator_org_id()))'
        || ' WITH CHECK (tenant_id = app_tenant_id()'
        || '        AND (app_is_platform() OR app_operator_org_id() IS NULL OR operator_org_id IS NOT DISTINCT FROM app_operator_org_id()))',
        r.policyname, r.tablename);
    ELSE
      EXECUTE format(
        'CREATE POLICY %I ON %I USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())',
        r.policyname, r.tablename);
    END IF;
  END LOOP;
END $fix$;
