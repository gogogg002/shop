import { useEffect, useState } from 'react';
import { api, openTelegramChat, prettyPhone, ratingText, reviewsWord, rub, type ProductView } from '../api';
import { normalizePhone } from '../phone';
import { Icon, useLoad } from '../ui/kit';
import { Druse, FacetStar, glyphOf, tintOf } from '../ui/Crystal';
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
    // так же, как сервер: номер без кода страны, который нельзя понять однозначно, не пропускаем
    ok: (v: string) => normalizePhone(v) !== null, hint: 'Укажите номер с кодом страны',
  },
  STEAM: {
    label: 'Логин Steam (не никнейм)', placeholder: 'login', inputMode: 'text' as const,
    ok: (v: string) => /^[A-Za-z0-9_.-]{2,64}$/.test(v), hint: 'Укажите логин Steam',
  },
};

export function Product({ id }: { id: number }) {
  const me = useMe()!;
  const { data: p, error } = useLoad(() => api<ProductView>(`/api/products/${id}`), [id]);
  const [pick, setPick] = useState<Pick>(null);
  const [recipient, setRecipient] = useState('');
  const [qtyRaw, setQtyRaw] = useState('');

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

  const save = v?.oldPrice && v.oldPrice > v.price ? Math.round((1 - v.price / v.oldPrice) * 100) : 0;
  // Своё количество (звёзды, рубли Steam): цена = количество × цена за единицу
  const qty = Number(qtyRaw.replace(/\s/g, ''));
  // «500,00» или «250.5» не склеиваем в 50000 и 2505: просим целое число
  const qtyFraction = /[.,]/.test(qtyRaw);
  const qtyOk = !v?.perUnit || (/^[\d\s]+$/.test(qtyRaw) && Number.isInteger(qty) && qty >= v.minQty && qty <= v.maxQty);
  const total = v ? (v.perUnit ? (qtyOk ? v.price * qty : 0) : v.price) : 0;
  const isStars = v?.unit === 'Stars';
  const perUnitText = v?.perUnit ? `${(v.price / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽ за ${isStars ? 'звезду' : '1 ₽'}` : '';
  // Один вариант со своим количеством: плитки вариантов не нужны, сразу поле ввода
  const showOptions = p.variants.length > 1 || !p.variants[0]?.perUnit || p.wholesale;
  // Описание: строка = шаг. Старый длинный абзац без переносов покажется одним шагом
  const steps = p.description.split('\n').map((x) => x.trim()).filter(Boolean);

  return (
    <div className="page" style={{ paddingTop: 8, gap: 16, paddingBottom: 130 }}>
      <Druse kind="product" glyph={glyphOf(p.icon)} tint={tintOf(p.glass)} top={6} />

      <header style={{ padding: '14px 4px 0', minHeight: 150 }}>
        <div className="cap">{p.category}</div>
        <h1 className="disp" style={{ fontSize: 28, marginTop: 12, maxWidth: 250 }}>{p.title}</h1>
        {p.rating.count > 0 ? (
          <a href={`#/reviews?p=${p.id}`} className="row" style={{ gap: 5, marginTop: 14, fontSize: 13.5, fontWeight: 500 }}>
            <FacetStar size={14} /><b>{ratingText(p.rating.avg)}</b><span className="muted">· {reviewsWord(p.rating.count)}</span>
          </a>
        ) : p.subtitle ? <p className="muted" style={{ marginTop: 12, fontSize: 14 }}>{p.subtitle}</p> : null}
      </header>

      {p.siblings.length > 1 && (
        <div className="seg" role="tablist" aria-label="Как выдаём">
          {p.siblings.map((s) => (
            <button key={s.id} role="tab" aria-selected={s.id === p.id} className={s.id === p.id ? 'on' : ''} onClick={() => s.id !== p.id && swap(`/product/${s.id}`)}>
              {s.label}
            </button>
          ))}
        </div>
      )}

      {showOptions && <div className="opts" role="radiogroup" aria-label="Вариант" style={p.variants.length === 1 ? { gridTemplateColumns: '1fr' } : undefined}>
        {p.variants.map((x) => {
          const off = x.oldPrice && x.oldPrice > x.price ? Math.round((1 - x.price / x.oldPrice) * 100) : 0;
          return (
            <button key={x.id} role="radio" aria-checked={x.id === pick} disabled={!x.inStock}
              className={`opt ${x.id === pick ? 'on' : ''}`} onClick={() => setPick(x.id)}>
              <span className="opt-t">{x.title}</span>
              <span className="opt-p">{x.inStock ? rub(x.price) : 'нет'}</span>
              {off > 0 && <i className="opt-save" style={{ fontStyle: 'normal' }}>−{off}%</i>}
            </button>
          );
        })}
        {p.wholesale && (
          <button role="radio" aria-checked={bulk} className={`opt wide ${bulk ? 'on' : ''}`} onClick={() => setPick('bulk')}>
            <span className="wh-l"><b>Опт</b><span className="ellipsis">от 10 шт, цена в поддержке</span></span>
            {support && <span className="wh-r">@{support}<Icon name="chev" size={14} /></span>}
          </button>
        )}
      </div>}

      {v?.perUnit && !bulk && (
        <label className="field">
          <span>{isStars ? 'Сколько звёзд' : 'Сумма пополнения, ₽'} · от {v.minQty.toLocaleString('ru-RU')} до {v.maxQty.toLocaleString('ru-RU')}</span>
          <input value={qtyRaw} onChange={(e) => setQtyRaw(e.target.value.replace(/[^\d\s.,]/g, ''))}
            placeholder={isStars ? '500' : '1000'} inputMode="numeric" aria-label={isStars ? 'Количество звёзд' : 'Сумма пополнения'} />
        </label>
      )}

      {v && (
        <div className="between" style={{ alignItems: 'center', padding: '2px 4px 0' }}>
          <div>
            <div className="price-xl">{v.perUnit ? (total ? rub(total) : '—') : rub(v.price)}</div>
            {v.perUnit && <div className="muted small" style={{ marginTop: 8 }}>{perUnitText}</div>}
            {save > 0 && <div className="muted small" style={{ marginTop: 8 }}><s>{rub(v.oldPrice!)}</s> · экономия {rub(v.oldPrice! - v.price)}</div>}
          </div>
        </div>
      )}

      {bulk && (
        <div className="card pad col" style={{ gap: 8 }}>
          <div className="disp" style={{ fontSize: 17 }}>Оптом дешевле</div>
          <p className="muted" style={{ lineHeight: 1.45 }}>
            От 10 штук. Напишите товар и количество, пришлём цену.
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
      {!bulk && p.needsRecipient && p.recipientKind === 'PHONE' && (recipientOk || recipient.replace(/\D/g, '').length >= 10) && (
        // Показываем, как поняли номер: «900 123-45-67» станет +7, украинский «067…» станет +380
        <p className="small" style={{ marginTop: -8, padding: '0 4px', color: recipientOk ? 'var(--m)' : 'var(--warn)' }} aria-live="polite">
          {recipientOk ? `Номер: ${prettyPhone(normalizePhone(recipient)!)}` : 'Не похоже на номер. Укажите код страны, например +7 900 123-45-67'}
        </p>
      )}

      {/* Описание — короткие шаги по строке: нумерованный список читается быстрее абзаца */}
      {!bulk && steps.length > 0 && (
        <section className="how" aria-label="Как это работает">
          <div className="cap">Как это работает</div>
          <ol className="steps">
            {steps.map((s, i) => <li key={i}><span className="n">{i + 1}</span><span>{s}</span></li>)}
          </ol>
        </section>
      )}

      {p.reviews.length > 0 && (
        <section className="col" aria-label="Отзывы" style={{ marginTop: 4 }}>
          <div className="between" style={{ padding: '0 4px' }}>
            <span className="row" style={{ gap: 6 }}>
              <FacetStar size={18} /><span className="disp" style={{ fontSize: 16 }}>{ratingText(p.rating.avg)}</span>
              <span className="muted" style={{ fontSize: 14 }}>· {reviewsWord(p.rating.count)}</span>
            </span>
            <a href={`#/reviews?p=${p.id}`} className="row lime" style={{ gap: 2, fontSize: 14, fontWeight: 500, minHeight: 44 }}>Все отзывы<Icon name="chev" size={16} /></a>
          </div>
          {p.reviews.map((r) => <ReviewCard key={r.id} r={r} />)}
        </section>
      )}

      <div className="sticky-cta">
        {bulk ? (
          <button className="btn block" disabled={!support} onClick={() => openTelegramChat(support)}>
            Написать @{support}
          </button>
        ) : (
          <button className="btn block" disabled={!v || !recipientOk || !qtyOk}
            onClick={() => go(`/checkout?v=${v!.id}&r=${encodeURIComponent(recipient.trim())}${v!.perUnit ? `&q=${qty}` : ''}`)}>
            {!qtyOk ? (qtyFraction ? `Без точек и запятых, например ${isStars ? '500' : '1000'}` : isStars ? 'Укажите количество звёзд' : 'Укажите сумму')
              : p.needsRecipient && !recipientOk ? spec.hint
              : <span>Оформить <span className="dot">·</span> {v ? rub(total) : ''}</span>}
          </button>
        )}
      </div>
    </div>
  );
}
