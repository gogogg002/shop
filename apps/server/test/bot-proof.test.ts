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
/** Как Telegram разбирает parse_mode HTML: «<», который не открывает поддерживаемый тег, — ошибка 400 */
const strictHtml = (text: string, other?: { parse_mode?: string }) => {
  if (other?.parse_mode === 'HTML' && /<(?!\/?b>)/.test(text)) throw new Error("Bad Request: can't parse entities: Unsupported start tag");
};

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

  it('«<» в названии товара: карточка экранирована и доходит до админа', async () => {
    const captions: string[] = [];
    sendPhoto.mockImplementation((async (_chat: unknown, _file: unknown, other?: { caption?: string; parse_mode?: string }) => {
      strictHtml(other?.caption ?? '', other);
      captions.push(other?.caption ?? '');
      return { photo: [{ file_id: 'lt' }] };
    }) as never);
    const p = await prisma.product.create({
      data: { categoryId: (await prisma.category.findFirstOrThrow({ where: { slug: 'bot-proof' } })).id, title: 'Stars <100 & больше>',
        needsRecipient: false, variants: { create: [{ title: '50 <шт>', price: 5_000 }] } },
      include: { variants: true },
    });
    const id = (await buyer('POST', '/api/orders', { variantId: p.variants[0].id, method: 'UAH' })).json().id as number;
    expect((await proofWithPhoto(id)).json().status).toBe('AWAITING_CONFIRMATION');
    expect(captions[0]).toContain('Stars &lt;100 &amp; больше&gt; · 50 &lt;шт&gt;');
  });

  it('разметку Telegram не разобрал: чек уходит без разметки, а не теряется', async () => {
    const sent: { caption?: string; parse_mode?: string }[] = [];
    const strict = (async (_chat: unknown, _file: unknown, other?: { caption?: string; parse_mode?: string }) => {
      if (other?.parse_mode === 'HTML') throw new Error("Bad Request: can't parse entities: Unsupported start tag");
      sent.push(other ?? {});
      return { photo: [{ file_id: 'plain' }] };
    }) as never;
    sendPhoto.mockImplementation(strict);
    sendDocument.mockImplementation(strict);
    const id = await newOrder();
    expect((await proofWithPhoto(id)).json().status).toBe('AWAITING_CONFIRMATION');
    expect(sent).toHaveLength(1);
    expect(sent[0].parse_mode).toBeUndefined();
    expect(sent[0].caption).toContain(`Заказ №${id}`);
    expect(sent[0].caption).not.toContain('<b>');
  });

  it('админ отклонил между проверкой и оплатой: «Подтвердить» не врёт, что оплата прошла', async () => {
    sendPhoto.mockResolvedValue({ photo: [{ file_id: 'x' }] } as never);
    const id = await newOrder();
    await proofWithPhoto(id);
    // Отклонение «влезает» ровно между проверкой статуса в confirmManual и переводом в «оплачен»
    const original = prisma.order.updateMany;
    prisma.order.updateMany = (async (args: Parameters<typeof original>[0]) => {
      prisma.order.updateMany = original;
      await prisma.order.update({ where: { id }, data: { status: 'REJECTED' } });
      return original(args);
    }) as typeof original;
    try {
      const confirm = await app.inject({ method: 'POST', url: `/api/admin/orders/${id}/confirm`, payload: {}, headers: { 'x-dev-user': ADMIN } });
      expect([confirm.statusCode, confirm.json().message]).toEqual([400, 'Заказ уже обработан: оплата отклонена']);
    } finally {
      prisma.order.updateMany = original;
    }
    expect((await prisma.order.findUniqueOrThrow({ where: { id } })).status).toBe('REJECTED');
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
