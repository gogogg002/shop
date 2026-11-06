import { prisma } from './db.js';
import { premiumModes, premiumVariants } from './catalog-data.js';

/** Так Telegram Premium выглядел в каталоге до режимов входа: подарком на 1, 3, 6 и 12 мес */
const OLD_GIFT = { title: 'Telegram Premium', access: 'UNSPECIFIED', subtitle: 'Подарком на аккаунт' } as const;

/**
 * Telegram Premium «Без входа» и «Со входом»: недостающий режим создаёт в категории. Режим, который админ
 * перенёс в другую категорию, считается на месте, второй такой товар не появится. Повторный запуск ничего не меняет.
 */
export async function ensurePremiumModes(categoryId: number, log: (m: string) => void = () => {}) {
  for (const m of premiumModes) {
    const exists = await prisma.product.findFirst({ where: { title: 'Telegram Premium', access: m.access }, orderBy: { id: 'asc' } });
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

/**
 * Старый Premium подарком (1 месяц подарком не выдаётся) удаляет, а если по нему были заказы, скрывает.
 * Трогает только товар в том виде, в каком его создал старый демо-каталог: Premium без режима,
 * который админ завёл сам, остаётся как есть. Нужна только при обновлении старой базы.
 */
export async function retireOldGiftPremium(log: (m: string) => void = () => {}) {
  const old = await prisma.product.findMany({ where: { ...OLD_GIFT, isActive: true } });
  for (const p of old) {
    const orders = await prisma.order.count({ where: { variant: { productId: p.id } } });
    if (orders) await prisma.product.update({ where: { id: p.id }, data: { isActive: false } });
    else await prisma.product.delete({ where: { id: p.id } });
    log(`Старый Telegram Premium подарком #${p.id}: ${orders ? 'скрыт (есть заказы)' : 'удалён'}`);
  }
}
