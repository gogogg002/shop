import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireUser } from '../auth/plugin.js';
import { getSettings } from '../services/settings.js';
import { autoProviders, isManual } from '../payments/index.js';
import {
  ShopError, addMessage, cancelByUser, computeTotal, createOrder, manualInstructions, normalizeRecipient, submitProof,
} from '../services/orders.js';
import { REVIEW_TEXT_MAX, groupOf, listReviews, productGroup, productOrder, ratingSummary, submitReview } from '../services/reviews.js';
import { ACCESS_LABEL } from '../services/labels.js';
import { dbId, pathId } from './ids.js';
import type { AccessMode } from '@prisma/client';

const METHODS = ['CRYPTOBOT', 'XROCKET', 'LOLZ', 'SBP', 'UAH'] as const;

/** Вкладки одного товара: сначала «Без входа», потом «Со входом» */
const ACCESS_ORDER: Record<AccessMode, number> = { NO_LOGIN: 0, WITH_LOGIN: 1, UNSPECIFIED: 2 };

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
          orderBy: productOrder,
          include: { variants: { where: { isActive: true }, orderBy: { sort: 'asc' } } },
        },
      },
    });
    return categories
      .map((c) => {
        // Товары с одинаковым названием и разным режимом входа — одна карточка с вкладками.
        // По одному товару на режим: дубль того же режима идёт отдельной карточкой (как и на странице товара)
        const listed = c.products.filter((x) => x.variants.length);
        const groups = new Map<number, typeof listed>();
        for (const p of listed) {
          const g = groupOf(p, listed);
          if (!g) groups.set(p.id, [p]);
          else if (!groups.has(g[0].id)) groups.set(g[0].id, g);
        }
        const products = [...groups.values()].map((g) => {
          const sorted = [...g].sort((a, b) => ACCESS_ORDER[a.access] - ACCESS_ORDER[b.access]);
          const first = sorted[0];
          const modes = sorted.map((p) => p.access).filter((a) => a !== 'UNSPECIFIED');
          return {
            id: first.id, title: first.title, icon: first.icon, glass: first.glass,
            subtitle: modes.length > 1 ? modes.map((m) => ACCESS_LABEL[m]).join(' · ') : first.subtitle,
            isHit: g.some((p) => p.isHit),
            access: first.access,
            modes,
            minPrice: Math.min(...g.flatMap((p) => p.variants.map((v) => v.price))),
          };
        });
        return { id: c.id, slug: c.slug, title: c.title, sort: c.sort, products };
      })
      .filter((c) => c.products.length);
  });

  app.get('/api/products/:id', async (req) => {
    const id = pathId(req, 'Товар не найден');
    const p = await prisma.product.findFirst({
      where: { id, isActive: true },
      include: { variants: { where: { isActive: true }, orderBy: { sort: 'asc' } }, category: true },
    });
    if (!p) throw new ShopError('not_found', 'Товар не найден', 404);
    const stock = p.deliveryType === 'CODES'
      ? Object.fromEntries(await Promise.all(p.variants.map(async (v) =>
          [v.id, await prisma.code.count({ where: { variantId: v.id, orderId: null } })] as const)))
      : null;

    const groupIds = await productGroup(p);
    const siblings = groupIds.length > 1
      ? (await prisma.product.findMany({
          where: { id: { in: groupIds }, isActive: true, variants: { some: { isActive: true } } },
          select: { id: true, access: true },
        }))
          .sort((a, b) => ACCESS_ORDER[a.access] - ACCESS_ORDER[b.access])
          .map((x) => ({ id: x.id, access: x.access, label: ACCESS_LABEL[x.access] }))
      : [];
    const s = await getSettings();

    return {
      id: p.id, title: p.title, subtitle: p.subtitle, description: p.description, icon: p.icon, glass: p.glass,
      category: p.category.title, needsRecipient: p.needsRecipient, recipientKind: p.recipientKind,
      deliveryType: p.deliveryType, access: p.access,
      wholesale: p.wholesale && Boolean(s.supportUsername),
      siblings: siblings.length > 1 ? siblings : [],
      variants: p.variants.map((v) => ({
        id: v.id, title: v.title, price: v.price, oldPrice: v.oldPrice, inStock: stock ? (stock[v.id] ?? 0) > 0 : true,
      })),
      rating: await ratingSummary({ productId: { in: groupIds } }),
      reviews: await listReviews({ productIds: groupIds, limit: 3 }),
    };
  });

  /** Отзывы на витрине: все или по товару (вместе с его вкладками «Без входа / Со входом») */
  app.get('/api/reviews', async (req) => {
    const q = z.object({
      productId: dbId.optional(),
      limit: z.coerce.number().int().min(0).max(50).default(20),
      before: dbId.optional(),
    }).parse(req.query);
    let productIds: number[] | undefined;
    if (q.productId) {
      // Скрытый товар не отдаём и здесь: его страница тоже 404
      const p = await prisma.product.findFirst({ where: { id: q.productId, isActive: true } });
      if (!p) throw new ShopError('not_found', 'Товар не найден', 404);
      productIds = await productGroup(p);
    }
    const items = q.limit ? await listReviews({ productIds, limit: q.limit, before: q.before }) : [];
    return {
      summary: await ratingSummary(productIds ? { productId: { in: productIds } } : {}),
      items,
      nextBefore: items.length === q.limit && items.length ? items[items.length - 1].id : null,
    };
  });

  const quoteBody = z.object({
    variantId: z.number().int(), method: z.enum(METHODS), promoCode: z.string().optional(), recipient: z.string().max(40).optional(),
  });
  app.post('/api/orders/quote', async (req) => {
    const b = quoteBody.parse(req.body);
    const s = await getSettings();
    const v = await prisma.variant.findUnique({ where: { id: b.variantId }, include: { product: true } });
    if (!v) throw new ShopError('not_found', 'Товар не найден', 404);
    let promo = null;
    if (b.promoCode) {
      promo = await prisma.promoCode.findUnique({ where: { code: b.promoCode.trim().toUpperCase() } });
      if (!promo || (promo.expiresAt && promo.expiresAt < new Date()) || promo.usesLeft === 0)
        throw new ShopError('bad_promo', 'Промокод не найден или истёк');
    }
    return {
      price: v.price, title: v.product.title, variant: v.title, icon: v.product.icon, glass: v.product.glass,
      // получатель в том виде, в каком его сохранит заказ (null — не разобрали)
      recipientKind: v.product.recipientKind,
      recipient: v.product.needsRecipient ? normalizeRecipient(v.product.recipientKind, b.recipient) : null,
      ...computeTotal(v.price, s.fees[b.method] ?? 0, promo),
    };
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
      include: { variant: { include: { product: true } }, review: { select: { id: true } } },
    });
    return orders.map((o) => ({
      id: o.id, status: o.status, method: o.method, amount: o.amount, payAmount: o.payAmount, createdAt: o.createdAt,
      product: o.variant.product.title, variant: o.variant.title, icon: o.variant.product.icon, glass: o.variant.product.glass,
      access: o.variant.product.access,
      recipient: o.recipient, deliveredText: o.deliveredText, payUrl: o.status === 'PENDING_PAYMENT' ? o.payUrl : null,
      reviewed: Boolean(o.review),
    }));
  });

  app.get('/api/orders/:id', async (req) => {
    const id = pathId(req, 'Заказ не найден');
    const o = await prisma.order.findFirst({
      where: { id, userId: req.user.id },
      include: { variant: { include: { product: true } }, messages: { orderBy: { id: 'asc' } }, review: true },
    });
    if (!o) throw new ShopError('not_found', 'Заказ не найден', 404);
    const s = await getSettings();
    return {
      id: o.id, status: o.status, method: o.method, amount: o.amount, discount: o.discount, payAmount: o.payAmount,
      createdAt: o.createdAt, recipient: o.recipient, deliveredText: o.deliveredText,
      product: o.variant.product.title, variant: o.variant.title, icon: o.variant.product.icon, glass: o.variant.product.glass,
      access: o.variant.product.access, productId: o.variant.productId,
      payUrl: o.status === 'PENDING_PAYMENT' ? o.payUrl : null,
      manual: isManual(o.method) ? manualInstructions(o, s) : null,
      messages: o.messages.map((m) => ({ id: m.id, text: m.text, fromAdmin: m.fromAdmin, createdAt: m.createdAt })),
      reviewed: Boolean(o.review),
      review: o.review ? { rating: o.review.rating, text: o.review.text, createdAt: o.review.createdAt } : null,
      canReview: o.status === 'DELIVERED',
    };
  });

  app.post('/api/orders/:id/proof', async (req) => {
    const id = pathId(req, 'Заказ не найден');
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
    const id = pathId(req, 'Заказ не найден');
    const o = await cancelByUser(id, req.user.id);
    return { id: o!.id, status: o!.status };
  });

  const reviewBody = z.object({
    rating: z.number().int().min(1, 'Поставьте оценку от 1 до 5').max(5, 'Поставьте оценку от 1 до 5'),
    text: z.string().max(REVIEW_TEXT_MAX * 2).optional(),
  });
  app.post('/api/orders/:id/review', async (req) => {
    const id = pathId(req, 'Заказ не найден');
    const b = reviewBody.parse(req.body);
    const r = await submitReview(id, req.user.id, b);
    return { rating: r.rating, text: r.text, createdAt: r.createdAt };
  });

  const msgBody = z.object({ text: z.string().trim().min(1).max(2000) });
  app.post('/api/orders/:id/messages', async (req) => {
    const id = pathId(req, 'Заказ не найден');
    const o = await prisma.order.findFirst({ where: { id, userId: req.user.id } });
    if (!o) throw new ShopError('not_found', 'Заказ не найден', 404);
    const m = await addMessage(id, { userId: req.user.id, text: msgBody.parse(req.body).text, fromAdmin: false });
    return { id: m.id, text: m.text, fromAdmin: false, createdAt: m.createdAt };
  });
}
