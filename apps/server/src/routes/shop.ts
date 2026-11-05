import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireUser } from '../auth/plugin.js';
import { getSettings } from '../services/settings.js';
import { autoProviders, isManual } from '../payments/index.js';
import {
  ShopError, addMessage, cancelByUser, computeTotal, createOrder, manualInstructions, submitProof,
} from '../services/orders.js';

const METHODS = ['CRYPTOBOT', 'XROCKET', 'LOLZ', 'SBP', 'UAH'] as const;

/** Какие методы реально можно выбрать: включены в админке и настроены */
async function availableMethods() {
  const s = await getSettings();
  return METHODS.filter((m) => {
    if (!s.methods[m]) return false;
    if (m === 'UAH') return Boolean(s.uah.card);
    if (m === 'SBP') return Boolean(s.sbp.phone);
    return Boolean(autoProviders[m]?.isConfigured());
  }).map((m) => ({ method: m, fee: s.fees[m] ?? 0, manual: isManual(m) }));
}

export async function shopRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser);

  app.get('/api/me', async (req) => {
    const s = await getSettings();
    return {
      user: { id: req.user.id, username: req.user.username, firstName: req.user.firstName, balance: req.user.balance },
      isAdmin: req.isAdmin,
      methods: await availableMethods(),
      supportUsername: s.supportUsername,
    };
  });

  app.get('/api/catalog', async () => {
    const categories = await prisma.category.findMany({
      orderBy: { sort: 'asc' },
      include: {
        products: {
          where: { isActive: true },
          orderBy: { sort: 'asc' },
          include: { variants: { where: { isActive: true }, orderBy: { sort: 'asc' } } },
        },
      },
    });
    return categories
      .map((c) => ({
        ...c,
        products: c.products
          .filter((p) => p.variants.length)
          .map((p) => ({
            id: p.id, title: p.title, subtitle: p.subtitle, icon: p.icon, glass: p.glass, isHit: p.isHit,
            minPrice: Math.min(...p.variants.map((v) => v.price)),
          })),
      }))
      .filter((c) => c.products.length);
  });

  app.get('/api/products/:id', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const p = await prisma.product.findFirst({
      where: { id, isActive: true },
      include: { variants: { where: { isActive: true }, orderBy: { sort: 'asc' } }, category: true },
    });
    if (!p) throw new ShopError('not_found', 'Товар не найден', 404);
    const stock = p.deliveryType === 'CODES'
      ? Object.fromEntries(await Promise.all(p.variants.map(async (v) =>
          [v.id, await prisma.code.count({ where: { variantId: v.id, orderId: null } })] as const)))
      : null;
    return {
      id: p.id, title: p.title, subtitle: p.subtitle, description: p.description, icon: p.icon, glass: p.glass,
      category: p.category.title, needsRecipient: p.needsRecipient, deliveryType: p.deliveryType,
      variants: p.variants.map((v) => ({
        id: v.id, title: v.title, price: v.price, oldPrice: v.oldPrice, inStock: stock ? (stock[v.id] ?? 0) > 0 : true,
      })),
    };
  });

  const quoteBody = z.object({ variantId: z.number().int(), method: z.enum(METHODS), promoCode: z.string().optional() });
  app.post('/api/orders/quote', async (req) => {
    const b = quoteBody.parse(req.body);
    const s = await getSettings();
    const v = await prisma.variant.findUnique({ where: { id: b.variantId } });
    if (!v) throw new ShopError('not_found', 'Товар не найден', 404);
    let promo = null;
    if (b.promoCode) {
      promo = await prisma.promoCode.findUnique({ where: { code: b.promoCode.trim().toUpperCase() } });
      if (!promo || (promo.expiresAt && promo.expiresAt < new Date()) || promo.usesLeft === 0)
        throw new ShopError('bad_promo', 'Промокод не найден или истёк');
    }
    return { price: v.price, ...computeTotal(v.price, s.fees[b.method] ?? 0, promo) };
  });

  const createBody = z.object({
    variantId: z.number().int(),
    method: z.enum(METHODS),
    recipient: z.string().max(40).optional(),
    promoCode: z.string().max(40).optional(),
  });
  app.post('/api/orders', async (req) => {
    const b = createBody.parse(req.body);
    const order = await createOrder({ userId: req.user.id, ...b });
    return { id: order.id, payUrl: order.payUrl, status: order.status };
  });

  app.get('/api/orders', async (req) => {
    const orders = await prisma.order.findMany({
      where: { userId: req.user.id },
      orderBy: { id: 'desc' },
      take: 50,
      include: { variant: { include: { product: true } } },
    });
    return orders.map((o) => ({
      id: o.id, status: o.status, method: o.method, amount: o.amount, payAmount: o.payAmount, createdAt: o.createdAt,
      product: o.variant.product.title, variant: o.variant.title, icon: o.variant.product.icon, glass: o.variant.product.glass,
      recipient: o.recipient, deliveredText: o.deliveredText, payUrl: o.status === 'PENDING_PAYMENT' ? o.payUrl : null,
    }));
  });

  app.get('/api/orders/:id', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const o = await prisma.order.findFirst({
      where: { id, userId: req.user.id },
      include: { variant: { include: { product: true } }, messages: { orderBy: { id: 'asc' } } },
    });
    if (!o) throw new ShopError('not_found', 'Заказ не найден', 404);
    const s = await getSettings();
    return {
      id: o.id, status: o.status, method: o.method, amount: o.amount, discount: o.discount, payAmount: o.payAmount,
      createdAt: o.createdAt, recipient: o.recipient, deliveredText: o.deliveredText,
      product: o.variant.product.title, variant: o.variant.title, icon: o.variant.product.icon, glass: o.variant.product.glass,
      payUrl: o.status === 'PENDING_PAYMENT' ? o.payUrl : null,
      manual: isManual(o.method) ? manualInstructions(o, s) : null,
      messages: o.messages.map((m) => ({ id: m.id, text: m.text, fromAdmin: m.fromAdmin, createdAt: m.createdAt })),
    };
  });

  app.post('/api/orders/:id/proof', async (req) => {
    const id = Number((req.params as { id: string }).id);
    let photo: Buffer | null = null;
    let note = '';
    if (req.isMultipart()) {
      for await (const part of req.parts()) {
        if (part.type === 'file') photo = await part.toBuffer();
        else if (part.fieldname === 'note') note = String(part.value ?? '');
      }
    } else {
      note = String((req.body as { note?: string } | undefined)?.note ?? '');
    }
    const o = await submitProof(id, req.user.id, photo, note);
    return { id: o.id, status: o.status };
  });

  app.post('/api/orders/:id/cancel', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const o = await cancelByUser(id, req.user.id);
    return { id: o!.id, status: o!.status };
  });

  const msgBody = z.object({ text: z.string().trim().min(1).max(2000) });
  app.post('/api/orders/:id/messages', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const o = await prisma.order.findFirst({ where: { id, userId: req.user.id } });
    if (!o) throw new ShopError('not_found', 'Заказ не найден', 404);
    const m = await addMessage(id, { userId: req.user.id, text: msgBody.parse(req.body).text, fromAdmin: false });
    return { id: m.id, text: m.text, fromAdmin: false, createdAt: m.createdAt };
  });
}
