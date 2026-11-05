import { describe, expect, it } from 'vitest';
import { signInitData, verifyInitData } from '../src/auth/telegram.js';
import { sign, verifySignature } from '../src/payments/signature.js';
import { computeTotal, rubToUah } from '../src/services/orders.js';
import { rubToUsdt } from '../src/payments/xrocket.js';

const TOKEN = '123456:TEST';
const now = Date.now();
const fields = (authDate = Math.floor(now / 1000)) => ({
  auth_date: String(authDate),
  query_id: 'AAA',
  user: JSON.stringify({ id: 42, username: 'tymur_dev', first_name: 'Тимур' }),
});

describe('Telegram initData', () => {
  it('принимает правильно подписанные данные', () => {
    expect(verifyInitData(signInitData(fields(), TOKEN), TOKEN, 3600, now)?.id).toBe(42);
  });
  it('отклоняет подделанного пользователя', () => {
    const tampered = signInitData(fields(), TOKEN).replace('42', '43');
    expect(verifyInitData(tampered, TOKEN, 3600, now)).toBeNull();
  });
  it('отклоняет подпись чужим токеном', () => {
    expect(verifyInitData(signInitData(fields(), 'other:token'), TOKEN, 3600, now)).toBeNull();
  });
  it('отклоняет просроченные данные', () => {
    const old = Math.floor(now / 1000) - 7200;
    expect(verifyInitData(signInitData(fields(old), TOKEN), TOKEN, 3600, now)).toBeNull();
  });
});

describe('подпись вебхуков', () => {
  it('сходится для того же тела и токена', () => {
    const body = '{"update_type":"invoice_paid"}';
    expect(verifySignature(body, 'tok', sign(body, 'tok'))).toBe(true);
    expect(verifySignature(body + ' ', 'tok', sign(body, 'tok'))).toBe(false);
    expect(verifySignature(body, 'tok', undefined)).toBe(false);
    expect(verifySignature(body, 'tok', 'zz')).toBe(false);
  });
});

describe('цены', () => {
  it('промокод, потом комиссия метода', () => {
    // 3490 ₽, промокод −100 ₽, комиссия 3%
    expect(computeTotal(349000, 3, { amount: 10000, percent: 0 })).toEqual({ discount: 10000, fee: 10170, amount: 349170 });
  });
  it('скидка не уходит ниже нуля', () => {
    expect(computeTotal(5000, 0, { amount: 10000, percent: 50 }).amount).toBe(0);
  });
  it('рубли в гривны и USDT округляются вверх', () => {
    expect(rubToUah(339000, 2.35)).toBe(1443); // 3390 / 2.35 = 1442.55
    expect(rubToUsdt(339000, 95)).toBe(35.69); // 3390 / 95 = 35.684
  });
});

describe('получатель', () => {
  it('username и телефон приводятся к одному виду', async () => {
    const { normalizeRecipient } = await import('../src/services/orders.js');
    expect(normalizeRecipient('USERNAME', 'durov')).toBe('@durov');
    expect(normalizeRecipient('USERNAME', '@du')).toBeNull();
    expect(normalizeRecipient('USERNAME', 'a b c d')).toBeNull();
    expect(normalizeRecipient('PHONE', '+7 (900) 123-45-67')).toBe('+79001234567');
    expect(normalizeRecipient('PHONE', '89001234567')).toBe('+79001234567');
    expect(normalizeRecipient('PHONE', '+380 67 123 45 67')).toBe('+380671234567');
    expect(normalizeRecipient('PHONE', '12345')).toBeNull();
    expect(normalizeRecipient('PHONE', '@durov')).toBeNull();
    expect(normalizeRecipient('PHONE', undefined)).toBeNull();
  });
});
