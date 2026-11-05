import type { PaymentMethod, Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { autoProviders, isManual } from '../payments/index.js';
import { getSettings, type ShopSettings } from './settings.js';
import { notifier, type OrderView } from './notify.js';

export class ShopError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

const withRefs = { user: true, variant: { include: { product: true } } } satisfies Prisma.OrderInclude;

export const loadOrder = (id: number) =>
  prisma.order.findUnique({ where: { id }, include: withRefs }) as Promise<OrderView | null>;

/** Итоговая цена: цена варианта − промокод + комиссия метода. Всё в копейках. */
export function computeTotal(price: number, feePercent: number, promo?: { amount: number; percent: number } | null) {
  let discount = 0;
  if (promo) discount = Math.min(price, promo.amount + Math.round((price * promo.percent) / 100));
  const afterPromo = price - discount;
  const fee = Math.round((afterPromo * feePercent) / 100);
  return { discount, fee, amount: afterPromo + fee };
}

/** ₽ (копейки) → гривны, округление вверх до целой гривны */
export const rubToUah = (kop: number, rate: number) => Math.ceil(kop / 100 / rate);

export interface ManualInstructions {
  method: 'UAH' | 'SBP';
  amount: string;
  requisites: { label: string; value: string }[];
  comment: string;
}

export function manualInstructions(order: { id: number; method: PaymentMethod; amount: number }, s: ShopSettings): ManualInstructions {
  if (order.method === 'UAH') {
    return {
      method: 'UAH',
      amount: `${rubToUah(order.amount, s.uah.rate)} грн`,
      requisites: [
        { label: 'Карта', value: s.uah.card },
        { label: 'Получатель', value: s.uah.holder },
        { label: 'Банк', value: s.uah.bank },
      ].filter((r) => r.value),
      comment: `Заказ ${order.id}`,
    };
  }
  return {
    method: 'SBP',
    amount: `${(order.amount / 100).toFixed(0)} ₽`,
    requisites: [
      { label: 'Телефон', value: s.sbp.phone },
      { label: 'Получатель', value: s.sbp.holder },
      { label: 'Банк', value: s.sbp.bank },
    ].filter((r) => r.value),
    comment: `Заказ ${order.id}`,
  };
}

export async function createOrder(input: {
  userId: number;
  variantId: number;
  method: PaymentMethod;
  recipient?: string;
  promoCode?: string;
}) {
  const s = await getSettings();
  const variant = await prisma.variant.findUnique({ where: { id: input.variantId }, include: { product: true } });
  if (!variant || !variant.isActive || !variant.product.isActive) throw new ShopError('variant_unavailable', 'Товар недоступен');

  const recipient = input.recipient?.trim().replace(/^@?/, '@');
  if (variant.product.needsRecipient && (!recipient || !/^@[A-Za-z0-9_]{4,32}$/.test(recipient)))
    throw new ShopError('bad_recipient', 'Укажите username получателя, например @durov');

  if (input.method === 'BALANCE') throw new ShopError('method_unavailable', 'Оплата с баланса пока не подключена');
  const methodKey = input.method as keyof ShopSettings['methods'];
  if (!s.methods[methodKey]) throw new ShopError('method_unavailable', 'Этот способ оплаты сейчас выключен');

  const provider = autoProviders[input.method];
  if (!isManual(input.method) && !provider?.isConfigured())
    throw new ShopError('method_unavailable', 'Этот способ оплаты ещё не настроен');
  if (input.method === 'UAH' && !s.uah.card) throw new ShopError('method_unavailable', 'Оплата гривнами ещё не настроена');
  if (input.method === 'SBP' && !s.sbp.phone) throw new ShopError('method_unavailable', 'Оплата по СБП ещё не настроена');

  if (variant.product.deliveryType === 'CODES') {
    const left = await prisma.code.count({ where: { variantId: variant.id, orderId: null } });
    if (left === 0) throw new ShopError('out_of_stock', 'Коды закончились, загляните позже');
  }

  let promo = null;
  if (input.promoCode) {
    promo = await prisma.promoCode.findUnique({ where: { code: input.promoCode.trim().toUpperCase() } });
    const expired = promo?.expiresAt && promo.expiresAt < new Date();
    if (!promo || expired || promo.usesLeft === 0) throw new ShopError('bad_promo', 'Промокод не найден или истёк');
  }

  const { amount, discount } = computeTotal(variant.price, s.fees[methodKey] ?? 0, promo);

  let order = await prisma.order.create({
    data: {
      userId: input.userId,
      variantId: variant.id,
      recipient: variant.product.needsRecipient ? recipient : null,
      method: input.method,
      amount,
      discount,
      cost: variant.cost,
      promoCode: promo?.code,
    },
  });

  if (promo?.usesLeft != null) await prisma.promoCode.update({ where: { id: promo.id }, data: { usesLeft: { decrement: 1 } } });

  if (provider) {
    const inv = await provider.createInvoice({
      orderId: order.id,
      amountRub: amount,
      description: `${variant.product.title} · ${variant.title}`,
    });
    order = await prisma.order.update({
      where: { id: order.id },
      data: { externalId: inv.externalId, payUrl: inv.payUrl, payAmount: inv.payAmount },
    });
  } else {
    const ins = manualInstructions(order, s);
    order = await prisma.order.update({ where: { id: order.id }, data: { payAmount: ins.amount } });
  }
  return order;
}

/** Клиент прислал чек по ручной оплате */
export async function submitProof(orderId: number, userId: number, photo: Buffer | null, note?: string) {
  const order = await loadOrder(orderId);
  if (!order || order.userId !== userId) throw new ShopError('not_found', 'Заказ не найден', 404);
  if (!isManual(order.method)) throw new ShopError('bad_state', 'Этот заказ оплачивается автоматически');
  if (order.status !== 'PENDING_PAYMENT' && order.status !== 'AWAITING_CONFIRMATION')
    throw new ShopError('bad_state', 'Заказ уже обработан');

  const fileId = await notifier().manualPaymentProof({ ...order, status: 'AWAITING_CONFIRMATION' }, photo);
  const updated = await prisma.order.update({
    where: { id: orderId },
    data: { status: 'AWAITING_CONFIRMATION', proofFileId: fileId ?? order.proofFileId },
  });
  if (note?.trim()) await addMessage(orderId, { userId, text: note.trim(), fromAdmin: false });
  return updated;
}

/**
 * Перевод в «оплачено». Идемпотентно: повторный вебхук ничего не сломает.
 * Для товаров с кодами сразу выдаёт код.
 */
export async function markPaid(orderId: number) {
  const changed = await prisma.order.updateMany({
    where: { id: orderId, status: { in: ['PENDING_PAYMENT', 'AWAITING_CONFIRMATION'] } },
    data: { status: 'PAID', paidAt: new Date() },
  });
  if (changed.count === 0) return loadOrder(orderId);

  const order = (await loadOrder(orderId))!;
  if (order.variant.product.deliveryType === 'CODES') {
    const delivered = await deliverCode(orderId);
    if (delivered) return delivered;
  }
  await notifier().orderPaid(order);
  await notifier().orderStatusToUser(order, `Заказ №${order.id} оплачен. Выдадим в течение 30 минут.`);
  return order;
}

async function deliverCode(orderId: number) {
  const done = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    // FOR UPDATE SKIP LOCKED: два заказа одновременно не получат один код
    const rows = await tx.$queryRaw<{ id: number; value: string }[]>`
      SELECT id, value FROM "Code" WHERE "variantId" = ${order.variantId} AND "orderId" IS NULL
      ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`;
    const code = rows[0];
    if (!code) return null;
    await tx.code.update({ where: { id: code.id }, data: { orderId, usedAt: new Date() } });
    await tx.order.update({
      where: { id: orderId },
      data: { status: 'DELIVERED', deliveredAt: new Date(), deliveredText: code.value },
    });
    return code.value;
  });
  if (!done) return null;
  const order = (await loadOrder(orderId))!;
  await notifier().orderStatusToUser(order, `Заказ №${order.id} выдан. Код: ${done}`);
  return order;
}

export async function confirmManual(orderId: number) {
  const order = await loadOrder(orderId);
  if (!order) throw new ShopError('not_found', 'Заказ не найден', 404);
  if (!isManual(order.method)) throw new ShopError('bad_state', 'Заказ не на ручной оплате');
  return markPaid(orderId);
}

export async function rejectManual(orderId: number, reason: string) {
  const changed = await prisma.order.updateMany({
    where: { id: orderId, status: { in: ['PENDING_PAYMENT', 'AWAITING_CONFIRMATION'] } },
    data: { status: 'REJECTED' },
  });
  if (!changed.count) throw new ShopError('bad_state', 'Заказ уже обработан');
  const order = (await loadOrder(orderId))!;
  await addMessage(orderId, { text: `Оплата отклонена: ${reason}`, fromAdmin: true });
  await notifier().orderStatusToUser(order, `Оплата заказа №${order.id} отклонена: ${reason}`);
  return order;
}

export async function deliver(orderId: number, text?: string) {
  const changed = await prisma.order.updateMany({
    where: { id: orderId, status: 'PAID' },
    data: { status: 'DELIVERED', deliveredAt: new Date(), deliveredText: text || null },
  });
  if (!changed.count) throw new ShopError('bad_state', 'Выдать можно только оплаченный заказ');
  const order = (await loadOrder(orderId))!;
  await notifier().orderStatusToUser(order, `Заказ №${order.id} выдан${text ? `: ${text}` : ''}. Спасибо за покупку!`);
  return order;
}

export async function cancelByUser(orderId: number, userId: number) {
  const changed = await prisma.order.updateMany({
    where: { id: orderId, userId, status: 'PENDING_PAYMENT' },
    data: { status: 'CANCELLED' },
  });
  if (!changed.count) throw new ShopError('bad_state', 'Отменить можно только неоплаченный заказ');
  return loadOrder(orderId);
}

export async function addMessage(orderId: number, m: { userId?: number; text: string; fromAdmin: boolean; fileId?: string }) {
  const msg = await prisma.message.create({ data: { orderId, ...m } });
  const order = await loadOrder(orderId);
  if (order) await notifier().chatMessage(order, m.text, m.fromAdmin);
  return msg;
}

/** Снимает неоплаченные заказы, у которых вышло время на оплату */
export async function expireUnpaid(ttlMin: number) {
  const before = new Date(Date.now() - ttlMin * 60_000);
  const r = await prisma.order.updateMany({
    where: { status: 'PENDING_PAYMENT', createdAt: { lt: before }, method: { notIn: ['UAH', 'SBP'] } },
    data: { status: 'CANCELLED' },
  });
  return r.count;
}
