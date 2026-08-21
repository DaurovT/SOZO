-- Дети объекта: помещения, зоны, персонал, жители, оборудование, дефекты,
-- замечания. Схема догоняет код.
--
-- Обнаружено при доводке кабинета оператора: паспорт здания оказался пустым
-- на базе, хотя в памяти всё было. Причина — семь коллекций из четырнадцати
-- репозиторий объектов не записывал вовсе, и записать их было нельзя: у пяти
-- моделей схема расходилась с кодом настолько, что запись не собиралась.
--
-- Расхождение не показывал и отчёт `schema:drift` — просто потому, что этих
-- пар в его списке не было. Отчёт отвечал «ноль» на вопрос, которого ему не
-- задавали. Пары добавлены вместе с этой миграцией.
--
-- Практического вреда не случилось: контур «Дом» на проде ещё не наполнен, а
-- в снимке `state.json` было ноль объектов. Но с 21.08 прод работает на базе,
-- и первое же заведённое помещение исчезло бы при перезапуске.

-- 1. Люди опознаются телефоном, а не ссылкой на пользователя.
--    То же решение, что в наряде-допуске (m21): у консьержа, охранника и
--    жителя учётной записи может не быть вовсе, а работать с объектом им
--    нужно. Имя хранится рядом: список персонала читают глазами, и join ради
--    подписи в таблице из десяти строк не окупается.
ALTER TABLE building_staff DROP COLUMN IF EXISTS user_id;
ALTER TABLE building_staff ADD COLUMN IF NOT EXISTS user_phone text NOT NULL DEFAULT '';
ALTER TABLE building_staff ADD COLUMN IF NOT EXISTS full_name text NOT NULL DEFAULT '';

ALTER TABLE unit_resident DROP COLUMN IF EXISTS user_id;
ALTER TABLE unit_resident ADD COLUMN IF NOT EXISTS user_phone text NOT NULL DEFAULT '';
ALTER TABLE unit_resident ADD COLUMN IF NOT EXISTS full_name text NOT NULL DEFAULT '';

-- Житель без телефона не житель: подтверждение проживания и уведомления об
-- отключении идут по нему
ALTER TABLE unit_resident DROP CONSTRAINT IF EXISTS unit_resident_has_phone;
ALTER TABLE unit_resident ADD CONSTRAINT unit_resident_has_phone
  CHECK (length(btrim(user_phone)) > 0);

-- 2. Замечание: зона свободной меткой, автор телефоном.
--    zone_key — не ссылка на общую зону, а метка места: «двор», «подъезд 2».
--    Обход идёт по дому целиком, и половина замечаний не про заведённую зону,
--    а про то, что попалось по дороге. Ссылка отсекла бы ровно их.
ALTER TABLE building_observation ADD COLUMN IF NOT EXISTS zone_key text NOT NULL DEFAULT '';
ALTER TABLE building_observation DROP COLUMN IF EXISTS author_user_id;
ALTER TABLE building_observation ADD COLUMN IF NOT EXISTS author_phone text NOT NULL DEFAULT '';

-- Маршрут, предложенный категорией (A-44). Отдельно от routed_to: одно —
-- предложение справочника, другое — решение человека, и слив их в одну
-- колонку означал бы, что предложение выдаётся за решение
ALTER TABLE building_observation ADD COLUMN IF NOT EXISTS suggested_route text NOT NULL DEFAULT 'journal';

-- Кто присоединился к замечанию: жители жалуются на одно и то же, и десять
-- обращений об одной луже должны быть одним замечанием с десятью голосами,
-- а не десятью замечаниями
ALTER TABLE building_observation ADD COLUMN IF NOT EXISTS joined_by text[] NOT NULL DEFAULT '{}';

-- 3. Дефект: объект, а не точка B2B.
--    Модель из DEV-02 описывала дефект акта осмотра B2B — с ссылкой на
--    location и оценкой из релиза прайса. Дефект контура «Дом» другой: он про
--    здание, находится на обходе, имеет срок и ответственного, и решение по
--    нему принимает оператор, а не подрядчик.
ALTER TABLE defect ADD COLUMN IF NOT EXISTS building_id uuid REFERENCES building (id);
ALTER TABLE defect ADD COLUMN IF NOT EXISTS common_zone_id uuid;
ALTER TABLE defect ADD COLUMN IF NOT EXISTS equipment_id uuid;
ALTER TABLE defect ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT '';
ALTER TABLE defect ADD COLUMN IF NOT EXISTS severity text NOT NULL DEFAULT 'substantial';
ALTER TABLE defect ADD COLUMN IF NOT EXISTS estimated_cost_tiyin bigint NOT NULL DEFAULT 0;
ALTER TABLE defect ADD COLUMN IF NOT EXISTS deadline timestamptz;
ALTER TABLE defect ADD COLUMN IF NOT EXISTS responsible text;
ALTER TABLE defect ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'walkthrough';
-- Замечание, из которого вырос дефект: по нему видно, что обход не прошёл
-- впустую
ALTER TABLE defect ADD COLUMN IF NOT EXISTS observation_id uuid;
ALTER TABLE defect ADD COLUMN IF NOT EXISTS decision text;
ALTER TABLE defect ADD COLUMN IF NOT EXISTS decision_reason text;
ALTER TABLE defect ADD COLUMN IF NOT EXISTS decision_by text;
ALTER TABLE defect ADD COLUMN IF NOT EXISTS decision_at timestamptz;

-- location_id был обязательным: дефект дома точки B2B не имеет
ALTER TABLE defect ALTER COLUMN location_id DROP NOT NULL;

ALTER TABLE defect DROP CONSTRAINT IF EXISTS defect_cost_non_negative;
ALTER TABLE defect ADD CONSTRAINT defect_cost_non_negative CHECK (estimated_cost_tiyin >= 0);

-- Отложенный дефект обязан иметь срок: «потом» без даты — это не решение,
-- а способ не принимать его
ALTER TABLE defect DROP CONSTRAINT IF EXISTS defect_postponed_has_deadline;
ALTER TABLE defect ADD CONSTRAINT defect_postponed_has_deadline
  CHECK (decision <> 'postponed' OR deadline IS NOT NULL);

CREATE INDEX IF NOT EXISTS defect_building_idx ON defect (tenant_id, building_id, status);
CREATE INDEX IF NOT EXISTS building_observation_zone_idx ON building_observation (tenant_id, building_id, status);
CREATE INDEX IF NOT EXISTS building_staff_phone_idx ON building_staff (tenant_id, user_phone);
CREATE INDEX IF NOT EXISTS unit_resident_phone_idx ON unit_resident (tenant_id, user_phone);

-- 4. У дефекта два жизненных цикла, и это не небрежность.
--
-- Перечень статусов описывал дефект акта осмотра B2B: найден → на
-- согласовании у клиента → согласован либо отложен либо отклонён → устранён.
-- Там решение принимает заказчик, и «на согласовании» — обязательный этап.
--
-- У дефекта дома заказчика нет. Его находят на обходе, оператор решает сам,
-- и путь короче: открыт → в работе → устранён. Втискивать его в чужой
-- перечень значило бы, что половина статусов у половины дефектов
-- бессмысленна, а отчёты по ним не складываются.
ALTER TYPE "DefectStatus" ADD VALUE IF NOT EXISTS 'open';
ALTER TYPE "DefectStatus" ADD VALUE IF NOT EXISTS 'in_progress';
ALTER TYPE "DefectStatus" ADD VALUE IF NOT EXISTS 'fixed';
