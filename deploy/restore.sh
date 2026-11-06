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
if ! docker compose exec -T db pg_isready -q -U krynel; then
  echo "База не отвечает, восстанавливать не во что. Запустите её (docker compose up -d db) и повторите. Ничего не трогал" >&2
  exit 1
fi

# Номера заказов, кодов и сообщений после восстановления продолжаются с самых больших, что уже были.
# Иначе новый заказ получил бы номер удалённого, и старая кнопка «Подтвердить» в боте сработала бы на нём.
# Номера пишутся в файл .restore-seqs в папке магазина до удаления базы: если восстановление оборвётся,
# следующий запуск возьмёт их оттуда, а не из полувосстановленной базы. Файл есть, только пока восстановление
# не закончено, и пока он есть, backup.sh отказывается снимать бэкап
state="$PWD/.restore-seqs"
header='# krynel restore pending'

# Файл остался от оборванного восстановления: текущая база может быть пустой или половиной бэкапа
pending=0
[ -e "$state" ] && pending=1
readable=1 unknown=0 dropping=0 restored=0 finished=0
# До удаления базы любой обрыв (ошибка, Ctrl+C, обрыв SSH) возвращает магазин как был. Если удаление уже
# началось, приложение не стартует на пустой или половине базы: восстановление запускают ещё раз
on_exit() {
  [ "$finished" = 1 ] && return
  trap '' INT HUP TERM
  if [ "$restored" = 1 ]; then
    echo "База восстановлена, но приложение не запустилось. Ошибка выше, запуск: docker compose start app" >&2
  elif [ "$dropping" = 1 ]; then
    echo "Восстановление оборвалось после начала удаления базы. Приложение остановлено, чтобы не работать на пустой или половине базы. Ошибка выше" >&2
    echo "Запустите восстановление ещё раз: номера заказов сохранены в $state, следующий запуск их учтёт" >&2
  else
    # База та же, что была: номера этого запуска помнить не нужно
    [ "$pending" = 0 ] && rm -f -- "$state" "$state.new"
    if [ "$pending" = 0 ] && [ "$readable" = 1 ]; then
      # Если прервали во время остановки, она ещё может идти: дожидаемся её и запускаем заново
      docker compose stop app > /dev/null 2>&1 || true
      if out=$(docker compose start app 2>&1); then
        echo "Восстановление не началось, база не тронута, приложение снова запущено" >&2
      else
        echo "$out" >&2
        echo "Восстановление не началось, база не тронута, но приложение не запустилось: docker compose start app" >&2
      fi
    else
      echo "Восстановление не началось, база не тронута. Приложение не запускаю: прошлое восстановление не закончено или текущая база не читается. Ошибка выше, запустите восстановление ещё раз" >&2
    fi
  fi
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 129' HUP
trap 'exit 143' TERM

docker compose stop app
live=$(psql -At -F ' ' -c "SELECT sequencename, last_value FROM pg_sequences WHERE schemaname = 'public' AND last_value IS NOT NULL" 2>/dev/null) || { live=''; readable=0; }
if [ "$pending" = 1 ]; then
  # Номеров в файле нет, если и тот запуск не смог прочитать базу
  grep -qxF unknown "$state" 2>/dev/null && unknown=1
  grep -qxF "$header" "$state" 2>/dev/null || unknown=1
elif [ "$readable" = 0 ]; then
  unknown=1
fi
# По каждой последовательности большее из текущей базы и сохранённого прошлым, оборванным запуском
merged=$( { cat -- "$state" 2>/dev/null || true; printf '%s\n' "$live"; } |
  awk 'NF == 2 && $1 ~ /^[A-Za-z0-9_]+$/ && $2 ~ /^[1-9][0-9]*$/ && length($2) <= 15 { if (!($1 in m) || $2 + 0 > m[$1] + 0) m[$1] = $2 }
       END { for (k in m) print k, m[k] }' | sort)
content=$header
[ "$unknown" = 1 ] && content+=$'\n'unknown
[ -n "$merged" ] && content+=$'\n'$merged
printf '%s\n' "$content" > "$state.new"
mv -f -- "$state.new" "$state"
[ "$pending" = 1 ] && echo "Прошлое восстановление не закончилось. Номера заказов беру из $state, если они больше текущих" >&2
[ "$unknown" = 1 ] && echo "Какие номера уже выданы, неизвестно: после восстановления сдвину их на 1000 вперёд, чтобы не повторить выданные" >&2

dropping=1
docker compose exec -T db dropdb --if-exists --force -U krynel krynel
docker compose exec -T db createdb -U krynel krynel
gzip -dc "$file" | psql > /dev/null
# Каждая последовательность восстановленной базы: большее из бэкапа и сохранённого, плюс 1000, если номера неизвестны.
# Последовательности, которых нет в бэкапе (таблица появилась позже), пропускаются
bump=0
[ "$unknown" = 1 ] && bump=1000
values=$(printf '%s\n' "$merged" | awk -v q="'" 'NF == 2 { printf ", (%s%s%s, %s)", q, $1, q, $2 }')
psql -c "SELECT setval(format('%I.%I', s.schemaname, s.sequencename)::regclass, GREATEST(s.last_value, v.val, 0) + $bump) FROM pg_sequences s LEFT JOIN (VALUES ('', 0)$values) AS v(name, val) ON v.name = s.sequencename WHERE s.schemaname = 'public' AND (s.last_value IS NOT NULL OR v.val IS NOT NULL OR $bump > 0)" > /dev/null
restored=1
rm -f -- "$state"
docker compose start app
finished=1
echo "База восстановлена из $file"
