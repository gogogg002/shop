#!/usr/bin/env bash
# Бэкап базы магазина перед обновлением. Запускать из папки магазина:
#   bash deploy/backup.sh            → ~/krynel-backups/before-<дата>-<код>.sql.gz
#   bash deploy/backup.sh <метка>    → ~/krynel-backups/<метка>-<дата>-<код>.sql.gz
# Падает с ошибкой, если дамп не снялся или в нём нет таблиц магазина: молча пустой бэкап хуже, чем никакого.
set -euo pipefail
# Папка магазина: текущая, если в ней docker-compose.yml, иначе та, где лежит скрипт
[ -f docker-compose.yml ] || cd "$(dirname "$0")/.."
[ -f docker-compose.yml ] || { echo "Запустите скрипт из папки магазина, где лежит docker-compose.yml" >&2; exit 1; }
# Восстановление базы оборвалось и не закончено: в базе может быть половина бэкапа, а цепочка обновления
# после бэкапа запустила бы на ней приложение
if [ -e .restore-seqs ]; then
  echo "Восстановление базы не закончено (есть $PWD/.restore-seqs). Сначала запустите его ещё раз: bash deploy/restore.sh <файл>" >&2
  exit 1
fi

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
complete=$(gzip -dc "$file" | tail -n 5 | grep -c 'PostgreSQL database dump complete' || true)
if [ "$complete" = 0 ]; then
  rm -f "$file"
  echo "Бэкап не снят: дамп оборвался" >&2
  exit 1
fi

echo "Бэкап: $file ($(du -h "$file" | cut -f1))"
