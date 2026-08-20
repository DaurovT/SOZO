-- Планировщик: смены, брони, лист ожидания.
--
-- Таблиц не было вовсе — модуль появился позже схемы. Форма записей уже
-- устоялась в коде и проверена восемью уровнями приоритета (ТЗ 17.3),
-- поэтому схема повторяет её, а не наоборот.

-- 1. Смена мастера.
--    Время — минуты от полуночи, а не timestamptz: смена принадлежит дате
--    и не переезжает между часовыми поясами. Хранить её моментом времени
--    значило бы, что «с 9 до 18» меняется при смене зоны, чего не бывает.
CREATE TABLE IF NOT EXISTS shift (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL,
  master_id   text NOT NULL,
  -- Имя мастера — снимок на момент смены: в наряде на день должно стоять то,
  -- что было напечатано, даже если карточку потом переименовали
  master_name text NOT NULL DEFAULT '',
  date        date NOT NULL,
  start_min   int NOT NULL,
  end_min     int NOT NULL,
  -- Дежурный: плановые заявки на него не бронируются (ТЗ 17.3)
  is_duty     boolean NOT NULL DEFAULT false,
  zone        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE shift DROP CONSTRAINT IF EXISTS shift_within_day;
ALTER TABLE shift ADD CONSTRAINT shift_within_day
  CHECK (start_min >= 0 AND end_min > start_min AND end_min <= 24 * 60);

CREATE INDEX IF NOT EXISTS shift_date_idx ON shift (tenant_id, date);
CREATE INDEX IF NOT EXISTS shift_master_idx ON shift (tenant_id, master_id, date);

-- 2. Бронь слота под заявку.
--    Номер заявки хранится рядом с идентификатором: наряд на день печатается
--    из брони, и запрос за номером в orders означал бы, что планировщик
--    зависит от заявок (DEV-07 §3).
CREATE TABLE IF NOT EXISTS booking (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL,
  shift_id     uuid NOT NULL REFERENCES shift (id) ON DELETE CASCADE,
  master_id    text NOT NULL,
  order_id     uuid NOT NULL,
  order_number text NOT NULL DEFAULT '',
  start_min    int NOT NULL,
  end_min      int NOT NULL,
  slots        int NOT NULL DEFAULT 1,
  norm_hours   numeric(5, 2) NOT NULL DEFAULT 0,
  -- Буфер на дорогу: часть брони, а не константа — он зависит от зоны
  buffer_min   int NOT NULL DEFAULT 0,
  -- Якорная бронь — жёсткое окно клиента; гибкую можно двигать
  anchored     boolean NOT NULL DEFAULT false,
  priority     int NOT NULL DEFAULT 8,
  -- Двухчасовое окно, которое видит клиент. Хранится, а не считается из
  -- слота: клиенту названо конкретное окно, и пересчёт его при изменении
  -- правил округления означал бы, что обещание задним числом поменялось
  client_window_from_min int NOT NULL DEFAULT 0,
  client_window_to_min   int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE booking DROP CONSTRAINT IF EXISTS booking_window_ordered;
ALTER TABLE booking ADD CONSTRAINT booking_window_ordered CHECK (end_min > start_min);
-- Приоритет — один из восьми уровней очереди (ТЗ 17.3), а не произвольное число
ALTER TABLE booking DROP CONSTRAINT IF EXISTS booking_priority_range;
ALTER TABLE booking ADD CONSTRAINT booking_priority_range CHECK (priority BETWEEN 1 AND 8);

CREATE INDEX IF NOT EXISTS booking_shift_idx ON booking (tenant_id, shift_id);
CREATE INDEX IF NOT EXISTS booking_order_idx ON booking (tenant_id, order_id);

-- 3. Лист ожидания: заявка без брони, ждущая освободившийся слот.
--    Ключ — заявка: одна заявка стоит в очереди один раз, повторная попытка
--    записаться не должна двигать её вперёд.
CREATE TABLE IF NOT EXISTS waitlist_entry (
  tenant_id    uuid NOT NULL,
  order_id     uuid NOT NULL,
  order_number text NOT NULL DEFAULT '',
  norm_hours   numeric(5, 2) NOT NULL DEFAULT 0,
  priority     int NOT NULL DEFAULT 8,
  at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, order_id)
);

CREATE INDEX IF NOT EXISTS waitlist_queue_idx ON waitlist_entry (tenant_id, priority, at);

DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['shift', 'booking', 'waitlist_entry'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())',
      t || '_tenant', t);
  END LOOP;
END $rls$;
