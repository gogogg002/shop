import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { saveSettings } from '../src/services/settings.js';
import { setNotifier, type Notifier } from '../src/services/notify.js';

const ADMIN = '1000';
const BUYER = '2100';
const STRANGER = '3100';
const R = (rub: number) => rub * 100;

let app: FastifyInstance;
const sent: string[] = [];
const notifier: Notifier = {
  async manualPaymentProof(o) { sent.push(`proof:${o.id}`); return null; },
  async orderPaid(o) { sent.push(`paid:${o.id}`); },
  async orderStatusToUser(o) { sent.push(`user:${o.id}`); },
  async orderDelivered(o, text) { sent.push(`delivered:${o.id}:${text}`); },
  async chatMessage(o) { sent.push(`chat:${o.id}`); },
  async newReview(r) { sent.push(`review:${r.orderId}:${r.rating}:${r.product}`); },
};

const as = (who: string) => ({
  get: (url: string) => app.inject({ method: 'GET', url, headers: { 'x-dev-user': who } }),
  post: (url: string, payload?: object) => app.inject({ method: 'POST', url, payload: payload ?? {}, headers: { 'x-dev-user': who } }),
  patch: (url: string, payload: object) => app.inject({ method: 'PATCH', url, payload, headers: { 'x-dev-user': who } }),
});

let noLogin: { id: number; variants: { id: number }[] };
let withLogin: { id: number; variants: { id: number }[] };
let solo: { id: number; variants: { id: number }[] };

/** Заказ гривнами, подтверждённый и выданный админом */
async function deliveredOrder(variantId: number, recipient?: string) {
  const id = (await as(BUYER).post('/api/orders', { variantId, method: 'UAH', recipient })).json().id as number;
  await as(BUYER).post(`/api/orders/${id}/proof`, {});
  await as(ADMIN).post(`/api/admin/orders/${id}/confirm`);
  await as(ADMIN).post(`/api/admin/orders/${id}/deliver`, {});
  return id;
}

beforeAll(async () => {
  app = await buildApp();
  setNotifier(notifier);
  const cat = await prisma.category.create({ data: { slug: 'tg-modes', title: 'Telegram', sort: -1 } });
  const variants = { create: [{ title: '1 мес', price: R(349), cost: R(270) }, { title: '12 мес', price: R(3490), cost: R(3050), sort: 1 }] };
  // «Со входом» создаём первым, чтобы проверить, что вкладка «Без входа» всё равно идёт первой
  withLogin = await prisma.product.create({
    data: { categoryId: cat.id, title: 'Telegram Premium', access: 'WITH_LOGIN', recipientKind: 'PHONE', wholesale: true, variants },
    include: { variants: true },
  });
  noLogin = await prisma.product.create({
    data: { categoryId: cat.id, title: 'Telegram Premium ', access: 'NO_LOGIN', wholesale: true, variants: { create: [{ title: '1 мес', price: R(299), cost: R(200) }] } },
    include: { variants: true },
  });
  solo = await prisma.product.create({
    data: { categoryId: cat.id, title: 'Telegram Stars', access: 'NO_LOGIN', variants: { create: [{ title: '50 Stars', price: R(85) }] } },
    include: { variants: true },
  });
  await saveSettings({
    uah: { card: '4441 1111 2222 3333', holder: 'Тимур', bank: 'Mono', rate: 2.35 },
    methods: { CRYPTOBOT: false, XROCKET: false, LOLZ: false, SBP: false, UAH: true },
    supportUsername: 'TimaGopl',
  });
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(() => {
  sent.length = 0;
});

describe('Без входа / Со входом', () => {
  it('в каталоге одна карточка с двумя режимами и минимальной ценой', async () => {
    const cats = (await as(BUYER).get('/api/catalog')).json();
    const tg = cats.find((c: { slug: string }) => c.slug === 'tg-modes');
    const premium = tg.products.filter((p: { title: string }) => p.title.trim() === 'Telegram Premium');
    expect(premium).toHaveLength(1);
    expect(premium[0]).toMatchObject({ id: noLogin.id, modes: ['NO_LOGIN', 'WITH_LOGIN'], subtitle: 'Без входа · Со входом', minPrice: R(299) });
    // одиночный товар с режимом не группируется
    expect(tg.products.find((p: { id: number }) => p.id === solo.id).modes).toEqual(['NO_LOGIN']);
  });

  it('у товара есть вкладки, «Без входа» первая, и опт через поддержку', async () => {
    const p = (await as(BUYER).get(`/api/products/${withLogin.id}`)).json();
    expect(p.siblings.map((s: { id: number; label: string }) => [s.id, s.label])).toEqual([[noLogin.id, 'Без входа'], [withLogin.id, 'Со входом']]);
    expect(p).toMatchObject({ access: 'WITH_LOGIN', recipientKind: 'PHONE', wholesale: true });
    expect((await as(BUYER).get(`/api/products/${solo.id}`)).json().siblings).toEqual([]);
  });

  it('без username поддержки вариант «Опт» не показывается', async () => {
    await saveSettings({ supportUsername: '' });
    expect((await as(BUYER).get(`/api/products/${noLogin.id}`)).json().wholesale).toBe(false);
    await saveSettings({ supportUsername: 'TimaGopl' });
  });

  it('скрытая вкладка пропадает из переключателя', async () => {
    await as(ADMIN).patch(`/api/admin/products/${withLogin.id}`, { isActive: false });
    expect((await as(BUYER).get(`/api/products/${noLogin.id}`)).json().siblings).toEqual([]);
    await as(ADMIN).patch(`/api/admin/products/${withLogin.id}`, { isActive: true });
  });

  it('«Со входом» спрашивает номер телефона и приводит его к +7…', async () => {
    const bad = await as(BUYER).post('/api/orders', { variantId: withLogin.variants[0].id, method: 'UAH', recipient: '@durov' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().message).toMatch(/номер телефона/);
    const ok = await as(BUYER).post('/api/orders', { variantId: withLogin.variants[0].id, method: 'UAH', recipient: '8 (900) 123-45-67' });
    expect(ok.statusCode).toBe(200);
    expect((await prisma.order.findUnique({ where: { id: ok.json().id } }))!.recipient).toBe('+79001234567');
  });

  it('админ меняет режим, получателя и опт', async () => {
    const r = await as(ADMIN).patch(`/api/admin/products/${solo.id}`, { access: 'WITH_LOGIN', recipientKind: 'PHONE', wholesale: true });
    expect(r.json()).toMatchObject({ access: 'WITH_LOGIN', recipientKind: 'PHONE', wholesale: true });
    const back = await as(ADMIN).patch(`/api/admin/products/${solo.id}`, { access: 'NO_LOGIN', recipientKind: 'USERNAME', wholesale: false });
    expect(back.json()).toMatchObject({ access: 'NO_LOGIN', recipientKind: 'USERNAME', wholesale: false });
    expect((await as(ADMIN).patch(`/api/admin/products/${solo.id}`, { access: 'SOMETIMES' })).statusCode).toBe(400);
  });
});

describe('отзывы', () => {
  it('нельзя оставить, пока заказ не выполнен, и нельзя на чужой заказ', async () => {
    const id = (await as(BUYER).post('/api/orders', { variantId: noLogin.variants[0].id, method: 'UAH', recipient: '@buyer_one' })).json().id;
    const early = await as(BUYER).post(`/api/orders/${id}/review`, { rating: 5 });
    expect(early.statusCode).toBe(400);
    expect(early.json().error).toBe('bad_state');
    expect((await as(BUYER).get(`/api/orders/${id}`)).json()).toMatchObject({ canReview: false, review: null });
    expect((await as(STRANGER).post(`/api/orders/${id}/review`, { rating: 5 })).statusCode).toBe(404);
  });

  it('после выдачи: пуш, отзыв в базе, уведомление админу один раз, рейтинг на товаре', async () => {
    const id = await deliveredOrder(noLogin.variants[0].id, '@buyer_one');
    expect(sent.some((m) => m.startsWith(`delivered:${id}:✅ Заказ №${id} выполнен`))).toBe(true);
    expect((await as(BUYER).get(`/api/orders/${id}`)).json()).toMatchObject({ canReview: true, reviewed: false });

    for (const rating of [0, 6, 4.5]) {
      const r = await as(BUYER).post(`/api/orders/${id}/review`, { rating });
      expect(r.statusCode).toBe(400);
    }
    expect((await as(BUYER).post(`/api/orders/${id}/review`, { rating: 0 })).json().message).toBe('Поставьте оценку от 1 до 5');
    expect((await as(STRANGER).post(`/api/orders/${id}/review`, { rating: 1 })).statusCode).toBe(404);

    const r = await as(BUYER).post(`/api/orders/${id}/review`, { rating: 5, text: '  Пришло за 3 минуты  ' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ rating: 5, text: 'Пришло за 3 минуты' });
    expect(sent).toContain(`review:${id}:5:Telegram Premium `);

    // повторная отправка правит отзыв, второго уведомления нет
    sent.length = 0;
    expect((await as(BUYER).post(`/api/orders/${id}/review`, { rating: 4, text: 'Норм' })).statusCode).toBe(200);
    expect(sent.filter((m) => m.startsWith('review:'))).toEqual([]);
    expect(await prisma.review.count({ where: { orderId: id } })).toBe(1);

    const view = (await as(BUYER).get(`/api/orders/${id}`)).json();
    expect(view).toMatchObject({ reviewed: true, review: { rating: 4, text: 'Норм' } });
    expect((await as(BUYER).get('/api/orders')).json().find((o: { id: number }) => o.id === id).reviewed).toBe(true);

    // отзыв виден на обеих вкладках товара: рейтинг считается по всей карточке
    for (const pid of [noLogin.id, withLogin.id]) {
      const p = (await as(STRANGER).get(`/api/products/${pid}`)).json();
      expect(p.rating).toEqual({ avg: 4, count: 1 });
      expect(p.reviews[0]).toMatchObject({ rating: 4, text: 'Норм', author: 'Dev', variant: '1 мес', access: 'NO_LOGIN' });
      expect(p.reviews[0]).not.toHaveProperty('userId');
    }
    expect((await as(STRANGER).get(`/api/products/${solo.id}`)).json().rating).toEqual({ avg: 0, count: 0 });
  });

  it('лента отзывов, сводка и скрытие админом', async () => {
    const id2 = await deliveredOrder(withLogin.variants[1].id, '+7 900 000 00 00');
    await as(BUYER).post(`/api/orders/${id2}/review`, { rating: 5 });

    const feed = (await as(STRANGER).get('/api/reviews?limit=1')).json();
    expect(feed.summary).toEqual({ avg: 4.5, count: 2 });
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0].variant).toBe('12 мес');
    const next = (await as(STRANGER).get(`/api/reviews?limit=1&before=${feed.nextBefore}`)).json();
    expect(next.items[0].rating).toBe(4);
    expect((await as(STRANGER).get('/api/reviews?limit=0')).json()).toMatchObject({ items: [], summary: { count: 2 } });
    expect((await as(STRANGER).get(`/api/reviews?productId=${noLogin.id}`)).json().summary.count).toBe(2);
    expect((await as(STRANGER).get('/api/reviews?productId=999999')).statusCode).toBe(404);

    // клиент не может модерировать
    const admin = (await as(ADMIN).get('/api/admin/reviews')).json();
    const target = admin.items.find((x: { orderId: number }) => x.orderId === id2);
    expect((await as(BUYER).patch(`/api/admin/reviews/${target.id}`, { isHidden: true })).statusCode).toBe(403);

    expect((await as(ADMIN).patch(`/api/admin/reviews/${target.id}`, { isHidden: true })).json().isHidden).toBe(true);
    expect((await as(STRANGER).get('/api/reviews')).json().summary).toEqual({ avg: 4, count: 1 });
    expect((await as(ADMIN).get('/api/admin/reviews?filter=hidden')).json().items.map((x: { id: number }) => x.id)).toEqual([target.id]);
    expect((await as(ADMIN).patch('/api/admin/reviews/999999', { isHidden: true })).statusCode).toBe(404);
  });
});
