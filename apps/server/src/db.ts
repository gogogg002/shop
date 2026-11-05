import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

/** BigInt в JSON-ответах отдаём строкой */
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};
