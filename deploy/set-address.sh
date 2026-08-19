#!/usr/bin/env bash
#
# Единая точка смены внешнего адреса SOZO.
#
# Адрес сервера зашит в семи местах: два Flutter-приложения, три веб-панели,
# ссылка из админки в диспетчерскую и список CORS на сервере. Менять их руками
# по одному — гарантированный способ забыть одно и получить приложение,
# которое молча ходит в localhost. Поэтому только этот скрипт.
#
#   ./deploy/set-address.sh 20.52.250.154          # по IP, http
#   ./deploy/set-address.sh api.ustapro.uz https   # по домену, https
#
set -euo pipefail

ADDR="${1:?Укажите адрес: ./deploy/set-address.sh <IP-или-домен> [http|https]}"
SCHEME="${2:-http}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOZO="$ROOT/sozo"

API_ORIGIN="$SCHEME://$ADDR"
API_BASE="$API_ORIGIN/v1"
# Панели — подпутями одного порта: наружу открыт только 80,
# отдельные порты 8080/8081 режет NSG Azure
ADMIN_URL="$API_ORIGIN/admin/"
DISPATCH_URL="$API_ORIGIN/dispatch/"

echo "Адрес сервера: $API_ORIGIN"
echo "  API      $API_BASE"
echo "  админка  $ADMIN_URL"
echo "  диспетч. $DISPATCH_URL"
echo

python3 - "$SOZO" "$API_ORIGIN" "$API_BASE" "$DISPATCH_URL" "$ADDR" <<'PY'
import pathlib, re, sys
sozo, origin, base, dispatch, host = (pathlib.Path(sys.argv[1]),) + tuple(sys.argv[2:])

def sub(path, pattern, repl, label):
    p = sozo / path
    src = p.read_text()
    out, n = re.subn(pattern, repl, src, count=1)
    if n != 1:
        raise SystemExit(f'НЕ НАЙДЕНО: {label} в {path} — проверьте, не переехал ли код')
    p.write_text(out)
    print(f'  ok  {path}  ({label})')

# Мобильные: значение по умолчанию, чтобы обычный flutter build без флагов
# уже шёл на боевой сервер. --dart-define по-прежнему перекрывает.
for app in ('client-app', 'master-app'):
    sub(f'apps/{app}/lib/store/session.dart',
        r"(String\.fromEnvironment\('SOZO_API',\s*defaultValue:\s*')[^']*(')",
        lambda m: m.group(1) + origin + m.group(2),
        'SOZO_API по умолчанию')

# Веб-панели: vite подхватывает .env.production при build
for app in ('admin-web', 'dispatcher-web', 'landing'):
    p = sozo / f'apps/{app}/.env.production'
    p.write_text(f'VITE_API_URL={base}\n')
    print(f'  ok  apps/{app}/.env.production')

# Ссылка «открыть диспетчерскую» из админки
sub('apps/admin-web/src/orderDicts.ts',
    r"(export const DISPATCHER_URL = ')[^']*(';)",
    lambda m: m.group(1) + dispatch + m.group(2),
    'DISPATCHER_URL')
PY

# CORS и публичный адрес на сервере
if [ -f /etc/sozo/sozo.env ]; then
  sudo sed -i \
    -e "s|^SOZO_PUBLIC_ADDR=.*|SOZO_PUBLIC_ADDR=$ADDR|" \
    -e "s|^CORS_ORIGINS=.*|CORS_ORIGINS=$API_ORIGIN|" \
    /etc/sozo/sozo.env
  echo "  ok  /etc/sozo/sozo.env (CORS)"
fi

echo
echo "Пересборка веб-панелей..."
for app in admin-web dispatcher-web landing; do
  ( cd "$SOZO/apps/$app" && npm run build >/dev/null 2>&1 ) && echo "  ok  $app" || { echo "  ПАДЕНИЕ: $app"; exit 1; }
done

if systemctl is-active --quiet sozo-api 2>/dev/null; then
  sudo systemctl restart sozo-api && echo "  ok  sozo-api перезапущен"
fi

echo
echo "Готово. Адреса:"
echo "  Лендинг и веб-карточка   $API_ORIGIN"
echo "  Админка                  $ADMIN_URL"
echo "  Диспетчерская            $DISPATCH_URL"
echo "  API                      $API_BASE"
echo
echo "Наружу нужны порты 80 (редирект и продление сертификата) и 443." 
echo
echo "Мобильные приложения пересоберите заново — адрес зашивается при сборке."
