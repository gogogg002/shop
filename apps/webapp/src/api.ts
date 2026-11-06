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

const NETWORK_TEXT = 'Нет связи с магазином. Проверьте интернет и попробуйте ещё раз';
/** Ответ не дошёл: запрос мог и выполниться на сервере */
export const isNetwork = (e: unknown) => e instanceof ApiError && e.code === 'network';

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
  // Обрыв связи браузер отдаёт как «Failed to fetch»: покупателю нужен понятный текст. Запрос мог и дойти:
  // экраны, где повтор что-то задвоит (сообщение, заказ, чек), говорят об этом сами, см. isNetwork
  const res = await fetch(path, { method: init.method ?? (body ? 'POST' : 'GET'), headers, body }).catch(() => {
    throw new ApiError('network', NETWORK_TEXT, 0);
  });
  const data = await res.json().catch(() => undefined);
  if (!res.ok) throw new ApiError(data?.error ?? 'http', data?.message ?? `Ошибка ${res.status}`, res.status);
  // Связь оборвалась посреди ответа: тело не дочиталось. Это та же ошибка связи, а не пустой ответ, иначе
  // экран получил бы {} вместо заказа и упал. Пустым телом сервер на запросы мини-аппа не отвечает
  if (data === undefined) throw new ApiError('network', NETWORK_TEXT, 0);
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
export type Access = 'UNSPECIFIED' | 'NO_LOGIN' | 'WITH_LOGIN' | 'GIFT';
export type RecipientKind = 'USERNAME' | 'PHONE' | 'STEAM';
export const accessLabel: Record<Access, string> = { UNSPECIFIED: '', NO_LOGIN: 'Без входа', WITH_LOGIN: 'Со входом', GIFT: 'Подарком' };
/** +79001234567 → «+7 900 123-45-67», +380671234567 → «+380 67 123 45 67», остальные как есть */
export function prettyPhone(e164: string) {
  const d = e164.replace(/^\+/, '');
  if (/^7\d{10}$/.test(d)) return `+7 ${d.slice(1, 4)} ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9)}`;
  if (/^380\d{9}$/.test(d)) return `+380 ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8, 10)} ${d.slice(10)}`;
  return e164;
}
/** «Telegram Premium · со входом · 12 мес»: оба режима одного товара в заказах должны различаться */
export const itemTitle = (product: string, access: Access, variant: string) =>
  [product.trim(), accessLabel[access].toLowerCase(), variant].filter(Boolean).join(' · ');
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
  products: {
    id: number; title: string; subtitle: string; icon: string; glass: Glass; isHit: boolean; minPrice: number;
    access: Access; modes: Access[];
  }[];
}
export interface Rating { avg: number; count: number }
export interface PublicReview {
  id: number; rating: number; text: string; author: string; product: string; access: Access; variant: string; createdAt: string;
}
export interface ReviewFeed { summary: Rating; items: PublicReview[]; nextBefore: number | null }
export interface ProductView {
  id: number; title: string; subtitle: string; description: string; icon: string; glass: Glass; category: string;
  needsRecipient: boolean; recipientKind: RecipientKind; deliveryType: 'MANUAL' | 'CODES'; access: Access; wholesale: boolean;
  siblings: { id: number; access: Access; label: string }[];
  variants: {
    id: number; title: string; price: number; oldPrice: number | null; inStock: boolean;
    /** своё количество: price — за единицу, покупатель вводит minQty..maxQty */
    perUnit: boolean; unit: string; minQty: number; maxQty: number;
  }[];
  rating: Rating;
  reviews: PublicReview[];
}
export interface OrderListItem {
  id: number; status: OrderStatus; method: Method; amount: number; payAmount: string | null; createdAt: string;
  product: string; variant: string; icon: string; glass: Glass; access: Access;
  recipient: string | null; deliveredText: string | null; payUrl: string | null; reviewed: boolean;
}
export interface OrderView extends OrderListItem {
  discount: number; productId: number;
  manual: { method: 'UAH' | 'SBP'; amount: string; requisites: { label: string; value: string }[]; comment: string } | null;
  messages: { id: number; text: string; fromAdmin: boolean; createdAt: string }[];
  review: { rating: number; text: string; createdAt: string } | null;
  canReview: boolean;
}

/** «4,9» и «23 отзыва» */
export const ratingText = (avg: number) => avg.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
export const reviewsWord = (n: number) => `${n.toLocaleString('ru-RU')} ${plural(n, 'отзыв', 'отзыва', 'отзывов')}`;
export const ratingWord = ['', 'Плохо', 'Так себе', 'Нормально', 'Хорошо', 'Отлично'];

/** Ссылка на чат в Telegram: внутри мини-аппа открывается без выхода из Telegram */
export function openTelegramChat(username: string) {
  const url = `https://t.me/${username.replace(/^@/, '')}`;
  if (tg) tg.openTelegramLink(url);
  else window.open(url, '_blank');
}
export const shortDate = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });

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

export interface AdminReview {
  id: number; orderId: number; rating: number; text: string; isHidden: boolean; createdAt: string;
  editCount: number; activityAt: string;
  user: { tgId: string; username: string | null; firstName: string | null };
  product: { title: string; access: Access; icon: string; glass: Glass };
  order: { id: number; quantity: number; variant: { title: string; perUnit: boolean; unit: string } };
}

/** «12 мес» или «750 Stars» для варианта со своим количеством */
export const variantText = (v: { title: string; perUnit?: boolean; unit?: string }, quantity = 1) =>
  v.perUnit ? `${quantity.toLocaleString('ru-RU')} ${v.unit ?? ''}`.trim() : v.title;

export interface AdminOrder {
  id: number; status: OrderStatus; method: Method; amount: number; cost: number; payAmount: string | null; recipient: string | null;
  createdAt: string; paidAt: string | null; deliveredText: string | null; proofFileId: string | null; quantity: number;
  user: { tgId: string; username: string | null; firstName: string | null };
  variant: { title: string; perUnit: boolean; unit: string; product: { title: string; icon: string; glass: Glass; deliveryType: 'MANUAL' | 'CODES'; access: Access } };
  messages?: { id: number; text: string; fromAdmin: boolean; createdAt: string }[];
}
