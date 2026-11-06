import { z } from 'zod';
import { ShopError } from '../services/orders.js';

/** Самый большой id в Postgres (int4). Всё, что больше, база не примет и ответит ошибкой 500 */
export const MAX_DB_ID = 2_147_483_647;

/** Номер из строки запроса: ?before=…, ?productId=… */
export const dbId = z.coerce.number().int().positive().max(MAX_DB_ID);

/** Номер в теле запроса (JSON): variantId, categoryId */
export const bodyId = z.number().int().positive().max(MAX_DB_ID);

/** Целое, которое помещается в колонку int4: цены в копейках, порядок сортировки, лимиты промокодов */
export const int4 = z.number().int().min(-MAX_DB_ID - 1).max(MAX_DB_ID);

/** Номер из пути (/orders/:id). Чужой, кривой или слишком большой номер — просто «не найдено» */
export function pathId(req: { params: unknown }, message = 'Не найдено') {
  const raw = (req.params as { id?: string }).id ?? '';
  const id = /^\d{1,10}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(id) || id < 1 || id > MAX_DB_ID) throw new ShopError('not_found', message, 404);
  return id;
}
