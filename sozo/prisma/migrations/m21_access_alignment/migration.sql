-- Наряд-допуск, пропуск и отключение: схема догоняет код.
--
-- Последнее расхождение из отчёта `npm run schema:drift` — тринадцать полей.
-- Разбирается оно на три разных решения, а не на одно.
--
-- 1. Люди адресуются телефоном, а не uuid.
--    requested_by и approver_user_id были ссылками на user, но наряд просит
--    мастер, а согласует консьерж или инженер объекта — у них нет учётной
--    записи платформы, и записать туда uuid было нечего. Телефон — то же
--    решение, что уже принято в заявке и в мастерах: он и есть личность
--    в этой системе, потому что вход по нему.
ALTER TABLE access_permit DROP COLUMN IF EXISTS requested_by;
ALTER TABLE access_permit ADD COLUMN IF NOT EXISTS requested_by_phone text NOT NULL DEFAULT '';
ALTER TABLE access_permit DROP COLUMN IF EXISTS approver_user_id;
ALTER TABLE access_permit ADD COLUMN IF NOT EXISTS approver_name text;

-- 2. Признаки зон — снимок, а не вычисление.
--    has_critical_zone и has_licensed_zone можно было бы каждый раз считать
--    по zone_types и справочнику зон. Нельзя: они решают, кого пускать
--    (ТЗ 17.8 — лицензируемая зона мастеру платформы запрещена), и решение
--    обязано остаться воспроизводимым, даже если справочник зон потом
--    поменяют. Ровно то же основание, что у счётчиков деградации объекта.
ALTER TABLE access_permit ADD COLUMN IF NOT EXISTS has_critical_zone boolean NOT NULL DEFAULT false;
ALTER TABLE access_permit ADD COLUMN IF NOT EXISTS has_licensed_zone boolean NOT NULL DEFAULT false;

-- 3. Кто идёт по наряду и на каком основании допущен.
--    master_id — колонка, а не связь: штатный мастер оператора карточки
--    в masters не имеет, его допуск декларирует оператор
--    (operator_self_declared, DEV-15 §7.1.2). Внешний ключ отсёк бы ровно
--    тот случай, ради которого поле и заведено.
ALTER TABLE access_permit ADD COLUMN IF NOT EXISTS master_id text;
ALTER TABLE access_permit ADD COLUMN IF NOT EXISTS master_is_platform boolean NOT NULL DEFAULT true;
ALTER TABLE access_permit ADD COLUMN IF NOT EXISTS operator_self_declared boolean NOT NULL DEFAULT false;
ALTER TABLE access_permit ADD COLUMN IF NOT EXISTS qualification_ok boolean NOT NULL DEFAULT false;

-- Допуск возможен по одному из двух оснований, и они исключают друг друга:
-- либо квалификация мастера платформы проверена нами, либо оператор отвечает
-- за своего работника сам. Обоих сразу быть не может — это разные стороны.
ALTER TABLE access_permit DROP CONSTRAINT IF EXISTS permit_single_qualification_basis;
ALTER TABLE access_permit ADD CONSTRAINT permit_single_qualification_basis
  CHECK (NOT (qualification_ok AND operator_self_declared));

-- 4. Гостевой пропуск (C-54): житель зовёт гостя сам.
--    vehicle_plate уже был, но назывался иначе, чем поле кода; issued_by
--    хранил роль («resident»), а нужен телефон выписавшего — иначе по журналу
--    проходов не найти, кто впустил. unit_label держится строкой: пропуск
--    переживает перенумерацию помещений, охране на входе важна та подпись,
--    что напечатана в пропуске.
DO $rename$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'visit_pass' AND column_name = 'vehicle_plate') THEN
    ALTER TABLE visit_pass RENAME COLUMN vehicle_plate TO car_plate;
  END IF;
END $rename$;
ALTER TABLE visit_pass ADD COLUMN IF NOT EXISTS issued_by_phone text;
ALTER TABLE visit_pass ADD COLUMN IF NOT EXISTS unit_label text;

-- 5. Отключение ресурса: две метки, по которым объект получает индикатор.
--    late_notice — публикация позже срока (таймер 62), is_emergency —
--    авария вместо плановых работ. Считать их из времён нельзя: срок
--    публикации у объектов разный и меняется, а метка ставится в момент
--    создания и больше не пересматривается.
ALTER TABLE resource_shutdown ADD COLUMN IF NOT EXISTS late_notice boolean NOT NULL DEFAULT false;
ALTER TABLE resource_shutdown ADD COLUMN IF NOT EXISTS is_emergency boolean NOT NULL DEFAULT false;

-- 6. Пропуск выписывают не только мастеру платформы.
--    master_id был uuid со ссылкой на master_profile, но по типам пропуска
--    (PASS_TYPES) его выписывают подрядчику жителя и работнику оператора —
--    у них карточки мастера нет и не будет. Внешний ключ здесь запрещал бы
--    ровно те пропуска, ради которых заведены их типы. То же решение, что
--    у master_id наряда.
ALTER TABLE visit_pass DROP CONSTRAINT IF EXISTS visit_pass_master_id_fkey;
ALTER TABLE visit_pass ALTER COLUMN master_id TYPE text USING master_id::text;
