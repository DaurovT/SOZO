-- Инварианты, которые нельзя проверить на PGlite.
--
-- db:check прогоняет схему в PGlite (WASM) — этого хватает для RLS и CHECK-ов,
-- но в PGlite нет btree_gist, и EXCLUDE-ограничение «один стояк — одно
-- отключение» (DEV-02 §4.4 п.9) там просто пропускается. То есть до появления
-- настоящего сервера этот инвариант не проверялся ни разу, а держался только
-- проверкой в AccessService.createShutdown — и разойтись они могли незаметно.
--
-- Запуск: npm run db:check:pg (нужен поднятый infra/docker-compose.yml)

\set ON_ERROR_STOP on

DO $$
DECLARE
  t uuid := gen_random_uuid();
  riser uuid := gen_random_uuid();
  passed int := 0;
  failed int := 0;
BEGIN
  -- Связность здесь не предмет проверки: нас интересует ровно ограничение
  PERFORM set_config('session_replication_role', 'replica', true);

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shutdown_no_riser_overlap' AND contype = 'x') THEN
    RAISE EXCEPTION 'ограничение shutdown_no_riser_overlap не найдено — миграция m7_shutdown_exclusion не применена';
  END IF;
  RAISE NOTICE '  ✓ EXCLUDE-ограничение на месте';
  passed := passed + 1;

  INSERT INTO resource_shutdown (id,tenant_id,building_id,resource_type,status,planned_from,planned_to,riser_id,reason,created_at,updated_at)
  VALUES (gen_random_uuid(),t,gen_random_uuid(),'cold_water','scheduled','2026-09-01 10:00+05','2026-09-01 14:00+05',riser,'Замена вентиля',now(),now());
  RAISE NOTICE '  ✓ первое отключение на стояке принято';
  passed := passed + 1;

  BEGIN
    INSERT INTO resource_shutdown (id,tenant_id,building_id,resource_type,status,planned_from,planned_to,riser_id,reason,created_at,updated_at)
    VALUES (gen_random_uuid(),t,gen_random_uuid(),'cold_water','scheduled','2026-09-01 12:00+05','2026-09-01 16:00+05',riser,'Вторая бригада',now(),now());
    RAISE NOTICE '  ✗ пересекающееся окно на том же стояке прошло';
    failed := failed + 1;
  EXCEPTION WHEN exclusion_violation THEN
    RAISE NOTICE '  ✓ пересечение на том же стояке отбито базой';
    passed := passed + 1;
  END;

  BEGIN
    INSERT INTO resource_shutdown (id,tenant_id,building_id,resource_type,status,planned_from,planned_to,riser_id,reason,created_at,updated_at)
    VALUES (gen_random_uuid(),t,gen_random_uuid(),'cold_water','scheduled','2026-09-01 15:00+05','2026-09-01 17:00+05',riser,'После первой',now(),now());
    RAISE NOTICE '  ✓ соседнее окно на том же стояке принято';
    passed := passed + 1;
  EXCEPTION WHEN exclusion_violation THEN
    RAISE NOTICE '  ✗ непересекающееся окно отбито — ограничение слишком широкое';
    failed := failed + 1;
  END;

  -- Ограничение включает tenant_id: без него чужая организация блокировала бы
  -- работы на своём стояке с тем же идентификатором
  BEGIN
    INSERT INTO resource_shutdown (id,tenant_id,building_id,resource_type,status,planned_from,planned_to,riser_id,reason,created_at,updated_at)
    VALUES (gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'cold_water','scheduled','2026-09-01 12:00+05','2026-09-01 16:00+05',riser,'Чужой тенант',now(),now());
    RAISE NOTICE '  ✓ тот же стояк у другого тенанта не конфликтует';
    passed := passed + 1;
  EXCEPTION WHEN exclusion_violation THEN
    RAISE NOTICE '  ✗ ограничение течёт между тенантами';
    failed := failed + 1;
  END;

  -- Отменённое отключение не должно держать стояк: условие WHERE в ограничении
  BEGIN
    INSERT INTO resource_shutdown (id,tenant_id,building_id,resource_type,status,planned_from,planned_to,riser_id,reason,created_at,updated_at)
    VALUES (gen_random_uuid(),t,gen_random_uuid(),'cold_water','cancelled','2026-09-01 11:00+05','2026-09-01 13:00+05',riser,'Отменено',now(),now());
    RAISE NOTICE '  ✓ отменённое отключение стояк не держит';
    passed := passed + 1;
  EXCEPTION WHEN exclusion_violation THEN
    RAISE NOTICE '  ✗ отменённое отключение блокирует стояк';
    failed := failed + 1;
  END;

  RAISE NOTICE '';
  RAISE NOTICE 'Пройдено: %   Провалено: %', passed, failed;
  IF failed > 0 THEN
    RAISE EXCEPTION 'инварианты не держатся: % провалов', failed;
  END IF;

  -- Проверка не оставляет за собой данных
  RAISE EXCEPTION 'SOZO_ROLLBACK';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'SOZO_ROLLBACK' THEN RAISE; END IF;
  RAISE NOTICE '  · тестовые строки откачены';
END $$;
