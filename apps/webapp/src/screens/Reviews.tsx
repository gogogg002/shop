import { useState } from 'react';
import { api, ratingText, reviewsWord, type PublicReview, type ReviewFeed } from '../api';
import { Stars, useLoad } from '../ui/kit';
import { ReviewCard } from '../ui/ReviewCard';

/** Все отзывы магазина или одного товара (?p=id) */
export function Reviews({ productId }: { productId: number | null }) {
  const base = `/api/reviews?limit=20${productId ? `&productId=${productId}` : ''}`;
  const { data, error } = useLoad(() => api<ReviewFeed>(base), [base]);
  const [more, setMore] = useState<PublicReview[]>([]);
  const [next, setNext] = useState<number | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  if (error) return <div className="page"><div className="empty">{error}</div></div>;
  if (!data) return <div className="page"><div className="skeleton" style={{ height: 300 }} /></div>;

  const cursor = next === undefined ? data.nextBefore : next;
  const items = [...data.items, ...more];

  async function loadMore() {
    if (!cursor) return;
    setBusy(true);
    try {
      const r = await api<ReviewFeed>(`${base}&before=${cursor}`);
      setMore((m) => [...m, ...r.items]);
      setNext(r.nextBefore);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="glow" />
      <h1 className="disp h1">Отзывы</h1>
      {data.summary.count > 0 ? (
        <div className="card pad row" style={{ gap: 14 }}>
          <div className="disp" style={{ fontSize: 44, lineHeight: 1 }}>{ratingText(data.summary.avg)}</div>
          <div>
            <Stars value={data.summary.avg} size={18} />
            <div className="muted small" style={{ marginTop: 4 }}>{reviewsWord(data.summary.count)}</div>
          </div>
        </div>
      ) : (
        <div className="empty">Отзывов пока нет</div>
      )}
      {items.map((r) => <ReviewCard key={r.id} r={r} showProduct={!productId} />)}
      {cursor && <button className="btn ghost block" disabled={busy} onClick={loadMore}>{busy ? 'Загружаем…' : 'Показать ещё'}</button>}
    </div>
  );
}
