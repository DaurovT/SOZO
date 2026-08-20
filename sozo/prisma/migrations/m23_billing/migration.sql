-- Биллинг: проводки, счета, закрытые периоды.
--
-- Главное отличие от всех предыдущих переносов: журнал проводок append-only
-- (ТЗ 8.1 — правка задним числом запрещена, исправление только сторно).
-- Значит и форма записи другая: не «переписать всё, что в памяти», а вставить
-- то, чего в базе ещё нет. Переписывание здесь было бы прямым нарушением
-- инварианта, ради которого журнал и существует.

-- 1. Проводка знает мастера и несёт пояснение.
--    master_id — text и без внешнего ключа, по той же причине, что в наряде:
--    доли и удержания считаются и штатному мастеру оператора, у которого
--    карточки в masters нет. Пояснение — часть проводки, а не журнала
--    аудита: по нему бухгалтер понимает основание, не выходя из ведомости.
ALTER TABLE transaction ADD COLUMN IF NOT EXISTS master_id text;
ALTER TABLE transaction ADD COLUMN IF NOT EXISTS comment text;

-- Сумма проводки строго положительна: направление задаётся счетами дебета и
-- кредита, а отрицательная сумма означала бы второй, необъявленный способ
-- сказать то же самое — и разошлась бы с ним в первом же отчёте.
ALTER TABLE transaction DROP CONSTRAINT IF EXISTS transaction_amount_positive;
ALTER TABLE transaction ADD CONSTRAINT transaction_amount_positive CHECK (amount_tiyin > 0);

-- Дебет и кредит одной проводки не могут совпадать: такая запись не двигает
-- ничего и лишь имитирует движение денег
ALTER TABLE transaction DROP CONSTRAINT IF EXISTS transaction_sides_differ;
ALTER TABLE transaction ADD CONSTRAINT transaction_sides_differ
  CHECK (debit_account_id <> credit_account_id);

-- 2. Счёт — бухгалтерский факт, а не витрина справочника.
--    Название организации, ставка НДС и дата оплаты пишутся при выставлении
--    и больше не пересчитываются: организация может перестать быть
--    плательщиком НДС или сменить название, а выставленный счёт от этого
--    не меняется.
ALTER TABLE invoice ADD COLUMN IF NOT EXISTS organization_name text NOT NULL DEFAULT '';
ALTER TABLE invoice ADD COLUMN IF NOT EXISTS paid_at timestamptz;
ALTER TABLE invoice ADD COLUMN IF NOT EXISTS vat_rate_percent int NOT NULL DEFAULT 0;

-- Оплаченный счёт обязан знать, когда оплачен: без даты его нельзя ни
-- разнести по периодам, ни сверить с выпиской
ALTER TABLE invoice DROP CONSTRAINT IF EXISTS invoice_paid_has_date;
ALTER TABLE invoice ADD CONSTRAINT invoice_paid_has_date
  CHECK (status <> 'paid' OR paid_at IS NOT NULL);

-- 3. Закрытый учётный период (A-19).
--    Отдельная таблица, а не флаг у проводки: закрывается период, а не
--    запись, и решение о закрытии — самостоятельное событие с автором и
--    временем. Проводку в закрытый период отклоняет приложение, а признак
--    period_locked у проводки остаётся отметкой на момент записи.
CREATE TABLE IF NOT EXISTS accounting_period (
  tenant_id uuid NOT NULL,
  -- 'YYYY-MM': период закрывается целым месяцем, дробить его нечем
  period    text NOT NULL,
  closed_at timestamptz NOT NULL DEFAULT now(),
  closed_by text,
  PRIMARY KEY (tenant_id, period)
);

ALTER TABLE accounting_period DROP CONSTRAINT IF EXISTS accounting_period_shape;
ALTER TABLE accounting_period ADD CONSTRAINT accounting_period_shape
  CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

ALTER TABLE accounting_period ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS accounting_period_tenant ON accounting_period;
CREATE POLICY accounting_period_tenant ON accounting_period
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
