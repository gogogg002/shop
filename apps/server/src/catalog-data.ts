/** Описание Telegram Premium по режимам выдачи, Stars и Steam. Общее для демо-каталога и обновления живой базы. */
const R = (rub: number) => rub * 100;

type PremiumVariant = { title: string; price: number; cost: number; oldPrice: number | null; sort: number };

/** Без входа и со входом: 1 и 12 мес. Цены демо, правятся в админке. */
const shortLong: PremiumVariant[] = [
  { title: '1 мес', price: R(349), cost: R(270), oldPrice: null, sort: 0 },
  { title: '12 мес', price: R(3490), cost: R(3050), oldPrice: R(4190), sort: 1 },
];
/** 1 месяц подарком не выдаётся, поэтому подарком только 3, 6 и 12 мес */
const gift: PremiumVariant[] = [
  { title: '3 мес', price: R(1190), cost: R(940), oldPrice: null, sort: 0 },
  { title: '6 мес', price: R(2090), cost: R(1760), oldPrice: null, sort: 1 },
  { title: '12 мес', price: R(3490), cost: R(3050), oldPrice: R(4190), sort: 2 },
];

/*
 * Описания товаров — короткие шаги, по одному на строку: мини-апп показывает их нумерованным списком
 * «Как это работает». Длинные абзацы в Telegram читать тяжело.
 */

/** «Без входа» — выдача картой: покупатель сам оплачивает Premium нашей картой, username не нужен */
export const NO_LOGIN_TEXT = {
  subtitle: 'Выдача картой, без входа',
  description: 'Оплачиваете заказ\nПолучаете карту в чате заказа\nОформляете Premium сами, вход не нужен',
};

export const premiumModes = [
  {
    access: 'NO_LOGIN' as const,
    ...NO_LOGIN_TEXT,
    needsRecipient: false,
    recipientKind: 'USERNAME' as const,
    isHit: true,
    variants: shortLong,
  },
  {
    access: 'WITH_LOGIN' as const,
    subtitle: 'Со входом в ваш аккаунт',
    needsRecipient: true,
    recipientKind: 'PHONE' as const,
    description: 'Оплачиваете заказ\nПрисылаете код входа в чат заказа, больше никуда\nОформляем Premium, потом завершите наш сеанс в «Устройствах»',
    isHit: false,
    variants: shortLong,
  },
  {
    access: 'GIFT' as const,
    subtitle: 'Подарком на @username',
    needsRecipient: true,
    recipientKind: 'USERNAME' as const,
    description: 'Оплачиваете заказ\nPremium приходит подарком на @username',
    isHit: false,
    variants: gift,
  },
];

/** Звёзды: покупатель вводит количество, цена 1,4 ₽ за звезду */
export const starsPerUnit = { title: 'Своё количество', price: 140, cost: 0, unit: 'Stars', minQty: 50, maxQty: 100000 };
export const STARS_DESCRIPTION = 'Указываете количество и @username\nЗвёзды приходят на аккаунт, вход не нужен';

/** Steam: покупатель вводит сумму пополнения в рублях и платит 1,1 ₽ за каждый рубль (наша комиссия 10%) */
export const steamPerUnit = { title: 'Своя сумма', price: 110, cost: 100, unit: '₽ на Steam', minQty: 100, maxQty: 50000 };
export const steamProduct = {
  subtitle: 'Пополнение по логину',
  description: 'Логин — тот, что вводите при входе в Steam\nЦена: сумма пополнения + 10%\nДеньги приходят на ваш Steam',
  deliveryType: 'MANUAL' as const,
  needsRecipient: true,
  recipientKind: 'STEAM' as const,
};

/** Прежние длинные описания → короткие шаги. Обновление базы меняет только описания, которые админ не правил */
export const SHORT_DESCRIPTIONS: [string, string][] = [
  [
    'После оплаты поддержка пришлёт в чат заказа данные карты. Вы сами оформляете Premium в своём Telegram ' +
      '(Настройки → Telegram Premium) и платите этой картой. Вход в аккаунт, пароль и коды не нужны.',
    NO_LOGIN_TEXT.description,
  ],
  [
    'После оплаты поддержка напишет в чат заказа и попросит код входа из Telegram. Входим только чтобы оформить подписку. ' +
      'Потом завершите наш сеанс: Настройки → Устройства.',
    premiumModes[1].description,
  ],
  ['Premium приходит подарком на указанный @username. Вход в аккаунт не нужен.', premiumModes[2].description],
  ['Укажите логин Steam (тот, что вводите при входе, не никнейм) и сумму пополнения. Цена: сумма + 10%.', steamProduct.description],
];

/** Claude (Anthropic): выдача картой, без входа — как Telegram Premium «Без входа». Цены и закупка от владельца */
export const claudeProduct = {
  title: 'Claude',
  subtitle: 'Выдача картой, без входа',
  description: 'Оплачиваете заказ\nПолучаете карту в чате заказа\nОформляете Claude сами, вход не нужен',
  icon: 'spark',
  glass: 'DARK' as const,
  access: 'NO_LOGIN' as const,
  needsRecipient: false,
  deliveryType: 'MANUAL' as const,
};
export const claudeVariants = [
  { title: 'Pro', price: R(2300), cost: R(1966), oldPrice: null, sort: 0 },
  { title: 'Max', price: R(10500), cost: R(9830), oldPrice: null, sort: 1 },
];
