-- Отдельная роль для приложения. Без неё RLS не работает вовсе.
--
-- Расширенная проверка изоляции показала то, чего не видно ни в схеме, ни в
-- политиках: приложение подключается ролью `sozo`, а она суперпользователь.
-- Суперпользователь обходит RLS полностью — ни политики, ни даже FORCE на
-- него не действуют. То есть изоляция арендаторов была написана, объявлена в
-- документации и не работала ни секунды.
--
-- Лечится это не политикой, а ролью: приложение обязано ходить в базу тем,
-- кому правила писаны. `sozo` остаётся владельцем и мигратором — DDL под
-- RLS не попадает, — а работать приложение будет ролью `sozo_app`.
--
-- Пароль здесь стоит разработческий и совпадает с именем роли: миграция
-- лежит в репозитории, и настоящий пароль в ней означал бы, что он больше не
-- настоящий. Прод меняет его при переключении (deploy/switch-to-postgres.sh),
-- и это единственное место, где он живёт.

DO $role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sozo_app') THEN
    CREATE ROLE sozo_app LOGIN PASSWORD 'sozo_app';
  END IF;
END $role$;

-- Ни суперпользователя, ни обхода политик: это и есть весь смысл роли
ALTER ROLE sozo_app NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;

GRANT USAGE ON SCHEMA public TO sozo_app;

-- Данные — да, схема — нет: менять таблицы приложение не должно, для этого
-- есть миграции, которые применяются владельцем
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sozo_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sozo_app;

-- Таблицы, которые появятся в следующих миграциях, получат права сами:
-- иначе первая же новая таблица окажется недоступна приложению, и понять
-- это можно будет только по отказу в проде
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sozo_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO sozo_app;
