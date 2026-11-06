import { config } from '../config.js';
import { getSettings } from '../services/settings.js';
import type { AutoProvider } from './types.js';
import { header, verifySignature } from './signature.js';

/**
 * xRocket Pay API: https://pay.xrocket.tg/api/
 * Счёт выставляется в USDT по курсу из настроек магазина (₽ за 1 USDT).
 * Перед запуском сверить поля ответа и вебхука с актуальной документацией.
 */
const BASE = 'https://pay.xrocket.tg';

async function call<T>(path: string, init: { method: string; body?: unknown }): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: init.method,
    headers: { 'Rocket-Pay-Key': config.XROCKET_TOKEN, 'Content-Type': 'application/json' },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const json = (await res.json()) as { success: boolean; data?: T; message?: string };
  if (!json.success || !json.data) throw new Error(`xRocket ${path}: ${json.message ?? res.status}`);
  return json.data;
}

interface TgInvoice {
  id: number;
  link: string;
  status: 'active' | 'paid' | 'expired';
  payload?: string;
}

export function rubToUsdt(amountRub: number, rate: number): number {
  return Math.ceil((amountRub / 100 / rate) * 100) / 100;
}

export const xrocket: AutoProvider = {
  method: 'XROCKET',
  isConfigured: () => Boolean(config.XROCKET_TOKEN),

  async createInvoice({ orderId, amountRub, description }) {
    const { usdtRate } = await getSettings();
    const amount = rubToUsdt(amountRub, usdtRate);
    const inv = await call<TgInvoice>('/tg-invoices', {
      method: 'POST',
      body: {
        amount,
        numPayments: 1,
        currency: 'USDT',
        description,
        payload: String(orderId),
        expiredIn: 1800,
        callbackUrl: `${config.PUBLIC_URL}/#/orders/${orderId}`,
      },
    });
    return { externalId: String(inv.id), payUrl: inv.link, payAmount: `${amount.toFixed(2)} USDT` };
  },

  async handleWebhook(rawBody, headers) {
    if (!verifySignature(rawBody, config.XROCKET_TOKEN, header(headers, 'rocket-pay-signature'))) return null;
    const body = JSON.parse(rawBody) as { data?: TgInvoice };
    if (!body.data?.id) return null;
    const inv = await call<TgInvoice>(`/tg-invoices/${body.data.id}`, { method: 'GET' });
    if (inv.status !== 'paid') return null;
    const orderId = Number(inv.payload);
    return Number.isInteger(orderId) ? orderId : null;
  },

  async paidInvoices(ids) {
    const paid = new Set<string>();
    let failed = 0;
    let lastError: unknown;
    for (const id of ids) {
      // Один счёт, на который API ответил ошибкой, не должен останавливать сверку остальных
      try {
        const inv = await call<TgInvoice>(`/tg-invoices/${encodeURIComponent(id)}`, { method: 'GET' });
        if (inv.status === 'paid') paid.add(id);
      } catch (e) {
        failed++;
        lastError = e;
      }
    }
    // Не ответил ни один: это сбой связи или ключа, сверка запишет ошибку в лог
    if (failed && failed === ids.length) throw lastError;
    return paid;
  },
};
