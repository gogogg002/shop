import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { ShopError } from './services/orders.js';
import { cleanDeep } from './services/labels.js';
import { shopRoutes } from './routes/shop.js';
import { adminRoutes } from './routes/admin.js';
import { webhookRoutes } from './routes/webhooks.js';

export async function buildApp(opts: { logger?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? false });

  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: 8 * 1024 * 1024, files: 1 } });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ShopError) return reply.code(err.status).send({ error: err.code, message: err.message });
    if (err instanceof ZodError) {
      // Свои русские сообщения из схем показываем как есть, стандартные английские — общим текстом
      const own = err.issues.find((i) => /[а-яё]/i.test(i.message))?.message;
      return reply.code(400).send({ error: 'validation', message: own ?? 'Проверьте поля', issues: err.issues });
    }
    // Ошибки базы, которые вызывает сам запрос (в основном формы админки): ответ по делу вместо «что-то сломалось»
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      const known: Record<string, [number, string, string]> = {
        P2002: [409, 'conflict', 'Такая запись уже есть'],
        P2003: [400, 'bad_ref', 'Связанная запись не найдена'],
        P2025: [404, 'not_found', 'Не найдено'],
      };
      const hit = known[err.code];
      if (hit) {
        req.log.warn({ code: err.code, meta: err.meta }, 'prisma');
        return reply.code(hit[0]).send({ error: hit[1], message: hit[2] });
      }
    }
    req.log.error(err);
    return reply.code(500).send({ error: 'internal', message: 'Что-то сломалось, попробуйте ещё раз' });
  });

  // Нулевой символ и половинки суррогатных пар база не принимает: чистим строки тела до разбора схемой,
  // чтобы ни одна форма не падала на них с 500. Вебхуки не трогаем: их подпись считается по телу как есть
  app.addHook('preValidation', async (req) => {
    if (req.body && typeof req.body === 'object' && !req.url.startsWith('/webhooks/')) req.body = cleanDeep(req.body);
  });

  app.get('/health', async () => ({ ok: true }));
  await app.register(webhookRoutes);
  await app.register(shopRoutes);
  await app.register(adminRoutes);

  // Собранный мини-апп раздаётся этим же сервером
  const here = dirname(fileURLToPath(import.meta.url));
  const webDist = resolve(here, '../../webapp/dist');
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, prefix: '/' });
  }
  return app;
}
