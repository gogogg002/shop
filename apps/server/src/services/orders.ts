import type { OrderStatus, PaymentMethod, Prisma, RecipientKind } from '@prisma/client';
import { prisma } from '../db.js';
import { autoProviders, isManual } from '../payments/index.js';
import { getSettings, type ShopSettings } from './settings.js';
import { notifier, type OrderView } from './notify.js';
import { normalizePhone } from './phone.js';
import { STATUS_WORD, cleanText, orderTitle, variantLabel } from './labels.js';

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

/**
 * Приводит получателя к одному виду: @username или +79001234567.
 * null — если формат не подходит.
 */
export function normalizeRecipient(kind: RecipientKind, raw: string | undefined): string | null {
  if (kind === 'PHONE') return normalizePhone(raw);
  if (kind === 'STEAM') {
    const login = (raw ?? '').trim();
    return /^[A-Za-z0-9_.-]{2,64}$/.test(login) ? login : null;
  }
  const u = (raw ?? '').trim().replace(/^@?/, '@');
  return /^@[A-Za-z0-9_]{4,32}$/.test(u) ? u : null;
}

/**
 * Количество для варианта со своим количеством (звёзды, рубли Steam): целое в пределах minQty..maxQty.
 * У обычного варианта всегда 1.
 */
export function checkQuantity(v: { perUnit: boolean; minQty: number; maxQty: number; unit: string }, raw: number | undefined): number {
  if (!v.perUnit) return 1;
  const q = Number(raw);
  if (!Number.isInteger(q) || q < v.minQty || q > v.maxQty)
    throw new ShopError('bad_quantity', `Укажите количество от ${v.minQty} до ${v.maxQty}${v.unit ? ` ${v.unit}` : ''}`);
  return q;
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
    // С копейками, если они есть: 51 звезда стоит 71,40 ₽, и перевести надо ровно столько
    amount: `${order.amount % 100 ? (order.amount / 100).toFixed(2).replace('.', ',') : order.amount / 100} ₽`,
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
  quantity?: number;
}) {
  const s = await getSettings();
  const variant = await prisma.variant.findUnique({ where: { id: input.variantId }, include: { product: true } });
  if (!variant || !variant.isActive || !variant.product.isActive) throw new ShopError('variant_unavailable', 'Товар недоступен');

  const recipient = variant.product.needsRecipient ? normalizeRecipient(variant.product.recipientKind, input.recipient) : null;
  if (variant.product.needsRecipient && !recipient)
    throw new ShopError(
      'bad_recipient',
      variant.product.recipientKind === 'PHONE'
        ? 'Укажите номер телефона с кодом страны, например +7 900 123-45-67'
        : variant.product.recipientKind === 'STEAM'
          ? 'Укажите логин Steam (не никнейм), например gaben'
          : 'Укажите username получателя, например @durov',
    );
  const quantity = checkQuantity(variant, input.quantity);

  if (input.method === 'BALANCE') throw new ShopError('method_unavailable', 'Оплата с баланса пока не подключена');
  const methodKey = input.method as keyof ShopSettings['methods'];
  if (!s.methods[methodKey]) throw new ShopError('method_unavailable', 'Этот способ оплаты сейчас выключен');

  const provider = autoProviders[input.method];
  if (!isManual(input.method) && !provider?.isConfigured())
    throw new ShopError('method_unavailable', 'Этот способ оплаты ещё не настроен');
  if (input.method === 'UAH' && !s.uah.card) throw new ShopError('method_unavailable', 'Оплата гривнами ещё не настроена');
  if (input.method === 'SBP' && !s.sbp.phone) throw new ShopError('method_unavailable', 'Оплата по СБП ещё не настроена');

  // У варианта со своим количеством код один на любую сумму не годится: такой заказ выдают вручную
  if (variant.product.deliveryType === 'CODES' && !variant.perUnit) {
    const left = await prisma.code.count({ where: { variantId: variant.id, orderId: null } });
    if (left === 0) throw new ShopError('out_of_stock', 'Коды закончились, загляните позже');
  }

  let promo = null;
  if (input.promoCode) {
    promo = await prisma.promoCode.findUnique({ where: { code: input.promoCode.trim().toUpperCase() } });
    const expired = promo?.expiresAt && promo.expiresAt < new Date();
    if (!promo || expired || promo.usesLeft === 0) throw new ShopError('bad_promo', 'Промокод не найден или истёк');
  }

  const { amount, discount } = computeTotal(variant.price * quantity, s.fees[methodKey] ?? 0, promo);

  let order = await prisma.order.create({
    data: {
      userId: input.userId,
      variantId: variant.id,
      recipient,
      method: input.method,
      amount,
      discount,
      cost: variant.cost * quantity,
      quantity,
      promoCode: promo?.code,
    },
  });

  if (promo?.usesLeft != null) await prisma.promoCode.update({ where: { id: promo.id }, data: { usesLeft: { decrement: 1 } } });

  if (provider) {
    const inv = await provider.createInvoice({
      orderId: order.id,
      amountRub: amount,
      description: `${variant.product.title} · ${variantLabel(variant, quantity)}`,
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
  // Подпись проверяем до уведомления админам: ошибка после него при повторной отправке дала бы второй чек
  const text = cleanText(note ?? '').trim();
  if (text.length > 2000) throw new ShopError('too_long', 'Подпись к чеку длиннее 2000 символов');

  // Сначала чек уходит админам, и только потом заказ встаёт «на проверку»: если чек не дошёл ни до кого или сервер
  // перезапустился посреди отправки, заказ остаётся «ждёт оплаты», и покупатель может отправить чек ещё раз
  let fileId: string | null;
  try {
    fileId = await notifier().manualPaymentProof({ ...order, status: 'AWAITING_CONFIRMATION' }, photo);
  } catch (e) {
    console.error('proof notify failed', (e as Error).message);
    throw new ShopError('notify_failed', 'Не удалось передать чек админам. Попробуйте ещё раз через минуту', 503);
  }
  // Фото уходит админам по очереди, и первый может подтвердить или отклонить оплату, пока оно грузится остальным:
  // статус меняем только из «ждёт оплаты» и «на проверке», чтобы не затереть это решение
  const moved = await prisma.order.updateMany({
    where: { id: orderId, userId, status: { in: ['PENDING_PAYMENT', 'AWAITING_CONFIRMATION'] } },
    data: { status: 'AWAITING_CONFIRMATION', ...(fileId ? { proofFileId: fileId } : {}) },
  });
  if (!moved.count && fileId) await prisma.order.update({ where: { id: orderId }, data: { proofFileId: fileId } });
  if (text) await addMessage(orderId, { userId, text, fromAdmin: false });
  return prisma.order.findUniqueOrThrow({ where: { id: orderId } });
}

/**
 * Перевод в «оплачено». Идемпотентно: повторный вебхук ничего не сломает.
 * Для товаров с кодами сразу выдаёт код.
 */
export async function markPaid(orderId: number) {
  const changed = await prisma.order.updateMany({
    where: {
      id: orderId,
      OR: [
        { status: { in: ['PENDING_PAYMENT', 'AWAITING_CONFIRMATION'] } },
        // Счёт крипто-провайдера оплатили в последние секунды, а заказ уже сняли по таймеру
        // или клиент отменил его и всё равно оплатил: деньги пришли, значит заказ оплачен
        { status: 'CANCELLED', method: { notIn: ['UAH', 'SBP'] } },
      ],
    },
    data: { status: 'PAID', paidAt: new Date() },
  });
  if (changed.count === 0) return loadOrder(orderId);

  const order = (await loadOrder(orderId))!;
  if (order.variant.product.deliveryType === 'CODES' && !order.variant.perUnit) {
    const delivered = await deliverCode(orderId);
    if (delivered) return delivered;
  }
  await notifier().orderPaid(order);
  await notifier().orderStatusToUser(order, `💳 Заказ №${order.id} оплачен, скоро выдадим`);
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
  await notifier().orderDelivered(order, `✅ Заказ №${order.id} выполнен: ${orderTitle(order.variant.product, variantLabel(order.variant, order.quantity))}.\nКод: ${done}`);
  return order;
}

export async function confirmManual(orderId: number) {
  const order = await loadOrder(orderId);
  if (!order) throw new ShopError('not_found', 'Заказ не найден', 404);
  if (!isManual(order.method)) throw new ShopError('bad_state', 'Заказ не на ручной оплате');
  // Кнопка «Подтвердить» есть у каждого админа. Повторное подтверждение оплаченного заказа ничего не меняет
  // (двойное нажатие), а отклонённый или отменённый заказ подтвердить нельзя: админ должен узнать об этом,
  // а не получить «Оплата подтверждена»
  const closed = (status: OrderStatus) => status === 'REJECTED' || status === 'CANCELLED' || status === 'REFUNDED';
  if (closed(order.status)) throw new ShopError('bad_state', `Заказ уже обработан: ${STATUS_WORD[order.status]}`);
  const after = await markPaid(orderId);
  // Другой админ отклонил заказ или покупатель отменил его между проверкой выше и оплатой
  if (after && closed(after.status)) throw new ShopError('bad_state', `Заказ уже обработан: ${STATUS_WORD[after.status]}`);
  return after;
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

/**
 * Выдать данные (карту, код, ссылку), не завершая заказ: клиент видит их в заказе и получает в бот,
 * а заказ остаётся «оплачен» до кнопки «Завершить». Можно выдать ещё раз, текст заменится.
 */
export async function issue(orderId: number, text: string) {
  const clean = cleanText(text).trim();
  if (!clean) throw new ShopError('bad_text', 'Напишите, что выдать клиенту');
  const changed = await prisma.order.updateMany({ where: { id: orderId, status: 'PAID' }, data: { deliveredText: clean } });
  if (!changed.count) throw new ShopError('bad_state', 'Выдать можно только оплаченный заказ');
  const order = (await loadOrder(orderId))!;
  await notifier().orderStatusToUser(
    order,
    `📦 Заказ №${order.id}: выдано\n${clean}\n\nЗавершим, когда всё будет готово`,
  );
  return order;
}

/** Завершить заказ: «выдан», клиенту пуш с просьбой оставить отзыв. Без нового текста остаётся выданный раньше */
export async function deliver(orderId: number, text?: string) {
  const clean = text ? cleanText(text).trim() : '';
  const changed = await prisma.order.updateMany({
    where: { id: orderId, status: 'PAID' },
    data: { status: 'DELIVERED', deliveredAt: new Date(), ...(clean ? { deliveredText: clean } : {}) },
  });
  if (!changed.count) throw new ShopError('bad_state', 'Выдать можно только оплаченный заказ');
  const order = (await loadOrder(orderId))!;
  const what = orderTitle(order.variant.product, variantLabel(order.variant, order.quantity));
  await notifier().orderDelivered(order, `✅ Заказ №${order.id} выполнен: ${what}.${clean ? `\n${clean}` : ''}`);
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
  const text = cleanText(m.text).trim();
  if (!text) throw new ShopError('empty', 'Напишите сообщение');
  const msg = await prisma.message.create({ data: { orderId, ...m, text } });
  const order = await loadOrder(orderId);
  if (order) await notifier().chatMessage(order, text, m.fromAdmin);
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
