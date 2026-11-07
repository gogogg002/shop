import { Prisma, type AccessMode } from '@prisma/client';
import { prisma } from '../db.js';
import { ShopError } from './orders.js';
import { notifier, type ReviewNotice } from './notify.js';
import { cleanText, variantLabel } from './labels.js';

export const REVIEW_TEXT_MAX = 1000;

/**
 * Правки отзыва: каждая уходит админам уведомлением (иначе правка в обход модерации сразу попадает на витрину),
 * поэтому между правками пауза и их число ограничено. Поля изменяемые, чтобы тесты могли убрать паузу.
 */
export const reviewPolicy = { editCooldownMs: 10_000, maxEdits: 5 };

/** Имя автора на витрине: только имя, без username и фамилии. Режем по символам, а не по UTF-16 (эмодзи в имени) */
export function authorName(u: { firstName: string | null }) {
  const name = (u.firstName ?? '').trim().split(/\s+/)[0] ?? '';
  return name ? Array.from(name).slice(0, 24).join('') : 'Покупатель';
}

const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

/**
 * Отзыв по своему выданному заказу. Один на заказ: повторная отправка правит оценку и текст.
 * Новый отзыв создаётся одной вставкой, поэтому параллельные отправки дают один отзыв и одно уведомление.
 */
export async function submitReview(orderId: number, userId: number, input: { rating: number; text?: string }) {
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5)
    throw new ShopError('bad_rating', 'Поставьте оценку от 1 до 5');
  const text = Array.from(cleanText(input.text ?? '').trim()).slice(0, REVIEW_TEXT_MAX).join('').trim();

  const order = await prisma.order.findFirst({
    where: { id: orderId, userId },
    include: { user: true, variant: { include: { product: true } }, review: { select: { id: true } } },
  });
  if (!order) throw new ShopError('not_found', 'Заказ не найден', 404);
  if (order.status !== 'DELIVERED') throw new ShopError('bad_state', 'Отзыв можно оставить, когда заказ выполнен');

  const notice = {
    orderId, product: order.variant.product.title, variant: variantLabel(order.variant, order.quantity), access: order.variant.product.access,
    author: [order.user.firstName, order.user.username ? `@${order.user.username}` : null].filter(Boolean).join(' ') || String(order.user.tgId),
  };

  if (!order.review) {
    try {
      const review = await prisma.review.create({
        data: { orderId, userId, productId: order.variant.productId, rating: input.rating, text, activityAt: new Date() },
      });
      await notify({ ...notice, rating: review.rating, text: review.text });
      return review;
    } catch (e) {
      // Параллельный запрос успел создать отзыв первым: эта отправка становится правкой
      if (!isUniqueViolation(e)) throw e;
    }
  }

  const current = await prisma.review.findUniqueOrThrow({ where: { orderId } });
  if (current.rating === input.rating && current.text === text) return current; // двойное нажатие: ничего не изменилось

  const now = new Date();
  // Условие в самом UPDATE: из одновременных правок пройдёт одна, остальные упрутся в паузу или лимит
  const changed = await prisma.review.updateMany({
    where: {
      orderId,
      editCount: { lt: reviewPolicy.maxEdits },
      activityAt: { lte: new Date(now.getTime() - reviewPolicy.editCooldownMs) },
    },
    data: { rating: input.rating, text, editCount: { increment: 1 }, activityAt: now },
  });
  if (!changed.count) {
    const fresh = await prisma.review.findUniqueOrThrow({ where: { orderId } });
    // Одновременная такая же правка (повтор запроса) уже сохранила то же самое: это успех, а не «слишком часто»
    if (fresh.rating === input.rating && fresh.text === text) return fresh;
    if (fresh.editCount >= reviewPolicy.maxEdits)
      throw new ShopError('edit_limit', `Отзыв можно изменить не больше ${reviewPolicy.maxEdits} раз`);
    const wait = Math.max(1, Math.ceil((fresh.activityAt.getTime() + reviewPolicy.editCooldownMs - now.getTime()) / 1000));
    throw new ShopError('too_fast', `Изменить отзыв можно через ${wait} сек.`, 429);
  }

  const review = await prisma.review.findUniqueOrThrow({ where: { orderId } });
  await notify({ ...notice, rating: review.rating, text: review.text, edited: { rating: current.rating, text: current.text } });
  return review;
}

async function notify(n: ReviewNotice) {
  try {
    await notifier().newReview(n);
  } catch (e) {
    console.error('review notify failed', (e as Error).message);
  }
}

/**
 * Товары одной карточки: то же название в той же категории и указан режим входа
 * («Без входа» и «Со входом» показываются вкладками одного товара).
 */
export const titleKey = (title: string) => title.trim().replace(/\s+/g, ' ').toLowerCase();

/** Порядок товаров везде одинаковый: так и каталог, и карточка выбирают одних и тех же «главных» */
export const productOrder = [{ sort: 'asc' }, { id: 'asc' }] satisfies Prisma.ProductOrderByWithRelationInput[];

/**
 * Из товаров с одинаковым названием в группу попадает по одному на режим: первый по порядку.
 * Второй товар с тем же режимом (дубль) живёт отдельной карточкой. null — товар сам по себе.
 */
export function groupOf<T extends { id: number; title: string; access: AccessMode }>(p: T, ordered: T[]): T[] | null {
  if (p.access === 'UNSPECIFIED') return null;
  const key = titleKey(p.title);
  const lead = new Map<AccessMode, T>();
  for (const x of ordered) if (x.access !== 'UNSPECIFIED' && titleKey(x.title) === key && !lead.has(x.access)) lead.set(x.access, x);
  return lead.get(p.access)?.id === p.id ? [...lead.values()] : null;
}

/** Активные товары карточки вместе с вкладками. Скрытые вкладки и их отзывы в карточку не входят */
export async function productGroup(p: { id: number; categoryId: number; title: string; access: AccessMode }) {
  if (p.access === 'UNSPECIFIED') return [p.id];
  const candidates = await prisma.product.findMany({
    where: { categoryId: p.categoryId, isActive: true, access: { not: 'UNSPECIFIED' }, variants: { some: { isActive: true } } },
    select: { id: true, title: true, access: true },
    orderBy: productOrder,
  });
  return groupOf(p, candidates)?.map((x) => x.id) ?? [p.id];
}

export async function ratingSummary(where: Prisma.ReviewWhereInput = {}) {
  const r = await prisma.review.aggregate({ where: { isHidden: false, ...where }, _avg: { rating: true }, _count: { _all: true } });
  const count = r._count._all;
  return { avg: count ? Math.round((r._avg.rating ?? 0) * 10) / 10 : 0, count };
}

const publicInclude = {
  user: { select: { firstName: true } },
  product: { select: { title: true, access: true } },
  order: { select: { quantity: true, variant: { select: { title: true, perUnit: true, unit: true } } } },
} satisfies Prisma.ReviewInclude;

type PublicRow = Prisma.ReviewGetPayload<{ include: typeof publicInclude }>;

const toPublic = (r: PublicRow) => ({
  id: r.id, rating: r.rating, text: r.text, author: authorName(r.user),
  product: r.product.title, access: r.product.access, variant: variantLabel(r.order.variant, r.order.quantity), createdAt: r.createdAt,
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
