import { prisma } from '../db.js';
import { autoProviders } from '../payments/index.js';
import { markPaid } from './orders.js';

/**
 * Сверка оплат без вебхуков: раз в минуту спрашиваем у CryptoBot и xRocket, не оплачены ли счета
 * неоплаченных заказов (и снятых по таймеру за последние 3 часа: счёт могли оплатить в последние секунды).
 * Вебхук остаётся основным путём, это страховка на случай, когда он не пришёл.
 * Возвращает id заказов, которые перевела в «оплачен».
 */
export async function reconcilePayments(log: (m: string) => void = () => {}) {
  const since = new Date(Date.now() - 3 * 60 * 60_000);
  const done: number[] = [];
  for (const [method, provider] of Object.entries(autoProviders)) {
    if (!provider?.isConfigured()) continue;
    const orders = await prisma.order.findMany({
      where: {
        method: method as never,
        externalId: { not: null },
        createdAt: { gte: since },
        status: { in: ['PENDING_PAYMENT', 'CANCELLED'] },
      },
      select: { id: true, externalId: true },
      take: 200,
    });
    if (!orders.length) continue;
    let paid: Set<string>;
    try {
      paid = await provider.paidInvoices(orders.map((o) => o.externalId!));
    } catch (e) {
      log(`сверка ${method}: ${(e as Error).message}`);
      continue;
    }
    for (const o of orders) {
      if (!paid.has(o.externalId!)) continue;
      await markPaid(o.id);
      done.push(o.id);
      log(`сверка ${method}: заказ №${o.id} оплачен, вебхук не приходил`);
    }
  }
  return done;
}
