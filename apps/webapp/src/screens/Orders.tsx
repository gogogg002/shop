import { api, itemTitle, prettyPhone, rub, statusLabel, type OrderListItem } from '../api';
import { Key, useLoad } from '../ui/kit';

const fmt = (d: string) => new Date(d).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function Orders() {
  const { data, error } = useLoad(() => api<OrderListItem[]>('/api/orders'));
  const active = data?.filter((o) => ['PENDING_PAYMENT', 'AWAITING_CONFIRMATION', 'PAID'].includes(o.status)) ?? [];
  const rest = data?.filter((o) => !active.includes(o)) ?? [];

  return (
    <div className="page">
      <div className="glow" />
      <h1 className="disp" style={{ fontSize: 34 }}>Заказы</h1>
      {error && <div className="empty">{error}</div>}
      {!data && !error && <div className="skeleton" style={{ height: 200 }} />}
      {data && !data.length && <div className="empty">Заказов пока нет. <a href="#/" style={{ color: 'var(--a2)' }}>В каталог</a></div>}

      {active.map((o) => {
        const st = statusLabel[o.status];
        const step = o.status === 'PAID' ? 2 : o.status === 'AWAITING_CONFIRMATION' ? 1 : 0;
        return (
          <a key={o.id} href={`#/orders/${o.id}`} className="card pad lit">
            <div className="between"><span className={`pill ${st.tone}`}>{st.text}</span><span className="mono muted small">#{o.id} · {fmt(o.createdAt)}</span></div>
            <div className="row" style={{ marginTop: 14 }}>
              <Key icon={o.icon} glass={o.glass} size={46} />
              <div className="sp"><div style={{ fontWeight: 700, fontSize: 16 }}>{itemTitle(o.product, o.access, o.variant)}</div>{o.recipient && <div className="muted small">для {prettyPhone(o.recipient)}</div>}</div>
              <b>{rub(o.amount)}</b>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginTop: 16 }}>
              {['Оплата', 'Выдаём', 'Получен'].map((t, i) => (
                <div key={t}>
                  <div style={{ height: 4, borderRadius: 2, background: i <= step ? 'var(--a)' : 'var(--s3)', boxShadow: i === step ? '0 0 12px var(--lime-glow)' : undefined }} />
                  <div style={{ fontSize: 12, marginTop: 7, fontWeight: 600, color: i === step ? 'var(--a2)' : i < step ? 'var(--t)' : 'var(--m)' }}>{t}</div>
                </div>
              ))}
            </div>
          </a>
        );
      })}

      {rest.length > 0 && <div className="cap" style={{ marginTop: 6 }}>Ранее</div>}
      {rest.length > 0 && (
        <div className="card list">
          {rest.map((o) => {
            const st = statusLabel[o.status];
            return (
              // Всегда на страницу заказа: там выданный код и чат, а оценку можно поставить звёздами прямо на ней
              <a key={o.id} href={`#/orders/${o.id}`} className="row item">
                <Key icon={o.icon} glass={o.glass} size={40} />
                <div className="sp"><div style={{ fontWeight: 600 }} className="ellipsis">{itemTitle(o.product, o.access, o.variant)}</div><div className="muted small">{fmt(o.createdAt)}</div></div>
                {o.status === 'DELIVERED' && !o.reviewed
                  ? <span className="pill a">★ Оценить</span>
                  : <span className={`pill ${st.tone}`}>{st.text}</span>}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
