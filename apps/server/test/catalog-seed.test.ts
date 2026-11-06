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
      'ChatGPT Plus|UNSPECIFIED', 'Discord Nitro|UNSPECIFIED', 'Telegram Premium|NO_LOGIN', 'Telegram Premium|WITH_LOGIN',
      'Telegram Stars|NO_LOGIN', 'Пополнение Steam|UNSPECIFIED',
    ]);
  });

  it('товар, который админ перенёс в другую категорию, второй раз не появляется', async () => {
    await seedCatalog();
    const subs = await prisma.category.create({ data: { slug: 'subs', title: 'Подписки' } });
    await prisma.product.updateMany({ where: { title: { in: ['Discord Nitro', 'Telegram Premium'] } }, data: { categoryId: subs.id } });
    await seedCatalog();
    expect(await prisma.product.count({ where: { title: 'Discord Nitro' } })).toBe(1);
    expect(await prisma.product.count({ where: { title: 'Telegram Premium' } })).toBe(2);
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
    expect(await active()).toEqual(['Telegram Premium|NO_LOGIN', 'Telegram Premium|WITH_LOGIN', 'Telegram Stars|NO_LOGIN']);
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
    expect(await prisma.product.count({ where: { title: 'Telegram Premium' } })).toBe(2);
  });
});
