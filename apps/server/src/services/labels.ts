import type { AccessMode } from '@prisma/client';

export const ACCESS_LABEL: Record<AccessMode, string> = { NO_LOGIN: 'Без входа', WITH_LOGIN: 'Со входом', UNSPECIFIED: '' };

/** «Telegram Premium (со входом) · 12 мес»: в уведомлениях оба режима одного товара должны различаться */
export function orderTitle(product: { title: string; access: AccessMode }, variant: string) {
  const mode = ACCESS_LABEL[product.access];
  return `${product.title.trim()}${mode ? ` (${mode.toLowerCase()})` : ''} · ${variant}`;
}

/**
 * Текст, который база примет: Postgres не хранит нулевой символ, а половинку суррогатной пары
 * (в JSON её можно прислать как «\ud800») не принимает драйвер. Нулевой символ вырезаем,
 * половинку меняем на «�»: так кривой ввод сохраняется, а не роняет запрос ошибкой 500.
 */
export const cleanText = (s: string) =>
  s.replace(/\u0000/g, '').replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '\ufffd');

/** cleanText для всех строк тела запроса, включая ключи. Глубже 32 уровней наших форм не бывает */
export function cleanDeep(v: unknown, depth = 0): unknown {
  if (typeof v === 'string') return cleanText(v);
  if (!v || typeof v !== 'object' || depth > 32) return v;
  if (Array.isArray(v)) return v.map((x) => cleanDeep(x, depth + 1));
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [cleanText(k), cleanDeep(x, depth + 1)]));
}
