#!/bin/zsh
# Сборка приложения мастера на подключённый iPhone.
#
# Адрес сервера зашивается в сборку: телефон не знает, что такое localhost,
# а набирать IP руками на экране входа каждый раз — лишний шаг.
set -e
cd "$(dirname "$0")"

API_HOST="${1:-$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)}"
if [ -z "$API_HOST" ]; then
  echo "Не удалось определить IP в Wi-Fi. Запустите так: ./build-iphone.sh 192.168.0.147"
  exit 1
fi
API="http://${API_HOST}:3000"

echo "▸ Проверяю, что сервер отвечает по сети: $API"
if ! curl -sf -o /dev/null "$API/v1/health"; then
  echo "  Сервер недоступен по $API"
  echo "  Запустите его из корня монорепозитория: node apps/api/dist/main.js"
  exit 1
fi
echo "  сервер на связи"

echo "\n▸ Ищу подключённый iPhone"
DEVICE=$(flutter devices --machine 2>/dev/null | node -e "
let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{
  const d=JSON.parse(s);
  const ios=d.find(x=>x.targetPlatform&&x.targetPlatform.startsWith('ios')&&x.emulator===false);
  console.log(ios?ios.id:'');
});")
if [ -z "$DEVICE" ]; then
  echo "  iPhone не найден. Подключите кабелем, разблокируйте и нажмите «Доверять этому компьютеру»."
  exit 1
fi
echo "  найден: $DEVICE"

echo "\n▸ Собираю и ставлю на телефон"
flutter run \
  --release \
  -d "$DEVICE" \
  --dart-define=SOZO_API="$API" \
  --dart-define=SOZO_VERSION=1.0.0
