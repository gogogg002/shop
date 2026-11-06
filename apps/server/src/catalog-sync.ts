import { prisma } from './db.js';
import { NO_LOGIN_TEXT, SHORT_DESCRIPTIONS, STARS_DESCRIPTION, premiumModes, starsPerUnit, steamPerUnit, steamProduct } from './catalog-data.js';

/** Так Telegram Premium выглядел в каталоге до режимов входа: подарком на 1, 3, 6 и 12 мес */
const OLD_GIFT = { title: 'Telegram Premium', access: 'UNSPECIFIED', subtitle: 'Подарком на аккаунт' } as const;

/**
 * Telegram Premium «Без входа», «Со входом» и «Подарком»: недостающий режим создаёт в категории. Режим, который админ
 * перенёс в другую категорию, считается на месте, второй такой товар не появится. Повторный запуск ничего не меняет.
 */
export async function ensurePremiumModes(categoryId: number, log: (m: string) => void = () => {}) {
  for (const { variants, ...m } of premiumModes) {
    const exists = await prisma.product.findFirst({ where: { title: 'Telegram Premium', access: m.access }, orderBy: { id: 'asc' } });
    if (exists) {
      log(`Telegram Premium ${m.access}: уже есть (#${exists.id}), не трогаю`);
      continue;
    }
    const p = await prisma.product.create({
      data: {
        categoryId, title: 'Telegram Premium', icon: 'star', glass: 'RED', sort: 0, wholesale: true, ...m,
        variants: { create: variants },
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

/**
 * «Без входа» стал выдачей картой: username больше не спрашиваем. Меняет только товар с прежним текстом
 * демо-каталога, чтобы не затереть то, что админ поправил сам.
 */
export async function noLoginByCard(log: (m: string) => void = () => {}) {
  const r = await prisma.product.updateMany({
    where: { title: 'Telegram Premium', access: 'NO_LOGIN', subtitle: 'На ваш @username, без входа' },
    data: { ...NO_LOGIN_TEXT, needsRecipient: false },
  });
  if (r.count) log('Telegram Premium «Без входа»: выдача картой, username не спрашиваем');
}

/** Фиксированные варианты прячет (с заказами) или удаляет и добавляет вариант со своим количеством */
async function toPerUnit(productId: number, v: typeof starsPerUnit, log: (m: string) => void, name: string) {
  // Выключенный админом вариант тоже считается: повторный запуск не вернёт его в продажу по цене из демо
  if (await prisma.variant.findFirst({ where: { productId, perUnit: true } })) {
    log(`${name}: своё количество уже есть, не трогаю`);
    return false;
  }
  for (const old of await prisma.variant.findMany({ where: { productId, isActive: true } })) {
    // Удаление варианта стёрло бы и его коды: вариант с заказами или кодами только выключаем
    const unsold = await prisma.code.count({ where: { variantId: old.id, orderId: null } });
    if (unsold) log(`${name} · ${old.title}: выключен, непроданных кодов ${unsold}, они остались в базе`);
    if (unsold || (await prisma.order.count({ where: { variantId: old.id } }))) await prisma.variant.update({ where: { id: old.id }, data: { isActive: false } });
    else await prisma.variant.delete({ where: { id: old.id } });
  }
  await prisma.variant.create({ data: { productId, ...v, perUnit: true, sort: 0 } });
  log(`${name}: своё количество, ${v.price / 100} ₽ за ${v.unit === 'Stars' ? 'звезду' : '1 ₽'}`);
  return true;
}

/** Stars и Steam со своим количеством. Повторный запуск ничего не меняет */
export async function perUnitStarsSteam(log: (m: string) => void = () => {}) {
  const stars = await prisma.product.findFirst({ where: { title: 'Telegram Stars' }, orderBy: { id: 'asc' } });
  if (stars) await toPerUnit(stars.id, starsPerUnit, log, 'Telegram Stars');
  const steam = await prisma.product.findFirst({ where: { title: 'Пополнение Steam' }, orderBy: { id: 'asc' } });
  if (steam && (await toPerUnit(steam.id, steamPerUnit, log, 'Пополнение Steam')))
    await prisma.product.update({ where: { id: steam.id }, data: steamProduct });
}

/** Длинные описания демо-каталога → короткие шаги. Описания, которые админ уже поправил, не трогает */
export async function shortDescriptions(log: (m: string) => void = () => {}) {
  let n = 0;
  for (const [old, next] of SHORT_DESCRIPTIONS) {
    n += (await prisma.product.updateMany({ where: { description: old }, data: { description: next } })).count;
  }
  n += (await prisma.product.updateMany({ where: { title: 'Telegram Stars', description: '' }, data: { description: STARS_DESCRIPTION } })).count;
  if (n) log(`Описания товаров: короткие шаги (${n})`);
}
