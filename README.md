# Krynel — Telegram-магазин цифровых товаров

Мини-апп в Telegram: витрина, оформление, мои заказы и чат по заказу. Тут же админка для владельца: очередь выдачи, подтверждение ручных оплат, товары, цены, коды и настройки.

## Что внутри

| Часть | Технологии |
|---|---|
| `apps/server` | Fastify API, бот на grammY, PostgreSQL через Prisma |
| `apps/webapp` | React + Vite, мини-апп. Собранный бандл раздаёт тот же сервер |

## Оплаты

| Метод | Как подтверждается | Статус |
|---|---|---|
| CryptoBot | вебхук `/webhooks/cryptobot`: проверяется подпись, статус перепроверяется через API | готово, нужен `CRYPTOBOT_TOKEN` |
| xRocket | вебхук `/webhooks/xrocket`: подпись + перепроверка через API. Счёт в USDT по курсу из настроек | готово, нужен `XROCKET_TOKEN`; поля API сверить при подключении |
| Гривны (UAH) | вручную: клиент видит карту из настроек, переводит, прикладывает скрин, админ подтверждает | готово |
| СБП | пока вручную, как гривны (телефон из настроек). Когда будет агрегатор, подключается как автоматический метод | ручной режим готов |
| Lolz | — | ждёт API-токен |

Ручная оплата: клиент жмёт «Я оплатил» и прикладывает скриншот → админам в бот приходит фото с кнопками «Подтвердить» и «Отклонить» → после подтверждения заказ уходит в очередь выдачи (или код выдаётся сразу, если товар с кодами). Причина отказа приходит клиенту в чат заказа.

## Выдача

- **Вручную** (Premium подарком, подписки на аккаунт): заказ попадает в очередь, у каждого таймер до SLA. Админ жмёт «Выдано» в боте или в админке и при желании пишет, что передал.
- **Коды из базы** (Steam и т.п.): коды загружаются в редакторе товара по одному в строке и выдаются автоматически сразу после оплаты. Один код никогда не уходит двум заказам (`FOR UPDATE SKIP LOCKED`). Когда кодов меньше 5, админка показывает предупреждение.

## Запуск на сервере

Нужны VPS, домен и HTTPS: Telegram открывает мини-апп только по https.

```bash
cp .env.example .env    # заполнить BOT_TOKEN, ADMIN_IDS, PUBLIC_URL и токены платёжек
docker compose up -d --build
docker compose exec app node dist/seed.js     # демо-каталог, по желанию
```

Приложение слушает `127.0.0.1:3000`. Перед ним ставится nginx или Caddy с сертификатом. Затем:

1. В @BotFather: `/setdomain` (или Bot Settings → Configure Mini App) → указать `PUBLIC_URL`.
2. В CryptoBot (Crypto Pay → My Apps → Webhooks) указать `PUBLIC_URL/webhooks/cryptobot`.
3. В xRocket Pay указать вебхук `PUBLIC_URL/webhooks/xrocket`.
4. Открыть бота, нажать /start, затем /admin. Админка откроется, если ваш ID есть в `ADMIN_IDS`.
5. В админке, в разделе «Настройки», указать карту для гривен, курс и телефон для СБП.

## Локальная разработка

```bash
pnpm install
cd apps/server && cp ../../.env.example .env   # DATABASE_URL на локальный postgres, DEV_AUTH=true, ADMIN_IDS=1000
npx prisma db push && npx tsx src/seed.ts
pnpm dev                                       # API на :3000
cd ../webapp && pnpm dev                       # мини-апп на :5173
```

В браузере без Telegram откройте `http://localhost:5173/?dev=1000` (вы админ) или `?dev=2000` (клиент).

## Тесты

```bash
createdb krynel_test   # отдельная база, тесты чистят её перед запуском
cd apps/server && pnpm test
```

Покрыто: подпись initData Telegram, подпись вебхуков, расчёт цен, промокоды и курсы, полный цикл ручной оплаты гривнами, отклонение с причиной, чат и доступ к чужим заказам, вебхук CryptoBot (поддельная подпись и неоплаченный счёт игнорируются), автовыдача кодов без двойной выдачи, правка цены и скрытие товара из админки.

## Деплой на VPS

```bash
git clone https://github.com/gogogg002/shop && cd shop
cp .env.example .env   # заполнить BOT_TOKEN, ADMIN_IDS, DOMAIN, PUBLIC_URL, токены платёжек
SEED=1 bash deploy/install.sh   # SEED=1 только при первом запуске: демо-каталог
```

### Обновление и откат

Команды запускаются из папки магазина, куда клонирован репозиторий.

```bash
bash deploy/backup.sh                            # бэкап базы в ~/krynel-backups
git pull && docker compose up -d --build db app
```

`backup.sh` останавливается с ошибкой, если дамп не снялся или в нём нет таблиц магазина (например, команда запущена не из той папки). В таком случае не обновляйтесь, пока не разберётесь. Схема базы применяется сама при старте контейнера (`prisma db push`), новые поля всегда со значениями по умолчанию.

Откат на прошлую версию. Старый код работает на новой схеме, но его `db push` захочет удалить новые колонки, и контейнер не запустится. Поэтому прошлую версию запускаем без `db push`:

```bash
printf 'services:\n  app:\n    command: node dist/index.js\n' > ~/krynel-rollback.yml
git checkout <прошлая ветка или коммит>
docker compose -f docker-compose.yml -f ~/krynel-rollback.yml up -d --build app
```

Вернуться на свежую версию: `git checkout <ветка> && docker compose up -d --build app`, без файла отката, и схема снова применится при старте.

Восстановление из бэкапа заменяет всю базу, заказы после бэкапа пропадут:

```bash
docker compose stop app
docker compose exec -T db dropdb -U krynel krynel
docker compose exec -T db createdb -U krynel krynel
gzip -dc ~/krynel-backups/<файл>.sql.gz | docker compose exec -T db psql -q -U krynel krynel
docker compose start app
```

Нет своего домена: `DOMAIN=95-215-32-54.sslip.io`, `PUBLIC_URL=https://95-215-32-54.sslip.io` (IP через дефисы). Caddy сам выпустит HTTPS-сертификат, порты 80 и 443 должны быть открыты. Свой Telegram ID показывает команда бота `/id`.
