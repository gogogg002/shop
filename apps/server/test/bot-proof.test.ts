import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Api, Bot } from 'grammy';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { saveSettings } from '../src/services/settings.js';

// Настоящий бот из src/bot без сети: опрос Telegram выключен, ответы Bot API подменяются по одному методу
vi.spyOn(Bot.prototype, 'start').mockResolvedValue(undefined);
vi.spyOn(Api.prototype, 'setChatMenuButton').mockResolvedValue(true);
const sendPhoto = vi.spyOn(Api.prototype, 'sendPhoto');
const sendDocument = vi.spyOn(Api.prototype, 'sendDocument');
const sendMessage = vi.spyOn(Api.prototype, 'sendMessage');
const telegramError = () => Promise.reject(new Error('Bad Request: PHOTO_INVALID_DIMENSIONS'));

const BUYER = '2400';
const ADMIN = '1000'; // единственный админ в ADMIN_IDS тестов
let app: FastifyInstance;
let variantId: number;

const buyer = (method: string, url: string, payload?: object) =>
  app.inject({ method: method as 'POST', url, payload: payload ?? {}, headers: { 'x-dev-user': BUYER } });

/** Чек с фото, как его шлёт мини-апп */
function proofWithPhoto(id: number) {
  const boundary = 'krynel-bot-test';
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="check.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return app.inject({
    method: 'POST', url: `/api/orders/${id}/proof`, payload,
    headers: { 'x-dev-user': BUYER, 'content-type': `multipart/form-data; boundary=${boundary}` },
  });
}

const newOrder = async () => (await buyer('POST', '/api/orders', { variantId, method: 'UAH', recipient: '@durov' })).json().id as number;

beforeAll(async () => {
  const { startBot } = await import('../src/bot/index.js');
  expect(startBot()).not.toBeNull();
  app = await buildApp();
  const cat = await prisma.category.create({ data: { slug: 'bot-proof', title: 'Бот' } });
  const p = await prisma.product.create({
    data: { categoryId: cat.id, title: 'Проверка чека', variants: { create: [{ title: '1 шт', price: 10_000 }] } },
    include: { variants: true },
  });
  variantId = p.variants[0].id;
  await saveSettings({
    uah: { card: '4441 1111 2222 3333', holder: 'Тимур', bank: 'Mono', rate: 2.35 },
    methods: { CRYPTOBOT: false, XROCKET: false, LOLZ: false, SBP: false, UAH: true },
  });
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(() => {
  sendPhoto.mockReset();
  sendDocument.mockReset();
  sendMessage.mockReset().mockResolvedValue({} as never);
});

describe('чек админам через бота', () => {
  it('фото дошло: заказ на проверке, file_id фото сохранён', async () => {
    sendPhoto.mockResolvedValue({ photo: [{ file_id: 'small' }, { file_id: 'big' }] } as never);
    const id = await newOrder();
    const r = await proofWithPhoto(id);
    expect([r.statusCode, r.json().status]).toEqual([200, 'AWAITING_CONFIRMATION']);
    expect(sendPhoto).toHaveBeenCalledTimes(1);
    expect(await prisma.order.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'AWAITING_CONFIRMATION', proofFileId: 'big' });
  });

  it('фото Telegram не принял: тот же файл уходит документом', async () => {
    sendPhoto.mockImplementation(telegramError);
    sendDocument.mockResolvedValue({ document: { file_id: 'doc-1' } } as never);
    const id = await newOrder();
    expect((await proofWithPhoto(id)).json().status).toBe('AWAITING_CONFIRMATION');
    expect(sendDocument).toHaveBeenCalledTimes(1);
    expect((await prisma.order.findUniqueOrThrow({ where: { id } })).proofFileId).toBe('doc-1');
  });

  it('чек не дошёл ни до одного админа: ошибка, заказ ждёт оплаты, можно отправить ещё раз', async () => {
    sendPhoto.mockImplementation(telegramError);
    sendDocument.mockImplementation(telegramError);
    const id = await newOrder();
    const r = await proofWithPhoto(id);
    expect(r.statusCode).toBe(503);
    expect(r.json().message).toMatch(/Не удалось передать чек/);
    expect((await prisma.order.findUniqueOrThrow({ where: { id } })).status).toBe('PENDING_PAYMENT');

    sendPhoto.mockResolvedValue({ photo: [{ file_id: 'retry' }] } as never);
    expect((await proofWithPhoto(id)).json().status).toBe('AWAITING_CONFIRMATION');
  });

  it('пока чек отправляется, заказ ещё «ждёт оплаты»: перезапуск сервера в этот момент ничего не ломает', async () => {
    let release!: () => void;
    let seen = '';
    const id = await newOrder();
    sendPhoto.mockImplementation((async () => {
      seen = (await prisma.order.findUniqueOrThrow({ where: { id } })).status;
      await new Promise<void>((r) => (release = r));
      return { photo: [{ file_id: 'slow' }] };
    }) as never);
    const r = proofWithPhoto(id);
    await vi.waitFor(() => expect(seen).not.toBe(''));
    expect(seen).toBe('PENDING_PAYMENT');
    release();
    expect((await r).json().status).toBe('AWAITING_CONFIRMATION');
  });

  it('второй админ жмёт «Подтвердить» после «Отклонить»: бот честно говорит, что заказ уже обработан', async () => {
    sendPhoto.mockResolvedValue({ photo: [{ file_id: 'x' }] } as never);
    const id = await newOrder();
    await proofWithPhoto(id);
    const reject = await app.inject({ method: 'POST', url: `/api/admin/orders/${id}/reject`, payload: { reason: 'нет перевода' }, headers: { 'x-dev-user': ADMIN } });
    expect(reject.statusCode).toBe(200);
    const confirm = await app.inject({ method: 'POST', url: `/api/admin/orders/${id}/confirm`, payload: {}, headers: { 'x-dev-user': ADMIN } });
    expect(confirm.statusCode).toBe(400);
    expect(confirm.json().message).toBe('Заказ уже обработан: оплата отклонена');
    expect((await prisma.order.findUniqueOrThrow({ where: { id } })).status).toBe('REJECTED');
  });
});
