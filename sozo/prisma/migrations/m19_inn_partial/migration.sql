-- ИНН уникален, только когда он есть.
--
-- Ограничение стояло на (tenant_id, inn) целиком, и второй оператор с пустым
-- ИНН упирался в него. Но пустой ИНН — это не значение, а его отсутствие:
-- организация-оператор заводится заявкой на подключение, а реквизиты
-- заполняет админ позже, и до тех пор таких организаций может быть сколько
-- угодно. Выдумывать ИНН за оператора нельзя — по нему выставляют счета.
--
-- Уникальность настоящих ИНН при этом сохраняется полностью.

ALTER TABLE organization DROP CONSTRAINT IF EXISTS organization_tenant_id_inn_key;
DROP INDEX IF EXISTS organization_tenant_id_inn_key;

CREATE UNIQUE INDEX IF NOT EXISTS organization_tenant_inn_idx
  ON organization (tenant_id, inn) WHERE inn <> '';
