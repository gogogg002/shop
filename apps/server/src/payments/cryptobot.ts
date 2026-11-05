import { config } from '../config.js';
import type { AutoProvider } from './types.js';
import { rubString } from './types.js';
import { header, verifySignature } from './signature.js';

/** Crypto Pay API (@CryptoBot): https://help.crypt.bot/crypto-pay-api */
const base = () => (config.CRYPTOBOT_TESTNET ? 'https://testnet-pay.crypt.bot/api' : 'https://pay.crypt.bot/api');

async function call<T>(method: string, params: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${base()}/${method}`, {
    method: 'POST',
    headers: { 'Crypto-Pay-API-Token': config.CRYPTOBOT_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const json = (await res.json()) as { ok: boolean; result?: T; error?: unknown };
  if (!json.ok || !json.result) throw new Error(`CryptoBot ${method}: ${JSON.stringify(json.error)}`);
  return json.result;
}

interface Invoice {
  invoice_id: number;
  status: 'active' | 'paid' | 'expired';
  bot_invoice_url?: string;
  pay_url?: string;
  payload?: string;
}

export const cryptobot: AutoProvider = {
  method: 'CRYPTOBOT',
  isConfigured: () => Boolean(config.CRYPTOBOT_TOKEN),

  async createInvoice({ orderId, amountRub, description }) {
    const inv = await call<Invoice>('createInvoice', {
      currency_type: 'fiat',
      fiat: 'RUB',
      amount: rubString(amountRub),
      accepted_assets: 'USDT,TON,BTC,LTC,TRX',
      description,
      payload: String(orderId),
      expires_in: 1800,
    });
    return {
      externalId: String(inv.invoice_id),
      payUrl: inv.bot_invoice_url ?? inv.pay_url ?? '',
      payAmount: `${rubString(amountRub)} RUB`,
    };
  },

  async handleWebhook(rawBody, headers) {
    if (!verifySignature(rawBody, config.CRYPTOBOT_TOKEN, header(headers, 'crypto-pay-api-signature'))) return null;
    const body = JSON.parse(rawBody) as { update_type?: string; payload?: Invoice };
    if (body.update_type !== 'invoice_paid' || !body.payload) return null;
    // Перепроверяем статус через API, а не верим телу запроса
    const list = await call<{ items: Invoice[] }>('getInvoices', { invoice_ids: String(body.payload.invoice_id) });
    const inv = list.items[0];
    if (!inv || inv.status !== 'paid') return null;
    const orderId = Number(inv.payload);
    return Number.isInteger(orderId) ? orderId : null;
  },
};
