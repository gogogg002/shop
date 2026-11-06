/**
 * Обновление живой базы (ноябрь 2026): Telegram Premium «Без входа» и «Со входом», по 1 и 12 мес, с оптом;
 * старый «Подарком на аккаунт» (1/3/6/12 мес) убирается, потому что 1 месяц подарком не выдаётся.
 * Запуск в контейнере: node dist/migrate-catalog.js. Повторный запуск ничего не дублирует.
 */
import { prisma } from './db.js';
import { syncTelegramPremium } from './catalog-sync.js';
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

  await syncTelegramPremium(cat.id, console.log);

  // Stars отправляются по username, это всегда без входа
  const stars = await prisma.product.updateMany({ where: { title: 'Telegram Stars', access: 'UNSPECIFIED' }, data: { access: 'NO_LOGIN' } });
  if (stars.count) console.log('Telegram Stars: режим «Без входа»');
  console.log('Готово');
}

main().finally(() => prisma.$disconnect());
