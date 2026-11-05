import type { FastifyInstance } from 'fastify';
import { autoProviders } from '../payments/index.js';
import { markPaid } from '../services/orders.js';
import { prisma } from '../db.js';

/**
 * Вебхуки платёжек. Тело читаем строкой: подпись считается от сырых байт.
 * CryptoBot: https://<PUBLIC_URL>/webhooks/cryptobot
 * xRocket:   https://<PUBLIC_URL>/webhooks/xrocket
 */
export async function webhookRoutes(app: FastifyInstance) {
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));

  for (const [name, method] of [['cryptobot', 'CRYPTOBOT'], ['xrocket', 'XROCKET']] as const) {
    app.post(`/webhooks/${name}`, async (req, reply) => {
      const provider = autoProviders[method];
      if (!provider?.isConfigured()) return reply.code(404).send();
      const orderId = await provider.handleWebhook(String(req.body ?? ''), req.headers).catch((e) => {
        req.log.error({ err: e }, `${name} webhook failed`);
        return null;
      });
      if (orderId) {
        const order = await prisma.order.findUnique({ where: { id: orderId } });
        if (order && order.method === method) await markPaid(orderId);
      }
      // Всегда 200, чтобы провайдер не долбил повторами из-за чужих событий
      return reply.send({ ok: true });
    });
  }
}
