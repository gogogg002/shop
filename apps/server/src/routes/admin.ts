import type { FastifyInstance } from 'fastify';
import type { OrderStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { requireAdmin } from '../auth/plugin.js';
import { getSettings, saveSettings } from '../services/settings.js';
import { ShopError, addMessage, confirmManual, deliver, rejectManual } from '../services/orders.js';

const idParam = (req: { params: unknown }) => Number((req.params as { id: string }).id);

const orderView = {
  user: { select: { tgId: true, username: true, firstName: true } },
  variant: { include: { product: { select: { title: true, icon: true, glass: true, deliveryType: true } } } },
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
    const b = z.object({ slug: z.string().min(1), title: z.string().min(1), sort: z.number().int().default(0) }).parse(req.body);
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
    categoryId: z.number().int(),
    title: z.string().trim().min(1).max(80),
    subtitle: z.string().max(120).default(''),
    description: z.string().max(4000).default(''),
    icon: z.string().max(20).default('star'),
    glass: z.enum(['RED', 'WHITE', 'DARK']).default('RED'),
    deliveryType: z.enum(['MANUAL', 'CODES']).default('MANUAL'),
    needsRecipient: z.boolean().default(true),
    isActive: z.boolean().default(true),
    isHit: z.boolean().default(false),
    sort: z.number().int().default(0),
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
    price: z.number().int().positive(),
    oldPrice: z.number().int().positive().nullable().optional(),
    cost: z.number().int().min(0).default(0),
    isActive: z.boolean().default(true),
    sort: z.number().int().default(0),
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

  // ---------- промокоды ----------
  app.get('/api/admin/promocodes', async () => prisma.promoCode.findMany({ orderBy: { id: 'desc' } }));
  app.post('/api/admin/promocodes', async (req) => {
    const b = z.object({
      code: z.string().trim().min(2).max(40).transform((s) => s.toUpperCase()),
      amount: z.number().int().min(0).default(0),
      percent: z.number().int().min(0).max(100).default(0),
      usesLeft: z.number().int().positive().nullable().optional(),
    }).parse(req.body);
    return prisma.promoCode.create({ data: b });
  });

  // ---------- настройки ----------
  app.get('/api/admin/settings', async () => getSettings());
  app.patch('/api/admin/settings', async (req) => saveSettings(req.body as object));
}
