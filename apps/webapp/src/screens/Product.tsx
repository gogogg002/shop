import { useEffect, useState } from 'react';
import { api, openTelegramChat, ratingText, reviewsWord, rub, type ProductView } from '../api';
import { Icon, Key, useLoad } from '../ui/kit';
import { ReviewCard } from '../ui/ReviewCard';
import { go, swap, useMe } from '../App';

/** Выбор на странице товара: вариант по id или «Опт» */
type Pick = number | 'bulk' | null;

const recipientSpec = {
  USERNAME: {
    label: 'Username получателя в Telegram', placeholder: '@username', inputMode: 'text' as const,
    ok: (v: string) => /^@?[A-Za-z0-9_]{4,32}$/.test(v), hint: 'Укажите получателя',
  },
  PHONE: {
    label: 'Номер телефона аккаунта Telegram', placeholder: '+7 900 123-45-67', inputMode: 'tel' as const,
    ok: (v: string) => /^\d{10,15}$/.test(v.replace(/[\s()\-.+]/g, '')), hint: 'Укажите номер телефона',
  },
};

export function Product({ id }: { id: number }) {
  const me = useMe()!;
  const { data: p, error } = useLoad(() => api<ProductView>(`/api/products/${id}`), [id]);
  const [pick, setPick] = useState<Pick>(null);
  const [recipient, setRecipient] = useState('');

  useEffect(() => {
    if (p && pick == null) {
      const best = [...p.variants].reverse().find((v) => v.inStock) ?? p.variants[0];
      setPick(best?.id ?? null);
    }
  }, [p, pick]);

  if (error) return <div className="page"><div className="empty">{error}</div></div>;
  if (!p) return <div className="page"><div className="skeleton" style={{ height: 320 }} /></div>;

  const v = typeof pick === 'number' ? p.variants.find((x) => x.id === pick) : undefined;
  const bulk = pick === 'bulk';
  const spec = recipientSpec[p.recipientKind];
  const recipientOk = !p.needsRecipient || spec.ok(recipient.trim());
  const support = me.supportUsername.replace(/^@/, '');
  const options = p.variants.length + (p.wholesale ? 1 : 0);

  return (
    <div className="page" style={{ paddingTop: 0, gap: 18, paddingBottom: 110 }}>
      <section style={{ position: 'relative', height: 250, margin: '0 -16px' }}>
        <div className="glow" style={{ height: 250, background: 'radial-gradient(60% 60% at 50% 55%, rgba(230,15,30,.8), rgba(120,0,10,.3) 50%, transparent 78%)' }} />
        <Key icon={p.icon} glass={p.glass} size={124} style={{ position: 'absolute', left: 'calc(50% - 62px)', top: 56, rotate: '-12deg' }} />
      </section>

      <div>
        <div className="cap">{p.category}</div>
        <h1 className="disp" style={{ fontSize: 30, marginTop: 8 }}>{p.title}</h1>
        {p.subtitle && <p className="muted" style={{ marginTop: 6 }}>{p.subtitle}</p>}
        {p.rating.count > 0 && (
          <a href={`#/reviews?p=${p.id}`} className="trust" style={{ marginTop: 10 }}>
            <span className="trust-star">★</span><b>{ratingText(p.rating.avg)}</b><span className="muted">· {reviewsWord(p.rating.count)}</span>
          </a>
        )}
      </div>

      {p.siblings.length > 1 && (
        <div className="seg" role="tablist" aria-label="Как выдаём">
          {p.siblings.map((s) => (
            <button key={s.id} role="tab" aria-selected={s.id === p.id} className={s.id === p.id ? 'on' : ''} onClick={() => s.id !== p.id && swap(`/product/${s.id}`)}>
              {s.label}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(options, 3)}, 1fr)`, gap: 8 }} role="radiogroup" aria-label="Вариант">
        {p.variants.map((x) => (
          <button key={x.id} role="radio" aria-checked={x.id === pick} disabled={!x.inStock}
            className={`tile ${x.id === pick ? 'on' : ''}`} style={{ opacity: x.inStock ? 1 : 0.4 }} onClick={() => setPick(x.id)}>
            <div className="disp" style={{ fontSize: 18 }}>{x.title}</div>
            <div style={{ fontSize: 12, marginTop: 2, opacity: 0.75 }}>{x.inStock ? rub(x.price) : 'нет'}</div>
          </button>
        ))}
        {p.wholesale && (
          <button role="radio" aria-checked={bulk} className={`tile ${bulk ? 'on' : ''}`} onClick={() => setPick('bulk')}>
            <div className="disp" style={{ fontSize: 18 }}>Опт</div>
            <div style={{ fontSize: 12, marginTop: 2, opacity: 0.75 }}>от 10 шт</div>
          </button>
        )}
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

      {bulk && (
        <div className="card pad col" style={{ gap: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 17 }}>Оптом дешевле</div>
          <p className="muted" style={{ lineHeight: 1.45 }}>
            Берёте от 10 штук? Напишите в поддержку {support && <b style={{ color: 'var(--t)' }}>@{support}</b>}: назовите товар, срок и количество, и мы пришлём цену за штуку.
          </p>
        </div>
      )}

      {!bulk && p.needsRecipient && (
        <label className="field">
          <span>{spec.label}</span>
          <input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder={spec.placeholder}
            autoCapitalize="off" autoCorrect="off" inputMode={spec.inputMode} autoComplete={p.recipientKind === 'PHONE' ? 'tel' : 'off'} />
        </label>
      )}

      {!bulk && p.access === 'WITH_LOGIN' && (
        <div className="note">
          <Icon name="shield" size={20} />
          <span>После оплаты поддержка напишет в чат заказа и попросит код входа из Telegram. Код отправляйте только в чат заказа, больше никому.</span>
        </div>
      )}

      {p.description && <p className="muted" style={{ lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{p.description}</p>}

      <div className="grid2" style={{ fontSize: 13, lineHeight: 1.3 }}>
        {p.access === 'NO_LOGIN' && <div className="row" style={{ gap: 10 }}><Icon name="shield" size={20} /><span className="muted">Без входа в ваш аккаунт</span></div>}
        {p.access === 'WITH_LOGIN' && <div className="row" style={{ gap: 10 }}><Icon name="shield" size={20} /><span className="muted">Входим только для оформления</span></div>}
        <div className="row" style={{ gap: 10 }}><Icon name="clock" size={20} /><span className="muted">Не выдали за 30 мин — вернём деньги</span></div>
      </div>

      {p.reviews.length > 0 && (
        <section className="col" aria-label="Отзывы">
          <div className="between">
            <h2 className="disp h2">Отзывы</h2>
            <a href={`#/reviews?p=${p.id}`} className="small" style={{ color: 'var(--a2)', fontWeight: 600 }}>Все {p.rating.count}</a>
          </div>
          {p.reviews.map((r) => <ReviewCard key={r.id} r={r} />)}
        </section>
      )}

      <div className="sticky-cta">
        {bulk ? (
          <button className="btn block" style={{ height: 60, borderRadius: 20 }} disabled={!support} onClick={() => openTelegramChat(support)}>
            Написать @{support}
          </button>
        ) : (
          <button className="btn block" style={{ height: 60, borderRadius: 20 }} disabled={!v || !recipientOk}
            onClick={() => go(`/checkout?v=${v!.id}&r=${encodeURIComponent(recipient.trim())}`)}>
            {p.needsRecipient && !recipientOk ? spec.hint : `Оформить · ${v ? rub(v.price) : ''}`}
          </button>
        )}
      </div>
    </div>
  );
}
