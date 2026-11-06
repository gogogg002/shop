import type { FastifyInstance } from 'fastify';
import type { OrderStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { requireAdmin } from '../auth/plugin.js';
import { getSettings, saveSettings } from '../services/settings.js';
import { ShopError, addMessage, confirmManual, deliver, rejectManual } from '../services/orders.js';
import { bodyId, dbId, int4, pathId } from './ids.js';

const idParam = (req: { params: unknown }) => pathId(req);

const orderView = {
  user: { select: { tgId: true, username: true, firstName: true } },
  // access нужен, чтобы в очереди «Со входом» не путался с «Без входа»: у них одно название
  variant: { include: { product: { select: { title: true, icon: true, glass: true, deliveryType: true, access: true } } } },
} as const;

export async function adminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin);

  // ---------- сводка ----------
  app.get('/api/admin/summary', async () => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const paidStatuses: OrderStatus[] = ['PAID', 'DELIVERED'];
    const today = await prisma.order.findMany({
      where: { paidAt: { gte: start }, status: { in: paidStatuses } },
      select: { amount: true, cost: true, paidAt: true },
    });
    const revenue = today.reduce((a, o) => a + o.amount, 0);
    const profit = today.reduce((a, o) => a + o.amount - o.cost, 0);
    const hourly = Array.from({ length: 24 }, (_, h) =>
      today.filter((o) => o.paidAt!.getHours() === h).reduce((a, o) => a + o.amount, 0));
    const queue = await prisma.order.count({ where: { status: { in: ['PAID', 'AWAITING_CONFIRMATION'] } } });
    const lowStock = await prisma.$queryRaw<{ variantId: number; title: string; left: bigint }[]>`
      SELECT v.id AS "variantId", p.title || ' · ' || v.title AS title, COUNT(c.id) AS left
      FROM "Variant" v JOIN "Product" p ON p.id = v."productId"
      LEFT JOIN "Code" c ON c."variantId" = v.id AND c."orderId" IS NULL
      WHERE p."deliveryType" = 'CODES' AND p."isActive" GROUP BY v.id, p.title, v.title HAVING COUNT(c.id) < 5`;
    return {
      revenue, profit, orders: today.length, queue, hourly,
      lowStock: lowStock.map((r) => ({ ...r, left: Number(r.left) })),
      slaMin: (await getSettings()).slaMin,
    };
  });

  // ---------- заказы ----------
  app.get('/api/admin/orders', async (req) => {
    const q = req.query as { status?: string; filter?: string };
    const where =
      q.filter === 'queue' ? { status: { in: ['PAID', 'AWAITING_CONFIRMATION'] as OrderStatus[] } }
      : q.status ? { status: q.status as OrderStatus } : {};
    const orders = await prisma.order.findMany({
      where, orderBy: { id: q.filter === 'queue' ? 'asc' : 'desc' }, take: 100, include: orderView,
    });
    return orders;
  });

  app.get('/api/admin/orders/:id', async (req) => {
    const o = await prisma.order.findUnique({
      where: { id: idParam(req) },
      include: { ...orderView, messages: { orderBy: { id: 'asc' } } },
    });
    if (!o) throw new ShopError('not_found', 'Заказ не найден', 404);
    return o;
  });

  /** Скриншот оплаты: тянем файл из Telegram по file_id */
  app.get('/api/admin/orders/:id/proof', async (req, reply) => {
    const o = await prisma.order.findUnique({ where: { id: idParam(req) } });
    if (!o?.proofFileId) throw new ShopError('not_found', 'Чека нет', 404);
    const meta = (await (await fetch(`https://api.telegram.org/bot${config.BOT_TOKEN}/getFile?file_id=${o.proofFileId}`)).json()) as
      { ok: boolean; result?: { file_path: string } };
    if (!meta.ok || !meta.result) throw new ShopError('not_found', 'Файл недоступен', 404);
    const file = await fetch(`https://api.telegram.org/file/bot${config.BOT_TOKEN}/${meta.result.file_path}`);
    reply.header('content-type', file.headers.get('content-type') ?? 'image/jpeg');
    return reply.send(Buffer.from(await file.arrayBuffer()));
  });

  app.post('/api/admin/orders/:id/confirm', async (req) => confirmManual(idParam(req)));
  app.post('/api/admin/orders/:id/reject', async (req) => {
    const { reason } = z.object({ reason: z.string().trim().min(1).max(300) }).parse(req.body);
    return rejectManual(idParam(req), reason);
  });
  app.post('/api/admin/orders/:id/deliver', async (req) => {
    const { text } = z.object({ text: z.string().max(2000).optional() }).parse(req.body ?? {});
    return deliver(idParam(req), text);
  });
  app.post('/api/admin/orders/:id/messages', async (req) => {
    const { text } = z.object({ text: z.string().trim().min(1).max(2000) }).parse(req.body);
    return addMessage(idParam(req), { userId: req.user.id, text, fromAdmin: true });
  });

  // ---------- категории ----------
  app.get('/api/admin/categories', async () => prisma.category.findMany({ orderBy: { sort: 'asc' } }));
  app.post('/api/admin/categories', async (req) => {
    const b = z.object({ slug: z.string().min(1), title: z.string().min(1), sort: int4.default(0) }).parse(req.body);
    return prisma.category.create({ data: b });
  });

  // ---------- товары ----------
  app.get('/api/admin/products', async () => {
    const products = await prisma.product.findMany({
      orderBy: [{ sort: 'asc' }, { id: 'asc' }],
      include: { category: true, variants: { orderBy: { sort: 'asc' } } },
    });
    const stock = await prisma.code.groupBy({ by: ['variantId'], where: { orderId: null }, _count: true });
    const left = new Map(stock.map((s) => [s.variantId, s._count]));
    const since = new Date(Date.now() - 30 * 86400_000);
    const sales = await prisma.order.groupBy({
      by: ['variantId'], where: { status: { in: ['PAID', 'DELIVERED'] }, paidAt: { gte: since } }, _count: true,
    });
    const sold = new Map(sales.map((s) => [s.variantId, s._count]));
    return products.map((p) => ({
      ...p,
      sales30d: p.variants.reduce((a, v) => a + (sold.get(v.id) ?? 0), 0),
      variants: p.variants.map((v) => ({ ...v, codesLeft: left.get(v.id) ?? 0 })),
    }));
  });

  const productBody = z.object({
    categoryId: bodyId,
    title: z.string().trim().min(1).max(80),
    subtitle: z.string().max(120).default(''),
    description: z.string().max(4000).default(''),
    icon: z.string().max(20).default('star'),
    glass: z.enum(['RED', 'WHITE', 'DARK']).default('RED'),
    deliveryType: z.enum(['MANUAL', 'CODES']).default('MANUAL'),
    needsRecipient: z.boolean().default(true),
    recipientKind: z.enum(['USERNAME', 'PHONE', 'STEAM']).default('USERNAME'),
    access: z.enum(['UNSPECIFIED', 'NO_LOGIN', 'WITH_LOGIN', 'GIFT']).default('UNSPECIFIED'),
    wholesale: z.boolean().default(false),
    isActive: z.boolean().default(true),
    isHit: z.boolean().default(false),
    sort: int4.default(0),
  });
  app.post('/api/admin/products', async (req) => prisma.product.create({ data: productBody.parse(req.body) }));
  app.patch('/api/admin/products/:id', async (req) =>
    prisma.product.update({ where: { id: idParam(req) }, data: productBody.partial().parse(req.body) }));
  app.delete('/api/admin/products/:id', async (req) => {
    const id = idParam(req);
    const hasOrders = await prisma.order.count({ where: { variant: { productId: id } } });
    // Товар с заказами не удаляем, а скрываем, чтобы не потерять историю
    if (hasOrders) return prisma.product.update({ where: { id }, data: { isActive: false } });
    return prisma.product.delete({ where: { id } });
  });

  const variantBody = z.object({
    title: z.string().trim().min(1).max(40),
    price: int4.positive(),
    oldPrice: int4.positive().nullable().optional(),
    cost: int4.min(0).default(0),
    isActive: z.boolean().default(true),
    sort: int4.default(0),
    // своё количество: price и cost за единицу
    perUnit: z.boolean().optional(),
    unit: z.string().trim().max(20).optional(),
    minQty: int4.positive().optional(),
    maxQty: int4.positive().optional(),
  });
  app.post('/api/admin/products/:id/variants', async (req) =>
    prisma.variant.create({ data: { ...variantBody.parse(req.body), productId: idParam(req) } }));
  app.patch('/api/admin/variants/:id', async (req) =>
    prisma.variant.update({ where: { id: idParam(req) }, data: variantBody.partial().parse(req.body) }));
  app.delete('/api/admin/variants/:id', async (req) => {
    const id = idParam(req);
    if (await prisma.order.count({ where: { variantId: id } }))
      return prisma.variant.update({ where: { id }, data: { isActive: false } });
    return prisma.variant.delete({ where: { id } });
  });

  /** Загрузка кодов: по одному в строке */
  app.post('/api/admin/variants/:id/codes', async (req) => {
    const { codes } = z.object({ codes: z.string() }).parse(req.body);
    const values = [...new Set(codes.split(/\r?\n/).map((s) => s.trim()).filter(Boolean))];
    const r = await prisma.code.createMany({ data: values.map((value) => ({ value, variantId: idParam(req) })) });
    return { added: r.count };
  });

  // ---------- отзывы ----------
  app.get('/api/admin/reviews', async (req) => {
    const q = z.object({
      filter: z.enum(['all', 'visible', 'hidden', 'low']).default('all'),
      before: dbId.optional(),
      at: z.coerce.date().min(new Date('2000-01-01T00:00:00Z')).max(new Date('9999-12-31T23:59:59Z')).optional(),
    }).parse(req.query);
    const where = {
      ...(q.filter === 'visible' ? { isHidden: false } : q.filter === 'hidden' ? { isHidden: true } : {}),
      ...(q.filter === 'low' ? { rating: { lte: 3 } } : {}),
    };
    // Сверху новые и только что изменённые покупателем. before и at — id и время последнего отзыва прошлой страницы:
    // следующая страница начинается строго после него в том же порядке (activityAt, id). Время берём из страницы,
    // а не из базы: если покупатель успел изменить этот отзыв, он уехал наверх, и страница иначе повторилась бы
    const after = !q.before ? null
      : q.at ? { id: q.before, activityAt: q.at }
      : await prisma.review.findUnique({ where: { id: q.before }, select: { id: true, activityAt: true } });
    const page = after ? { OR: [{ activityAt: { lt: after.activityAt } }, { activityAt: after.activityAt, id: { lt: after.id } }] } : {};
    const [items, all, visible] = await Promise.all([
      q.before && !after ? Promise.resolve([]) : prisma.review.findMany({
        where: { ...where, ...page }, orderBy: [{ activityAt: 'desc' }, { id: 'desc' }], take: 50,
        include: {
          user: { select: { tgId: true, username: true, firstName: true } },
          product: { select: { title: true, access: true, icon: true, glass: true } },
          order: { select: { id: true, variant: { select: { title: true } } } },
        },
      }),
      prisma.review.aggregate({ _avg: { rating: true }, _count: { _all: true } }),
      prisma.review.count({ where: { isHidden: false } }),
    ]);
    return {
      items,
      total: all._count._all,
      visible,
      avg: all._count._all ? Math.round((all._avg.rating ?? 0) * 10) / 10 : 0,
      nextBefore: items.length === 50 ? items[items.length - 1].id : null,
      nextAt: items.length === 50 ? items[items.length - 1].activityAt : null,
    };
  });
  app.patch('/api/admin/reviews/:id', async (req) => {
    const { isHidden } = z.object({ isHidden: z.boolean() }).parse(req.body);
    const id = idParam(req);
    if (!(await prisma.review.findUnique({ where: { id }, select: { id: true } }))) throw new ShopError('not_found', 'Отзыв не найден', 404);
    return prisma.review.update({ where: { id }, data: { isHidden } });
  });

  // ---------- промокоды ----------
  app.get('/api/admin/promocodes', async () => prisma.promoCode.findMany({ orderBy: { id: 'desc' } }));
  app.post('/api/admin/promocodes', async (req) => {
    const b = z.object({
      code: z.string().trim().min(2).max(40).transform((s) => s.toUpperCase()),
      amount: int4.min(0).default(0),
      percent: z.number().int().min(0).max(100).default(0),
      usesLeft: int4.positive().nullable().optional(),
    }).parse(req.body);
    return prisma.promoCode.create({ data: b });
  });

  // ---------- настройки ----------
  app.get('/api/admin/settings', async () => getSettings());
  app.patch('/api/admin/settings', async (req) => saveSettings(req.body as object));
}
