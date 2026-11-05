import type { AccessMode, Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { ShopError } from './orders.js';
import { notifier } from './notify.js';

export const REVIEW_TEXT_MAX = 1000;

/** Имя автора на витрине: только имя, без username и фамилии */
export function authorName(u: { firstName: string | null }) {
  const name = (u.firstName ?? '').trim().split(/\s+/)[0] ?? '';
  return name ? name.slice(0, 24) : 'Покупатель';
}

/**
 * Отзыв по своему выданному заказу. Один на заказ: повторная отправка правит оценку и текст.
 * Админам уходит уведомление только о новом отзыве.
 */
export async function submitReview(orderId: number, userId: number, input: { rating: number; text?: string }) {
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5)
    throw new ShopError('bad_rating', 'Поставьте оценку от 1 до 5');
  const text = (input.text ?? '').trim().slice(0, REVIEW_TEXT_MAX);

  const order = await prisma.order.findFirst({
    where: { id: orderId, userId },
    include: { user: true, variant: { include: { product: true } }, review: { select: { id: true } } },
  });
  if (!order) throw new ShopError('not_found', 'Заказ не найден', 404);
  if (order.status !== 'DELIVERED') throw new ShopError('bad_state', 'Отзыв можно оставить, когда заказ выполнен');

  const isNew = !order.review;
  const review = await prisma.review.upsert({
    where: { orderId },
    create: { orderId, userId, productId: order.variant.productId, rating: input.rating, text },
    update: { rating: input.rating, text },
  });

  if (isNew) {
    const who = [order.user.firstName, order.user.username ? `@${order.user.username}` : null].filter(Boolean).join(' ');
    try {
      await notifier().newReview({
        orderId, rating: review.rating, text: review.text,
        product: order.variant.product.title, variant: order.variant.title, author: who || String(order.user.tgId),
      });
    } catch (e) {
      console.error('review notify failed', (e as Error).message);
    }
  }
  return review;
}

/**
 * Товары одной карточки: то же название в той же категории и указан режим входа
 * («Без входа» и «Со входом» показываются вкладками одного товара).
 */
export const titleKey = (title: string) => title.trim().replace(/\s+/g, ' ').toLowerCase();

export async function productGroup(p: { id: number; categoryId: number; title: string; access: AccessMode }) {
  if (p.access === 'UNSPECIFIED') return [p.id];
  const candidates = await prisma.product.findMany({
    where: { categoryId: p.categoryId, access: { not: 'UNSPECIFIED' } },
    select: { id: true, title: true },
  });
  const key = titleKey(p.title);
  return [...new Set([p.id, ...candidates.filter((x) => titleKey(x.title) === key).map((x) => x.id)])];
}

export async function ratingSummary(where: Prisma.ReviewWhereInput = {}) {
  const r = await prisma.review.aggregate({ where: { isHidden: false, ...where }, _avg: { rating: true }, _count: { _all: true } });
  const count = r._count._all;
  return { avg: count ? Math.round((r._avg.rating ?? 0) * 10) / 10 : 0, count };
}

const publicInclude = {
  user: { select: { firstName: true } },
  product: { select: { title: true, access: true } },
  order: { select: { variant: { select: { title: true } } } },
} satisfies Prisma.ReviewInclude;

type PublicRow = Prisma.ReviewGetPayload<{ include: typeof publicInclude }>;

const toPublic = (r: PublicRow) => ({
  id: r.id, rating: r.rating, text: r.text, author: authorName(r.user),
  product: r.product.title, access: r.product.access, variant: r.order.variant.title, createdAt: r.createdAt,
});

export async function listReviews(opts: { productIds?: number[]; limit: number; before?: number }) {
  const rows = await prisma.review.findMany({
    where: {
      isHidden: false,
      ...(opts.productIds ? { productId: { in: opts.productIds } } : {}),
      ...(opts.before ? { id: { lt: opts.before } } : {}),
    },
    orderBy: { id: 'desc' },
    take: opts.limit,
    include: publicInclude,
  });
  return rows.map(toPublic);
}
