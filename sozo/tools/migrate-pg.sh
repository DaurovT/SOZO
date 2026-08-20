#!/usr/bin/env bash
# Применение миграций к настоящему PostgreSQL — по порядку из
# prisma/migrations/README.md. Prisma не используется намеренно: миграции
# написаны как обычный SQL и должны применяться так же на любом сервере,
# без клиента и без shadow-базы.
set -euo pipefail
CID="docker compose -f infra/docker-compose.yml exec -T postgres"
for m in 000_init m7_buildings_rls m7_shutdown_exclusion m8_audit_actor_phone m9_identity m10_pricing; do
  printf '  %-24s ' "$m"
  $CID psql -U sozo -d sozo -q -v ON_ERROR_STOP=1 < "prisma/migrations/$m/migration.sql"
  echo 'применена'
done
echo -n '  таблиц в базе: '
$CID psql -U sozo -d sozo -tAc "select count(*) from information_schema.tables where table_schema='public'"
