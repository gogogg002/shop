import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Api, Bot } from 'grammy';

// Настоящий бот из src/bot без сети: опрос Telegram выключен, ответы Bot API подменены
vi.spyOn(Bot.prototype, 'start').mockResolvedValue(undefined);
vi.spyOn(Api.prototype, 'setChatMenuButton').mockResolvedValue(true);
const sendMessage = vi.spyOn(Api.prototype, 'sendMessage');

const ADMIN = 1000; // единственный админ в ADMIN_IDS тестов
const BUYER = 2400;
let bot: Bot;

beforeAll(async () => {
  const { startBot } = await import('../src/bot/index.js');
  bot = startBot()!.bot;
  bot.botInfo = {
    id: 1, is_bot: true, first_name: 'Krynel', username: 'krynel_app', can_join_groups: false,
    can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false,
  };
});

beforeEach(() => {
  sendMessage.mockReset().mockResolvedValue({} as never);
});

/** Команда /start от пользователя с этим Telegram ID: какие кнопки пришли в ответ */
async function startButtons(from: number) {
  await bot.handleUpdate({
    update_id: from,
    message: {
      message_id: 1, date: 0, text: '/start', entities: [{ type: 'bot_command', offset: 0, length: 6 }],
      chat: { id: from, type: 'private', first_name: 'U' }, from: { id: from, is_bot: false, first_name: 'U' },
    },
  });
  expect(sendMessage).toHaveBeenCalledTimes(1);
  const markup = sendMessage.mock.calls[0][2]?.reply_markup as { inline_keyboard: { text: string; web_app?: { url: string } }[][] };
  return markup.inline_keyboard.flat().map((b) => [b.text, b.web_app?.url]);
}

describe('/start', () => {
  it('админу первой кнопкой «Админка», под ней магазин', async () => {
    const buttons = await startButtons(ADMIN);
    expect(buttons.map((b) => b[0])).toEqual(['⚙️ Админка', 'Открыть магазин']);
    expect(buttons[0][1]).toMatch(/\/#\/admin$/);
  });

  it('покупателю только магазин', async () => {
    expect((await startButtons(BUYER)).map((b) => b[0])).toEqual(['Открыть магазин']);
  });
});
