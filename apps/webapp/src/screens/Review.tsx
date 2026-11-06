import { useEffect, useState } from 'react';
import { api, itemTitle, prettyPhone, ratingWord, type OrderView } from '../api';
import { Icon, Key, Stars, useLoad, useToast } from '../ui/kit';
import { Brand, Druse } from '../ui/Crystal';
import { back, go, swap } from '../App';
import { TAGS, TAGS_ROOM, TEXT_MAX, joinTags, splitTags } from '../reviewTags';

/** Экран отзыва: сюда ведёт кнопка «Оставить отзыв» из пуша о выполненном заказе */
export function Review({ orderId, preset }: { orderId: number; preset: number }) {
  const { data: o, error } = useLoad(() => api<OrderView>(`/api/orders/${orderId}`), [orderId]);
  const toast = useToast();
  const [rating, setRating] = useState(preset >= 1 && preset <= 5 ? preset : 0);
  const [tags, setTags] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  // Звёзды со страницы заказа приходят в ?r=. Запоминаем их и убираем из адреса, чтобы при возврате
  // на этот экран кнопкой «Назад» старая оценка не подставилась поверх сохранённой
  useEffect(() => {
    if (preset) swap(`/orders/${orderId}/review`);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Уже оставлял отзыв: открываем для правки именно его, а не звёзды из ссылки
  useEffect(() => {
    if (o?.review) {
      const saved = splitTags(o.review.text);
      setRating(o.review.rating);
      setTags(saved.tags);
      setText(saved.rest);
    }
  }, [o?.review]);

  if (error) return <div className="page"><div className="empty">{error}</div></div>;
  if (!o) return <div className="page"><div className="skeleton" style={{ height: 320 }} /></div>;

  if (!o.canReview) {
    return (
      <div className="page">
        <div className="glow" />
        <h1 className="disp h1">Заказ №{o.id}</h1>
        <div className="empty">Отзыв можно оставить, когда заказ будет выполнен.</div>
        <a href={`#/orders/${o.id}`} className="btn ghost block">К заказу</a>
      </div>
    );
  }

  const toggle = (t: string) => setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  async function send() {
    setBusy(true);
    try {
      await api(`/api/orders/${orderId}/review`, { body: { rating, text: joinTags(tags, text) } });
      window.Telegram?.WebApp.HapticFeedback?.notificationOccurred('success');
      setDone(true);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="page" style={{ justifyContent: 'center', textAlign: 'center', gap: 16 }}>
        <div className="glow" />
        <span className="done-mark" aria-hidden="true"><Icon name="check" size={34} /></span>
        <h1 className="disp h1">{o.review ? 'Отзыв обновлён' : 'Спасибо за отзыв!'}</h1>
        <p className="muted" style={{ lineHeight: 1.45 }}>{o.review ? 'Сохранили новую оценку.' : 'Он появится на витрине и поможет другим выбрать.'}</p>
        <button className="btn block" onClick={() => go('/')}>В каталог</button>
        <button className="btn ghost block sm" onClick={back}>К заказу</button>
      </div>
    );
  }

  const low = rating > 0 && rating <= 3;
  return (
    <div className="page" style={{ paddingTop: 8, paddingBottom: 180, gap: 0 }}>
      <Druse kind="review" top={14} />
      <header className="appbar"><Brand /></header>

      <section style={{ padding: '30px 4px 0', minHeight: 132 }}>
        <div className="cap lit"><Icon name="check" size={13} />{o.review ? 'Ваш отзыв' : 'Заказ выдан'}</div>
        <h1 className="disp" style={{ fontSize: 28, marginTop: 12, maxWidth: 240 }}>Заказ №{o.id} выполнен</h1>
      </section>

      <div className="card order-line" style={{ marginTop: 34 }}>
        <Key icon={o.icon} glass={o.glass} size={44} />
        <div className="sp">
          <div style={{ fontWeight: 600 }} className="ellipsis">{itemTitle(o.product, o.access, o.variant)}</div>
          {o.recipient && <div className="muted small ellipsis" style={{ marginTop: 3 }}>для {prettyPhone(o.recipient)}</div>}
        </div>
      </div>

      <h2 className="disp" style={{ fontSize: 17, margin: '34px 4px 0', letterSpacing: '-0.03em' }}>{o.review ? 'Ваша оценка' : 'Как вам покупка?'}</h2>
      <div style={{ marginTop: 12 }}>
        <Stars value={rating} size={56} label="Оценка заказа" onChange={setRating} />
      </div>
      <div className={`rate-word ${rating ? '' : 'off'}`} style={{ marginTop: 8 }}>{rating ? ratingWord[rating] : 'Нажмите на звезду'}</div>

      {rating > 0 && (
        <div className="tags" style={{ marginTop: 20 }} role="group" aria-label="Быстрые метки">
          {TAGS.map((t) => {
            const on = tags.includes(t);
            return (
              <button key={t} type="button" className={`tag ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => toggle(t)}>
                {on && <Icon name="check" size={14} />}{t}
              </button>
            );
          })}
        </div>
      )}

      <label className="field" style={{ marginTop: 14 }}>
        <span>{low ? 'Что пошло не так? (необязательно)' : 'Что понравилось? (необязательно)'}</span>
        <textarea rows={4} maxLength={TEXT_MAX - TAGS_ROOM} value={text} onChange={(e) => setText(e.target.value)} placeholder="Пришло быстро, всё чётко" />
      </label>
      {low && <p className="muted small" style={{ lineHeight: 1.45, margin: '10px 4px 0' }}>Если с заказом проблема, напишите в чат заказа, поможем.</p>}

      <div className="sticky-cta col" style={{ gap: 2 }}>
        <button className="btn block" disabled={!rating || busy} onClick={send}>
          {busy ? 'Отправляем…' : o.review ? 'Сохранить отзыв' : 'Отправить отзыв'}
        </button>
        <button type="button" className="link" onClick={back}>{o.review ? 'Оставить как было' : 'Не сейчас'}</button>
      </div>
    </div>
  );
}
