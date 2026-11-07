import { useRef, useState } from 'react';
import { api, itemTitle, ratingText, shortDate, variantText, type AdminReview } from '../api';
import { Key, Stars, Toggle, useLoad, useToast } from '../ui/kit';

interface Page { items: AdminReview[]; total: number; visible: number; avg: number; nextBefore: number | null; nextAt: string | null }

const FILTERS = [['all', 'Все'], ['low', '1–3 ★'], ['visible', 'На витрине'], ['hidden', 'Скрытые']] as const;
type Filter = (typeof FILTERS)[number][0];

export function AdminReviews() {
  const [filter, setFilter] = useState<Filter>('all');
  const { data, error, setData } = useLoad(() => api<Page>(`/api/admin/reviews?filter=${filter}`), [filter]);
  // Номер списка: растёт при каждой смене фильтра. Догрузка, начатая для прошлого списка, в новый не попадёт,
  // даже если вернуться на тот же фильтр, и её «Загружаем…» не держит кнопку нового списка
  const gen = useRef(0);
  const [loadingFor, setLoadingFor] = useState<number | null>(null);
  const loadingMore = loadingFor === gen.current;
  const toast = useToast();

  const patchItem = (id: number, isHidden: boolean) =>
    setData((d) => d && { ...d, items: d.items.map((x) => (x.id === id ? { ...x, isHidden } : x)) });

  async function toggle(r: AdminReview, visible: boolean) {
    patchItem(r.id, !visible);
    try {
      await api(`/api/admin/reviews/${r.id}`, { method: 'PATCH', body: { isHidden: !visible } });
      toast(visible ? 'Отзыв снова на витрине' : 'Отзыв скрыт с витрины');
    } catch (e) {
      toast((e as Error).message, true);
      patchItem(r.id, r.isHidden);
    }
  }

  async function more() {
    if (!data?.nextBefore || !data.nextAt || loadingMore) return;
    const g = gen.current;
    setLoadingFor(g);
    try {
      const next = await api<Page>(`/api/admin/reviews?filter=${filter}&before=${data.nextBefore}&at=${encodeURIComponent(data.nextAt)}`);
      if (gen.current !== g) return;
      setData((d) => {
        if (!d) return d;
        const have = new Set(d.items.map((x) => x.id));
        return { ...next, items: [...d.items, ...next.items.filter((x) => !have.has(x.id))] };
      });
    } catch (e) {
      if (gen.current === g) toast((e as Error).message, true);
    } finally {
      setLoadingFor((cur) => (cur === g ? null : cur));
    }
  }

  return (
    <div className="page">
      <div className="glow" />
      <div className="between">
        <h1 className="disp" style={{ fontSize: 34 }}>Отзывы</h1>
        {data && data.total > 0 && <span className="pill m">★ {ratingText(data.avg)} · {data.total}</span>}
      </div>
      <div className="row" style={{ gap: 8, overflowX: 'auto', scrollbarWidth: 'none' }}>
        {FILTERS.map(([k, t]) => (
          <button key={k} className={`pill ${filter === k ? 'solid' : 'm'}`} style={{ height: 32, padding: '0 14px', fontSize: 13.5 }} onClick={() => {
            if (k === filter) return;
            gen.current += 1;
            setData(null); // список и «Показать ещё» старого фильтра не показываем, пока грузится новый
            setFilter(k);
          }}>{t}</button>
        ))}
      </div>
      {error && <div className="empty">{error}</div>}
      {!data && !error && <div className="skeleton" style={{ height: 240 }} />}
      {data && !data.items.length && <div className="empty">Отзывов нет</div>}

      {data?.items.map((r) => {
        const buyer = r.user.username ? `@${r.user.username}` : r.user.firstName ?? r.user.tgId;
        return (
          <article key={r.id} className="card pad col" style={{ gap: 10, opacity: r.isHidden ? 0.55 : 1 }}>
            <div className="row" style={{ gap: 12 }}>
              <Key icon={r.product.icon} glass={r.product.glass} size={40} />
              <div className="sp" style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }} className="ellipsis">{itemTitle(r.product.title, r.product.access, variantText(r.order.variant, r.order.quantity))}</div>
                <div className="muted small ellipsis">
                  {buyer} · <a href={`#/admin/orders/${r.orderId}`} style={{ color: 'var(--a2)' }}>заказ №{r.orderId}</a> · {shortDate(r.createdAt)}
                </div>
              </div>
            </div>
            <div className="between">
              <Stars value={r.rating} size={18} />
              {r.editCount > 0 && <span className="small" style={{ color: 'var(--warn)' }}>изменён {shortDate(r.activityAt)}</span>}
            </div>
            {r.text ? <p style={{ lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{r.text}</p> : <p className="muted small">Без текста</p>}
            <div className="between">
              <span className="small muted">{r.isHidden ? 'Скрыт с витрины' : 'Виден на витрине'}</span>
              <Toggle on={!r.isHidden} onChange={(v) => toggle(r, v)} label="Показывать на витрине" />
            </div>
          </article>
        );
      })}

      {data?.nextBefore && (
        <button className="btn ghost block sm" disabled={loadingMore} onClick={more}>{loadingMore ? 'Загружаем…' : 'Показать ещё'}</button>
      )}
    </div>
  );
}
