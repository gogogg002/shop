/**
 * Обновление живой базы (ноябрь 2026): Telegram Premium «Без входа» и «Со входом», по 1 и 12 мес, с оптом;
 * старый «Подарком на аккаунт» (1/3/6/12 мес) убирается, потому что 1 месяц подарком не выдаётся.
 * Запуск в контейнере: node dist/migrate-catalog.js. Повторный запуск ничего не дублирует.
 */
import { prisma } from './db.js';
import { premiumModes, premiumVariants } from './catalog-data.js';
import { getSettings, saveSettings } from './services/settings.js';

async function main() {
  const s = await getSettings();
  if (!s.supportUsername) {
    await saveSettings({ supportUsername: 'TimaGopl' });
    console.log('Поддержка для опта: @TimaGopl');
  }

  const cat = await prisma.category.upsert({
    where: { slug: 'telegram' }, create: { slug: 'telegram', title: 'Telegram', sort: 0 }, update: {},
  });

  // Старый товар без режима входа: удаляем, а если по нему уже были заказы, только скрываем
  const old = await prisma.product.findMany({ where: { categoryId: cat.id, title: 'Telegram Premium', access: 'UNSPECIFIED' } });
  for (const p of old) {
    const orders = await prisma.order.count({ where: { variant: { productId: p.id } } });
    if (orders) await prisma.product.update({ where: { id: p.id }, data: { isActive: false } });
    else await prisma.product.delete({ where: { id: p.id } });
    console.log(`Старый Telegram Premium #${p.id}: ${orders ? 'скрыт (есть заказы)' : 'удалён'}`);
  }

  for (const m of premiumModes) {
    const exists = await prisma.product.findFirst({ where: { categoryId: cat.id, title: 'Telegram Premium', access: m.access } });
    if (exists) {
      console.log(`Telegram Premium ${m.access}: уже есть (#${exists.id}), не трогаю`);
      continue;
    }
    const p = await prisma.product.create({
      data: {
        categoryId: cat.id, title: 'Telegram Premium', icon: 'star', glass: 'RED', sort: 0, wholesale: true, ...m,
        variants: { create: premiumVariants },
      },
    });
    console.log(`Telegram Premium ${m.access}: создан #${p.id}`);
  }

  // Stars отправляются по username, это всегда без входа
  const stars = await prisma.product.updateMany({ where: { title: 'Telegram Stars', access: 'UNSPECIFIED' }, data: { access: 'NO_LOGIN' } });
  if (stars.count) console.log('Telegram Stars: режим «Без входа»');
  console.log('Готово');
}

main().finally(() => prisma.$disconnect());
