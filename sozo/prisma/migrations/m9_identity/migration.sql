-- Блокировка с причиной, последний вход и журнал входов.
--
-- Схема знала о блокировке только флаг is_blocked, а сервис хранит время и
-- причину: без них при разборе увольнение и компрометация выглядят одинаково.
-- Журнала входов не было вовсе, хотя он пишется с самого начала — и именно
-- неудачные попытки в нём ценнее всего: серия отказов по чужому номеру
-- означает подбор.

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS blocked_at     timestamptz;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS blocked_reason text;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS last_login_at  timestamptz;

CREATE TABLE IF NOT EXISTS login_event (
  id        uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  phone     text NOT NULL,
  ok        boolean NOT NULL,
  reason    text,
  roles     text[] NOT NULL DEFAULT '{}',
  at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS login_event_tenant_at_idx    ON login_event (tenant_id, at);
CREATE INDEX IF NOT EXISTS login_event_tenant_phone_idx ON login_event (tenant_id, phone);
