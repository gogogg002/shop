import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

/** Тесты идут на отдельной локальной базе krynel_test: применяем схему и чистим таблицы. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://krynel:krynel@localhost:5432/krynel_test';
  if (!/\/krynel_test(\?|$)/.test(url)) throw new Error('Тесты запускаются только на базе krynel_test');
  execSync('npx prisma db push --skip-generate', { env: { ...process.env, DATABASE_URL: url }, stdio: 'ignore' });
  const db = new PrismaClient({ datasourceUrl: url });
  await db.$executeRawUnsafe(
    'TRUNCATE "Review","Message","Code","Order","Variant","Product","Category","User","PromoCode","Setting" RESTART IDENTITY CASCADE',
  );
  await db.$disconnect();
}
