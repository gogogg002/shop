import { useMemo, useState } from 'react';
import { api, ratingText, reviewsWord, rub, type CatalogCategory, type ReviewFeed } from '../api';
import { Icon, Key, useLoad } from '../ui/kit';
import { useMe } from '../App';

export function Catalog({ category }: { category: string | null }) {
  const me = useMe()!;
  const { data, error } = useLoad(() => api<CatalogCategory[]>('/api/catalog'));
  const feed = useLoad(() => api<ReviewFeed>('/api/reviews?limit=0'));
  const [q, setQ] = useState('');

  const products = useMemo(() => {
    const all = (data ?? []).flatMap((c) => c.products.map((p) => ({ ...p, cat: c.slug })));
    const needle = q.trim().toLowerCase();
    return all.filter((p) => (!category || p.cat === category) && (!needle || `${p.title} ${p.subtitle}`.toLowerCase().includes(needle)));
  }, [data, q, category]);

  const rating = feed.data?.summary;

  return (
    <div className="page" style={{ paddingTop: 0 }}>
      <div className="glow" style={{ height: 420, background: 'radial-gradient(70% 60% at 50% 38%, rgba(225,12,28,.85), rgba(110,0,10,.35) 50%, transparent 78%)' }} />

      <section style={{ position: 'relative', height: 250, margin: '0 -16px' }} aria-label="Витрина">
        <Key icon="star" glass="WHITE" size={40} style={{ position: 'absolute', left: 22, top: 34, rotate: '-18deg', filter: 'blur(.8px)' }} />
        <Key icon="bolt" glass="RED" size={52} style={{ position: 'absolute', right: 26, top: 22, rotate: '16deg' }} />
        <Key icon="pad" glass="DARK" size={42} style={{ position: 'absolute', left: 16, top: 190, rotate: '14deg', filter: 'blur(1px)' }} />
        <Key icon="star" glass="RED" size={34} style={{ position: 'absolute', right: 22, top: 198, rotate: '-20deg', filter: 'blur(1.5px)' }} />
        <div style={{ position: 'absolute', inset: '70px 16px auto', textAlign: 'center' }}>
          <h1 className="disp" style={{ fontSize: 35 }}>Подписки и звёзды<br />за пару минут</h1>
          <p style={{ fontSize: 14.5, color: 'rgba(255,255,255,.72)', marginTop: 12, lineHeight: 1.4 }}>
            Telegram, Discord, Steam и нейросети.<br />Оплата СБП, криптой или гривнами.
          </p>
        </div>
      </section>

      {rating && rating.count > 0 && (
        <a href="#/reviews" className="trust" aria-label={`Рейтинг ${ratingText(rating.avg)}, ${reviewsWord(rating.count)}`}>
          <span className="trust-star">★</span><b>{ratingText(rating.avg)}</b><span className="muted">· {reviewsWord(rating.count)}</span><Icon name="chev" size={16} />
        </a>
      )}

      <label className="search">
        <Icon name="search" size={20} />
        <input placeholder="Найти сервис" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск" />
        {me.user.balance > 0 && <span className="pill m" style={{ color: '#fff' }}>Баланс {rub(me.user.balance)}</span>}
      </label>

      {data && data.length > 1 && (
        <div className="row" style={{ gap: 8, overflowX: 'auto', scrollbarWidth: 'none' }}>
          <a href="#/" className={`pill ${!category ? 'solid' : 'm'}`} style={{ height: 32, padding: '0 14px', fontSize: 13.5 }}>Все</a>
          {data.map((c) => (
            <a key={c.id} href={`#/?c=${c.slug}`} className={`pill ${category === c.slug ? 'solid' : 'm'}`} style={{ height: 32, padding: '0 14px', fontSize: 13.5 }}>{c.title}</a>
          ))}
        </div>
      )}

      <h2 className="disp h2">Выберите сервис</h2>
      {error && <div className="empty">{error}</div>}
      {!data && !error && <div className="grid2">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 190 }} />)}</div>}
      {data && !products.length && <div className="empty">Ничего не нашли. Попробуйте другое название.</div>}

      <div className="grid2">
        {products.map((p) => (
          <a key={p.id} href={`#/product/${p.id}`} className="svc">
            {p.isHit && <span className="pill solid" style={{ position: 'absolute', top: 14, right: 14, height: 22, fontSize: 11 }}>Хит</span>}
            <Key icon={p.icon} glass={p.glass} size={56} style={{ rotate: '-8deg' }} />
            <div style={{ marginTop: 22, fontWeight: 700, fontSize: 16 }}>{p.title}</div>
            <div className="muted ellipsis" style={{ fontSize: 12.5, marginTop: 3 }}>
              {p.subtitle}
            </div>
            <div className="between" style={{ marginTop: 12 }}>
              <span style={{ fontWeight: 700 }}><span className="muted" style={{ fontWeight: 500, fontSize: 12 }}>от </span>{rub(p.minPrice)}</span>
              <span className="go"><Icon name="chev" /></span>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
