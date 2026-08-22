#!/usr/bin/env bash
#
# Диагностика канала push: где именно рвётся цепочка до FCM.
#
# Отказ виден в кабинете как «HTTP 401» и больше никак: журнал доставки хранит
# код, но не объяснение Google. Скрипт проходит тот же путь, что и сервер, и на
# каждом шаге показывает ответ целиком.
#
# Шаги: ключ → обмен на токен доступа → отправка на заведомо неверный адрес.
# Последний шаг важнее, чем кажется: если ключ и права в порядке, FCM отвечает
# 400 или 404 (плохой адрес), и это ЗЕЛЁНЫЙ результат — канал жив, дело было в
# адресате. 401 и 403 означают, что до адресата дело не дошло вовсе.
#
#   sudo deploy/check-push.sh
#
set -euo pipefail

ENV_FILE=/etc/sozo/sozo.env
[[ -r "$ENV_FILE" ]] || { echo "Не читается $ENV_FILE — запускать под sudo"; exit 1; }

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

echo "PUSH_PROVIDER = ${PUSH_PROVIDER:-<не задан>}"
if [[ "${PUSH_PROVIDER:-log}" != "fcm" ]]; then
  echo
  echo "Провайдер не fcm — уведомления пишутся в журнал и никуда не уходят."
  echo "Включается: sudo deploy/enable-push.sh /путь/к/service-account.json"
  exit 1
fi

KEY="${PUSH_FCM_CREDENTIALS:-}"
if [[ -n "${PUSH_FCM_CREDENTIALS_JSON:-}" ]]; then
  KEY=/tmp/fcm-key-check.json
  printf '%s' "$PUSH_FCM_CREDENTIALS_JSON" > "$KEY"
  trap 'rm -f /tmp/fcm-key-check.json' EXIT
fi
[[ -n "$KEY" && -r "$KEY" ]] || { echo "Ключ не найден: PUSH_FCM_CREDENTIALS=${PUSH_FCM_CREDENTIALS:-<пусто>}"; exit 1; }

node - "$KEY" <<'NODE'
const { readFileSync } = require('node:fs');
const { createSign } = require('node:crypto');

const key = JSON.parse(readFileSync(process.argv[2], 'utf8'));
console.log(`Проект в ключе:   ${key.project_id}`);
console.log(`Сервисный аккаунт: ${key.client_email}`);
console.log();

const now = Math.floor(Date.now() / 1000);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const body = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
  iss: key.client_email,
  scope: 'https://www.googleapis.com/auth/firebase.messaging',
  aud: 'https://oauth2.googleapis.com/token',
  iat: now,
  exp: now + 3600,
})}`;
const signer = createSign('RSA-SHA256');
signer.update(body);
const assertion = `${body}.${signer.sign(key.private_key, 'base64url')}`;

(async () => {
  const t = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });
  const tb = await t.text();
  console.log(`1. Обмен ключа на токен: HTTP ${t.status}`);
  if (!t.ok) {
    console.log(tb.slice(0, 500));
    console.log('\nКлюч отвергнут Google. Обычные причины: аккаунт удалён,');
    console.log('ключ отозван, или на сервере сбиты часы (JWT не проходит по времени).');
    process.exit(1);
  }
  const access = JSON.parse(tb).access_token;
  console.log('   ключ принят, токен получен\n');

  // Заведомо неверный адрес устройства: проверяем право отправлять, а не доставку
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${key.project_id}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { token: 'ЗАВЕДОМО-НЕВЕРНЫЙ-АДРЕС', notification: { title: 'проверка', body: 'проверка' } } }),
  });
  const rb = await r.text();
  console.log(`2. Отправка в проект ${key.project_id}: HTTP ${r.status}`);
  console.log(rb.slice(0, 700));
  console.log();

  if (r.status === 400 || r.status === 404) {
    console.log('ИТОГ: канал исправен. FCM отверг только выдуманный адрес устройства —');
    console.log('значит ключ, права и проект в порядке.');
  } else if (r.status === 401) {
    console.log('ИТОГ: токен получен, но FCM его не принимает.');
    console.log('Чаще всего — Firebase Cloud Messaging API не включён в проекте:');
    console.log(`  https://console.cloud.google.com/apis/library/fcm.googleapis.com?project=${key.project_id}`);
  } else if (r.status === 403) {
    console.log('ИТОГ: у сервисного аккаунта нет прав на рассылку в этом проекте.');
    console.log('Нужна роль Firebase Cloud Messaging API Admin в IAM проекта.');
  } else {
    console.log('ИТОГ: неожиданный ответ — смотрите текст выше.');
  }
})();
NODE

echo
echo "Что говорил сам сервер в последних отказах:"
journalctl -u sozo-api --no-pager -n 3000 2>/dev/null | grep -A 20 -E "FCM отказал|Push уходят|FCM недоступен" | tail -40 \
  || echo "  (записей не нашлось — служба называется иначе, проверьте systemctl list-units | grep sozo)"
