#!/usr/bin/env bash
#
# Поддомен под презентацию продукта: deck.<домен>.
#
# Страница статическая и лежит в репозитории (sozo/apps/deck), сборки ей не
# нужно — вся работа здесь про имя: DNS, сертификат, конфиг nginx.
#
# Порядок важен, и он не тот, что кажется. Certbot подтверждает имя,
# скачивая файл по http://deck.<домен>/.well-known/acme-challenge/... Пока в
# nginx нет блока с этим именем, запрос уходит в default_server, который
# отвечает 444, и проверка падает. Поэтому конфиг раскладывается ДО выпуска
# сертификата, а не после.
#
# Блок на 443 при этом секунду-другую отдаёт старый сертификат, в котором
# нового имени ещё нет: файл существует, nginx стартует, а браузер успел бы
# показать предупреждение — если бы кто-то зашёл именно в эту секунду.
# Это дешевле, чем городить временный конфиг только под проверку.
#
# Запись в DNS должна существовать заранее: иначе попытка сгорит впустую и
# приблизит лимит неудачных проверок Let's Encrypt.
#
# Перед запуском у регистратора должна стоять запись:
#     deck.<домен>   A   <адрес этой машины>
#
#   sudo ./deploy/add-deck.sh sozo.uz
#
set -euo pipefail
DOMAIN="${1:?Укажите домен: ./deploy/add-deck.sh sozo.uz}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IP="$(curl -s --max-time 10 https://api.ipify.org || true)"
NAME="deck.$DOMAIN"
# Сертификат один на все имена. Перечисляем список целиком: certbot с
# --cert-name выпускает ровно то, что ему передали, и пропущенное имя
# молча исчезнет из сертификата.
NAMES=("$DOMAIN" "www.$DOMAIN" "api.$DOMAIN" "admin.$DOMAIN" "dispatch.$DOMAIN" "$NAME")

echo "== 1. Проверка DNS (адрес машины: ${IP:-неизвестен})"
AUTH_NS="$(dig +short NS "$DOMAIN" | head -1)"
[ -z "$AUTH_NS" ] && { echo "  ✗ не нашёл NS для $DOMAIN"; exit 1; }
GOT="$(dig +short "@$AUTH_NS" "$NAME" A | tail -1)"
if [ -z "$GOT" ]; then
  echo "  ✗ $NAME не резолвится на $AUTH_NS."
  echo "    Заведите у регистратора запись:  $NAME  A  ${IP:-<адрес машины>}"
  echo "    и запустите скрипт снова — до этого certbot имя не подтвердит."
  exit 1
fi
if [ -n "$IP" ] && [ "$GOT" != "$IP" ]; then
  echo "  ✗ $NAME → $GOT, а машина $IP"; exit 1
fi
echo "  ✓ $NAME → $GOT"

echo "== 2. Страница на месте"
[ -f "$ROOT/sozo/apps/deck/index.html" ] || { echo "  ✗ нет sozo/apps/deck/index.html"; exit 1; }
echo "  ✓ $(du -sh "$ROOT/sozo/apps/deck" | cut -f1) в sozo/apps/deck"

echo "== 3. Конфиг nginx: имя должно отвечать до проверки"
sudo cp /etc/nginx/sites-available/sozo "/etc/nginx/sites-available/sozo.bak.$(date +%Y%m%d%H%M%S)"
sudo mkdir -p /var/www/html
sudo sed -e "s|__DOMAIN__|$DOMAIN|g" -e "s|__CERT__|api.$DOMAIN|g" \
  "$ROOT/deploy/nginx-subdomains.conf.template" | sudo tee /etc/nginx/sites-available/sozo >/dev/null
sudo nginx -t && sudo systemctl reload nginx && echo "  ✓ применён"
printf "  проверка ACME-пути: "
echo ok | sudo tee /var/www/html/.well-known/acme-challenge/probe >/dev/null 2>&1 || {
  sudo mkdir -p /var/www/html/.well-known/acme-challenge
  echo ok | sudo tee /var/www/html/.well-known/acme-challenge/probe >/dev/null
}
curl -s --max-time 15 "http://$NAME/.well-known/acme-challenge/probe" | grep -qx ok \
  && echo "✓ файл отдаётся" || { echo "✗ не отдаётся — certbot тоже не сможет"; exit 1; }
sudo rm -f /var/www/html/.well-known/acme-challenge/probe

echo "== 4. Сертификат: добавляем имя к существующему"
sudo certbot certonly --webroot -w /var/www/html \
  --cert-name "api.$DOMAIN" \
  $(printf -- '-d %s ' "${NAMES[@]}") \
  --expand --non-interactive --agree-tos --register-unsafely-without-email --keep-until-expiring
sudo systemctl reload nginx
echo "  ✓ имена в сертификате: ${NAMES[*]}"

echo "== 5. Проверка"
for u in "https://$NAME/" "https://$DOMAIN/deck/" "https://$DOMAIN/" "https://api.$DOMAIN/v1/health"; do
  printf "  %-36s " "$u"; curl -s -o /dev/null -w "HTTP %{http_code}\n" --max-time 15 "$u"
done
echo
echo "Готово: https://$NAME"
echo "Страница закрыта от поисковиков заголовком X-Robots-Tag — снять его можно"
echo "в deploy/nginx-subdomains.conf.template, блок «Презентация продукта»."
