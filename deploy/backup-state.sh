#!/usr/bin/env bash
# Бэкап состояния. Вся система живёт в одном файле, БД нет — потеря файла
# означает потерю всего, поэтому копия ежечасная, а не суточная.
set -euo pipefail
SRC=${STATE_FILE:-/var/lib/sozo/state.json}
DST=/var/backups/sozo
[ -f "$SRC" ] || { echo "нет файла состояния: $SRC" >&2; exit 1; }
mkdir -p "$DST"
STAMP=$(date +%Y%m%d-%H%M%S)
gzip -c "$SRC" > "$DST/state-$STAMP.json.gz"
# Держим двое суток почасовых копий: файл маленький, но диск не резиновый
find "$DST" -name 'state-*.json.gz' -mtime +2 -delete
