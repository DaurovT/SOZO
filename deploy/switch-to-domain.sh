#!/usr/bin/env bash
#
# Переключение на домен с поддоменами. Порядок здесь важен, поэтому скрипт,
# а не список шагов в голове:
#
#   1. убедиться, что DNS уже указывает на эту машину — иначе certbot
#      потратит попытку и упрётся в лимит Let's Encrypt;
#   2. поднять временный HTTP-конфиг: сертификата ещё нет, а блок с
#      ssl_certificate на несуществующий файл не даст nginx стартовать;
#   3. выпустить сертификат сразу на все имена, которые резолвятся;
#   4. вернуть панели в корень своих хостов (подпути были обходом
#      закрытых портов) и разложить боевой конфиг;
#   5. переписать адреса и пересобрать.
#
#   ./deploy/switch-to-domain.sh sozo.uz
#
set -euo pipefail
DOMAIN="${1:?Укажите домен: ./deploy/switch-to-domain.sh sozo.uz}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IP="$(curl -s --max-time 10 https://api.ipify.org || true)"
# Корень и www — лендинг и веб-карточка; поддомены — API и панели
NAMES=("$DOMAIN" "www.$DOMAIN" "api.$DOMAIN" "admin.$DOMAIN" "dispatch.$DOMAIN")
# Имена, без которых система работает: презентация продукта. Если записи нет,
# имя молча выпадает из сертификата, а не роняет весь переезд. Перечислять его
# здесь обязательно: certbot с --cert-name выпускает ровно тот список, который
# ему дали, поэтому забытое имя тихо пропадёт из сертификата при следующем
# запуске — и TLS на нём сломается.
OPTIONAL=("deck.$DOMAIN")

echo "== 1. Проверка DNS (адрес машины: ${IP:-неизвестен})"
# Спрашиваем авторитетные серверы, а не локальный резолвер: у записи TTL
# в часы, и кэш будет отдавать старый адрес ещё долго после правки. Let's
# Encrypt резолвит рекурсивно от корня, то есть видит именно авторитетный ответ.
AUTH_NS="$(dig +short NS "$DOMAIN" | head -1)"
[ -z "$AUTH_NS" ] && { echo "  ✗ не нашёл NS для $DOMAIN"; exit 1; }
echo "  авторитетный сервер: $AUTH_NS"
for n in "${NAMES[@]}"; do
  got="$(dig +short "@$AUTH_NS" "$n" A | tail -1)"
  if [ -z "$got" ]; then echo "  ✗ $n не резолвится на $AUTH_NS — добавьте запись"; exit 1; fi
  if [ -n "$IP" ] && [ "$got" != "$IP" ]; then echo "  ✗ $n → $got, а машина $IP"; exit 1; fi
  echo "  ✓ $n → $got"
done
for n in "${OPTIONAL[@]}"; do
  got="$(dig +short "@$AUTH_NS" "$n" A | tail -1)"
  if [ -z "$got" ] || { [ -n "$IP" ] && [ "$got" != "$IP" ]; }; then
    echo "  ~ $n не указывает сюда — пропускаю, сертификат выпущу без него"
    continue
  fi
  echo "  ✓ $n → $got"; NAMES+=("$n")
done

echo "== 2. Временный HTTP-конфиг для проверки Let's Encrypt"
sudo mkdir -p /var/www/html
sudo tee /etc/nginx/sites-available/sozo >/dev/null <<EOF
server {
    listen 80 default_server;
    server_name ${NAMES[*]};
    location ^~ /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 503; }
}
EOF
sudo ln -sf /etc/nginx/sites-available/sozo /etc/nginx/sites-enabled/sozo
sudo nginx -t >/dev/null && sudo systemctl reload nginx && echo "  ✓ nginx принял"

echo "== 3. Сертификат на все имена, которые резолвятся"
sudo certbot certonly --webroot -w /var/www/html \
  --cert-name "api.$DOMAIN" \
  $(printf -- '-d %s ' "${NAMES[@]}") \
  --expand --non-interactive --agree-tos --register-unsafely-without-email --keep-until-expiring
echo "  ✓ выпущен"

echo "== 4. Панели возвращаются в корень своих хостов"
python3 - "$ROOT/sozo/apps" <<'PY'
import pathlib, re, sys
apps = pathlib.Path(sys.argv[1])
for app in ('admin-web', 'dispatcher-web'):
    v = apps / app / 'vite.config.ts'
    s = v.read_text()
    s2 = re.sub(r"\n  // Панель живёт подпутём[^\n]*\n  // отдельные порты[^\n]*\n  base: '[^']*',", '', s)
    s2 = re.sub(r"\n\s*base: '/(admin|dispatch)/',", '', s2)
    if s2 != s: v.write_text(s2); print(f'  ✓ {app}/vite.config.ts: base убран')
    a = apps / app / 'src/App.tsx'
    s = a.read_text()
    s2 = s.replace('<BrowserRouter basename={import.meta.env.BASE_URL}>', '<BrowserRouter>')
    if s2 != s: a.write_text(s2); print(f'  ✓ {app}/src/App.tsx: basename убран')
PY

echo "== 5. Боевой конфиг nginx"
sudo sed -e "s|__DOMAIN__|$DOMAIN|g" -e "s|__CERT__|api.$DOMAIN|g" \
  "$ROOT/deploy/nginx-subdomains.conf.template" | sudo tee /etc/nginx/sites-available/sozo >/dev/null
sudo nginx -t && sudo systemctl reload nginx && echo "  ✓ конфиг применён"

echo "== 6. Адреса и пересборка"
"$ROOT/deploy/set-address.sh" "$DOMAIN"

echo "== 7. Проверка"
CHECK=("https://$DOMAIN/" "https://api.$DOMAIN/v1/health" "https://admin.$DOMAIN/" "https://dispatch.$DOMAIN/")
printf '%s\n' "${NAMES[@]}" | grep -qx "deck.$DOMAIN" && CHECK+=("https://deck.$DOMAIN/")
for u in "${CHECK[@]}"; do
  printf "  %-40s " "$u"; curl -s -o /dev/null -w "HTTP %{http_code}\n" --max-time 15 "$u"
done
