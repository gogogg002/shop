/** Демо-каталог, чтобы мини-апп не был пустым. Цены в копейках. Запуск: pnpm db:seed */
import { prisma } from './db.js';

const R = (rub: number) => rub * 100;

const catalog = [
  { slug: 'telegram', title: 'Telegram', products: [
    { title: 'Telegram Premium', subtitle: 'Подарком на аккаунт', icon: 'star', glass: 'RED', isHit: true, variants: [
      ['1 мес', 349, 270], ['3 мес', 1190, 940], ['6 мес', 2090, 1760], ['12 мес', 3490, 3050, 4190]] },
    { title: 'Telegram Stars', subtitle: 'Звёзды на аккаунт', icon: 'starO', glass: 'WHITE', variants: [
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
] as const;

async function main() {
  for (const [ci, c] of catalog.entries()) {
    const cat = await prisma.category.upsert({ where: { slug: c.slug }, create: { slug: c.slug, title: c.title, sort: ci }, update: {} });
    for (const [pi, p] of c.products.entries()) {
      if (await prisma.product.findFirst({ where: { title: p.title } })) continue;
      await prisma.product.create({
        data: {
          categoryId: cat.id, title: p.title, subtitle: p.subtitle, icon: p.icon, glass: p.glass, sort: pi,
          isHit: 'isHit' in p ? p.isHit : false,
          deliveryType: 'deliveryType' in p ? p.deliveryType : 'MANUAL',
          needsRecipient: 'needsRecipient' in p ? p.needsRecipient : true,
          variants: { create: p.variants.map((v, i) => ({ title: v[0], price: R(v[1]), cost: R(v[2]), oldPrice: v[3] ? R(v[3]) : null, sort: i })) },
        },
      });
    }
  }
  console.log('Каталог заполнен');
}

main().finally(() => prisma.$disconnect());
