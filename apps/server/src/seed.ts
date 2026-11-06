/**
 * Демо-каталог, чтобы мини-апп не был пустым. Цены в копейках. Запуск: pnpm db:seed.
 * Только добавляет: товар, который уже есть под тем же названием в любой категории, не создаётся второй раз,
 * а существующие товары не меняются и не удаляются. Старую базу (Premium подарком, без режимов входа)
 * переводит не сид, а node dist/migrate-catalog.js.
 */
import { pathToFileURL } from 'node:url';
import type { AccessMode } from '@prisma/client';
import { prisma } from './db.js';
import { ensurePremiumModes } from './catalog-sync.js';
import { getSettings, saveSettings } from './services/settings.js';

const R = (rub: number) => rub * 100;

type V = readonly [string, number, number, number?];
type P = {
  title: string; subtitle: string; icon: string; glass: 'RED' | 'WHITE' | 'DARK'; variants: readonly V[];
  isHit?: boolean; deliveryType?: 'MANUAL' | 'CODES'; needsRecipient?: boolean; access?: AccessMode;
};

const catalog: { slug: string; title: string; products: P[] }[] = [
  { slug: 'telegram', title: 'Telegram', products: [
    { title: 'Telegram Stars', subtitle: 'Звёзды на аккаунт', icon: 'starO', glass: 'WHITE', access: 'NO_LOGIN', variants: [
      ['50 Stars', 85, 70], ['100 Stars', 165, 140], ['500 Stars', 845, 720], ['1000 Stars', 1690, 1440]] },
  ] },
  { slug: 'ai', title: 'Нейросети', products: [
    { title: 'ChatGPT Plus', subtitle: 'Подписка на ваш аккаунт', icon: 'spark', glass: 'WHITE', variants: [['1 мес', 1990, 1700]] },
  ] },
  { slug: 'games', title: 'Игры', products: [
    { title: 'Пополнение Steam', subtitle: 'Код пополнения', icon: 'pad', glass: 'DARK', deliveryType: 'CODES', needsRecipient: false, variants: [
      ['500 ₽', 525, 500], ['1 000 ₽', 1050, 1000]] },
  ] },
  { slug: 'discord', title: 'Discord', products: [
    { title: 'Discord Nitro', subtitle: 'На ваш аккаунт', icon: 'bolt', glass: 'RED', variants: [['1 мес', 399, 320], ['12 мес', 3990, 3400]] },
  ] },
];

export async function seedCatalog() {
  const s = await getSettings();
  if (!s.supportUsername) await saveSettings({ supportUsername: 'TimaGopl' });

  for (const [ci, c] of catalog.entries()) {
    const cat = await prisma.category.upsert({ where: { slug: c.slug }, create: { slug: c.slug, title: c.title, sort: ci }, update: {} });

    if (c.slug === 'telegram') await ensurePremiumModes(cat.id);

    for (const [pi, p] of c.products.entries()) {
      // По названию во всех категориях: товар, который админ перенёс в другую категорию, не дублируем
      if (await prisma.product.findFirst({ where: { title: p.title }, select: { id: true } })) continue;
      await prisma.product.create({
        data: {
          categoryId: cat.id, title: p.title, subtitle: p.subtitle, icon: p.icon, glass: p.glass, sort: pi + 1,
          isHit: p.isHit ?? false,
          deliveryType: p.deliveryType ?? 'MANUAL',
          needsRecipient: p.needsRecipient ?? true,
          access: p.access ?? 'UNSPECIFIED',
          variants: { create: p.variants.map((v, i) => ({ title: v[0], price: R(v[1]), cost: R(v[2]), oldPrice: v[3] ? R(v[3]) : null, sort: i })) },
        },
      });
    }
  }
}

// Запуск как скрипт (pnpm db:seed, node dist/seed.js); при импорте из тестов ничего не делает
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  seedCatalog()
    .then(() => console.log('Каталог заполнен'))
    .finally(() => prisma.$disconnect());
}
