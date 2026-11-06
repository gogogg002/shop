/**
 * Обновление живой базы (ноябрь 2026): Telegram Premium «Без входа» и «Со входом», по 1 и 12 мес, с оптом;
 * старый «Подарком на аккаунт» (1/3/6/12 мес) убирается, потому что 1 месяц подарком не выдаётся.
 * Запуск в контейнере: node dist/migrate-catalog.js. Повторный запуск ничего не дублирует.
 */
import { pathToFileURL } from 'node:url';
import { prisma } from './db.js';
import { ensurePremiumModes, retireOldGiftPremium } from './catalog-sync.js';
import { getSettings, saveSettings } from './services/settings.js';

export async function migrateCatalog(log: (m: string) => void = console.log) {
  const s = await getSettings();
  if (!s.supportUsername) {
    await saveSettings({ supportUsername: 'TimaGopl' });
    log('Поддержка для опта: @TimaGopl');
  }

  const cat = await prisma.category.upsert({
    where: { slug: 'telegram' }, create: { slug: 'telegram', title: 'Telegram', sort: 0 }, update: {},
  });

  await retireOldGiftPremium(log);
  await ensurePremiumModes(cat.id, log);

  // Stars отправляются по username, это всегда без входа
  const stars = await prisma.product.updateMany({ where: { title: 'Telegram Stars', access: 'UNSPECIFIED' }, data: { access: 'NO_LOGIN' } });
  if (stars.count) log('Telegram Stars: режим «Без входа»');
  log('Готово');
}

// Запуск как скрипт; при импорте из тестов ничего не делает
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  migrateCatalog().finally(() => prisma.$disconnect());
}
