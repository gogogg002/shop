import { Bot, InlineKeyboard, InputFile } from 'grammy';
import { adminIds, config, isAdmin } from '../config.js';
import { setNotifier, type Notifier, type OrderView } from '../services/notify.js';
import { ShopError, confirmManual, deliver, loadOrder, rejectManual } from '../services/orders.js';
import { orderTitle } from '../services/labels.js';

const rub = (kop: number) => `${(kop / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`;
const who = (o: OrderView) => (o.user.username ? `@${o.user.username}` : o.user.firstName ?? String(o.user.tgId));
const title = (o: OrderView) => orderTitle(o.variant.product, o.variant.title);
const webUrl = (hash: string) => `${config.PUBLIC_URL}/#${hash}`;

function orderCard(o: OrderView) {
  return [
    `<b>Заказ №${o.id}</b>`,
    title(o),
    o.recipient ? `Получатель: ${o.recipient}` : null,
    `Покупатель: ${who(o)}`,
    `Сумма: ${rub(o.amount)}${o.payAmount ? ` (${o.payAmount})` : ''} · ${o.method}`,
  ].filter(Boolean).join('\n');
}

export function startBot() {
  if (!config.BOT_TOKEN) {
    console.warn('BOT_TOKEN не задан: бот и уведомления выключены');
    return null;
  }
  const bot = new Bot(config.BOT_TOKEN);
  const admins = [...adminIds].map(Number);
  const toAdmins = async (fn: (chatId: number) => Promise<unknown>) => {
    for (const id of admins) await fn(id).catch((e) => console.error('notify admin failed', id, e.message));
  };

  bot.command('start', (ctx) =>
    ctx.reply('Krynel: подписки, Stars и пополнения за пару минут. Открывайте магазин кнопкой ниже.', {
      reply_markup: new InlineKeyboard().webApp('Открыть магазин', config.PUBLIC_URL),
    }));

  bot.command('id', (ctx) => ctx.reply(`Ваш Telegram ID: <code>${ctx.from!.id}</code>`, { parse_mode: 'HTML' }));

  bot.command('admin', (ctx) => {
    if (!isAdmin(BigInt(ctx.from!.id))) return;
    return ctx.reply('Админка', { reply_markup: new InlineKeyboard().webApp('Открыть админку', webUrl('/admin')) });
  });

  // Кнопки под уведомлениями админу
  bot.callbackQuery(/^(ok|no|dlv):(\d+)$/, async (ctx) => {
    if (!isAdmin(BigInt(ctx.from.id))) return ctx.answerCallbackQuery({ text: 'Только для админа' });
    const [, action, idRaw] = ctx.match!;
    const id = Number(idRaw);
    try {
      if (action === 'ok') await confirmManual(id);
      if (action === 'no') await rejectManual(id, 'перевод не найден, напишите в чат заказа');
      if (action === 'dlv') await deliver(id);
      const label = { ok: '✅ Оплата подтверждена', no: '❌ Оплата отклонена', dlv: '✅ Выдано' }[action as 'ok' | 'no' | 'dlv'];
      await ctx.answerCallbackQuery({ text: label });
      await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard().text(label, 'noop') }).catch(() => {});
    } catch (e) {
      await ctx.answerCallbackQuery({ text: e instanceof ShopError ? e.message : 'Ошибка', show_alert: true });
    }
  });
  bot.callbackQuery('noop', (ctx) => ctx.answerCallbackQuery());

  const notifier: Notifier = {
    async manualPaymentProof(o, photo) {
      const kb = new InlineKeyboard()
        .text('✅ Подтвердить', `ok:${o.id}`).text('❌ Отклонить', `no:${o.id}`).row()
        .webApp('Открыть заказ', webUrl(`/admin/orders/${o.id}`));
      const caption = `🧾 Ручная оплата ждёт проверки\n\n${orderCard(o)}`;
      let fileId: string | null = null;
      let delivered = 0;
      await toAdmins(async (chat) => {
        if (photo) {
          const extra = { caption, parse_mode: 'HTML' as const, reply_markup: kb };
          // Длинный скриншот из банка или не картинку Telegram фото не примет: тогда шлём тот же файл документом
          const m = await bot.api.sendPhoto(chat, new InputFile(photo, `order-${o.id}.jpg`), extra)
            .catch(() => bot.api.sendDocument(chat, new InputFile(photo, `order-${o.id}.jpg`), extra));
          fileId ??= ('photo' in m ? m.photo?.at(-1)?.file_id : m.document?.file_id) ?? null;
        } else {
          await bot.api.sendMessage(chat, `${caption}\n\nЧек не приложен.`, { parse_mode: 'HTML', reply_markup: kb });
        }
        delivered += 1;
      });
      if (admins.length && !delivered) throw new Error('чек не дошёл ни до одного админа');
      return fileId;
    },
    async orderPaid(o) {
      const kb = new InlineKeyboard().text('✅ Выдано', `dlv:${o.id}`).webApp('Открыть', webUrl(`/admin/orders/${o.id}`));
      await toAdmins((chat) => bot.api.sendMessage(chat, `💰 Оплачен, нужно выдать\n\n${orderCard(o)}`, { parse_mode: 'HTML', reply_markup: kb }));
    },
    async orderStatusToUser(o, text) {
      await bot.api.sendMessage(Number(o.user.tgId), text, {
        reply_markup: new InlineKeyboard().webApp('Открыть заказ', webUrl(`/orders/${o.id}`)),
      }).catch((e) => console.error('notify user failed', e.message));
    },
    async orderDelivered(o, text) {
      // Кнопка сразу открывает экран отзыва в мини-аппе
      const kb = new InlineKeyboard()
        .webApp('⭐ Оставить отзыв', webUrl(`/orders/${o.id}/review`)).row()
        .webApp('Открыть заказ', webUrl(`/orders/${o.id}`));
      await bot.api.sendMessage(Number(o.user.tgId), `${text}\n\nСпасибо за покупку! Оцените заказ, это займёт 10 секунд.`, {
        reply_markup: kb,
      }).catch((e) => console.error('notify user failed', e.message));
    },
    async newReview(r) {
      const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);
      const short = (t: string) => (Array.from(t).length > 300 ? `${Array.from(t).slice(0, 300).join('')}…` : t);
      const body = [
        r.edited ? `✏️ ${stars(r.rating)} Отзыв к заказу №${r.orderId} изменён` : `${stars(r.rating)} Новый отзыв к заказу №${r.orderId}`,
        orderTitle({ title: r.product, access: r.access }, r.variant),
        `От: ${r.author}`,
        '',
        r.text || 'Без текста',
        ...(r.edited ? ['', `Было: ${stars(r.edited.rating)}${r.edited.text ? ` «${short(r.edited.text)}»` : ''}`] : []),
      ].join('\n');
      await toAdmins((chat) => bot.api.sendMessage(chat, body, {
        reply_markup: new InlineKeyboard().webApp('Все отзывы', webUrl('/admin/reviews')).webApp('Заказ', webUrl(`/admin/orders/${r.orderId}`)),
      }));
    },
    async chatMessage(o, text, fromAdmin) {
      if (fromAdmin) {
        await bot.api.sendMessage(Number(o.user.tgId), `💬 Поддержка по заказу №${o.id}:\n${text}`, {
          reply_markup: new InlineKeyboard().webApp('Ответить', webUrl(`/orders/${o.id}`)),
        }).catch(() => {});
      } else {
        await toAdmins((chat) => bot.api.sendMessage(chat, `💬 ${who(o)} по заказу №${o.id}:\n${text}`, {
          reply_markup: new InlineKeyboard().webApp('Ответить', webUrl(`/admin/orders/${o.id}`)),
        }));
      }
    },
  };
  setNotifier(notifier);

  bot.catch((e) => console.error('bot error', e.message));
  void bot.start({ drop_pending_updates: true });
  void bot.api.setChatMenuButton({ menu_button: { type: 'web_app', text: 'Магазин', web_app: { url: config.PUBLIC_URL } } }).catch(() => {});
  return { bot, loadOrder };
}
