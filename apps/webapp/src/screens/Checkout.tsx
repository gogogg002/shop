import { useEffect, useState } from 'react';
import { ApiError, api, methodLabel, openPay, rub, tg, type Glass, type Method } from '../api';
import { Icon, Key, useToast } from '../ui/kit';
import { go, useMe } from '../App';

interface Quote { price: number; discount: number; fee: number; amount: number; title: string; variant: string; icon: string; glass: Glass }

export function Checkout({ variantId, recipient }: { variantId: number; recipient: string }) {
  const me = useMe()!;
  const toast = useToast();
  const [method, setMethod] = useState<Method | null>(me.methods[0]?.method ?? null);
  const [promo, setPromo] = useState('');
  const [appliedPromo, setAppliedPromo] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!method) return;
    api<Quote>('/api/orders/quote', { body: { variantId, method, promoCode: appliedPromo || undefined } })
      .then(setQuote)
      .catch((e: ApiError) => {
        if (e.code === 'bad_promo') { setAppliedPromo(''); toast(e.message, true); } else toast(e.message, true);
      });
  }, [variantId, method, appliedPromo, toast]);

  async function pay() {
    if (!method) return;
    setBusy(true);
    try {
      const o = await api<{ id: number; payUrl: string | null }>('/api/orders', {
        body: { variantId, method, recipient: recipient || undefined, promoCode: appliedPromo || undefined },
      });
      tg?.HapticFeedback?.notificationOccurred('success');
      if (o.payUrl) openPay(o.payUrl);
      go(`/orders/${o.id}`);
    } catch (e) {
      toast((e as Error).message, true);
      setBusy(false);
    }
  }

  if (!me.methods.length)
    return <div className="page"><div className="empty">Оплата временно недоступна. Напишите в поддержку.</div></div>;

  return (
    <div className="page" style={{ paddingBottom: 180 }}>
      <div className="glow" />
      <h1 className="disp h1">Оплата</h1>

      {quote && (
        <div className="card pad col" style={{ gap: 12 }}>
          <div className="row">
            <Key icon={quote.icon} glass={quote.glass} size={50} />
            <div className="sp">
              <div style={{ fontWeight: 600, fontSize: 16 }}>{quote.title}</div>
              <div className="muted small">{quote.variant}{recipient ? ` → ${recipient.startsWith('@') ? recipient : '@' + recipient}` : ''}</div>
            </div>
          </div>
          <div style={{ borderTop: '2px dashed rgba(255,255,255,.1)', margin: '4px 0' }} />
          <div className="between"><span className="muted">Стоимость</span><span>{rub(quote.price)}</span></div>
          {quote.discount > 0 && <div className="between"><span className="muted">Промокод {appliedPromo}</span><span style={{ color: 'var(--a2)' }}>−{rub(quote.discount)}</span></div>}
          {quote.fee > 0 && <div className="between"><span className="muted">Комиссия способа оплаты</span><span>{rub(quote.fee)}</span></div>}
          <div className="between" style={{ alignItems: 'flex-end' }}><b>К оплате</b><span className="disp" style={{ fontSize: 30 }}>{rub(quote.amount)}</span></div>
        </div>
      )}

      <div className="cap" style={{ marginTop: 4 }}>Способ оплаты</div>
      <div className="grid2" role="radiogroup" aria-label="Способ оплаты">
        {me.methods.map((m) => {
          const on = m.method === method;
          return (
            <button key={m.method} role="radio" aria-checked={on} onClick={() => setMethod(m.method)} className="card"
              style={{ padding: 14, textAlign: 'left', borderColor: on ? 'var(--a)' : undefined, background: on ? 'rgba(255,46,62,.08)' : undefined, position: 'relative' }}>
              {on && <span style={{ position: 'absolute', top: 10, right: 10, width: 22, height: 22, borderRadius: 11, background: 'var(--a)', display: 'grid', placeItems: 'center' }}><Icon name="check" size={13} /></span>}
              <div style={{ fontWeight: 700, fontSize: 15.5 }}>{methodLabel[m.method].title}</div>
              <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>
                {methodLabel[m.method].sub}{m.fee ? ` · +${m.fee}%` : ''}{m.manual ? ' · ручная проверка' : ''}
              </div>
            </button>
          );
        })}
      </div>

      <div className="row" style={{ gap: 8 }}>
        <label className="field sp" style={{ padding: '8px 14px' }}>
          <span>Промокод</span>
          <input value={promo} onChange={(e) => setPromo(e.target.value.toUpperCase())} placeholder="Если есть" />
        </label>
        <button className="btn ghost" style={{ height: 56 }} disabled={!promo.trim()} onClick={() => setAppliedPromo(promo.trim())}>Применить</button>
      </div>

      <div className="sticky-cta">
        <div className="row muted" style={{ justifyContent: 'center', gap: 6, fontSize: 12, marginBottom: 10 }}>
          <Icon name="shield" size={14} />Не выдали за 30 минут — вернём деньги
        </div>
        <button className="btn block" style={{ height: 60, borderRadius: 20 }} disabled={!quote || busy} onClick={pay}>
          {busy ? 'Создаём заказ…' : quote ? `Оплатить ${rub(quote.amount)}` : 'Считаем…'}
        </button>
      </div>
    </div>
  );
}
