import type { FastifyReply, FastifyRequest } from 'fastify';
import type { User } from '@prisma/client';
import { config, isAdmin } from '../config.js';
import { prisma } from '../db.js';
import { verifyInitData, type TgUser } from './telegram.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: User;
    isAdmin: boolean;
  }
}

function devUser(req: FastifyRequest): TgUser | null {
  if (!config.DEV_AUTH) return null;
  const raw = req.headers['x-dev-user'];
  const id = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(id) && id > 0 ? { id, username: `dev${id}`, first_name: 'Dev' } : null;
}

/** preHandler: проверяет initData из мини-аппа и кладёт пользователя в req.user */
export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  const raw = req.headers['x-telegram-init-data'];
  const initData = Array.isArray(raw) ? raw[0] : raw;
  const tg = (initData && verifyInitData(initData, config.BOT_TOKEN)) || devUser(req);
  if (!tg) return reply.code(401).send({ error: 'unauthorized', message: 'Откройте магазин из Telegram' });

  const tgId = BigInt(tg.id);
  const user = await prisma.user.upsert({
    where: { tgId },
    create: { tgId, username: tg.username, firstName: tg.first_name },
    update: { username: tg.username, firstName: tg.first_name },
  });
  if (user.isBlocked) return reply.code(403).send({ error: 'blocked', message: 'Доступ закрыт' });
  req.user = user;
  req.isAdmin = isAdmin(tgId);
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  await requireUser(req, reply);
  if (reply.sent) return;
  if (!req.isAdmin) return reply.code(403).send({ error: 'forbidden', message: 'Только для админа' });
}
