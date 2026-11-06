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
  it('username приводится к @username', async () => {
    const { normalizeRecipient } = await import('../src/services/orders.js');
    expect(normalizeRecipient('USERNAME', 'durov')).toBe('@durov');
    expect(normalizeRecipient('USERNAME', '@du')).toBeNull();
    expect(normalizeRecipient('USERNAME', 'a b c d')).toBeNull();
    expect(normalizeRecipient('PHONE', '@durov')).toBeNull();
    expect(normalizeRecipient('PHONE', undefined)).toBeNull();
  });

  // Один и тот же набор для сервера и мини-аппа: кнопка «Оформить» и сервер должны понимать номер одинаково
  const phones: [string, string | null][] = [
    ['+7 (900) 123-45-67', '+79001234567'],
    ['8 (900) 123-45-67', '+79001234567'],
    ['89001234567', '+79001234567'],
    ['79001234567', '+79001234567'],
    ['900 123-45-67', '+79001234567'], // без кода страны, российский мобильный
    ['+8 900 123 45 67', '+79001234567'], // частая опечатка вместо +7
    ['8 701 123 45 67', '+77011234567'], // Казахстан через восьмёрку
    ['+380 67 123 45 67', '+380671234567'],
    ['380671234567', '+380671234567'],
    ['067 123 45 67', '+380671234567'], // украинский номер без кода страны
    ['+84 912 345 678', '+84912345678'], // Вьетнам: восьмёрку после «+» не трогаем
    ['+852 6123 4567', '+85261234567'],
    ['4915112345678', '+4915112345678'],
    ['84912345678', null], // без «+» непонятно: Вьетнам или российский городской
    ['123 456 78 90', null],
    ['+0671234567', null],
    ['+7 900 123 45 6', null], // цифры не хватает
    ['+380 67 123 45', null],
    ['7 900 123 45 678', null], // лишняя цифра без «+»: не превращаем в чужую страну
    ['380 67 123 45 6', null], // украинскому номеру не хватает цифры
    ['+8 900 123 45 6', null], // опечатка +8 и цифры не хватает
    ['+8 900 123 45 678', null],
    ['12345', null],
    ['+7 900 abc', null],
    ['', null],
  ];

  it('телефон: сервер', async () => {
    const { normalizePhone } = await import('../src/services/phone.js');
    for (const [raw, want] of phones) expect([raw, normalizePhone(raw)]).toEqual([raw, want]);
  });

  it('телефон: мини-апп понимает номер так же', async () => {
    const { normalizePhone } = await import('../../webapp/src/phone.js');
    for (const [raw, want] of phones) expect([raw, normalizePhone(raw)]).toEqual([raw, want]);
  });
});

describe('название заказа в сообщениях', () => {
  it('с режимом входа, если он указан', async () => {
    const { orderTitle } = await import('../src/services/labels.js');
    expect(orderTitle({ title: 'Telegram Premium ', access: 'WITH_LOGIN' }, '12 мес')).toBe('Telegram Premium (со входом) · 12 мес');
    expect(orderTitle({ title: 'Telegram Premium', access: 'NO_LOGIN' }, '1 мес')).toBe('Telegram Premium (без входа) · 1 мес');
    expect(orderTitle({ title: 'ChatGPT Plus', access: 'UNSPECIFIED' }, '1 мес')).toBe('ChatGPT Plus · 1 мес');
  });
});
