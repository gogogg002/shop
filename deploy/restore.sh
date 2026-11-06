#!/usr/bin/env bash
# Восстановление базы магазина из бэкапа deploy/backup.sh. Запускать из папки магазина:
#   bash deploy/restore.sh ~/krynel-backups/<файл>.sql.gz
# Заменяет всю базу: заказы, отзывы и правки после бэкапа пропадут. Сначала проверяет файл
# и только потом трогает базу. Подтверждение спрашивает сам; --yes вторым аргументом пропускает вопрос.
set -euo pipefail
cd "$(dirname "$0")/.."

file="${1:-}"
if [ -z "$file" ] || [ ! -f "$file" ]; then
  echo "Укажите файл бэкапа: bash deploy/restore.sh ~/krynel-backups/<файл>.sql.gz" >&2
  exit 1
fi
if ! gzip -t "$file" 2>/dev/null; then
  echo "Файл $file битый (не gzip или оборван). Базу не трогаю" >&2
  exit 1
fi
tables=$(gzip -dc "$file" | grep -c '^CREATE TABLE public\."Order"' || true)
if [ "$tables" = 0 ]; then
  echo "В $file нет таблиц магазина. Базу не трогаю" >&2
  exit 1
fi

if [ "${2:-}" != "--yes" ]; then
  read -r -p "Заменить всю базу магазина содержимым $file? Напишите да: " answer
  [ "$answer" = "да" ] || { echo "Отменено"; exit 1; }
fi

docker compose stop app
docker compose exec -T db dropdb -U krynel krynel
docker compose exec -T db createdb -U krynel krynel
# ON_ERROR_STOP: на первой ошибке psql останавливается, и приложение не стартует на полубазе
gzip -dc "$file" | docker compose exec -T db psql -q -v ON_ERROR_STOP=1 -U krynel krynel > /dev/null
docker compose start app
echo "База восстановлена из $file"
