import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Подпись вебхука по схеме CryptoBot и xRocket:
 * hex(HMAC-SHA256(rawBody, key = SHA256(apiToken)))
 */
export function sign(rawBody: string, token: string): string {
  const key = createHash('sha256').update(token).digest();
  return createHmac('sha256', key).update(rawBody).digest('hex');
}

export function verifySignature(rawBody: string, token: string, signature: string | undefined): boolean {
  if (!signature || !token) return false;
  const expected = Buffer.from(sign(rawBody, token), 'hex');
  let got: Buffer;
  try {
    got = Buffer.from(signature, 'hex');
  } catch {
    return false;
  }
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export const header = (h: Record<string, string | string[] | undefined>, name: string) => {
  const v = h[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
};
