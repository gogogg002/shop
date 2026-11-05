import { config } from './config.js';
import { buildApp } from './app.js';
import { startBot } from './bot/index.js';
import { expireUnpaid } from './services/orders.js';
import { getSettings } from './services/settings.js';

const app = await buildApp({ logger: true });
startBot();

// Раз в минуту закрываем просроченные неоплаченные счета
setInterval(async () => {
  try {
    await expireUnpaid((await getSettings()).paymentTtlMin);
  } catch (e) {
    app.log.error(e);
  }
}, 60_000);

await app.listen({ port: config.PORT, host: '0.0.0.0' });
