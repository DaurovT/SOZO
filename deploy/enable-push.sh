#!/usr/bin/env bash
#
# Включение push-уведомлений (FCM).
#
# Отдельный скрипт по той же причине, что и у SMS: включение состоит из
# нескольких шагов, и пропуск любого даёт систему, которая выглядит рабочей и
# молчит. Ключ без перезапуска не читается; перезапуск без ключа оставляет
# журнальный режим, в котором уведомления «отправляются» в лог.
#
# Что нужно приготовить заранее, в консоли Firebase:
#   1. Проект (один на обе платформы).
#   2. Приложения Android: uz.sozo.sozo_client и uz.sozo.sozo_master.
#      Для каждого скачать google-services.json и положить в
#      sozo/apps/<client|master>-app/android/app/ — без файла сборка
#      приложения соберётся, но канал в нём не включится.
#   3. Ключ сервисного аккаунта (Project settings → Service accounts →
#      Generate new private key) — тот самый JSON, который передаётся сюда.
#
#   sudo deploy/enable-push.sh /путь/к/service-account.json
#
set -euo pipefail

ENV_FILE=/etc/sozo/sozo.env
KEY_SRC="${1:-}"
KEY_DST=/etc/sozo/fcm-service-account.json

if [[ -z "$KEY_SRC" ]]; then
  echo "Нужен файл ключа сервисного аккаунта Firebase:"
  echo "  sudo $0 /путь/к/service-account.json"
  exit 1
fi

if [[ ! -r "$KEY_SRC" ]]; then
  echo "Файл $KEY_SRC не читается"
  exit 1
fi

if [[ ! -w "$ENV_FILE" ]]; then
  echo "Нет доступа к $ENV_FILE — запускать под sudo"
  exit 1
fi

# Ключ — это право рассылать уведомления от имени SOZO всем, у кого стоит
# приложение. Проверяем, что нам дали именно его, до того как класть в
# систему: подпись собирается из этих трёх полей, и без любого из них канал
# молча останется журнальным
for field in project_id client_email private_key; do
  if ! grep -q "\"$field\"" "$KEY_SRC"; then
    echo "В ключе нет поля $field — это не файл сервисного аккаунта Firebase"
    exit 1
  fi
done

PROJECT=$(sed -n 's/.*"project_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$KEY_SRC" | head -1)
echo "Проект Firebase: $PROJECT"

set_var() {
  local key="$1" value="$2"
  if grep -qE "^#?${key}=" "$ENV_FILE"; then
    sed -i -E "s|^#?${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

cp "$ENV_FILE" "${ENV_FILE}.bak.$(date +%Y%m%d%H%M%S)"

# Ключ кладём файлом, а не в переменную окружения: содержимое переменных
# видно в `docker inspect` и в списке процессов, а это приватный ключ.
#
# Владелец — тот пользователь, под которым работает сервис, а не root.
# Файл с правами 600 и владельцем root читается только root'ом, а сервис
# запущен от обычного пользователя: ключ лежал бы на месте, права выглядели
# бы образцово, и канал молча остался бы журнальным с EACCES в логе.
SERVICE_USER=$(systemctl show sozo-api -p User --value)
SERVICE_USER=${SERVICE_USER:-azureuser}
install -m 600 -o "$SERVICE_USER" -g "$SERVICE_USER" "$KEY_SRC" "$KEY_DST"
set_var PUSH_PROVIDER fcm
set_var PUSH_FCM_CREDENTIALS "$KEY_DST"

systemctl restart sozo-api

# Ждём, пока сервис действительно поднимется. Трёх секунд не хватает: старт
# занимает больше десяти, и проверка успевала прочитать журнал прошлого
# запуска — то есть сообщала об отказе там, где всё было в порядке
for _ in $(seq 1 20); do
  sleep 2
  systemctl is-active --quiet sozo-api && curl -sf -o /dev/null http://127.0.0.1:3000/v1/health && break
done

# Сервер объявляет режим канала при старте — по журналу видно, прочитан ли
# ключ. Молчаливый откат в журнальный режим здесь самый вероятный исход.
#
# Journald принимает записи с задержкой в несколько секунд, и здоровый
# сервер отвечает раньше, чем его собственная строка доезжает до журнала.
# Поэтому ждём саму строку, а не момент готовности: без этого скрипт
# сообщал об отказе там, где канал уже работал, — и это хуже, чем молчание,
# потому что после такого сообщения ключ идут перевыпускать.
#
# Журнал читается в переменную, а не через конвейер в grep. Причина не в
# красоте: при `set -o pipefail` связка `journalctl | grep -q` возвращает
# ошибку ровно тогда, когда строка НАЙДЕНА — grep выходит по первому
# совпадению, journalctl получает SIGPIPE и падает с 141, и статус всего
# конвейера становится ненулевым. Проверка сообщала об отказе именно в
# успешном случае.
ACCEPTED=0
for _ in $(seq 1 10); do
  LOG=$(journalctl -u sozo-api --no-pager --since '3 min ago' 2>/dev/null || true)
  if grep -q 'Push уходят через FCM' <<< "$LOG"; then
    ACCEPTED=1
    break
  fi
  sleep 2
done

if [[ $ACCEPTED -eq 1 ]]; then
  echo "Ключ принят: уведомления уходят через FCM, проект $PROJECT."
else
  echo "Ключ НЕ принят — канал остался журнальным. Смотрите причину:"
  echo "  journalctl -u sozo-api -n 40 --no-pager | grep Push"
  exit 1
fi

echo
echo "Осталось два шага, без них уведомления не дойдут до телефонов:"
echo "  1. google-services.json в обоих приложениях (см. шапку скрипта) и новая сборка."
echo "  2. Люди должны войти в приложение заново — токен устройства"
echo "     регистрируется при входе и при старте с живой сессией."
echo
echo "Проверить доставку: journalctl -u sozo-api -f | grep Push"
echo "Что кому ушло:      GET /v1/devices/deliveries под токеном человека"
