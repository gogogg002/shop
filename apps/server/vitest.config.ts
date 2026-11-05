import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://vault:vault@localhost:5432/vault_test',
      BOT_TOKEN: '123456:TEST',
      ADMIN_IDS: '1000',
      DEV_AUTH: 'true',
      CRYPTOBOT_TOKEN: 'cb-test-token',
    },
    globalSetup: './test/global-setup.ts',
    fileParallelism: false,
  },
});
