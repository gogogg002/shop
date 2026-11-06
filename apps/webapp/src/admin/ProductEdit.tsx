import { useEffect, useState } from 'react';
import { api, type Glass } from '../api';
import { Icon, Key, Toggle, productIcons, useLoad, useToast } from '../ui/kit';
import { go } from '../App';
import type { AdminProduct } from './Products';

type Draft = Omit<AdminProduct, 'id' | 'sales30d' | 'category' | 'variants'>;
type VariantDraft = { id?: number; title: string; price: string; oldPrice: string; cost: string; isActive: boolean; codesLeft?: number };

const toRub = (kop: number | null) => (kop == null ? '' : String(kop / 100));
const toKop = (s: string) => Math.round(Number(s.replace(',', '.').replace(/\s/g, '')) * 100);

/** Цвет кристалла на обложке. В базе поле осталось от стеклянных клавиш v3: RED, WHITE, DARK */
const GLASS_LABEL: Record<Glass, string> = { RED: 'Лайм', WHITE: 'Лёд', DARK: 'Графит' };
const GLASS_SWATCH: Record<Glass, string> = {
  RED: 'linear-gradient(135deg,#DDFB86,#6A9426)', WHITE: 'linear-gradient(135deg,#FFFFFF,#678190)', DARK: 'linear-gradient(135deg,#AEB3BC,#292C33)',
};

export function ProductEdit({ id }: { id: number | null }) {
  const toast = useToast();
  const cats = useLoad(() => api<{ id: number; title: string }[]>('/api/admin/categories'));
  const all = useLoad(() => (id ? api<AdminProduct[]>('/api/admin/products') : Promise.resolve([])), [id]);
  const [p, setP] = useState<Draft | null>(null);
  const [vars, setVars] = useState<VariantDraft[]>([]);
  const [codes, setCodes] = useState<Record<number, string>>({});
  const [newCat, setNewCat] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!cats.data || !all.data || p) return;
    const found = id ? all.data.find((x) => x.id === id) : null;
    if (found) {
      const { id: _i, sales30d: _s, category: _c, variants, ...rest } = found;
      setP(rest);
      setVars(variants.map((v) => ({ id: v.id, title: v.title, price: toRub(v.price), oldPrice: toRub(v.oldPrice), cost: toRub(v.cost), isActive: v.isActive, codesLeft: v.codesLeft })));
    } else {
      setP({
        categoryId: cats.data[0]?.id ?? 0, title: '', subtitle: '', description: '', icon: 'star', glass: 'RED', deliveryType: 'MANUAL',
        needsRecipient: true, recipientKind: 'USERNAME', access: 'UNSPECIFIED', wholesale: false, isActive: true, isHit: false, sort: 0,
      });
      setVars([{ title: '1 мес', price: '', oldPrice: '', cost: '', isActive: true }]);
    }
  }, [cats.data, all.data, id, p]);

  if (!p) return <div className="page"><div className="skeleton" style={{ height: 300 }} /></div>;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setP({ ...p, [k]: v });
  const setVar = (i: number, patch: Partial<VariantDraft>) => setVars(vars.map((v, j) => (j === i ? { ...v, ...patch } : v)));

  async function addCategory() {
    const title = newCat.trim();
    if (!title) return;
    const slug = title.toLowerCase().replace(/[^a-zа-я0-9]+/gi, '-') + '-' + Date.now().toString(36);
    const c = await api<{ id: number; title: string }>('/api/admin/categories', { body: { title, slug } });
    cats.setData([...(cats.data ?? []), c]);
    set('categoryId', c.id);
    setNewCat('');
  }

  async function save() {
    if (!p!.title.trim()) return toast('Укажите название', true);
    if (!p!.categoryId) return toast('Выберите или создайте категорию', true);
    const bad = vars.find((v) => !v.title.trim() || !(toKop(v.price) > 0));
    if (bad) return toast('У каждого варианта нужны название и цена', true);
    setBusy(true);
    try {
      const saved = id
        ? await api<{ id: number }>(`/api/admin/products/${id}`, { method: 'PATCH', body: p })
        : await api<{ id: number }>('/api/admin/products', { body: p });
      for (const [i, v] of vars.entries()) {
        const body = { title: v.title.trim(), price: toKop(v.price), oldPrice: v.oldPrice ? toKop(v.oldPrice) : null, cost: v.cost ? toKop(v.cost) : 0, isActive: v.isActive, sort: i };
        if (v.id) await api(`/api/admin/variants/${v.id}`, { method: 'PATCH', body });
        else await api(`/api/admin/products/${saved.id}/variants`, { body });
      }
      for (const [vid, text] of Object.entries(codes)) {
        if (text.trim()) {
          const r = await api<{ added: number }>(`/api/admin/variants/${vid}/codes`, { body: { codes: text } });
          toast(`Добавлено кодов: ${r.added}`);
        }
      }
      toast('Сохранено');
      go('/admin/products');
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  async function remove(i: number) {
    const v = vars[i];
    if (v.id) {
      try { await api(`/api/admin/variants/${v.id}`, { method: 'DELETE' }); } catch (e) { return toast((e as Error).message, true); }
    }
    setVars(vars.filter((_, j) => j !== i));
  }

  async function removeProduct() {
    if (!id) return go('/admin/products');
    try {
      await api(`/api/admin/products/${id}`, { method: 'DELETE' });
      toast('Товар удалён. Если по нему были заказы, он просто скрыт');
      go('/admin/products');
    } catch (e) {
      toast((e as Error).message, true);
    }
  }

  return (
    <div className="page" style={{ paddingBottom: 110 }}>
      <div className="glow" />
      <h1 className="disp h1">{id ? 'Редактор' : 'Новый товар'}</h1>

      <div className="row" style={{ gap: 14, alignItems: 'flex-start' }}>
        <Key icon={p.icon} glass={p.glass} size={84} />
        <div className="sp col" style={{ gap: 8 }}>
          <div className="cap">Обложка</div>
          <div className="row" style={{ gap: 8 }}>
            {(['RED', 'WHITE', 'DARK'] as Glass[]).map((g) => (
              <button key={g} aria-pressed={p.glass === g} onClick={() => set('glass', g)} className={`pill ${p.glass === g ? 'a' : 'm'}`} style={{ height: 30, padding: '0 11px 0 8px' }}>
                <span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: 4, rotate: '45deg', background: GLASS_SWATCH[g] }} />{GLASS_LABEL[g]}
              </button>
            ))}
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {productIcons.map((ic) => (
              <button key={ic} aria-label={`Иконка ${ic}`} onClick={() => set('icon', ic)} className="card" style={{ width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', borderColor: p.icon === ic ? 'var(--a)' : undefined }}>
                <Icon name={ic} size={18} />
              </button>
            ))}
          </div>
        </div>
      </div>

      <label className="field"><span>Название</span><input value={p.title} onChange={(e) => set('title', e.target.value)} placeholder="Telegram Premium" /></label>
      <label className="field"><span>Подпись в каталоге</span><input value={p.subtitle} onChange={(e) => set('subtitle', e.target.value)} placeholder="Подарком на аккаунт" /></label>
      <label className="field"><span>Описание</span><textarea rows={3} value={p.description} onChange={(e) => set('description', e.target.value)} /></label>

      <div className="row" style={{ gap: 8 }}>
        <label className="field sp"><span>Категория</span>
          <select value={p.categoryId} onChange={(e) => set('categoryId', Number(e.target.value))}>
            {(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </label>
        <label className="field sp"><span>Новая категория</span><input value={newCat} onChange={(e) => setNewCat(e.target.value)} onBlur={addCategory} placeholder="Название" /></label>
      </div>

      <div className="cap">Как выдаём</div>
      <div className="seg">
        <button className={p.deliveryType === 'MANUAL' ? 'on' : ''} onClick={() => set('deliveryType', 'MANUAL')}>Вручную</button>
        <button className={p.deliveryType === 'CODES' ? 'on' : ''} onClick={() => set('deliveryType', 'CODES')}>Коды из базы</button>
      </div>

      <div className="cap">Вход в аккаунт покупателя</div>
      <div className="seg">
        {([['UNSPECIFIED', 'Не указано'], ['NO_LOGIN', 'Без входа'], ['WITH_LOGIN', 'Со входом'], ['GIFT', 'Подарком']] as const).map(([k, t]) => (
          <button key={k} className={p.access === k ? 'on' : ''} onClick={() => setP({
            ...p, access: k,
            // со входом удобнее спрашивать номер телефона, без входа — @username
            ...(k === 'WITH_LOGIN' && p.needsRecipient ? { recipientKind: 'PHONE' as const } : {}),
            ...(k === 'GIFT' ? { needsRecipient: true, recipientKind: 'USERNAME' as const } : {}),
          })}>{t}</button>
        ))}
      </div>
      <p className="muted small" style={{ lineHeight: 1.45 }}>
        Товары с одинаковым названием в одной категории и разным режимом («Без входа», «Со входом», «Подарком») покупатель видит одной карточкой с вкладками.
      </p>

      <div className="cap">Что спросить у покупателя</div>
      <div className="seg">
        <button className={!p.needsRecipient ? 'on' : ''} onClick={() => set('needsRecipient', false)}>Ничего</button>
        <button className={p.needsRecipient && p.recipientKind === 'USERNAME' ? 'on' : ''} onClick={() => setP({ ...p, needsRecipient: true, recipientKind: 'USERNAME' })}>@username</button>
        <button className={p.needsRecipient && p.recipientKind === 'PHONE' ? 'on' : ''} onClick={() => setP({ ...p, needsRecipient: true, recipientKind: 'PHONE' })}>Телефон</button>
        <button className={p.needsRecipient && p.recipientKind === 'STEAM' ? 'on' : ''} onClick={() => setP({ ...p, needsRecipient: true, recipientKind: 'STEAM' })}>Логин Steam</button>
      </div>

      <div className="between"><span className="cap">Цены, ₽</span>
        <button style={{ color: 'var(--a2)', fontWeight: 600, fontSize: 13.5 }} onClick={() => setVars([...vars, { title: '', price: '', oldPrice: '', cost: '', isActive: true }])}>+ вариант</button>
      </div>
      <div className="col">
        {vars.map((v, i) => {
          const price = toKop(v.price), cost = toKop(v.cost || '0');
          const margin = price > 0 ? Math.round(((price - cost) / price) * 100) : 0;
          return (
            <div key={v.id ?? `n${i}`} className="card pad col" style={{ gap: 8, opacity: v.isActive ? 1 : 0.55 }}>
              <div className="row" style={{ gap: 8 }}>
                <label className="field sp" style={{ padding: '6px 12px' }}><span>Вариант</span><input value={v.title} onChange={(e) => setVar(i, { title: e.target.value })} placeholder="12 мес" /></label>
                <Toggle on={v.isActive} onChange={(x) => setVar(i, { isActive: x })} label="Вариант активен" />
                <button className="btn ghost icon sm" onClick={() => remove(i)} aria-label="Удалить вариант"><Icon name="trash" size={18} /></button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                <label className="field" style={{ padding: '6px 12px' }}><span>Цена</span><input inputMode="decimal" value={v.price} onChange={(e) => setVar(i, { price: e.target.value })} /></label>
                <label className="field" style={{ padding: '6px 12px' }}><span>Закупка</span><input inputMode="decimal" value={v.cost} onChange={(e) => setVar(i, { cost: e.target.value })} /></label>
                <label className="field" style={{ padding: '6px 12px' }}><span>Старая цена</span><input inputMode="decimal" value={v.oldPrice} onChange={(e) => setVar(i, { oldPrice: e.target.value })} /></label>
              </div>
              {price > 0 && (
                <div className="row" style={{ gap: 10 }}>
                  <div className="sp" style={{ height: 5, borderRadius: 3, background: 'var(--s3)', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.max(0, Math.min(100, margin * 3))}%`, height: '100%', background: margin >= 20 ? 'var(--ok)' : margin > 0 ? 'var(--warn)' : 'var(--bad)' }} />
                  </div>
                  <span className="small" style={{ color: margin >= 20 ? 'var(--ok)' : margin > 0 ? 'var(--warn)' : 'var(--bad)', fontWeight: 600 }}>маржа {margin}%</span>
                </div>
              )}
              {p.deliveryType === 'CODES' && v.id && (
                <label className="field" style={{ padding: '6px 12px' }}>
                  <span>Добавить коды, по одному в строке · сейчас в наличии {v.codesLeft ?? 0}</span>
                  <textarea rows={2} className="mono" value={codes[v.id] ?? ''} onChange={(e) => setCodes({ ...codes, [v.id!]: e.target.value })} />
                </label>
              )}
              {p.deliveryType === 'CODES' && !v.id && <div className="muted small">Коды можно загрузить после сохранения.</div>}
            </div>
          );
        })}
      </div>

      <div className="card list">
        <div className="row item"><span className="sp">Показывать на витрине</span><Toggle on={p.isActive} onChange={(v) => set('isActive', v)} label="Показывать на витрине" /></div>
        <div className="row item"><span className="sp">Метка «Хит»</span><Toggle on={p.isHit} onChange={(v) => set('isHit', v)} label="Метка Хит" /></div>
        <div className="row item">
          <div className="sp"><div>Вариант «Опт»</div><div className="muted small">Покупатель пишет в поддержку из настроек</div></div>
          <Toggle on={p.wholesale} onChange={(v) => set('wholesale', v)} label="Вариант Опт" />
        </div>
      </div>

      <div className="sticky-cta row">
        <button className="btn ghost" style={{ width: 60, height: 60, borderRadius: 20, color: 'var(--bad)' }} onClick={removeProduct} aria-label="Удалить товар"><Icon name="trash" /></button>
        <button className="btn sp" style={{ height: 60, borderRadius: 20 }} disabled={busy} onClick={save}>{busy ? 'Сохраняем…' : 'Сохранить'}</button>
      </div>
    </div>
  );
}
