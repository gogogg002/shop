import type { DeliveryType, Order } from '@prisma/client';

/**
 * Всё, что сервер говорит людям в Telegram, идёт через этот интерфейс.
 * Реализацию на grammY подставляет bot/index.ts, в тестах — заглушка.
 */
export interface Notifier {
  /** Новая ручная оплата с чеком: шлёт админам фото с кнопками, возвращает file_id фото */
  manualPaymentProof(order: OrderView, photo: Buffer | null): Promise<string | null>;
  /** Заказ оплачен и ждёт ручной выдачи */
  orderPaid(order: OrderView): Promise<void>;
  /** Клиенту: статус заказа изменился */
  orderStatusToUser(order: OrderView, text: string): Promise<void>;
  /** Сообщение в чате заказа: от клиента — админам, от админа — клиенту */
  chatMessage(order: OrderView, text: string, fromAdmin: boolean): Promise<void>;
}

export type OrderView = Order & {
  user: { tgId: bigint; username: string | null; firstName: string | null };
  variant: { title: string; product: { title: string; deliveryType: DeliveryType } };
};

const noop: Notifier = {
  async manualPaymentProof() {
    return null;
  },
  async orderPaid() {},
  async orderStatusToUser() {},
  async chatMessage() {},
};

let current: Notifier = noop;
export const notifier = () => current;
export const setNotifier = (n: Notifier) => {
  current = n;
};
