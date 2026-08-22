-- Доставка push: токены устройств и журнал доставки (ТЗ §11, DEV-13 п.24).
--
-- До сих пор уведомление существовало только как строка ленты: событие
-- записывалось, и увидеть его мог тот, кто сам открыл приложение. Оффер на
-- шестьдесят секунд при таком порядке не работает вовсе — мастер узнаёт о
-- заявке, когда она уже ушла другому. Эти две таблицы — то, чего не хватало
-- каналу, чтобы событие доходило до человека.

CREATE TABLE IF NOT EXISTS device_token (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL,
  -- Уникален сам токен, а не пара «человек + приложение». FCM возвращает тот
  -- же токен переустановленному приложению: если телефон сменил владельца,
  -- строка обязана переехать, иначе прежний хозяин продолжит получать чужие
  -- заявки
  token        text NOT NULL UNIQUE,
  app          text NOT NULL,
  platform     text NOT NULL,
  phone        text NOT NULL,
  locale       text NOT NULL DEFAULT 'ru',
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Приложения ровно два, и deep-link у них разный: чужое значение означало бы
-- ссылку sozo-master:// в телефоне клиента — тап в никуда
ALTER TABLE device_token DROP CONSTRAINT IF EXISTS device_token_app_known;
ALTER TABLE device_token ADD CONSTRAINT device_token_app_known
  CHECK (app IN ('client', 'master'));

ALTER TABLE device_token DROP CONSTRAINT IF EXISTS device_token_platform_known;
ALTER TABLE device_token ADD CONSTRAINT device_token_platform_known
  CHECK (platform IN ('android', 'ios', 'web'));

-- Адресат — телефон, как и везде в системе: учётной записи у клиента B2C
-- может не быть вовсе, а телефон есть всегда
ALTER TABLE device_token DROP CONSTRAINT IF EXISTS device_token_phone_present;
ALTER TABLE device_token ADD CONSTRAINT device_token_phone_present
  CHECK (length(btrim(phone)) > 0);

-- Рассылка идёт от адресата к живым токенам — этот индекс её и обслуживает
CREATE INDEX IF NOT EXISTS device_token_subject_idx
  ON device_token (tenant_id, phone, app) WHERE revoked_at IS NULL;

-- Чистка мёртвых: телефон, не подтверждавший токен полгода, — не адресат,
-- а лишний запрос при каждой рассылке
CREATE INDEX IF NOT EXISTS device_token_last_seen_idx
  ON device_token (tenant_id, last_seen_at);

CREATE TABLE IF NOT EXISTS push_delivery (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL,
  event        text NOT NULL,
  phone        text NOT NULL,
  app          text NOT NULL,
  channel      text NOT NULL,
  status       text NOT NULL,
  detail       text,
  order_id     uuid,
  attempts     integer NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Пишется и успех, и отказ. По журналу без успешных строк неразличимы два
-- разных случая — «не дошло» и «не отправлялось», — а виноваты в них разные
-- люди и чинятся они по-разному
ALTER TABLE push_delivery DROP CONSTRAINT IF EXISTS push_delivery_status_known;
ALTER TABLE push_delivery ADD CONSTRAINT push_delivery_status_known
  CHECK (status IN ('sent', 'failed', 'skipped'));

ALTER TABLE push_delivery DROP CONSTRAINT IF EXISTS push_delivery_channel_known;
ALTER TABLE push_delivery ADD CONSTRAINT push_delivery_channel_known
  CHECK (channel IN ('push', 'sms_fallback', 'none'));

-- Частотный потолок (ТЗ §17.12: сервисное касание не чаще одного в две
-- недели) считается по этому индексу: «когда этому человеку последний раз
-- отправляли». По ленте клиента его не посчитать — она вычисляется из
-- заявок и об отправленном не знает ничего
CREATE INDEX IF NOT EXISTS push_delivery_subject_idx
  ON push_delivery (tenant_id, phone, created_at DESC);

CREATE INDEX IF NOT EXISTS push_delivery_event_idx
  ON push_delivery (tenant_id, event, created_at DESC);

-- RLS здесь намеренно не включается. Изоляция арендаторов в этой базе пока
-- живёт только в контуре «Дом» (m7_buildings_rls, девять таблиц); все
-- платформенные таблицы — master_notification, login_event, order —
-- разделяются по tenant_id в коде. Включить политику на двух новых таблицах
-- в отрыве от остальных значило бы получить ровно тот отказ, о котором
-- предупреждает README миграций: запрос вне транзакции вернёт пусто, и
-- выглядеть это будет как «пуши перестали приходить», а не как изоляция.
-- Обе таблицы войдут в общий заход по RLS вместе с остальной платформой.
