import type { PaymentMethod } from '@prisma/client';

export interface CreateInvoiceInput {
  orderId: number;
  /** Сумма в копейках RUB */
  amountRub: number;
  description: string;
}

export interface InvoiceResult {
  externalId: string;
  payUrl: string;
  /** Сумма в валюте провайдера, для показа клиенту */
  payAmount: string;
}

/** Автоматический провайдер: создаёт счёт и сам подтверждает оплату вебхуком. */
export interface AutoProvider {
  method: PaymentMethod;
  isConfigured(): boolean;
  createInvoice(input: CreateInvoiceInput): Promise<InvoiceResult>;
  /**
   * Разбирает вебхук. Возвращает orderId, если счёт действительно оплачен
   * (подпись верна и статус перепроверен через API провайдера), иначе null.
   */
  handleWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>): Promise<number | null>;
}

export const rubString = (kop: number) => (kop / 100).toFixed(2);
