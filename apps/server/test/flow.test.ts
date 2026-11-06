import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { saveSettings } from '../src/services/settings.js';
import { setNotifier, type Notifier } from '../src/services/notify.js';
import { sign } from '../src/payments/signature.js';

const ADMIN = '1000';
const CLIENT = '2000';
const R = (rub: number) => rub * 100;

let app: FastifyInstance;
const sent: string[] = [];
const notifier: Notifier = {
  async manualPaymentProof(o) { sent.push(`proof:${o.id}`); return 'file-123'; },
  async orderPaid(o) { sent.push(`paid:${o.id}`); },
  async orderStatusToUser(o, text) { sent.push(`user:${o.id}:${text}`); },
  async orderDelivered(o, text) { sent.push(`delivered:${o.id}:${text}`); },
  async chatMessage(o, _t, fromAdmin) { sent.push(`chat:${o.id}:${fromAdmin ? 'admin' : 'user'}`); },
  async newReview(r) { sent.push(`review:${r.orderId}:${r.rating}`); },
};

const api = (who: string) => ({
  get: (url: string) => app.inject({ method: 'GET', url, headers: { 'x-dev-user': who } }),
  post: (url: string, payload?: object) => app.inject({ method: 'POST', url, payload: payload ?? {}, headers: { 'x-dev-user': who } }),
  patch: (url: string, payload: object) => app.inject({ method: 'PATCH', url, payload, headers: { 'x-dev-user': who } }),
});

let premiumVariant: number;
let steamVariant: number;

beforeAll(async () => {
  app = await buildApp();
  setNotifier(notifier);
  const cat = await prisma.category.create({ data: { slug: 'tg', title: 'Telegram' } });
  const prem = await prisma.product.create({
    data: { categoryId: cat.id, title: 'Telegram Premium', variants: { create: [{ title: '12 мес', price: R(3490), cost: R(3050) }] } },
    include: { variants: true },
  });
  premiumVariant = prem.variants[0].id;
  const steam = await prisma.product.create({
    data: {
      categoryId: cat.id, title: 'Steam', deliveryType: 'CODES', needsRecipient: false,
      variants: { create: [{ title: '1000 ₽', price: R(1050), cost: R(1000) }] },
    },
    include: { variants: true },
  });
  steamVariant = steam.variants[0].id;
  await saveSettings({
    uah: { card: '4441 1111 2222 3333', holder: 'Тимур', bank: 'Mono', rate: 2.35 },
    methods: { CRYPTOBOT: true, XROCKET: false, LOLZ: false, SBP: false, UAH: true },
    fees: { CRYPTOBOT: 3, XROCKET: 0, LOLZ: 0, SBP: 0, UAH: 0 },
  });
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(() => {
  sent.length = 0;
  vi.unstubAllGlobals();
});

describe('доступ', () => {
  it('без initData — 401', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/me' });
    expect(r.statusCode).toBe(401);
  });
  it('клиент не попадает в админку', async () => {
    expect((await api(CLIENT).get('/api/admin/orders')).statusCode).toBe(403);
    expect((await api(ADMIN).get('/api/admin/orders')).statusCode).toBe(200);
  });
  it('/api/me показывает только настроенные методы', async () => {
    const me = (await api(CLIENT).get('/api/me')).json();
    expect(me.isAdmin).toBe(false);
    expect(me.methods.map((m: { method: string }) => m.method).sort()).toEqual(['CRYPTOBOT', 'UAH']);
  });
});

describe('ручная оплата гривнами', () => {
  it('реквизиты → чек → подтверждение админом → выдача', async () => {
    const c = api(CLIENT);
    const created = await c.post('/api/orders', { variantId: premiumVariant, method: 'UAH', recipient: 'tymur_dev' });
    expect(created.statusCode).toBe(200);
    const id = created.json().id;

    const view = (await c.get(`/api/orders/${id}`)).json();
    expect(view.recipient).toBe('@tymur_dev');
    expect(view.manual.amount).toBe('1486 грн'); // 3490 / 2.35 = 1485.1 → 1486
    expect(view.manual.requisites[0]).toEqual({ label: 'Карта', value: '4441 1111 2222 3333' });

    const proof = await c.post(`/api/orders/${id}/proof`, { note: 'перевёл с моно' });
    expect(proof.json().status).toBe('AWAITING_CONFIRMATION');
    expect(sent).toContain(`proof:${id}`);
    expect((await prisma.order.findUnique({ where: { id } }))!.proofFileId).toBe('file-123');

    // админ видит заказ в очереди
    const queue = (await api(ADMIN).get('/api/admin/orders?filter=queue')).json();
    expect(queue.map((o: { id: number }) => o.id)).toContain(id);

    expect((await api(ADMIN).post(`/api/admin/orders/${id}/confirm`)).json().status).toBe('PAID');
    expect(sent).toContain(`paid:${id}`);
    // повторное подтверждение ничего не ломает
    expect((await api(ADMIN).post(`/api/admin/orders/${id}/confirm`)).json().status).toBe('PAID');

    const d = await api(ADMIN).post(`/api/admin/orders/${id}/deliver`, { text: 'Подарок отправлен' });
    expect(d.json().status).toBe('DELIVERED');
    // клиенту уходит пуш «выполнен» (в боте под ним кнопка «Оставить отзыв»)
    expect(sent).toContain(`delivered:${id}:✅ Заказ №${id} выполнен: Telegram Premium · 12 мес.\nПодарок отправлен`);
    expect((await api(ADMIN).post(`/api/admin/orders/${id}/deliver`)).statusCode).toBe(400);
  });

  it('выдать данные без завершения: заказ в работе, отзыв только после «Завершить»', async () => {
    const id = (await api(CLIENT).post('/api/orders', { variantId: premiumVariant, method: 'UAH', recipient: '@tymur_dev' })).json().id;
    await api(CLIENT).post(`/api/orders/${id}/proof`, {});
    await api(ADMIN).post(`/api/admin/orders/${id}/confirm`);

    const i = await api(ADMIN).post(`/api/admin/orders/${id}/issue`, { text: 'Карта 4441 1111 2222 3333' });
    expect(i.json()).toMatchObject({ status: 'PAID', deliveredText: 'Карта 4441 1111 2222 3333' });
    expect(sent.some((m) => m.startsWith(`user:${id}:📦 Заказ №${id}: выдано\nКарта 4441`))).toBe(true);
    expect(sent.some((m) => m.startsWith(`delivered:${id}:`))).toBe(false);
    // клиент видит выданное, но отзыв пока нельзя
    const view = (await api(CLIENT).get(`/api/orders/${id}`)).json();
    expect(view).toMatchObject({ status: 'PAID', deliveredText: 'Карта 4441 1111 2222 3333', canReview: false });
    expect((await api(ADMIN).post(`/api/admin/orders/${id}/issue`, { text: ' ' })).statusCode).toBe(400);

    // «Завершить» без текста не стирает выданное и просит отзыв
    const d = await api(ADMIN).post(`/api/admin/orders/${id}/deliver`, {});
    expect(d.json()).toMatchObject({ status: 'DELIVERED', deliveredText: 'Карта 4441 1111 2222 3333' });
    expect(sent.some((m) => m.startsWith(`delivered:${id}:`))).toBe(true);
    expect((await api(CLIENT).get(`/api/orders/${id}`)).json().canReview).toBe(true);
    expect((await api(ADMIN).post(`/api/admin/orders/${id}/issue`, { text: 'ещё' })).statusCode).toBe(400);
  });

  it('админ может отклонить, и клиент получает причину в чат', async () => {
    const id = (await api(CLIENT).post('/api/orders', { variantId: premiumVariant, method: 'UAH', recipient: '@tymur_dev' })).json().id;
    await api(CLIENT).post(`/api/orders/${id}/proof`, {});
    const r = await api(ADMIN).post(`/api/admin/orders/${id}/reject`, { reason: 'перевод не пришёл' });
    expect(r.json().status).toBe('REJECTED');
    const view = (await api(CLIENT).get(`/api/orders/${id}`)).json();
    expect(view.messages.at(-1)).toMatchObject({ fromAdmin: true, text: 'Оплата отклонена: перевод не пришёл' });
  });

  it('чат по заказу: чужой заказ недоступен', async () => {
    const id = (await api(CLIENT).post('/api/orders', { variantId: premiumVariant, method: 'UAH', recipient: '@tymur_dev' })).json().id;
    expect((await api(CLIENT).post(`/api/orders/${id}/messages`, { text: 'Когда будет?' })).statusCode).toBe(200);
    expect(sent).toContain(`chat:${id}:user`);
    expect((await api('3000').get(`/api/orders/${id}`)).statusCode).toBe(404);
    expect((await api('3000').post(`/api/orders/${id}/messages`, { text: 'hi' })).statusCode).toBe(404);
  });

  it('без username получателя заказ не создаётся', async () => {
    const r = await api(CLIENT).post('/api/orders', { variantId: premiumVariant, method: 'UAH', recipient: 'a b' });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('bad_recipient');
  });
});

describe('CryptoBot', () => {
  it('создаёт счёт в рублях с комиссией и подтверждает по вебхуку', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    let invoiceStatus = 'active';
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      calls.push({ url, body });
      if (url.endsWith('/createInvoice'))
        return new Response(JSON.stringify({ ok: true, result: { invoice_id: 777, status: 'active', bot_invoice_url: 'https://t.me/CryptoBot?start=IV777', payload: body.payload } }));
      if (url.endsWith('/getInvoices'))
        return new Response(JSON.stringify({ ok: true, result: { items: [{ invoice_id: 777, status: invoiceStatus, payload: calls[0].body.payload }] } }));
      throw new Error('unexpected ' + url);
    }));

    const r = await api(CLIENT).post('/api/orders', { variantId: premiumVariant, method: 'CRYPTOBOT', recipient: '@tymur_dev' });
    expect(r.json().payUrl).toBe('https://t.me/CryptoBot?start=IV777');
    expect(calls[0].body).toMatchObject({ currency_type: 'fiat', fiat: 'RUB', amount: '3594.70' }); // 3490 + 3%
    const id = r.json().id;

    const hook = (raw: string, sig: string) =>
      app.inject({ method: 'POST', url: '/webhooks/cryptobot', payload: raw, headers: { 'content-type': 'application/json', 'crypto-pay-api-signature': sig } });
    const raw = JSON.stringify({ update_type: 'invoice_paid', payload: { invoice_id: 777, status: 'paid', payload: String(id) } });

    // поддельная подпись — заказ не трогаем
    await hook(raw, sign(raw, 'wrong-token'));
    expect((await prisma.order.findUnique({ where: { id } }))!.status).toBe('PENDING_PAYMENT');

    // подпись верная, но API говорит, что счёт не оплачен — тоже не трогаем
    await hook(raw, sign(raw, 'cb-test-token'));
    expect((await prisma.order.findUnique({ where: { id } }))!.status).toBe('PENDING_PAYMENT');

    invoiceStatus = 'paid';
    expect((await hook(raw, sign(raw, 'cb-test-token'))).statusCode).toBe(200);
    expect((await prisma.order.findUnique({ where: { id } }))!.status).toBe('PAID');
  });
});

describe('коды', () => {
  it('выдаются автоматически и не достаются двум заказам', async () => {
    await api(ADMIN).post(`/api/admin/variants/${steamVariant}/codes`, { codes: 'AAAA-1111\nBBBB-2222\nAAAA-1111\n' });
    const ids = [];
    for (let i = 0; i < 3; i++) {
      const r = await api(CLIENT).post('/api/orders', { variantId: steamVariant, method: 'UAH' });
      ids.push(r.json().id);
    }
    // подтверждаем все три одновременно, а кодов только два
    const results = await Promise.all(ids.map((id) => api(ADMIN).post(`/api/admin/orders/${id}/confirm`)));
    const statuses = results.map((r) => r.json().status).sort();
    expect(statuses).toEqual(['DELIVERED', 'DELIVERED', 'PAID']);
    const codes = (await prisma.order.findMany({ where: { id: { in: ids } } })).map((o) => o.deliveredText).filter(Boolean);
    expect(new Set(codes)).toEqual(new Set(['AAAA-1111', 'BBBB-2222']));

    // кодов не осталось — новый заказ не создаётся
    const r = await api(CLIENT).post('/api/orders', { variantId: steamVariant, method: 'UAH' });
    expect(r.json().error).toBe('out_of_stock');
  });

  it('своё количество на товаре с кодами: код на фиксированную сумму не выдаётся, заказ уходит в ручную выдачу', async () => {
    const steam = await prisma.variant.findUniqueOrThrow({ where: { id: steamVariant } });
    const own = await prisma.variant.create({
      data: { productId: steam.productId, title: 'Своя сумма', price: 110, cost: 100, perUnit: true, unit: '₽ на Steam', minQty: 100, maxQty: 50000 },
    });
    const upload = await api(ADMIN).post(`/api/admin/variants/${own.id}/codes`, { codes: 'STEAM-500\n' });
    expect(upload.statusCode).toBe(400);
    expect(upload.json().error).toBe('per_unit_codes');
    // код, попавший к варианту в обход админки, тоже не выдаётся
    await prisma.code.create({ data: { variantId: own.id, value: 'STEAM-500' } });

    const view = (await api(CLIENT).get(`/api/products/${steam.productId}`)).json();
    expect(view.variants.find((v: { id: number }) => v.id === own.id).inStock).toBe(true);
    const created = await api(CLIENT).post('/api/orders', { variantId: own.id, method: 'UAH', quantity: 100 });
    expect(created.statusCode).toBe(200);
    const o = await prisma.order.findUniqueOrThrow({ where: { id: created.json().id } });
    expect(o).toMatchObject({ amount: R(110), quantity: 100 });
    const paid = (await api(ADMIN).post(`/api/admin/orders/${o.id}/confirm`)).json();
    expect(paid.status).toBe('PAID');
    expect(paid.deliveredText).toBeNull();
    expect(await prisma.code.count({ where: { variantId: own.id, orderId: null } })).toBe(1);
    await prisma.variant.update({ where: { id: own.id }, data: { isActive: false } });
  });
});

describe('админ: товары и цены', () => {
  it('меняет цену и скрывает товар с витрины', async () => {
    await api(ADMIN).patch(`/api/admin/variants/${premiumVariant}`, { price: R(3290) });
    const tgCat = () => api(CLIENT).get('/api/catalog').then((r) => r.json().find((c: { slug: string }) => c.slug === 'tg'));
    const p = (await tgCat()).products.find((x: { title: string }) => x.title === 'Telegram Premium');
    expect(p.minPrice).toBe(R(3290));

    const products = (await api(ADMIN).get('/api/admin/products')).json();
    const prem = products.find((x: { id: number; variants: { id: number }[] }) => x.variants.some((v) => v.id === premiumVariant));
    await api(ADMIN).patch(`/api/admin/products/${prem.id}`, { isActive: false });
    const after = (await tgCat()).products.map((x: { title: string }) => x.title);
    expect(after).not.toContain('Telegram Premium');
    await api(ADMIN).patch(`/api/admin/products/${prem.id}`, { isActive: true });
  });

  it('сводка считает выручку и прибыль за сегодня', async () => {
    const s = (await api(ADMIN).get('/api/admin/summary')).json();
    expect(s.orders).toBeGreaterThan(0);
    expect(s.revenue).toBeGreaterThan(s.profit);
    expect(s.hourly).toHaveLength(24);
  });
});
