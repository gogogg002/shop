import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { seedCatalog } from '../src/seed.js';
import { migrateCatalog } from '../src/migrate-catalog.js';

const R = (rub: number) => rub * 100;

/** Каждый тест здесь на пустой базе. Чистим и в конце, чтобы следующий файл тестов начал с того же, что и после global-setup */
const wipe = () => prisma.$executeRawUnsafe(
  'TRUNCATE "Review","Message","Code","Order","Variant","Product","Category","User","PromoCode","Setting" RESTART IDENTITY CASCADE',
);
beforeEach(wipe);
afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

const active = async () => (await prisma.product.findMany({ where: { isActive: true }, select: { title: true, access: true } }))
  .map((p) => `${p.title}|${p.access}`).sort();
const quiet = () => {};

/** Так выглядела база после старого демо-каталога: Premium подарком, у товаров ещё нет режима входа */
async function oldCatalog() {
  const tg = await prisma.category.create({ data: { slug: 'telegram', title: 'Telegram' } });
  await prisma.product.create({ data: { categoryId: tg.id, title: 'Telegram Stars', variants: { create: [{ title: '50 Stars', price: R(85) }] } } });
  const gift = await prisma.product.create({
    data: {
      categoryId: tg.id, title: 'Telegram Premium', subtitle: 'Подарком на аккаунт',
      variants: { create: ['1 мес', '3 мес', '6 мес', '12 мес'].map((title, sort) => ({ title, price: R(349), sort })) },
    },
    include: { variants: true },
  });
  return { tg, gift };
}

describe('демо-каталог', () => {
  it('на пустой базе создаёт витрину, повторный запуск ничего не дублирует', async () => {
    await seedCatalog();
    await seedCatalog();
    expect(await active()).toEqual([
      'ChatGPT Plus|UNSPECIFIED', 'Discord Nitro|UNSPECIFIED', 'Telegram Premium|GIFT', 'Telegram Premium|NO_LOGIN', 'Telegram Premium|WITH_LOGIN',
      'Telegram Stars|NO_LOGIN', 'Пополнение Steam|UNSPECIFIED',
    ]);
  });

  it('товар, который админ перенёс в другую категорию, второй раз не появляется', async () => {
    await seedCatalog();
    const subs = await prisma.category.create({ data: { slug: 'subs', title: 'Подписки' } });
    await prisma.product.updateMany({ where: { title: { in: ['Discord Nitro', 'Telegram Premium'] } }, data: { categoryId: subs.id } });
    await seedCatalog();
    expect(await prisma.product.count({ where: { title: 'Discord Nitro' } })).toBe(1);
    expect(await prisma.product.count({ where: { title: 'Telegram Premium' } })).toBe(3);
  });

  it('на старой базе ничего не удаляет и не меняет', async () => {
    const { gift } = await oldCatalog();
    await seedCatalog();
    expect(await prisma.product.findUnique({ where: { id: gift.id } })).toMatchObject({ isActive: true, access: 'UNSPECIFIED' });
    expect(await prisma.product.count({ where: { title: 'Telegram Stars' } })).toBe(1);
  });
});

describe('обновление живой базы', () => {
  it('убирает старый Premium подарком, добавляет режимы, Stars — без входа', async () => {
    const { gift } = await oldCatalog();
    await migrateCatalog(quiet);
    await migrateCatalog(quiet);
    expect(await prisma.product.findUnique({ where: { id: gift.id } })).toBeNull();
    expect(await active()).toEqual(['Telegram Premium|GIFT', 'Telegram Premium|NO_LOGIN', 'Telegram Premium|WITH_LOGIN', 'Telegram Stars|NO_LOGIN']);
  });

  it('старый Premium с заказами скрывает, а не удаляет', async () => {
    const { gift } = await oldCatalog();
    const user = await prisma.user.create({ data: { tgId: 5000n } });
    await prisma.order.create({ data: { userId: user.id, variantId: gift.variants[1].id, method: 'UAH', amount: R(1190), status: 'DELIVERED' } });
    await migrateCatalog(quiet);
    expect(await prisma.product.findUnique({ where: { id: gift.id } })).toMatchObject({ isActive: false });
  });

  it('Premium без режима, который админ завёл сам, не трогает', async () => {
    const { tg } = await oldCatalog();
    const own = await prisma.product.create({
      data: { categoryId: tg.id, title: 'Telegram Premium', subtitle: 'Подарком от 3 мес', variants: { create: [{ title: '3 мес', price: R(1190) }] } },
    });
    await migrateCatalog(quiet);
    expect(await prisma.product.findUnique({ where: { id: own.id } })).toMatchObject({ isActive: true, access: 'UNSPECIFIED' });
  });

  it('режим, перенесённый админом в другую категорию, не дублирует', async () => {
    await migrateCatalog(quiet);
    const subs = await prisma.category.create({ data: { slug: 'subs', title: 'Подписки' } });
    await prisma.product.updateMany({ where: { title: 'Telegram Premium' }, data: { categoryId: subs.id } });
    await migrateCatalog(quiet);
    expect(await prisma.product.count({ where: { title: 'Telegram Premium' } })).toBe(3);
  });
});

describe('своё количество: Stars и Steam', () => {
  it('миграция переводит Stars на цену за звезду, повторный запуск ничего не дублирует', async () => {
    await oldCatalog();
    await migrateCatalog(quiet);
    await migrateCatalog(quiet);
    const stars = await prisma.variant.findMany({ where: { product: { title: 'Telegram Stars' }, isActive: true } });
    expect(stars).toHaveLength(1);
    expect(stars[0]).toMatchObject({ perUnit: true, price: 140, unit: 'Stars', minQty: 50 });
  });

  it('демо-каталог: Steam по логину, 1,1 ₽ за рубль; «Без входа» не спрашивает username', async () => {
    await seedCatalog();
    const steam = await prisma.product.findFirstOrThrow({ where: { title: 'Пополнение Steam' }, include: { variants: true } });
    expect(steam).toMatchObject({ deliveryType: 'MANUAL', needsRecipient: true, recipientKind: 'STEAM' });
    expect(steam.variants).toEqual([expect.objectContaining({ perUnit: true, price: 110, cost: 100 })]);
    const card = await prisma.product.findFirstOrThrow({ where: { title: 'Telegram Premium', access: 'NO_LOGIN' } });
    expect(card.needsRecipient).toBe(false);
    const gift = await prisma.product.findFirstOrThrow({ where: { title: 'Telegram Premium', access: 'GIFT' }, include: { variants: true } });
    expect(gift.variants.map((v) => v.title).sort()).toEqual(['12 мес', '3 мес', '6 мес']);
  });

  it('заказ на своё количество: цена = количество × цена за единицу, вне пределов — ошибка', async () => {
    await seedCatalog();
    const { createOrder } = await import('../src/services/orders.js');
    const { saveSettings } = await import('../src/services/settings.js');
    await saveSettings({ methods: { CRYPTOBOT: false, XROCKET: false, LOLZ: false, SBP: false, UAH: true }, uah: { card: '4441', holder: 'T', bank: 'B', rate: 2.5 }, fees: { CRYPTOBOT: 0, XROCKET: 0, LOLZ: 0, SBP: 0, UAH: 0 } });
    const user = await prisma.user.create({ data: { tgId: 7000n } });
    const v = await prisma.variant.findFirstOrThrow({ where: { perUnit: true, product: { title: 'Пополнение Steam' } } });
    const o = await createOrder({ userId: user.id, variantId: v.id, method: 'UAH', recipient: 'gaben', quantity: 1000 });
    expect(o).toMatchObject({ amount: R(1100), cost: R(1000), quantity: 1000, recipient: 'gaben' });
    await expect(createOrder({ userId: user.id, variantId: v.id, method: 'UAH', recipient: 'gaben', quantity: 5 })).rejects.toThrow(/от 100/);
  });
});
