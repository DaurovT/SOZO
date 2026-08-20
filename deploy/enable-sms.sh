#!/usr/bin/env bash
#
# Включение SMS-провайдера (Eskiz).
#
# Отдельный скрипт, а не инструкция в README: включение состоит из четырёх
# шагов, и пропуск последнего — самый вероятный исход. Выключить dev-код,
# забыв вписать ключи, значит закрыть вход всем; вписать ключи, забыв
# выключить dev-код, значит платить за SMS и оставить дыру открытой.
#
#   sudo deploy/enable-sms.sh <почта> <пароль> [альфа-номер]
#
set -euo pipefail

ENV_FILE=/etc/sozo/sozo.env
EMAIL="${1:-}"
PASSWORD="${2:-}"
FROM="${3:-4546}"

if [[ -z "$EMAIL" || -z "$PASSWORD" ]]; then
  echo "Нужны почта и пароль из кабинета notify.eskiz.uz:"
  echo "  sudo $0 robot@sozo.uz 'пароль' [альфа-номер]"
  exit 1
fi

if [[ ! -w "$ENV_FILE" ]]; then
  echo "Нет доступа к $ENV_FILE — запускать под sudo"
  exit 1
fi

set_var() {
  local key="$1" value="$2"
  # Строка может быть закомментирована — снимаем комментарий вместе с заменой
  if grep -qE "^#?${key}=" "$ENV_FILE"; then
    sed -i -E "s|^#?${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

cp "$ENV_FILE" "${ENV_FILE}.bak.$(date +%Y%m%d%H%M%S)"

set_var SMS_PROVIDER eskiz
set_var SMS_ESKIZ_EMAIL "$EMAIL"
set_var SMS_ESKIZ_PASSWORD "$PASSWORD"
set_var SMS_ESKIZ_FROM "$FROM"

echo "Ключи вписаны. Проверяю отправку до того, как закрывать вход по dev-коду."
systemctl restart sozo-api
sleep 3

# Проверка настоящей отправкой на номер владельца: если поставщик не примет
# сообщение, dev-код останется включённым и вход не сломается
read -rp "Номер для проверочной SMS (+998...): " TEST_PHONE
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:3000/v1/auth/request-otp \
  -H 'content-type: application/json' -d "{\"phone\":\"${TEST_PHONE}\"}")

if [[ "$CODE" != "200" && "$CODE" != "201" ]]; then
  echo "Отправка не удалась (HTTP $CODE). Вход по dev-коду НЕ выключен."
  echo "Журнал:  journalctl -u sozo-api -n 40 --no-pager"
  exit 1
fi

echo "Сообщение принято поставщиком. Пришло ли оно на $TEST_PHONE?"
read -rp "Введите y, если SMS получена: " GOT
if [[ "$GOT" != "y" ]]; then
  echo "Вход по dev-коду оставлен включённым: без доставки выключать его нельзя."
  exit 1
fi

set_var ALLOW_DEV_OTP 0
systemctl restart sozo-api
sleep 3
curl -s http://127.0.0.1:3000/v1/health | head -c 200
echo
echo "Готово: коды уходят через Eskiz, вход по «пяти нулям» закрыт."
