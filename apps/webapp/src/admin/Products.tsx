import { api, rub, type Glass } from '../api';
import { Icon, Key, Toggle, useLoad, useToast } from '../ui/kit';

export interface AdminProduct {
  id: number; categoryId: number; title: string; subtitle: string; description: string; icon: string; glass: Glass;
  deliveryType: 'MANUAL' | 'CODES'; needsRecipient: boolean; isActive: boolean; isHit: boolean; sort: number; sales30d: number;
  category: { id: number; title: string };
  variants: { id: number; title: string; price: number; oldPrice: number | null; cost: number; isActive: boolean; sort: number; codesLeft: number }[];
}

export function Products() {
  const { data, error, setData } = useLoad(() => api<AdminProduct[]>('/api/admin/products'));
  const toast = useToast();

  async function toggle(p: AdminProduct, isActive: boolean) {
    setData(data!.map((x) => (x.id === p.id ? { ...x, isActive } : x)));
    try {
      await api(`/api/admin/products/${p.id}`, { method: 'PATCH', body: { isActive } });
    } catch (e) {
      toast((e as Error).message, true);
      setData(data!);
    }
  }

  return (
    <div className="page">
      <div className="glow" />
      <div className="between">
        <h1 className="disp" style={{ fontSize: 34 }}>Товары <span style={{ color: 'var(--m2)' }}>{data?.length ?? ''}</span></h1>
        <a href="#/admin/products/new" className="btn icon" style={{ width: 46, height: 46, borderRadius: 23 }} aria-label="Добавить товар"><Icon name="plus" /></a>
      </div>
      {error && <div className="empty">{error}</div>}
      {data && !data.length && <div className="empty">Товаров нет. Нажмите «+», чтобы добавить первый.</div>}

      {data?.filter((p) => p.deliveryType === 'CODES' && p.isActive).flatMap((p) => p.variants.filter((v) => v.isActive && v.codesLeft < 5).map((v) => (
        <a key={v.id} href={`#/admin/products/${p.id}`} className="row" style={{ background: 'rgba(255,181,71,.08)', border: '1px solid rgba(255,181,71,.25)', borderRadius: 16, padding: '12px 14px' }}>
          <b style={{ color: 'var(--warn)' }}>!</b><span className="sp small"><b>{p.title} · {v.title}:</b> осталось {v.codesLeft} кодов</span><span style={{ color: 'var(--warn)', fontWeight: 600, fontSize: 13.5 }}>Загрузить</span>
        </a>
      )))}

      {data && data.length > 0 && (
        <div className="card list">
          {data.map((p) => {
            const prices = p.variants.filter((v) => v.isActive).map((v) => v.price);
            return (
              <div key={p.id} className="row item" style={{ opacity: p.isActive ? 1 : 0.5 }}>
                <a href={`#/admin/products/${p.id}`} className="row sp">
                  <Key icon={p.icon} glass={p.glass} size={42} />
                  <div className="sp">
                    <div style={{ fontWeight: 600 }} className="ellipsis">{p.title}</div>
                    <div className="muted ellipsis" style={{ fontSize: 12.5 }}>
                      {prices.length ? `${p.variants.length} вар. · ${rub(Math.min(...prices))}–${rub(Math.max(...prices))}` : 'нет вариантов'} · {p.sales30d} продаж за 30 дн
                    </div>
                  </div>
                </a>
                <Toggle on={p.isActive} onChange={(v) => toggle(p, v)} label={`Показывать ${p.title}`} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
