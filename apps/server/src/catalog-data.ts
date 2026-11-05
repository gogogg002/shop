/** Описание Telegram Premium в двух режимах. Общее для демо-каталога и обновления живой базы. */
const R = (rub: number) => rub * 100;

export const premiumModes = [
  {
    access: 'NO_LOGIN' as const,
    subtitle: 'На ваш @username, без входа',
    recipientKind: 'USERNAME' as const,
    description: 'Premium оформляется на ваш аккаунт по @username. Пароль, номер телефона и коды не нужны.',
    isHit: true,
  },
  {
    access: 'WITH_LOGIN' as const,
    subtitle: 'Со входом в ваш аккаунт',
    recipientKind: 'PHONE' as const,
    description:
      'После оплаты поддержка напишет в чат заказа и попросит код входа из Telegram. Входим только чтобы оформить подписку. ' +
      'Потом завершите наш сеанс: Настройки → Устройства.',
    isHit: false,
  },
];

/** 1 месяц подарком не выдаётся, поэтому у обоих режимов 1 и 12 месяцев. Цены демо, правятся в админке. */
export const premiumVariants = [
  { title: '1 мес', price: R(349), cost: R(270), oldPrice: null, sort: 0 },
  { title: '12 мес', price: R(3490), cost: R(3050), oldPrice: R(4190), sort: 1 },
];
