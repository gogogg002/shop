FROM node:22-slim AS build
RUN corepack enable && apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter webapp build && pnpm --filter server build

FROM node:22-slim
RUN corepack enable && apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app /app
WORKDIR /app/apps/server
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
# Схема применяется при старте. SKIP_DB_PUSH=1 — запуск без неё: нужен при откате на старую версию,
# иначе db push старой схемы попросит удалить новые таблицы и колонки и контейнер не стартует
CMD ["sh", "-c", "if [ \"$SKIP_DB_PUSH\" != 1 ]; then npx prisma db push --skip-generate || exit 1; fi; exec node dist/index.js"]
