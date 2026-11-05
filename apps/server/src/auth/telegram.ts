import { createHmac, timingSafeEqual } from 'node:crypto';

export interface TgUser {
  id: number;
  username?: string;
  first_name?: string;
}

/**
 * Проверка подписи Telegram WebApp initData.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function verifyInitData(
  initData: string,
  botToken: string,
  maxAgeSec = 24 * 3600,
  now = Date.now(),
): TgUser | null {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(dataCheckString).digest('hex');

  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || now / 1000 - authDate > maxAgeSec) return null;

  const userRaw = params.get('user');
  if (!userRaw) return null;
  try {
    const user = JSON.parse(userRaw) as TgUser;
    return typeof user.id === 'number' ? user : null;
  } catch {
    return null;
  }
}

/** Для тестов: собирает валидную initData так же, как Telegram. */
export function signInitData(fields: Record<string, string>, botToken: string): string {
  const params = new URLSearchParams(fields);
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  params.set('hash', createHmac('sha256', secret).update(dataCheckString).digest('hex'));
  return params.toString();
}
