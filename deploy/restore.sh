#!/usr/bin/env bash
# Восстановление базы магазина из бэкапа deploy/backup.sh. Запускать из папки магазина:
#   bash deploy/restore.sh ~/krynel-backups/<файл>.sql.gz
# Заменяет всю базу: заказы, отзывы и выданные коды после бэкапа пропадут. Сначала проверяет файл
# и только потом трогает базу. Подтверждение спрашивает сам; --yes вторым аргументом пропускает вопрос.
set -euo pipefail

# Путь к файлу запоминаем до смены папки, чтобы относительный путь тоже работал
file=$(realpath -e -- "${1:-}" 2>/dev/null) || {
  echo "Укажите файл бэкапа: bash deploy/restore.sh ~/krynel-backups/<файл>.sql.gz" >&2
  exit 1
}
# Папка магазина: текущая, если в ней docker-compose.yml, иначе та, где лежит скрипт
[ -f docker-compose.yml ] || cd "$(dirname "$0")/.."
[ -f docker-compose.yml ] || { echo "Запустите скрипт из папки магазина, где лежит docker-compose.yml" >&2; exit 1; }

if ! gzip -t "$file" 2>/dev/null; then
  echo "Файл $file битый (не gzip или оборван). Базу не трогаю" >&2
  exit 1
fi
tables=$(gzip -dc "$file" | grep -c '^CREATE TABLE public\."Order"' || true)
complete=$(gzip -dc "$file" | tail -n 5 | grep -c 'PostgreSQL database dump complete' || true)
if [ "$tables" = 0 ] || [ "$complete" = 0 ]; then
  echo "В $file нет таблиц магазина или дамп оборван. Базу не трогаю" >&2
  exit 1
fi

if [ "${2:-}" != "--yes" ]; then
  if [ ! -t 0 ]; then
    echo "Нет терминала для подтверждения. Если точно нужно заменить базу, добавьте --yes: bash deploy/restore.sh $file --yes" >&2
    exit 1
  fi
  read -r -p "Заменить всю базу магазина содержимым $file? Напишите да: " answer
  [ "$answer" = "да" ] || { echo "Отменено"; exit 1; }
fi

psql() { docker compose exec -T db psql -q -v ON_ERROR_STOP=1 -U krynel krynel "$@"; }
dropped=0
# Пока база не удалена, любая ошибка возвращает магазин как был. После удаления приложение не стартует
# на половине базы: его запускают руками (docker compose start app), когда восстановление прошло
on_exit() {
  local rc=$?
  [ "$rc" = 0 ] && return
  if [ "$dropped" = 0 ]; then
    docker compose start app || true
    echo "Восстановление не началось, база не тронута, приложение снова запущено" >&2
  else
    echo "Восстановление не закончено, приложение остановлено. Ошибка выше" >&2
  fi
}
trap on_exit EXIT

docker compose stop app
# Номера заказов, кодов и сообщений после восстановления продолжаются с самых больших, что уже были.
# Иначе новый заказ получил бы номер удалённого, и старая кнопка «Подтвердить» в боте сработала бы на нём
seqs=$(psql -At -c "SELECT format('SELECT setval(%L, GREATEST((SELECT last_value FROM %I.%I), %s));', format('%I.%I', schemaname, sequencename), schemaname, sequencename, COALESCE(last_value, 1)) FROM pg_sequences WHERE schemaname = 'public'" || true)

docker compose exec -T db dropdb --force -U krynel krynel
dropped=1
docker compose exec -T db createdb -U krynel krynel
gzip -dc "$file" | psql > /dev/null
if [ -n "$seqs" ]; then
  printf '%s\n' "$seqs" | psql > /dev/null
else
  # Текущую базу прочитать не удалось: берём номера с запасом, чтобы точно не повторить выданные
  psql -At -c "SELECT format('SELECT setval(%L, (SELECT last_value FROM %I.%I) + 1000);', format('%I.%I', schemaname, sequencename), schemaname, sequencename) FROM pg_sequences WHERE schemaname = 'public'" | psql > /dev/null
fi
docker compose start app
echo "База восстановлена из $file"
