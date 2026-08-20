-- Карточка мастера: поля и связь с пользователем.
--
-- Главное здесь — решение, а не колонки. user_id был обязательным и
-- уникальным, то есть карточка не могла существовать без пользователя. Но
-- мастер заводится в воронке онбординга задолго до первого входа: кандидат
-- проходит проверку документов и обучение, и требовать для него учётную
-- запись значило бы создавать людей, которые никогда не входили — они
-- засоряли бы журнал входов и матрицу ролей.
--
-- Поэтому связь становится необязательной, а рабочим ключом остаётся
-- телефон: именно по нему выдаётся роль master при входе (PRD-02 §2).
--
-- Остальное поделено по правилу DEV-02: имя, телефон, транспорт, рефералка
-- и причина ухода — колонки, по ним ищут и отчитываются; экзамены,
-- документы, последняя геопозиция и офлайн-очередь — jsonb, по ним не ищут.

ALTER TABLE master_profile ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE master_profile ADD COLUMN IF NOT EXISTS phone                  text NOT NULL DEFAULT '';
ALTER TABLE master_profile ADD COLUMN IF NOT EXISTS full_name              text NOT NULL DEFAULT '';
ALTER TABLE master_profile ADD COLUMN IF NOT EXISTS transport              text;
ALTER TABLE master_profile ADD COLUMN IF NOT EXISTS referrer_name          text;
ALTER TABLE master_profile ADD COLUMN IF NOT EXISTS referrer_code          text;
ALTER TABLE master_profile ADD COLUMN IF NOT EXISTS referral_bonus_paid_at timestamptz;
ALTER TABLE master_profile ADD COLUMN IF NOT EXISTS offboarding_note       text;

ALTER TABLE master_profile ADD COLUMN IF NOT EXISTS skill_exams_json   jsonb;
ALTER TABLE master_profile ADD COLUMN IF NOT EXISTS documents_json     jsonb;
ALTER TABLE master_profile ADD COLUMN IF NOT EXISTS last_geo_json      jsonb;
ALTER TABLE master_profile ADD COLUMN IF NOT EXISTS offline_queue_json jsonb;

-- Телефон — рабочий ключ поиска мастера, он же связывает вход с карточкой
CREATE UNIQUE INDEX IF NOT EXISTS master_profile_tenant_phone_idx ON master_profile (tenant_id, phone);

-- Долг по наличным не бывает отрицательным: правило жило только в коде
ALTER TABLE master_profile DROP CONSTRAINT IF EXISTS master_cash_debt_non_negative;
ALTER TABLE master_profile ADD CONSTRAINT master_cash_debt_non_negative CHECK (cash_debt_tiyin >= 0);

-- Зоны мастера — названия районов, а не ссылки.
--
-- В схеме стоял массив uuid, но справочника зон как сущности не существует:
-- и распределение, и карточка оперируют строками «Чиланзар», «Яккасарай».
-- Запись падала на разборе uuid. Тип приведён к реальности; появится
-- справочник — будет отдельная миграция со связью.
ALTER TABLE master_profile ALTER COLUMN zone_ids TYPE text[] USING zone_ids::text[];
