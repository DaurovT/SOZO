#!/usr/bin/env bash
#
# Переключение прода с state.json на PostgreSQL.
#
# Порядок здесь не украшение. Сервис останавливается ДО снятия снимка, иначе
# он допишет файл посреди чтения и в базу уедет полуснимок. Приёмка идёт ДО
# переключения, а не после: разошедшиеся данные надо увидеть, пока прод ещё
# работает на файле и откат стоит одну строку в конфиге.
#
# Файл после переноса не удаляется и не переименовывается: девятнадцать
# разделов состояния таблиц не имеют и продолжают жить в нём.
#
#   sudo deploy/switch-to-postgres.sh [--skip-conflicts]
#
set -euo pipefail

ROOT=/home/azureuser/SOZO/sozo
ENV_FILE=/etc/sozo/sozo.env
STATE=/var/lib/sozo/state.json
DB_NAME=sozo
# Приложение ходит в базу ролью sozo_app, а не владельцем.
#
# Владелец `sozo` — суперпользователь, а суперпользователь обходит RLS
# целиком: политики на него не действуют, и FORCE тоже. Пока прод подключался
# владельцем, изоляция арендаторов была написана, объявлена в документации и
# не работала ни секунды. Пароль генерируется здесь и живёт только в
# /etc/sozo/sozo.env.
APP_PASSWORD=$(head -c 24 /dev/urandom | base64 | tr -d '/+=' | head -c 24)
DB_URL="postgresql://sozo_app:${APP_PASSWORD}@127.0.0.1:5432/${DB_NAME}"
STAMP=$(date +%Y%m%d%H%M%S)
SNAPSHOT="/var/lib/sozo/state.pre-pg.${STAMP}.json"
# Как разрешать конфликты снимка со схемой. Умолчание — ничего не терять:
# повторяющийся ИНН обнуляется, организация и её точки остаются, заявки на
# них не повисают. Настоящий ИНН вписывается потом руками.
# Два разных решения, и путать их нельзя.
#
# --recreate-db — про пустоту целевой базы; всё остальное — про то, как
# разрешать конфликты снимка со схемой. В первой версии они жили в одной
# переменной, и указание --recreate-db молча вытеснило умолчания: перенос
# остановился на конфликте ИНН, хотя способ его разрешения был задан.
RECREATE=0
CONFLICT_ARGS=()
for a in "$@"; do
  if [[ "$a" == "--recreate-db" ]]; then RECREATE=1; else CONFLICT_ARGS+=("$a"); fi
done
# Умолчание — ничего не терять: повторяющийся ИНН обнуляется, организация и её
# точки остаются, заявки на них не повисают
if [[ ${#CONFLICT_ARGS[@]} -eq 0 ]]; then
  CONFLICT_ARGS=(--blank-duplicate-inn --skip-conflicts)
fi
EXTRA="${CONFLICT_ARGS[*]}"

say() { printf '\n=== %s\n' "$1"; }

if [[ $EUID -ne 0 ]]; then echo "Запускать под sudo"; exit 1; fi
if grep -q '^DATABASE_URL=' "$ENV_FILE"; then
  echo "DATABASE_URL уже задан в $ENV_FILE — прод, похоже, уже на базе."
  echo "Повторный перенос затрёт то, что появилось после переключения."
  exit 1
fi

say "1/7 Останавливаю сервис — снимок должен быть целым"
systemctl stop sozo-api
sleep 2

say "2/7 Снимок: $SNAPSHOT"
cp "$STATE" "$SNAPSHOT"
ls -la "$SNAPSHOT"

say "3/7 База $DB_NAME и миграции"
cd "$ROOT"

# База должна быть пустой.
#
# При первом запуске выяснилось, что она не пуста: в ней лежали 46 таблиц и
# восемь заявок от ранних опытов с Prisma — миграции легли на них и упали на
# «type OrderType already exists». Накатывать поверх чужой схемы нельзя: в
# лучшем случае это отказ посреди работы, в худшем — молча смешанные данные.
EXISTING=$(docker compose -f infra/docker-compose.yml exec -T postgres \
  psql -U sozo -d postgres -tAq -c "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | tr -d '[:space:]')
TABLES=0
if [[ "$EXISTING" == "1" ]]; then
  TABLES=$(docker compose -f infra/docker-compose.yml exec -T postgres \
    psql -U sozo -d "${DB_NAME}" -tAq -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" | tr -d '[:space:]')
fi

if [[ "$TABLES" != "0" ]]; then
  if [[ "$RECREATE" == "1" ]]; then
    echo "База ${DB_NAME} не пуста (${TABLES} таблиц) — пересоздаю, как велено флагом"
    docker compose -f infra/docker-compose.yml exec -T postgres \
      psql -U sozo -d postgres -tAq -c "DROP DATABASE ${DB_NAME} WITH (FORCE)" >/dev/null
    EXISTING=""
  else
    echo "База ${DB_NAME} уже содержит ${TABLES} таблиц."
    echo "Накатывать миграции поверх чужой схемы нельзя. Посмотрите, что там:"
    echo "  docker compose -f infra/docker-compose.yml exec postgres psql -U sozo -d ${DB_NAME} -c '\\dt'"
    echo "Если это остатки опытов и их не жалко — повторите с флагом --recreate-db"
    systemctl start sozo-api
    exit 1
  fi
fi

[[ "$EXISTING" == "1" ]] || docker compose -f infra/docker-compose.yml exec -T postgres \
  psql -U sozo -d postgres -tAq -c "CREATE DATABASE ${DB_NAME}" >/dev/null
for m in $(ls -d prisma/migrations/*/ | xargs -n1 basename | sort -V); do
  docker compose -f infra/docker-compose.yml exec -T postgres \
    psql -U sozo -d "${DB_NAME}" -v ON_ERROR_STOP=1 -q < "prisma/migrations/${m}/migration.sql" >/dev/null \
    || { echo "Миграция ${m} не применилась"; systemctl start sozo-api; exit 1; }
done
echo "миграции применены"

# Пароль роли приложения — свой на каждой установке. Миграция заводит роль с
# разработческим паролем, и оставить его в проде значит держать открытой
# дверь, о которой все забудут
docker compose -f infra/docker-compose.yml exec -T postgres \
  psql -U sozo -d postgres -tAq -c "ALTER ROLE sozo_app LOGIN PASSWORD '${APP_PASSWORD}'" >/dev/null
echo "пароль роли приложения обновлён"

say "4/7 Что поедет (ничего не пишется)"
STATE_FILE="$SNAPSHOT" DATABASE_URL="$DB_URL" node apps/api/dist/tools/import-state.js --dry

say "5/7 Перенос"
if ! STATE_FILE="$SNAPSHOT" DATABASE_URL="$DB_URL" node apps/api/dist/tools/import-state.js $EXTRA; then
  echo "Перенос не выполнен. Прод остаётся на файле — возвращаю сервис."
  systemctl start sozo-api
  exit 1
fi

say "6/7 Приёмка: два сервера на одних данных отвечают одинаково?"
if ! node apps/api/test/import-verify.mjs "$SNAPSHOT" "$DB_URL" $EXTRA; then
  echo "Приёмка не прошла. Прод остаётся на файле — возвращаю сервис."
  echo "База ${DB_NAME} оставлена как есть, чтобы можно было разобраться."
  systemctl start sozo-api
  exit 1
fi

say "7/7 Переключаю прод"
cp "$ENV_FILE" "${ENV_FILE}.bak.${STAMP}"
printf '\n# Прод на PostgreSQL с %s. Откат: закомментировать строку и перезапустить\n# сервис — модули вернутся к state.json, который остался на месте.\nDATABASE_URL=%s\n' \
  "$(date +%F)" "$DB_URL" >> "$ENV_FILE"
systemctl start sozo-api
sleep 4
curl -s http://127.0.0.1:3000/v1/health

cat <<EOF

Готово. Прод работает на PostgreSQL.
  снимок до переноса: $SNAPSHOT
  откат:  закомментировать DATABASE_URL в $ENV_FILE и systemctl restart sozo-api
  резервная копия конфига: ${ENV_FILE}.bak.${STAMP}

state.json остаётся рабочим: девятнадцать разделов состояния таблиц не имеют.
EOF
