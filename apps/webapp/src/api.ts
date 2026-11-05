declare global {
  interface Window {
    Telegram?: { WebApp: TgWebApp };
  }
}
interface TgWebApp {
  initData: string;
  ready(): void;
  expand(): void;
  setHeaderColor(c: string): void;
  setBackgroundColor(c: string): void;
  openTelegramLink(url: string): void;
  openLink(url: string): void;
  HapticFeedback?: { notificationOccurred(t: 'success' | 'error' | 'warning'): void };
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
}

export const tg = window.Telegram?.WebApp;

/** В браузере без Telegram (локальная разработка) можно передать ?dev=<tgId> */
const devUser = new URLSearchParams(location.search).get('dev');

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (tg?.initData) headers['x-telegram-init-data'] = tg.initData;
  else if (devUser) headers['x-dev-user'] = devUser;
  let body: BodyInit | undefined;
  if (init.form) body = init.form;
  else if (init.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(init.body);
  }
  const res = await fetch(path, { method: init.method ?? (body ? 'POST' : 'GET'), headers, body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? 'http', data.message ?? `Ошибка ${res.status}`, res.status);
  return data as T;
}

export const rub = (kop: number) => `${(kop / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`;

export function openPay(url: string) {
  if (!url) return;
  if (tg && /^https:\/\/t\.me\//.test(url)) tg.openTelegramLink(url);
  else if (tg) tg.openLink(url);
  else window.open(url, '_blank');
}

export async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ---- типы ответов API ----
export type Glass = 'RED' | 'WHITE' | 'DARK';
export type Method = 'CRYPTOBOT' | 'XROCKET' | 'LOLZ' | 'SBP' | 'UAH';
export type OrderStatus = 'PENDING_PAYMENT' | 'AWAITING_CONFIRMATION' | 'PAID' | 'DELIVERED' | 'REJECTED' | 'CANCELLED' | 'REFUNDED';

export interface Me {
  user: { id: number; username: string | null; firstName: string | null; balance: number };
  isAdmin: boolean;
  methods: { method: Method; fee: number; manual: boolean }[];
  supportUsername: string;
}
export interface CatalogCategory {
  id: number; slug: string; title: string;
  products: { id: number; title: string; subtitle: string; icon: string; glass: Glass; isHit: boolean; minPrice: number }[];
}
export interface ProductView {
  id: number; title: string; subtitle: string; description: string; icon: string; glass: Glass; category: string;
  needsRecipient: boolean; deliveryType: 'MANUAL' | 'CODES';
  variants: { id: number; title: string; price: number; oldPrice: number | null; inStock: boolean }[];
}
export interface OrderListItem {
  id: number; status: OrderStatus; method: Method; amount: number; payAmount: string | null; createdAt: string;
  product: string; variant: string; icon: string; glass: Glass; recipient: string | null; deliveredText: string | null; payUrl: string | null;
}
export interface OrderView extends OrderListItem {
  discount: number;
  manual: { method: 'UAH' | 'SBP'; amount: string; requisites: { label: string; value: string }[]; comment: string } | null;
  messages: { id: number; text: string; fromAdmin: boolean; createdAt: string }[];
}

export const methodLabel: Record<Method, { title: string; sub: string }> = {
  SBP: { title: 'СБП', sub: 'Перевод по номеру' },
  CRYPTOBOT: { title: 'CryptoBot', sub: 'USDT, TON, BTC' },
  XROCKET: { title: 'xRocket', sub: 'USDT в Telegram' },
  LOLZ: { title: 'Lolz', sub: 'Баланс lolz.market' },
  UAH: { title: 'Гривны', sub: 'Перевод на карту' },
};

export const statusLabel: Record<OrderStatus, { text: string; tone: 'ok' | 'warn' | 'bad' | 'info' | 'm' | 'a' }> = {
  PENDING_PAYMENT: { text: 'Ждёт оплаты', tone: 'bad' },
  AWAITING_CONFIRMATION: { text: 'Проверяем оплату', tone: 'warn' },
  PAID: { text: 'Выдаём', tone: 'warn' },
  DELIVERED: { text: 'Выдан', tone: 'ok' },
  REJECTED: { text: 'Оплата отклонена', tone: 'bad' },
  CANCELLED: { text: 'Отменён', tone: 'm' },
  REFUNDED: { text: 'Возврат', tone: 'info' },
};

/** Картинка, которую сервер отдаёт только с авторизацией (чек оплаты) */
export async function apiBlobUrl(path: string): Promise<string> {
  const headers: Record<string, string> = {};
  if (tg?.initData) headers['x-telegram-init-data'] = tg.initData;
  else if (devUser) headers['x-dev-user'] = devUser;
  const res = await fetch(path, { headers });
  if (!res.ok) throw new ApiError('http', 'Не удалось загрузить чек', res.status);
  return URL.createObjectURL(await res.blob());
}

export interface AdminOrder {
  id: number; status: OrderStatus; method: Method; amount: number; cost: number; payAmount: string | null; recipient: string | null;
  createdAt: string; paidAt: string | null; deliveredText: string | null; proofFileId: string | null;
  user: { tgId: string; username: string | null; firstName: string | null };
  variant: { title: string; product: { title: string; icon: string; glass: Glass; deliveryType: 'MANUAL' | 'CODES' } };
  messages?: { id: number; text: string; fromAdmin: boolean; createdAt: string }[];
}
