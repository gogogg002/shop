import { useEffect, useState } from 'react';
import { api, rub, type ProductView } from '../api';
import { Icon, Key, useLoad } from '../ui/kit';
import { go } from '../App';

export function Product({ id }: { id: number }) {
  const { data: p, error } = useLoad(() => api<ProductView>(`/api/products/${id}`), [id]);
  const [variantId, setVariantId] = useState<number | null>(null);
  const [recipient, setRecipient] = useState('');

  useEffect(() => {
    if (p && variantId == null) {
      const best = [...p.variants].reverse().find((v) => v.inStock) ?? p.variants[0];
      setVariantId(best?.id ?? null);
    }
  }, [p, variantId]);

  if (error) return <div className="page"><div className="empty">{error}</div></div>;
  if (!p) return <div className="page"><div className="skeleton" style={{ height: 320 }} /></div>;

  const v = p.variants.find((x) => x.id === variantId);
  const recipientOk = !p.needsRecipient || /^@?[A-Za-z0-9_]{4,32}$/.test(recipient.trim());

  return (
    <div className="page" style={{ paddingTop: 0, gap: 18, paddingBottom: 110 }}>
      <section style={{ position: 'relative', height: 250, margin: '0 -16px' }}>
        <div className="glow" style={{ height: 250, background: 'radial-gradient(60% 60% at 50% 55%, rgba(230,15,30,.8), rgba(120,0,10,.3) 50%, transparent 78%)' }} />
        <Key icon={p.icon} glass={p.glass} size={124} style={{ position: 'absolute', left: 'calc(50% - 62px)', top: 56, rotate: '-12deg' }} />
        <Key icon="bolt" glass="WHITE" size={46} style={{ position: 'absolute', left: 36, top: 160, rotate: '20deg', filter: 'blur(1.5px)' }} />
        <Key icon="pad" glass="DARK" size={52} style={{ position: 'absolute', right: 30, top: 70, rotate: '-24deg', filter: 'blur(1px)' }} />
      </section>

      <div>
        <div className="cap">{p.category}</div>
        <h1 className="disp" style={{ fontSize: 30, marginTop: 8 }}>{p.title}</h1>
        {p.subtitle && <p className="muted" style={{ marginTop: 6 }}>{p.subtitle}</p>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(p.variants.length, 4)}, 1fr)`, gap: 8 }} role="radiogroup" aria-label="Вариант">
        {p.variants.map((x) => (
          <button key={x.id} role="radio" aria-checked={x.id === variantId} disabled={!x.inStock}
            className={`tile ${x.id === variantId ? 'on' : ''}`} style={{ opacity: x.inStock ? 1 : 0.4 }} onClick={() => setVariantId(x.id)}>
            <div className="disp" style={{ fontSize: 18 }}>{x.title}</div>
            <div style={{ fontSize: 12, marginTop: 2, opacity: 0.75 }}>{x.inStock ? rub(x.price) : 'нет'}</div>
          </button>
        ))}
      </div>

      {v && (
        <div className="between" style={{ alignItems: 'flex-end' }}>
          <div>
            <div className="disp" style={{ fontSize: 42, lineHeight: 0.9 }}>{rub(v.price)}</div>
            {v.oldPrice && <div className="muted small" style={{ marginTop: 8 }}><s>{rub(v.oldPrice)}</s> · экономия {rub(v.oldPrice - v.price)}</div>}
          </div>
          <span className="pill ok" style={{ height: 30 }}><Icon name="bolt" size={13} />{p.deliveryType === 'CODES' ? 'сразу' : '≈ 5 мин'}</span>
        </div>
      )}

      {p.needsRecipient && (
        <label className="field">
          <span>Username получателя в Telegram</span>
          <input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="@username" autoCapitalize="off" autoCorrect="off" inputMode="text" />
        </label>
      )}

      {p.description && <p className="muted" style={{ lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{p.description}</p>}

      <div className="grid2" style={{ fontSize: 13, lineHeight: 1.3 }}>
        <div className="row" style={{ gap: 10 }}><Icon name="shield" size={20} /><span className="muted">Без входа в ваш аккаунт</span></div>
        <div className="row" style={{ gap: 10 }}><Icon name="clock" size={20} /><span className="muted">Не выдали за 30 мин — вернём деньги</span></div>
      </div>

      <div className="sticky-cta">
        <button className="btn block" style={{ height: 60, borderRadius: 20 }} disabled={!v || !recipientOk}
          onClick={() => go(`/checkout?v=${v!.id}&r=${encodeURIComponent(recipient.trim())}`)}>
          {p.needsRecipient && !recipientOk ? 'Укажите получателя' : `Оформить · ${v ? rub(v.price) : ''}`}
        </button>
      </div>
    </div>
  );
}
