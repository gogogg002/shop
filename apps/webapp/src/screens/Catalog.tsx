import { useMemo, useState } from 'react';
import { accessLabel, api, ratingText, reviewsWord, rub, type CatalogCategory, type ReviewFeed } from '../api';
import { Icon, useLoad } from '../ui/kit';
import { Brand, CrystalCover, Druse, FacetStar, glyphOf, tintOf } from '../ui/Crystal';
import { useMe } from '../App';
import { matches, searchText } from '../search';

export function Catalog({ category }: { category: string | null }) {
  const me = useMe()!;
  const { data, error } = useLoad(() => api<CatalogCategory[]>('/api/catalog'));
  const feed = useLoad(() => api<ReviewFeed>('/api/reviews?limit=0'));
  const [q, setQ] = useState('');

  const products = useMemo(() => {
    const all = (data ?? []).flatMap((c) => c.products.map((p) => ({
      ...p, cat: c.slug, hay: searchText(p.title, p.subtitle, c.title, ...p.modes.map((m) => accessLabel[m])),
    })));
    return all.filter((p) => (!category || p.cat === category) && matches(p.hay, q));
  }, [data, q, category]);

  const rating = feed.data?.summary;
  // Хит идёт первой широкой карточкой, остальные — сеткой по два
  const feat = products.find((p) => p.isHit);
  const rest = products.filter((p) => p !== feat);

  return (
    <div className="page" style={{ paddingTop: 8, gap: 0 }}>
      <Druse kind="catalog" top={-2} />

      <header className="appbar">
        <Brand />
        {rating && rating.count > 0 && (
          <a href="#/reviews" className="trust" aria-label={`Рейтинг ${ratingText(rating.avg)}, ${reviewsWord(rating.count)}`}>
            <FacetStar size={16} /><b>{ratingText(rating.avg)}</b><span>· {reviewsWord(rating.count)}</span><Icon name="chev" size={16} />
          </a>
        )}
      </header>

      <section style={{ padding: '18px 4px 0', minHeight: 196 }} aria-label="Витрина">
        <h1 className="hero-title">Кристально<br />просто</h1>
        <p className="hero-sub" style={{ marginTop: 34 }}>Telegram, Discord, Steam и нейросети. Оплата СБП, криптой или гривнами.</p>
      </section>

      <label className="search" style={{ marginTop: 16 }}>
        <Icon name="search" size={20} />
        <input placeholder="Найти сервис" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск" />
        {me.user.balance > 0 && <span className="pill a">Баланс {rub(me.user.balance)}</span>}
      </label>

      {data && data.length > 1 && (
        <nav className="chips" style={{ marginTop: 12 }} aria-label="Категории">
          <a href="#/" className={`pill ${!category ? 'solid' : 'm'}`} aria-current={!category ? 'page' : undefined}>Все</a>
          {data.map((c) => (
            <a key={c.id} href={`#/?c=${c.slug}`} className={`pill ${category === c.slug ? 'solid' : 'm'}`} aria-current={category === c.slug ? 'page' : undefined}>{c.title}</a>
          ))}
        </nav>
      )}

      {error && <div className="empty">{error}</div>}
      {!data && !error && <div className="svc-grid" style={{ marginTop: 16 }}>{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 106 }} />)}</div>}
      {data && !products.length && <div className="empty">Ничего не нашли. Попробуйте другое название.</div>}

      {products.length > 0 && (
        <section className="svc-grid" style={{ marginTop: 16 }} aria-label="Сервисы">
          {feat && (
            <a href={`#/product/${feat.id}`} className="svc feat">
              <span className="hit"><FacetStar size={11} />Хит</span>
              <h3>{feat.title}</h3>
              <p className="ellipsis">{feat.modes.length > 1 ? feat.modes.map((m) => accessLabel[m]).filter(Boolean).join(' · ') : feat.subtitle}</p>
              <div className="price">от <b>{rub(feat.minPrice)}</b></div>
              <span className="art"><CrystalCover glyph={glyphOf(feat.icon)} tint={tintOf(feat.glass)} size={140} scale={1.3} aura={0.14} groundO={0.6} /></span>
            </a>
          )}
          {rest.map((p) => {
            const tint = tintOf(p.glass);
            return (
              <a key={p.id} href={`#/product/${p.id}`} className={`svc t-${tint}`}>
                <h3>{p.title}</h3>
                <div className="price">от <b>{rub(p.minPrice)}</b></div>
                <span className="art"><CrystalCover glyph={glyphOf(p.icon)} tint={tint} size={100} /></span>
              </a>
            );
          })}
        </section>
      )}
    </div>
  );
}
