#!/usr/bin/env bash
# Бэкап базы магазина перед обновлением. Запускать из папки магазина:
#   bash deploy/backup.sh            → ~/krynel-backups/before-<дата>-<код>.sql.gz
#   bash deploy/backup.sh <метка>    → ~/krynel-backups/<метка>-<дата>-<код>.sql.gz
# Падает с ошибкой, если дамп не снялся или в нём нет таблиц магазина: молча пустой бэкап хуже, чем никакого.
set -euo pipefail
cd "$(dirname "$0")/.."

dir="${BACKUP_DIR:-$HOME/krynel-backups}"
mkdir -p "$dir"
# Своё уникальное имя: неудачный запуск удаляет только свой файл, а не бэкап, снятый в ту же секунду
file=$(mktemp --suffix=.sql.gz "$dir/${1:-before}-$(date +%Y%m%d-%H%M%S)-XXXX")

if ! docker compose exec -T db pg_dump -U krynel krynel | gzip > "$file"; then
  rm -f "$file"
  echo "Бэкап не снят: pg_dump завершился с ошибкой. Запущена ли база (docker compose ps)?" >&2
  exit 1
fi

# Не та папка или новая пустая база дают дамп без таблиц, хотя pg_dump отработал без ошибок
tables=$(gzip -dc "$file" | grep -c '^CREATE TABLE public\."Order"' || true)
if [ "$tables" = 0 ]; then
  rm -f "$file"
  echo "Бэкап не снят: в базе нет таблиц магазина. Запустите скрипт из папки магазина, где лежит его docker-compose.yml" >&2
  exit 1
fi

echo "Бэкап: $file ($(du -h "$file" | cut -f1))"
