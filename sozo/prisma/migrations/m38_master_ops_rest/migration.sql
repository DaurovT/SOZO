-- Ещё четыре сущности мастера, не попавшие в DEV-19.
--
-- Нашлись при переносе master-ops: в разделе состояния десять коллекций, а
-- спроектированы были шесть. Залог, отпуска, проверки инструмента на линии и
-- квартальный NPS остались бы в файле, то есть модуль оказался бы наполовину
-- перенесён — худшее из состояний.

CREATE TABLE IF NOT EXISTS master_deposit (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL,
  master_id    text NOT NULL,
  amount_tiyin bigint NOT NULL,
  status       text NOT NULL DEFAULT 'pending',
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS master_deposit_idx ON master_deposit (tenant_id, master_id, status);

ALTER TABLE master_deposit DROP CONSTRAINT IF EXISTS master_deposit_amount_positive;
ALTER TABLE master_deposit ADD CONSTRAINT master_deposit_amount_positive CHECK (amount_tiyin > 0);

CREATE TABLE IF NOT EXISTS master_time_off (
  id         uuid PRIMARY KEY,
  tenant_id  uuid NOT NULL,
  master_id  text NOT NULL,
  -- Календарные дни, а не моменты: отпуск берут днями, и «с 14:32» здесь
  -- не значит ничего
  from_date  date NOT NULL,
  to_date    date NOT NULL,
  kind       text NOT NULL,
  comment    text,
  status     text NOT NULL DEFAULT 'pending',
  reason     text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS master_time_off_idx ON master_time_off (tenant_id, master_id, status);

ALTER TABLE master_time_off DROP CONSTRAINT IF EXISTS master_time_off_range_ordered;
ALTER TABLE master_time_off ADD CONSTRAINT master_time_off_range_ordered CHECK (to_date >= from_date);

-- Отказ обязан нести причину: иначе мастер не знает, подавать ли заново, а
-- планировщик уже не поставил ему смены
ALTER TABLE master_time_off DROP CONSTRAINT IF EXISTS master_time_off_rejection_explained;
ALTER TABLE master_time_off ADD CONSTRAINT master_time_off_rejection_explained
  CHECK (status <> 'rejected' OR length(btrim(coalesce(reason, ''))) > 0);

CREATE TABLE IF NOT EXISTS master_tool_check (
  id        uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  master_id text NOT NULL,
  skill     text NOT NULL,
  complete  boolean NOT NULL DEFAULT true,
  -- Чего не хватает — строкой: по ней снабжение докупает
  missing   text,
  at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS master_tool_check_idx ON master_tool_check (tenant_id, master_id, at DESC);

ALTER TABLE master_tool_check DROP CONSTRAINT IF EXISTS master_tool_check_incomplete_named;
ALTER TABLE master_tool_check ADD CONSTRAINT master_tool_check_incomplete_named
  CHECK (complete OR length(btrim(coalesce(missing, ''))) > 0);

CREATE TABLE IF NOT EXISTS master_nps (
  id        uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  master_id text NOT NULL,
  score     int NOT NULL,
  comment   text,
  at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS master_nps_idx ON master_nps (tenant_id, at DESC);

-- Шкала NPS фиксированная: одиннадцать баллов — не восторг, а ошибка ввода,
-- которая ломает расчёт индекса
ALTER TABLE master_nps DROP CONSTRAINT IF EXISTS master_nps_score_range;
ALTER TABLE master_nps ADD CONSTRAINT master_nps_score_range CHECK (score BETWEEN 0 AND 10);

DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['master_deposit','master_time_off','master_tool_check','master_nps'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())',
      t || '_tenant', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO sozo_app', t);
  END LOOP;
END $rls$;
