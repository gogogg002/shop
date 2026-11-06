import { accessLabel, shortDate, type PublicReview } from '../api';
import { Stars } from './kit';

export function ReviewCard({ r, showProduct = false }: { r: PublicReview; showProduct?: boolean }) {
  const what = [showProduct ? r.product : null, r.variant, accessLabel[r.access] ? accessLabel[r.access].toLowerCase() : null].filter(Boolean).join(' · ');
  return (
    <article className="card pad review">
      <div className="between">
        <div className="row" style={{ gap: 10, minWidth: 0 }}>
          <span className="ava" aria-hidden="true">{(Array.from(r.author)[0] ?? '?').toUpperCase()}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600 }} className="ellipsis">{r.author}</div>
            <div className="muted ellipsis" style={{ fontSize: 12.5 }}>{what}</div>
          </div>
        </div>
        <div style={{ textAlign: 'right', flex: 'none' }}>
          <Stars value={r.rating} size={13} />
          <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>{shortDate(r.createdAt)}</div>
        </div>
      </div>
      {r.text && <p style={{ marginTop: 10, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{r.text}</p>}
    </article>
  );
}
