import { prisma } from './db.js';
import { premiumModes, premiumVariants } from './catalog-data.js';

/**
 * Telegram Premium «Без входа» и «Со входом» в категории. Недостающие режимы создаёт, старый товар
 * без режима (подарок на 1/3/6/12 мес) удаляет, а если по нему были заказы, скрывает.
 * Общая для демо-каталога и обновления живой базы. Повторный запуск ничего не меняет.
 */
export async function syncTelegramPremium(categoryId: number, log: (m: string) => void = () => {}) {
  const old = await prisma.product.findMany({ where: { categoryId, title: 'Telegram Premium', access: 'UNSPECIFIED', isActive: true } });
  for (const p of old) {
    const orders = await prisma.order.count({ where: { variant: { productId: p.id } } });
    if (orders) await prisma.product.update({ where: { id: p.id }, data: { isActive: false } });
    else await prisma.product.delete({ where: { id: p.id } });
    log(`Старый Telegram Premium #${p.id}: ${orders ? 'скрыт (есть заказы)' : 'удалён'}`);
  }

  for (const m of premiumModes) {
    const exists = await prisma.product.findFirst({ where: { categoryId, title: 'Telegram Premium', access: m.access } });
    if (exists) {
      log(`Telegram Premium ${m.access}: уже есть (#${exists.id}), не трогаю`);
      continue;
    }
    const p = await prisma.product.create({
      data: {
        categoryId, title: 'Telegram Premium', icon: 'star', glass: 'RED', sort: 0, wholesale: true, ...m,
        variants: { create: premiumVariants },
      },
    });
    log(`Telegram Premium ${m.access}: создан #${p.id}`);
  }
}
