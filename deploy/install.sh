#!/usr/bin/env bash
# Установка Krynel на чистый Ubuntu/Debian VPS. Запускать из корня репозитория под root:
#   bash deploy/install.sh
# Перед запуском заполните .env (cp .env.example .env). Скрипт идемпотентный: повторный запуск = обновление.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi

[ -f .env ] || { echo "Нет .env: cp .env.example .env и заполните"; exit 1; }

# Случайный пароль БД при первой установке
if grep -q '^POSTGRES_PASSWORD=krynel$' .env; then
  pw=$(openssl rand -hex 16)
  sed -i "s/^POSTGRES_PASSWORD=krynel$/POSTGRES_PASSWORD=$pw/" .env
  sed -i "s#^DATABASE_URL=postgresql://krynel:krynel@#DATABASE_URL=postgresql://krynel:$pw@#" .env
fi

if command -v ufw >/dev/null && ufw status | grep -q active; then
  ufw allow 80/tcp; ufw allow 443/tcp
fi

docker compose up -d --build
echo "Ждём запуск приложения..."
for i in $(seq 1 60); do
  docker compose exec -T app node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null && break
  sleep 2
done

if [ "${SEED:-0}" = "1" ]; then
  docker compose exec -T app node dist/seed.js
fi
docker compose ps
echo "Готово: $(grep ^PUBLIC_URL= .env | cut -d= -f2-)"
