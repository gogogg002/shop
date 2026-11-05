import { useEffect, useState } from 'react';
import { api, ratingWord, type OrderView } from '../api';
import { Icon, Key, Stars, useLoad, useToast } from '../ui/kit';
import { go } from '../App';

/** Экран отзыва: сюда ведёт кнопка «Оставить отзыв» из пуша о выполненном заказе */
export function Review({ orderId, preset }: { orderId: number; preset: number }) {
  const { data: o, error } = useLoad(() => api<OrderView>(`/api/orders/${orderId}`), [orderId]);
  const toast = useToast();
  const [rating, setRating] = useState(preset >= 1 && preset <= 5 ? preset : 0);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  // Уже оставлял отзыв: открываем его для правки
  useEffect(() => {
    if (o?.review) {
      setRating((r) => r || o.review!.rating);
      setText((t) => t || o.review!.text);
    }
  }, [o?.review]); // eslint-disable-line react-hooks/exhaustive-deps

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
        <h1 className="disp h1">Спасибо за отзыв!</h1>
        <p className="muted" style={{ lineHeight: 1.45 }}>Он появится на витрине и поможет другим выбрать.</p>
        <button className="btn block" onClick={() => go('/')}>В каталог</button>
        <a href={`#/orders/${o.id}`} className="btn ghost block sm">К заказу</a>
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
          <div style={{ fontWeight: 600 }}>{o.product} · {o.variant}</div>
          {o.recipient && <div className="muted small">для {o.recipient}</div>}
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

      <div className="sticky-cta col" style={{ gap: 8 }}>
        <button className="btn block" style={{ height: 60, borderRadius: 20 }} disabled={!rating || busy} onClick={send}>
          {busy ? 'Отправляем…' : o.review ? 'Сохранить отзыв' : 'Отправить отзыв'}
        </button>
      </div>
    </div>
  );
}
