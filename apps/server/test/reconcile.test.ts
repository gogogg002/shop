import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/db.js';
import { cryptobot } from '../src/payments/cryptobot.js';
import { markPaid } from '../src/services/orders.js';
import { reconcilePayments } from '../src/services/reconcile.js';
import { setNotifier, type Notifier } from '../src/services/notify.js';

const sent: string[] = [];
let variantId: number;
let userId: number;

beforeAll(async () => {
  setNotifier({
    async manualPaymentProof() { return null; },
    async orderPaid(o) { sent.push(`paid:${o.id}`); },
    async orderStatusToUser(o) { sent.push(`user:${o.id}`); },
    async orderDelivered(o) { sent.push(`delivered:${o.id}`); },
    async chatMessage() {},
  } as unknown as Notifier);
  const cat = await prisma.category.create({ data: { slug: 'reconcile', title: 'Сверка' } });
  const p = await prisma.product.create({ data: { categoryId: cat.id, title: 'Сверка', variants: { create: [{ title: '1 мес', price: 10000 }] } }, include: { variants: true } });
  variantId = p.variants[0].id;
  userId = (await prisma.user.create({ data: { tgId: 880001n } })).id;
});
afterAll(() => vi.restoreAllMocks());

const order = (data: { method: 'CRYPTOBOT' | 'UAH'; status: 'PENDING_PAYMENT' | 'CANCELLED'; externalId?: string }) =>
  prisma.order.create({ data: { userId, variantId, amount: 10000, ...data } });

describe('сверка оплат без вебхука', () => {
  it('оплаченный счёт переводит заказ в «оплачен» и шлёт уведомления; неоплаченный не трогает', async () => {
    const paid = await order({ method: 'CRYPTOBOT', status: 'PENDING_PAYMENT', externalId: 'inv-paid' });
    const wait = await order({ method: 'CRYPTOBOT', status: 'PENDING_PAYMENT', externalId: 'inv-wait' });
    const spy = vi.spyOn(cryptobot, 'paidInvoices').mockResolvedValue(new Set(['inv-paid']));
    const done = await reconcilePayments();
    expect(done).toContain(paid.id);
    expect(spy).toHaveBeenCalled();
    expect((await prisma.order.findUniqueOrThrow({ where: { id: paid.id } })).status).toBe('PAID');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: wait.id } })).status).toBe('PENDING_PAYMENT');
    expect(sent).toContain(`paid:${paid.id}`);
    // повторная сверка ничего не дублирует
    sent.length = 0;
    await reconcilePayments();
    expect(sent).not.toContain(`paid:${paid.id}`);
  });

  it('счёт оплачен после снятия по таймеру: заказ всё равно оплачен', async () => {
    const late = await order({ method: 'CRYPTOBOT', status: 'CANCELLED', externalId: 'inv-late' });
    vi.spyOn(cryptobot, 'paidInvoices').mockResolvedValue(new Set(['inv-late']));
    await reconcilePayments();
    expect((await prisma.order.findUniqueOrThrow({ where: { id: late.id } })).status).toBe('PAID');
  });

  it('ручную оплату после отмены не проводит', async () => {
    const manual = await order({ method: 'UAH', status: 'CANCELLED' });
    await markPaid(manual.id);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: manual.id } })).status).toBe('CANCELLED');
  });

  it('ошибка API провайдера не роняет сверку', async () => {
    await order({ method: 'CRYPTOBOT', status: 'PENDING_PAYMENT', externalId: 'inv-err' });
    vi.spyOn(cryptobot, 'paidInvoices').mockRejectedValue(new Error('timeout'));
    const log: string[] = [];
    await expect(reconcilePayments((m) => log.push(m))).resolves.toEqual([]);
    expect(log[0]).toMatch(/timeout/);
  });

  it('xRocket: счёт, на который API ответил ошибкой, не мешает найти оплату остальных', async () => {
    const { xrocket } = await import('../src/payments/xrocket.js');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const id = url.split('/').pop();
      if (id === 'bad') return new Response(JSON.stringify({ success: false, message: 'Not found' }), { status: 404 });
      return new Response(JSON.stringify({ success: true, data: { id, link: '', status: id === 'p1' ? 'paid' : 'active', payload: '1' } }));
    }));
    try {
      expect([...(await xrocket.paidInvoices(['bad', 'p1', 'w1']))]).toEqual(['p1']);
      // не ответил ни один: сверка узнаёт об ошибке и пишет её в лог
      await expect(xrocket.paidInvoices(['bad'])).rejects.toThrow(/Not found/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
