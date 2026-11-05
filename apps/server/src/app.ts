import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { ZodError } from 'zod';
import { ShopError } from './services/orders.js';
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
    req.log.error(err);
    return reply.code(500).send({ error: 'internal', message: 'Что-то сломалось, попробуйте ещё раз' });
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
