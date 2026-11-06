import type { AccessMode } from '@prisma/client';

export const ACCESS_LABEL: Record<AccessMode, string> = { NO_LOGIN: 'Без входа', WITH_LOGIN: 'Со входом', UNSPECIFIED: '' };

/** «Telegram Premium (со входом) · 12 мес»: в уведомлениях оба режима одного товара должны различаться */
export function orderTitle(product: { title: string; access: AccessMode }, variant: string) {
  const mode = ACCESS_LABEL[product.access];
  return `${product.title.trim()}${mode ? ` (${mode.toLowerCase()})` : ''} · ${variant}`;
}

/** Postgres не хранит нулевой символ в тексте: вырезаем его из всего, что пишут люди */
export const stripNul = (s: string) => s.replace(/\u0000/g, '');
