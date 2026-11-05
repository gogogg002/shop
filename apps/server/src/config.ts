import 'dotenv/config';
import { z } from 'zod';

// z.coerce.boolean() превращает строку "false" в true, поэтому парсим явно
const flag = z
  .string()
  .default('false')
  .transform((v) => ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase()));

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
  CRYPTOBOT_TESTNET: flag,
  XROCKET_TOKEN: z.string().default(''),
  LOLZ_TOKEN: z.string().default(''),
  /** В dev-режиме разрешает заголовок x-dev-user вместо initData */
  DEV_AUTH: flag,
});

export const config = schema.parse(process.env);

export const adminIds = new Set(
  config.ADMIN_IDS.split(',').map((s) => s.trim()).filter(Boolean).map((s) => BigInt(s)),
);

export const isAdmin = (tgId: bigint) => adminIds.has(tgId);
