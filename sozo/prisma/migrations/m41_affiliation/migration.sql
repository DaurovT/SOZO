-- Принадлежность мастера оператору: причина приостановки и правила.
--
-- Сама таблица была заведена ещё в DEV-02, но кода за ней не стояло: экран
-- U-05 «свои мастера» не делался, потому что оператор не мог владеть
-- мастером. Здесь добавляется то, чего таблице не хватало для работы.

-- Приостановка обязана нести причину. Приостановленный мастер не может
-- выйти на заявку, и человек должен знать, что исправить, — «приостановлен»
-- без объяснения это не решение, а способ его не принимать
ALTER TABLE master_affiliation ADD COLUMN IF NOT EXISTS suspend_reason text;

ALTER TABLE master_affiliation DROP CONSTRAINT IF EXISTS affiliation_suspend_explained;
ALTER TABLE master_affiliation ADD CONSTRAINT affiliation_suspend_explained
  CHECK (status <> 'suspended' OR length(btrim(coalesce(suspend_reason, ''))) > 0);

-- Состояния перечислены: чужое значение молча выключило бы мастера из
-- реестра, и заметили бы это по отсутствию людей на смене
ALTER TABLE master_affiliation DROP CONSTRAINT IF EXISTS affiliation_status_known;
ALTER TABLE master_affiliation ADD CONSTRAINT affiliation_status_known
  CHECK (status IN ('active', 'suspended', 'terminated'));

-- Договор не кончается раньше, чем начался
ALTER TABLE master_affiliation DROP CONSTRAINT IF EXISTS affiliation_period_ordered;
ALTER TABLE master_affiliation ADD CONSTRAINT affiliation_period_ordered
  CHECK (until IS NULL OR until >= since);

-- Ставка неотрицательна: отрицательная себестоимость часа означала бы, что
-- оператор зарабатывает на самом факте выхода мастера
ALTER TABLE master_affiliation DROP CONSTRAINT IF EXISTS affiliation_cost_non_negative;
ALTER TABLE master_affiliation ADD CONSTRAINT affiliation_cost_non_negative
  CHECK (hourly_cost_tiyin >= 0);

-- Один действующий договор на пару «мастер — оператор». Прекращённых может
-- быть сколько угодно: человек уходил и возвращался, и след обоих раз должен
-- остаться
DROP INDEX IF EXISTS master_affiliation_tenant_id_master_id_org_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS affiliation_one_live_idx
  ON master_affiliation (tenant_id, master_id, org_id) WHERE status <> 'terminated';
