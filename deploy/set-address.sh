#!/usr/bin/env bash
#
# Единая точка смены внешнего адреса SOZO.
#
# Адрес сервера зашит в шести местах: два Flutter-приложения, три .env веб-панелей
# и ссылка из админки в диспетчерскую, плюс список CORS на сервере. Менять их
# руками по одному — гарантированный способ забыть одно и получить приложение,
# которое молча ходит в localhost. Поэтому только этот скрипт.
#
# Две раскладки:
#
#   ./deploy/set-address.sh sozo.uz
#       поддомены: api.sozo.uz, admin.sozo.uz, dispatch.sozo.uz — рабочий вариант
#
#   ./deploy/set-address.sh 20-52-250-154.sslip.io --single https
#       один хост, панели подпутями /admin/ и /dispatch/ — запасной вариант для
#       случая, когда поддоменов нет (так жили на голом IP)
#
set -euo pipefail

ADDR="${1:?Укажите домен: ./deploy/set-address.sh sozo.uz [--single [http|https]]}"
LAYOUT="subdomains"
SCHEME="https"
if [ "${2:-}" = "--single" ]; then LAYOUT="single"; SCHEME="${3:-https}"; fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOZO="$ROOT/sozo"

if [ "$LAYOUT" = "subdomains" ]; then
  API_ORIGIN="$SCHEME://api.$ADDR"
  ADMIN_URL="$SCHEME://admin.$ADDR"
  DISPATCH_URL="$SCHEME://dispatch.$ADDR"
else
  API_ORIGIN="$SCHEME://$ADDR"
  ADMIN_URL="$API_ORIGIN/admin/"
  DISPATCH_URL="$API_ORIGIN/dispatch/"
fi
API_BASE="$API_ORIGIN/v1"

echo "Раскладка: $LAYOUT"
echo "  API      $API_BASE"
echo "  админка  $ADMIN_URL"
echo "  диспетч. $DISPATCH_URL"
echo

python3 - "$SOZO" "$API_ORIGIN" "$API_BASE" "$DISPATCH_URL" <<'PY'
import pathlib, re, sys
sozo, origin, base, dispatch = (pathlib.Path(sys.argv[1]),) + tuple(sys.argv[2:])

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
for app in ('admin-web', 'dispatcher-web', 'landing', 'operator-web'):
    d = sozo / f'apps/{app}'
    if not d.is_dir():
        continue
    (d / '.env.production').write_text(f'VITE_API_URL={base}\n')
    print(f'  ok  apps/{app}/.env.production')

# Ссылка «открыть диспетчерскую» из админки
sub('apps/admin-web/src/orderDicts.ts',
    r"(export const DISPATCHER_URL = ')[^']*(';)",
    lambda m: m.group(1) + dispatch + m.group(2),
    'DISPATCHER_URL')
PY

# CORS и публичный адрес на сервере. При поддоменах панели лежат на других
# именах, чем API, — значит запросы кросс-доменные и список обязателен.
if [ -f /etc/sozo/sozo.env ]; then
  sudo sed -i \
    -e "s|^SOZO_PUBLIC_ADDR=.*|SOZO_PUBLIC_ADDR=$ADDR|" \
    -e "s|^CORS_ORIGINS=.*|CORS_ORIGINS=$API_ORIGIN,$ADMIN_URL,$DISPATCH_URL|" \
    /etc/sozo/sozo.env
  echo "  ok  /etc/sozo/sozo.env (CORS)"
fi

echo
echo "Пересборка веб-панелей..."
for app in admin-web dispatcher-web landing operator-web; do
  [ -d "$SOZO/apps/$app" ] || continue
  ( cd "$SOZO/apps/$app" && npm run build >/dev/null 2>&1 ) && echo "  ok  $app" || { echo "  ПАДЕНИЕ: $app"; exit 1; }
done

if systemctl is-active --quiet sozo-api 2>/dev/null; then
  sudo systemctl restart sozo-api && echo "  ok  sozo-api перезапущен"
fi

echo
echo "Готово. Адреса:"
echo "  API и веб-карточка   $API_ORIGIN"
echo "  Админка              $ADMIN_URL"
echo "  Диспетчерская        $DISPATCH_URL"
echo
echo "Наружу нужны порты 80 (редирект и продление сертификата) и 443."
echo "Мобильные приложения пересоберите заново — адрес зашивается при сборке."
