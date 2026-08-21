#!/usr/bin/env bash
#
# Накат миграций на живую базу.
#
# Пока прод работал на файле, миграции применялись целиком на пустую базу —
# порядок и повторы значения не имели. С живой базой это перестаёт работать:
# часть миграций не идемпотентна по своей природе (переименование колонки
# нельзя написать «если ещё не переименовано» без лишних оговорок), а
# применять всё подряд на каждом обновлении значит однажды переписать данные.
#
# Поэтому здесь ведётся учёт: таблица schema_migration помнит, что уже
# применено, и скрипт накатывает только новое, по порядку номеров.
#
#   sudo deploy/migrate.sh [--dry]
#
set -euo pipefail

ROOT=/home/azureuser/SOZO/sozo
DB_NAME="${DB_NAME:-sozo}"
DRY=0
[[ "${1:-}" == "--dry" ]] && DRY=1

cd "$ROOT"

psql_db() {
  docker compose -f infra/docker-compose.yml exec -T postgres \
    psql -U sozo -d "$DB_NAME" -v ON_ERROR_STOP=1 -q "$@"
}

psql_db -c "CREATE TABLE IF NOT EXISTS schema_migration (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
)" >/dev/null

# Учёт миграций — не данные арендатора, и приложение его не читает вовсе.
# Но проверка охвата RLS считает таблицы, а не намерения: таблица без
# политики выглядит одинаково и когда до неё не дошли руки, и когда она не
# нужна. Включаем защиту без единой политики — роль приложения не видит
# ничего, а миграции ходят суперпользователем, которого RLS не касается.
psql_db -c "ALTER TABLE schema_migration ENABLE ROW LEVEL SECURITY;
            ALTER TABLE schema_migration FORCE ROW LEVEL SECURITY" >/dev/null

APPLIED=$(psql_db -tAq -c "SELECT name FROM schema_migration" | tr -d '\r')

# Порядок числовой: m9 идёт раньше m10, а не после, как при обычной сортировке
LIST=$(ls -d prisma/migrations/*/ | xargs -n1 basename \
  | awk '{n=$0; sub(/^m/,"",n); split(n,a,"_"); printf "%09d %s\n", a[1], $0}' \
  | sort | cut -d' ' -f2)

PENDING=()
for m in $LIST; do
  grep -qxF "$m" <<< "$APPLIED" || PENDING+=("$m")
done

if [[ ${#PENDING[@]} -eq 0 ]]; then
  echo "Новых миграций нет — база актуальна"
  exit 0
fi

echo "К применению (${#PENDING[@]}):"
printf '  %s\n' "${PENDING[@]}"

if [[ $DRY -eq 1 ]]; then
  echo "--dry: ничего не применено"
  exit 0
fi

for m in "${PENDING[@]}"; do
  echo "→ $m"
  if ! psql_db < "prisma/migrations/${m}/migration.sql" >/dev/null; then
    echo "Миграция $m не применилась. Остальные не трогаю — разбирайтесь с этой."
    exit 1
  fi
  psql_db -c "INSERT INTO schema_migration (name) VALUES ('${m}')" >/dev/null
done

echo "Готово. Применено: ${#PENDING[@]}"
