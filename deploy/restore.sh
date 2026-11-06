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
# Номера заказов, кодов и сообщений после восстановления продолжаются с самых больших, что уже были.
# Иначе новый заказ получил бы номер удалённого, и старая кнопка «Подтвердить» в боте сработала бы на нём.
# Номера пишутся в файл до удаления базы: если восстановление оборвётся, следующий запуск возьмёт их оттуда,
# а не из полувосстановленной базы
dir="${BACKUP_DIR:-$HOME/krynel-backups}"
state="$dir/.restore-seqs"
mkdir -p "$dir"

# Файл с номерами остаётся только после оборванного восстановления: тогда текущая база может быть половиной бэкапа
pending=0
[ -s "$state" ] && pending=1
readable=1 dropped=0 restored=0
# Пока база не удалена, любая ошибка возвращает магазин как был. После удаления приложение не стартует
# на половине базы: восстановление запускают ещё раз или приложение руками (docker compose start app)
on_exit() {
  local rc=$?
  [ "$rc" = 0 ] && return
  if [ "$restored" = 1 ]; then
    echo "База восстановлена, но приложение не запустилось. Ошибка выше, запуск: docker compose start app" >&2
  elif [ "$dropped" = 1 ]; then
    echo "Восстановление не закончено, приложение остановлено, чтобы не работать на половине базы. Ошибка выше" >&2
    [ -s "$state" ] && echo "Запустите восстановление ещё раз: последние номера заказов сохранены в $state, следующий запуск их учтёт" >&2
  elif [ "$pending" = 0 ] && [ "$readable" = 1 ]; then
    rm -f -- "$state" "$state.new"
    docker compose start app || true
    echo "Восстановление не началось, база не тронута, приложение снова запущено" >&2
  else
    echo "Восстановление не началось, база не тронута. Приложение не запускаю: прошлое восстановление не закончено или текущая база не читается. Ошибка выше, запустите восстановление ещё раз" >&2
  fi
}
trap on_exit EXIT

docker compose stop app
live=$(psql -At -F ' ' -c "SELECT sequencename, last_value FROM pg_sequences WHERE schemaname = 'public' AND last_value IS NOT NULL" 2>/dev/null) || { live=''; readable=0; }
# По каждой последовательности большее из текущей базы и сохранённого прошлым, оборванным запуском
merged=$( { cat -- "$state" 2>/dev/null || true; printf '%s\n' "$live"; } |
  awk 'NF == 2 && $1 ~ /^[A-Za-z0-9_]+$/ && $2 ~ /^[1-9][0-9]*$/ && length($2) <= 15 { if (!($1 in m) || $2 + 0 > m[$1] + 0) m[$1] = $2 }
       END { for (k in m) print k, m[k] }' | sort)
if [ -n "$merged" ]; then
  printf '%s\n' "$merged" > "$state.new"
  mv -f -- "$state.new" "$state"
fi
if [ "$pending" = 1 ]; then
  echo "Прошлое восстановление не закончилось. Номера заказов беру из $state, если они больше текущих" >&2
elif [ "$readable" = 0 ] && [ -z "$merged" ]; then
  echo "Номера из текущей базы прочитать не удалось: после восстановления сдвину их на 1000 вперёд, чтобы не повторить выданные" >&2
fi

docker compose exec -T db dropdb --if-exists --force -U krynel krynel
dropped=1
docker compose exec -T db createdb -U krynel krynel
gzip -dc "$file" | psql > /dev/null
if [ -n "$merged" ]; then
  # Последовательности, которых нет в бэкапе (таблица появилась позже), пропускаются
  values=$(printf '%s\n' "$merged" | awk -v q="'" '{ printf "%s(%s%s%s, %s)", (NR > 1 ? ", " : ""), q, $1, q, $2 }')
  psql -c "SELECT setval(format('%I.%I', s.schemaname, s.sequencename)::regclass, GREATEST(s.last_value, v.val)) FROM pg_sequences s JOIN (VALUES $values) AS v(name, val) ON s.sequencename = v.name WHERE s.schemaname = 'public'" > /dev/null
else
  psql -c "SELECT setval(format('%I.%I', schemaname, sequencename)::regclass, COALESCE(last_value, 0) + 1000) FROM pg_sequences WHERE schemaname = 'public'" > /dev/null
fi
rm -f -- "$state"
restored=1
docker compose start app
echo "База восстановлена из $file"
