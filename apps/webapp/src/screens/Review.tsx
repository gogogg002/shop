import { useEffect, useState } from 'react';
import { api, itemTitle, prettyPhone, ratingWord, type OrderView } from '../api';
import { Icon, Key, Stars, useLoad, useToast } from '../ui/kit';
import { back, go, swap } from '../App';

/** Экран отзыва: сюда ведёт кнопка «Оставить отзыв» из пуша о выполненном заказе */
export function Review({ orderId, preset }: { orderId: number; preset: number }) {
  const { data: o, error } = useLoad(() => api<OrderView>(`/api/orders/${orderId}`), [orderId]);
  const toast = useToast();
  const [rating, setRating] = useState(preset >= 1 && preset <= 5 ? preset : 0);
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
      setRating(o.review.rating);
      setText(o.review.text);
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

  async function send() {
    setBusy(true);
    try {
      await api(`/api/orders/${orderId}/review`, { body: { rating, text } });
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

  return (
    <div className="page" style={{ paddingBottom: 110, gap: 18 }}>
      <div className="glow" />
      <div>
        <div className="cap">Заказ №{o.id} выполнен</div>
        <h1 className="disp h1" style={{ marginTop: 8 }}>{o.review ? 'Ваш отзыв' : 'Как вам заказ?'}</h1>
      </div>

      <div className="card pad row">
        <Key icon={o.icon} glass={o.glass} size={46} />
        <div className="sp">
          <div style={{ fontWeight: 600 }}>{itemTitle(o.product, o.access, o.variant)}</div>
          {o.recipient && <div className="muted small">для {prettyPhone(o.recipient)}</div>}
        </div>
      </div>

      <div className="col" style={{ alignItems: 'center', gap: 8, padding: '6px 0' }}>
        <Stars value={rating} size={44} label="Оценка заказа" onChange={setRating} />
        <div style={{ fontWeight: 700, minHeight: 22 }}>{rating ? ratingWord[rating] : 'Нажмите на звезду'}</div>
      </div>

      <label className="field">
        <span>{rating && rating <= 3 ? 'Что пошло не так? (необязательно)' : 'Что понравилось? (необязательно)'}</span>
        <textarea rows={4} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Пришло быстро, всё чётко" />
      </label>
      {rating > 0 && rating <= 3 && (
        <p className="muted small" style={{ lineHeight: 1.45 }}>Если с заказом проблема, напишите в чат заказа, поможем.</p>
      )}
      <button type="button" className="muted small" style={{ alignSelf: 'center', padding: '10px 16px', textDecoration: 'underline', textUnderlineOffset: 3 }} onClick={back}>
        {o.review ? 'Оставить как было' : 'Не сейчас'}
      </button>

      <div className="sticky-cta col" style={{ gap: 8 }}>
        <button className="btn block" style={{ height: 60, borderRadius: 20 }} disabled={!rating || busy} onClick={send}>
          {busy ? 'Отправляем…' : o.review ? 'Сохранить отзыв' : 'Отправить отзыв'}
        </button>
      </div>
    </div>
  );
}
