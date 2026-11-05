import { useEffect, useRef, useState } from 'react';
import { api, copy, methodLabel, openPay, rub, statusLabel, type OrderView } from '../api';
import { Icon, Key, Stars, useLoad, useToast } from '../ui/kit';
import { go } from '../App';
import { Chat } from '../ui/Chat';

export function Order({ id }: { id: number }) {
  const { data: o, error, reload, setData } = useLoad(() => api<OrderView>(`/api/orders/${id}`), [id]);
  const toast = useToast();
  const file = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  // Пока заказ в работе, обновляем раз в 8 секунд: статус и ответы поддержки
  useEffect(() => {
    if (!o || ['DELIVERED', 'CANCELLED', 'REFUNDED'].includes(o.status)) return;
    const h = setInterval(reload, 8000);
    return () => clearInterval(h);
  }, [o?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="page"><div className="empty">{error}</div></div>;
  if (!o) return <div className="page"><div className="skeleton" style={{ height: 300 }} /></div>;

  const st = statusLabel[o.status];

  async function sendProof() {
    setBusy(true);
    try {
      const form = new FormData();
      if (photo) form.append('file', photo);
      await api(`/api/orders/${id}/proof`, { method: 'POST', form });
      toast('Отправили на проверку. Обычно это занимает до 15 минут');
      reload();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    try {
      await api(`/api/orders/${id}/cancel`, { method: 'POST', body: {} });
      reload();
    } catch (e) {
      toast((e as Error).message, true);
    }
  }

  const copyText = async (t: string) => toast((await copy(t)) ? 'Скопировано' : 'Не получилось скопировать, выделите вручную');

  return (
    <div className="page">
      <div className="glow" />
      <div className="between"><h1 className="disp h1">Заказ №{o.id}</h1><span className={`pill ${st.tone}`}>{st.text}</span></div>

      <div className="card pad row">
        <Key icon={o.icon} glass={o.glass} size={50} />
        <div className="sp">
          <div style={{ fontWeight: 600, fontSize: 16 }}>{o.product} · {o.variant}</div>
          <div className="muted small">{o.recipient ? `для ${o.recipient} · ` : ''}{methodLabel[o.method].title}</div>
        </div>
        <b>{rub(o.amount)}</b>
      </div>

      {o.status === 'DELIVERED' && o.deliveredText && (
        <div className="card pad col">
          <div className="cap">Выдано</div>
          <div className="row" style={{ background: '#0c0c0e', borderRadius: 14, padding: '8px 8px 8px 14px' }}>
            <span className="sp mono" style={{ fontSize: 15, wordBreak: 'break-all' }}>{o.deliveredText}</span>
            <button className="btn icon sm" onClick={() => copyText(o.deliveredText!)} aria-label="Копировать"><Icon name="copy" size={18} /></button>
          </div>
        </div>
      )}

      {o.canReview && !o.review && (
        <div className="card pad col" style={{ gap: 10, alignItems: 'center', textAlign: 'center' }}>
          <div style={{ fontWeight: 700, fontSize: 17 }}>Как вам заказ?</div>
          <Stars value={0} size={34} label="Оцените заказ" onChange={(r) => go(`/orders/${o.id}/review?r=${r}`)} />
          <div className="muted small">Отзыв помогает другим покупателям</div>
        </div>
      )}

      {o.review && (
        <a href={`#/orders/${o.id}/review`} className="card pad col" style={{ gap: 6 }}>
          <div className="between"><span className="cap">Ваш отзыв</span><span className="small" style={{ color: 'var(--a2)', fontWeight: 600 }}>Изменить</span></div>
          <Stars value={o.review.rating} size={18} />
          {o.review.text && <p style={{ lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{o.review.text}</p>}
        </a>
      )}

      {o.status === 'PENDING_PAYMENT' && o.payUrl && (
        <div className="card pad col">
          <div className="muted">Счёт {o.payAmount} ждёт оплаты. После оплаты статус обновится сам.</div>
          <button className="btn block" onClick={() => openPay(o.payUrl!)}>Перейти к оплате</button>
          <button className="btn ghost block sm" onClick={cancel}>Отменить заказ</button>
        </div>
      )}

      {o.manual && (o.status === 'PENDING_PAYMENT' || o.status === 'AWAITING_CONFIRMATION' || o.status === 'REJECTED') && (
        <div className="card pad col" style={{ gap: 12 }}>
          <div className="cap">{o.manual.method === 'UAH' ? 'Перевод на карту' : 'Перевод по СБП'}</div>
          <div className="between" style={{ alignItems: 'flex-end' }}>
            <span className="muted">Переведите ровно</span>
            <button className="disp" style={{ fontSize: 30 }} onClick={() => copyText(o.manual!.amount.replace(/[^\d.,]/g, ''))}>{o.manual.amount}</button>
          </div>
          {o.manual.requisites.map((r) => (
            <button key={r.label} className="row" style={{ background: '#0c0c0e', borderRadius: 14, padding: '10px 12px', textAlign: 'left' }} onClick={() => copyText(r.value)}>
              <div className="sp"><div className="muted" style={{ fontSize: 12 }}>{r.label}</div><div className="mono" style={{ fontSize: 15.5 }}>{r.value}</div></div>
              <Icon name="copy" size={18} />
            </button>
          ))}
          <div className="muted small">Комментарий к переводу: <b style={{ color: 'var(--t)' }}>{o.manual.comment}</b>. Если банк не даёт указать комментарий, просто приложите чек.</div>

          {o.status === 'AWAITING_CONFIRMATION' ? (
            <div className="row" style={{ background: 'rgba(255,181,71,.1)', borderRadius: 14, padding: 12, color: 'var(--warn)', fontSize: 14 }}>
              <Icon name="clock" size={20} />Чек у админа на проверке. Ответ придёт сюда и в бот.
            </div>
          ) : (
            <>
              <input ref={file} type="file" accept="image/*" hidden onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
              <button className="btn ghost block" onClick={() => file.current?.click()}>
                <Icon name="img" size={20} />{photo ? photo.name : 'Приложить скриншот перевода'}
              </button>
              <button className="btn block" disabled={busy || !photo} onClick={sendProof}>{busy ? 'Отправляем…' : 'Я оплатил'}</button>
              {o.status === 'PENDING_PAYMENT' && <button className="btn ghost block sm" onClick={cancel}>Отменить заказ</button>}
            </>
          )}
        </div>
      )}

      <Chat
        title="Чат с поддержкой"
        asAdmin={false}
        messages={o.messages}
        onSend={async (text) => {
          const m = await api<OrderView['messages'][number]>(`/api/orders/${id}/messages`, { body: { text } });
          setData({ ...o, messages: [...o.messages, m] });
        }}
      />
    </div>
  );
}
