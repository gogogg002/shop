import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { saveSettings } from '../src/services/settings.js';
import { setNotifier, type Notifier } from '../src/services/notify.js';
import { reviewPolicy, submitReview } from '../src/services/reviews.js';
import type { ShopError } from '../src/services/orders.js';

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
  async newReview(r) {
    sent.push(r.edited ? `review-edit:${r.orderId}:${r.rating}:${r.edited.rating}` : `review:${r.orderId}:${r.rating}:${r.product}`);
  },
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

/** Правка отзыва без паузы между отправками (в жизни она защищает админов от потока уведомлений) */
async function withoutEditPause(fn: () => Promise<void>) {
  const pause = reviewPolicy.editCooldownMs;
  reviewPolicy.editCooldownMs = 0;
  try {
    await fn();
  } finally {
    reviewPolicy.editCooldownMs = pause;
  }
}

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

    // повторная отправка правит отзыв, админам приходит уведомление о правке с прежней оценкой
    sent.length = 0;
    await withoutEditPause(async () => {
      expect((await as(BUYER).post(`/api/orders/${id}/review`, { rating: 4, text: 'Норм' })).statusCode).toBe(200);
    });
    expect(sent.filter((m) => m.startsWith('review'))).toEqual([`review-edit:${id}:4:5`]);
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

describe('отзывы: гонки и правки', () => {
  it('параллельные отправки на один заказ: один отзыв, одно уведомление, без 500', async () => {
    const buyer = await prisma.user.findFirstOrThrow({ where: { tgId: BigInt(BUYER) } });
    let id = 0;
    // Несколько заказов подряд: на прогретом пуле соединений старая логика давала по 7–8 уведомлений на заказ
    for (let round = 0; round < 3; round++) {
      id = await deliveredOrder(noLogin.variants[0].id, '@buyer_race');
      sent.length = 0;
      // Напрямую в сервис, минуя HTTP: так отправки точно идут одновременно
      const results = await Promise.allSettled([1, 2, 3, 4, 5, 1, 2, 3].map((rating) =>
        submitReview(id, buyer.id, { rating, text: `оценка ${rating}` })));
      for (const r of results) if (r.status === 'rejected') expect((r.reason as ShopError).code).toBe('too_fast');
      expect(sent.filter((m) => m.startsWith('review'))).toHaveLength(1);
      expect(await prisma.review.count({ where: { orderId: id } })).toBe(1);
    }
    // через HTTP тоже без 500
    const res = await Promise.all([1, 2, 3, 4].map((rating) => as(BUYER).post(`/api/orders/${id}/review`, { rating, text: `http ${rating}` })));
    expect(res.map((r) => r.statusCode).filter((c) => c !== 200 && c !== 429)).toEqual([]);
  });

  it('правка: двойное нажатие без ошибки, пауза между правками, уведомление и лимит', async () => {
    const id = await deliveredOrder(noLogin.variants[0].id, '@buyer_edit');
    expect((await as(BUYER).post(`/api/orders/${id}/review`, { rating: 5, text: 'Отлично' })).statusCode).toBe(200);
    sent.length = 0;
    expect((await as(BUYER).post(`/api/orders/${id}/review`, { rating: 5, text: 'Отлично' })).statusCode).toBe(200);
    const fast = await as(BUYER).post(`/api/orders/${id}/review`, { rating: 1, text: 'Плохо' });
    expect(fast.statusCode).toBe(429);
    expect(fast.json().error).toBe('too_fast');
    expect(sent).toEqual([]);

    await withoutEditPause(async () => {
      expect((await as(BUYER).post(`/api/orders/${id}/review`, { rating: 1, text: 'Плохо' })).statusCode).toBe(200);
      expect(sent).toEqual([`review-edit:${id}:1:5`]);
      // админ видит правку первой в списке и с пометкой
      const top = (await as(ADMIN).get('/api/admin/reviews')).json().items[0];
      expect(top).toMatchObject({ orderId: id, rating: 1, text: 'Плохо', editCount: 1 });

      for (let i = 2; i <= reviewPolicy.maxEdits; i++) {
        expect((await as(BUYER).post(`/api/orders/${id}/review`, { rating: 3, text: `правка ${i}` })).statusCode).toBe(200);
      }
      const over = await as(BUYER).post(`/api/orders/${id}/review`, { rating: 2, text: 'ещё раз' });
      expect(over.statusCode).toBe(400);
      expect(over.json().error).toBe('edit_limit');
    });
    expect(sent.filter((m) => m.startsWith('review-edit'))).toHaveLength(reviewPolicy.maxEdits);
  });

  it('скрытый админом отзыв после правки остаётся скрытым', async () => {
    const id = await deliveredOrder(noLogin.variants[0].id, '@buyer_hidden');
    await as(BUYER).post(`/api/orders/${id}/review`, { rating: 1, text: 'спам' });
    const rid = (await prisma.review.findUniqueOrThrow({ where: { orderId: id } })).id;
    await as(ADMIN).patch(`/api/admin/reviews/${rid}`, { isHidden: true });
    await withoutEditPause(async () => {
      expect((await as(BUYER).post(`/api/orders/${id}/review`, { rating: 2, text: 'другой спам' })).statusCode).toBe(200);
    });
    expect((await prisma.review.findUniqueOrThrow({ where: { id: rid } })).isHidden).toBe(true);
  });
});

describe('неверные номера и текст', () => {
  it('огромные и нечисловые номера дают 400 или 404, а не 500', async () => {
    for (const url of ['/api/reviews?before=3000000000', '/api/reviews?productId=3000000000', '/api/admin/reviews?before=3000000000']) {
      expect([url, (await as(ADMIN).get(url)).statusCode]).toEqual([url, 400]);
    }
    for (const url of ['/api/orders/3000000000/review', '/api/orders/abc/review', '/api/orders/1.5/review']) {
      expect([url, (await as(BUYER).post(url, { rating: 5 })).statusCode]).toEqual([url, 404]);
    }
    for (const url of ['/api/products/3000000000', '/api/products/abc', '/api/orders/abc', '/api/orders/3000000000']) {
      expect([url, (await as(BUYER).get(url)).statusCode]).toEqual([url, 404]);
    }
    for (const url of ['/api/admin/orders/99999999999', '/api/admin/orders/abc']) {
      expect([url, (await as(ADMIN).get(url)).statusCode]).toEqual([url, 404]);
    }
  });

  it('нулевой символ в отзыве и в чате вырезается', async () => {
    const id = await deliveredOrder(noLogin.variants[0].id, '@buyer_nul');
    const r = await as(BUYER).post(`/api/orders/${id}/review`, { rating: 4, text: 'a\u0000b' });
    expect(r.statusCode).toBe(200);
    expect(r.json().text).toBe('ab');
    const m = await as(BUYER).post(`/api/orders/${id}/messages`, { text: 'привет\u0000' });
    expect(m.statusCode).toBe(200);
    expect(m.json().text).toBe('привет');
    expect((await as(BUYER).post(`/api/orders/${id}/messages`, { text: '\u0000' })).statusCode).toBe(400);
  });
});

describe('скрытый товар и дубли режима', () => {
  it('отзывы скрытой вкладки не отдаются и не входят в рейтинг соседней', async () => {
    const cat = await prisma.category.create({ data: { slug: 'nitro-modes', title: 'Discord', sort: 40 } });
    const mk = (access: 'NO_LOGIN' | 'WITH_LOGIN') => prisma.product.create({
      data: { categoryId: cat.id, title: 'Discord Nitro', access, recipientKind: access === 'WITH_LOGIN' ? 'PHONE' : 'USERNAME', variants: { create: [{ title: '1 мес', price: R(399) }] } },
      include: { variants: true },
    });
    const a = await mk('NO_LOGIN');
    const b = await mk('WITH_LOGIN');
    await as(BUYER).post(`/api/orders/${await deliveredOrder(a.variants[0].id, '@nitro_fan')}/review`, { rating: 5 });
    await as(BUYER).post(`/api/orders/${await deliveredOrder(b.variants[0].id, '+79001112233')}/review`, { rating: 1 });
    expect((await as(STRANGER).get(`/api/products/${a.id}`)).json().rating).toEqual({ avg: 3, count: 2 });

    await as(ADMIN).patch(`/api/admin/products/${b.id}`, { isActive: false });
    expect((await as(STRANGER).get(`/api/reviews?productId=${b.id}`)).statusCode).toBe(404);
    expect((await as(STRANGER).get(`/api/products/${a.id}`)).json().rating).toEqual({ avg: 5, count: 1 });
    expect((await as(STRANGER).get(`/api/reviews?productId=${a.id}`)).json().summary).toEqual({ avg: 5, count: 1 });
  });

  it('второй товар с тем же названием и режимом не сливается во вкладки', async () => {
    const cat = await prisma.category.create({ data: { slug: 'dupes', title: 'Дубли', sort: 41 } });
    const mk = (access: 'NO_LOGIN' | 'WITH_LOGIN', sort = 0) => prisma.product.create({
      data: { categoryId: cat.id, title: 'Steam', access, sort, variants: { create: [{ title: '500 ₽', price: R(525) }] } },
    });
    const a = await mk('NO_LOGIN');
    const b = await mk('WITH_LOGIN');
    const dupe = await mk('NO_LOGIN', 1);
    const cards = (await as(BUYER).get('/api/catalog')).json().find((c: { slug: string }) => c.slug === 'dupes').products;
    expect(cards.map((p: { id: number; modes: string[] }) => [p.id, p.modes])).toEqual([[a.id, ['NO_LOGIN', 'WITH_LOGIN']], [dupe.id, ['NO_LOGIN']]]);
    expect((await as(BUYER).get(`/api/products/${a.id}`)).json().siblings.map((s: { id: number }) => s.id)).toEqual([a.id, b.id]);
    expect((await as(BUYER).get(`/api/products/${dupe.id}`)).json().siblings).toEqual([]);
  });
});

describe('режим входа виден админу и в сообщениях', () => {
  it('в заказах админки есть режим, пуш о выдаче его называет', async () => {
    const id = await deliveredOrder(withLogin.variants[0].id, '+7 900 555 44 33');
    expect((await as(ADMIN).get(`/api/admin/orders/${id}`)).json().variant.product.access).toBe('WITH_LOGIN');
    const list = (await as(ADMIN).get('/api/admin/orders')).json();
    expect(list.find((o: { id: number }) => o.id === id).variant.product.access).toBe('WITH_LOGIN');
    expect(sent.find((m) => m.startsWith(`delivered:${id}:`))).toContain('Telegram Premium (со входом) · 1 мес');
  });

  it('цена по получателю: сервер возвращает номер так, как сохранит его', async () => {
    const q = await as(BUYER).post('/api/orders/quote', { variantId: withLogin.variants[0].id, method: 'UAH', recipient: '900 123-45-67' });
    expect(q.json()).toMatchObject({ recipientKind: 'PHONE', recipient: '+79001234567' });
    const bad = await as(BUYER).post('/api/orders/quote', { variantId: withLogin.variants[0].id, method: 'UAH', recipient: '84912345678' });
    expect(bad.json()).toMatchObject({ recipientKind: 'PHONE', recipient: null });
  });
});

describe('админка: все отзывы постранично', () => {
  it('«Показать ещё» доходит до самых старых отзывов', async () => {
    const buyer = await prisma.user.findFirstOrThrow({ where: { tgId: BigInt(BUYER) } });
    const vid = solo.variants[0].id;
    const orders = await Promise.all(Array.from({ length: 60 }, () =>
      prisma.order.create({ data: { userId: buyer.id, variantId: vid, method: 'UAH', amount: R(85), status: 'DELIVERED' } })));
    await prisma.review.createMany({ data: orders.map((o, i) => ({ orderId: o.id, userId: buyer.id, productId: solo.id, rating: 1 + (i % 5) })) });
    const total = await prisma.review.count();

    const seen: number[] = [];
    let cursor = '';
    for (let page = 0; page < 10; page++) {
      const r = (await as(ADMIN).get(`/api/admin/reviews${cursor}`)).json();
      seen.push(...(r.items as { id: number }[]).map((x) => x.id));
      if (!r.nextBefore) break;
      // Покупатель правит последний отзыв страницы, пока админ её читает: отзыв уезжает наверх, а следующая страница не повторяет эту
      if (page === 0) await prisma.review.update({ where: { id: r.nextBefore }, data: { activityAt: new Date(), editCount: 1 } });
      cursor = `?before=${r.nextBefore}&at=${encodeURIComponent(r.nextAt)}`;
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBe(total);
  });

  it('кривое время в курсоре даёт 400', async () => {
    for (const at of ['abc', '1e400', '+275760-09-13T00:00:00.000Z']) {
      expect([at, (await as(ADMIN).get(`/api/admin/reviews?before=1&at=${encodeURIComponent(at)}`)).statusCode]).toEqual([at, 400]);
    }
  });
});

describe('демо-каталог', () => {
  it('на старой базе без режимов и при повторном запуске не плодит дубли', async () => {
    const { seedCatalog } = await import('../src/seed.js');
    const tg = await prisma.category.upsert({ where: { slug: 'telegram' }, create: { slug: 'telegram', title: 'Telegram' }, update: {} });
    // так выглядела база после старого сида: режимов ещё не было
    await prisma.product.create({ data: { categoryId: tg.id, title: 'Telegram Stars', variants: { create: [{ title: '50 Stars', price: R(85) }] } } });
    await prisma.product.create({ data: { categoryId: tg.id, title: 'Telegram Premium', variants: { create: [{ title: '3 мес', price: R(1190) }] } } });

    await seedCatalog();
    await seedCatalog();

    const active = await prisma.product.findMany({ where: { isActive: true, category: { slug: { in: ['telegram', 'ai', 'games', 'discord'] } } }, select: { title: true, access: true } });
    const key = (p: { title: string; access: string }) => `${p.title}|${p.access}`;
    expect(active.map(key).sort()).toEqual([
      'ChatGPT Plus|UNSPECIFIED', 'Discord Nitro|UNSPECIFIED', 'Telegram Premium|NO_LOGIN', 'Telegram Premium|WITH_LOGIN',
      'Telegram Stars|NO_LOGIN', 'Пополнение Steam|UNSPECIFIED',
    ]);
  });
});
