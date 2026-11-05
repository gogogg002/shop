import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string(),
  BOT_TOKEN: z.string().default(''),
  /** Telegram ID админов через запятую */
  ADMIN_IDS: z.string().default(''),
  /** Публичный https-адрес, где открыт мини-апп и API (нужен для вебхуков и кнопки бота) */
  PUBLIC_URL: z.string().default('http://localhost:3000'),
  CRYPTOBOT_TOKEN: z.string().default(''),
  /** true — тестовая сеть CryptoBot (testnet-pay.crypt.bot) */
  CRYPTOBOT_TESTNET: z.coerce.boolean().default(false),
  XROCKET_TOKEN: z.string().default(''),
  LOLZ_TOKEN: z.string().default(''),
  /** В dev-режиме разрешает заголовок x-dev-user вместо initData */
  DEV_AUTH: z.coerce.boolean().default(false),
});

export const config = schema.parse(process.env);

export const adminIds = new Set(
  config.ADMIN_IDS.split(',').map((s) => s.trim()).filter(Boolean).map((s) => BigInt(s)),
);

export const isAdmin = (tgId: bigint) => adminIds.has(tgId);
