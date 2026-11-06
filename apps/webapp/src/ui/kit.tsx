import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Glass } from '../api';

const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

/** Глифы товаров и интерфейса. Свои, без логотипов брендов. */
const glyphs: Record<string, ReactNode> = {
  star: <path fill="currentColor" d="M12 2.5l2.9 6 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.2 1.3-6.6L2.5 9.3l6.6-.8z" />,
  starO: <path {...P} strokeWidth={2.2} d="M12 3.5l2.6 5.3 5.9.8-4.3 4.1 1 5.8L12 16.7l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z" />,
  bolt: <path fill="currentColor" d="M13.5 2L4.5 13.5h6l-1 8.5 9-11.5h-6z" />,
  pad: <path fill="currentColor" d="M7 7h10a5 5 0 0 1 4.6 7l-1.2 2.9a2.4 2.4 0 0 1-4 .6L14.8 16H9.2l-1.6 1.5a2.4 2.4 0 0 1-4-.6L2.4 14A5 5 0 0 1 7 7zm0 3v1.3H5.7v1.4H7V14h1.4v-1.3h1.3v-1.4H8.4V10zm8.6.2a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm2 1.8a1 1 0 1 0 0 2 1 1 0 0 0 0-2z" />,
  spark: <path fill="currentColor" d="M12 2c.6 4.8 2.7 7.4 8 8.2v1.6c-5.3.8-7.4 3.4-8 8.2h-1.6c-.6-4.8-2.7-7.4-8-8.2v-1.6c5.3-.8 7.4-3.4 8-8.2z" />,
  wave: <g {...P} strokeWidth={2.4}><path d="M5 9.2c4.6-1.4 9.6-1 14 1.3" /><path d="M6 12.8c3.8-1 7.8-.7 11.4 1.1" /><path d="M7 16.2c3-.7 6-.5 8.7.8" /></g>,
  gift: <g {...P}><rect x="4" y="9" width="16" height="11" rx="2" /><path d="M12 9v11M3.5 9h17M12 9c-2-4-6-4-6-1.5S10 9 12 9zm0 0c2-4 6-4 6-1.5S14 9 12 9z" /></g>,
  grid: <g {...P} strokeWidth={1.9}><rect x="3.5" y="3.5" width="7" height="7" rx="2" /><rect x="13.5" y="3.5" width="7" height="7" rx="2" /><rect x="3.5" y="13.5" width="7" height="7" rx="2" /><rect x="13.5" y="13.5" width="7" height="7" rx="3.5" /></g>,
  list: <g {...P} strokeWidth={1.9}><rect x="4" y="3.5" width="16" height="17" rx="3" /><path d="M8 9h8M8 13h8M8 17h5" /></g>,
  user: <g {...P} strokeWidth={1.9}><circle cx="12" cy="8.5" r="4" /><path d="M4.5 20c1.3-3.6 4.2-5.3 7.5-5.3s6.2 1.7 7.5 5.3" /></g>,
  chart: <g {...P} strokeWidth={1.9}><path d="M4 20h16M7 16v-4M12 16V7M17 16v-7" /></g>,
  box: <g {...P} strokeWidth={1.9}><path d="M12 3l8 4.3v9.4L12 21l-8-4.3V7.3z" /><path d="M4 7.3l8 4.4 8-4.4M12 11.7V21" /></g>,
  gear: <g {...P} strokeWidth={1.9}><circle cx="12" cy="12" r="3" /><path d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8M18.5 18.5l-1.8-1.8M7.3 7.3L5.5 5.5" /></g>,
  search: <g {...P}><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" /></g>,
  check: <path {...P} strokeWidth={2.4} d="M5 12.5l4.5 4.5L19 7.5" />,
  copy: <g {...P} strokeWidth={1.9}><rect x="8.5" y="8.5" width="11" height="11" rx="2.5" /><path d="M15.5 5.5V5a1.5 1.5 0 0 0-1.5-1.5H6A2.5 2.5 0 0 0 3.5 6v8A1.5 1.5 0 0 0 5 15.5h.5" /></g>,
  back: <path {...P} strokeWidth={2.2} d="M14.5 5.5L8 12l6.5 6.5" />,
  chev: <path {...P} d="M9.5 6l6 6-6 6" />,
  plus: <path {...P} strokeWidth={2.4} d="M12 5v14M5 12h14" />,
  shield: <g {...P} strokeWidth={1.9}><path d="M12 3l7.5 3v5.5c0 4.5-3.2 8.2-7.5 9.5-4.3-1.3-7.5-5-7.5-9.5V6z" /><path d="M8.8 12.2l2.2 2.2 4.2-4.4" /></g>,
  clock: <g {...P} strokeWidth={1.9}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></g>,
  send: <path {...P} d="M4 12l16-8-6 16-2.5-6.5z" />,
  img: <g {...P} strokeWidth={1.9}><rect x="3.5" y="4.5" width="17" height="15" rx="3" /><circle cx="9" cy="10" r="1.8" /><path d="M20 16l-4.5-4.5L6 19.5" /></g>,
  trash: <g {...P}><path d="M5 7h14M10 11v6M14 11v6M6.5 7l1 12.5h9l1-12.5M9.5 7V4.5h5V7" /></g>,
};

export const productIcons = ['star', 'starO', 'bolt', 'pad', 'spark', 'wave', 'gift'];

const STAR = 'M12 2.5l2.9 6 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.2 1.3-6.6L2.5 9.3l6.6-.8z';

/** Звёзды рейтинга: только показ или выбор оценки (onChange) */
export function Stars({ value, size = 16, onChange, label = 'Оценка' }: { value: number; size?: number; onChange?: (v: number) => void; label?: string }) {
  const filled = Math.round(value);
  if (!onChange) {
    return (
      <span className="stars" role="img" aria-label={`Оценка ${value} из 5`}>
        {[1, 2, 3, 4, 5].map((i) => (
          <svg key={i} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={i <= filled ? 'on' : ''}><path d={STAR} /></svg>
        ))}
      </span>
    );
  }
  return (
    <div className="stars-input" role="radiogroup" aria-label={label}>
      {[1, 2, 3, 4, 5].map((i) => (
        <button key={i} type="button" role="radio" aria-checked={value === i} aria-label={`${i} из 5`} className={i <= value ? 'on' : ''} onClick={() => onChange(i)}>
          <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path d={STAR} /></svg>
        </button>
      ))}
    </div>
  );
}

export function Icon({ name, size = 22 }: { name: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">{glyphs[name] ?? glyphs.star}</svg>;
}

export function Key({ icon, glass, size = 48, style }: { icon: string; glass: Glass; size?: number; style?: React.CSSProperties }) {
  return (
    <span className={`key ${glass}`} style={{ width: size, height: size, ...style }}>
      <svg viewBox="0 0 24 24" aria-hidden="true">{glyphs[icon] ?? glyphs.star}</svg>
    </span>
  );
}

// ---------- тосты ----------
const ToastCtx = createContext<(text: string, err?: boolean) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ text: string; err: boolean } | null>(null);
  useEffect(() => {
    if (!t) return;
    const h = setTimeout(() => setT(null), 2600);
    return () => clearTimeout(h);
  }, [t]);
  const show = useCallback((text: string, err = false) => setT({ text, err }), []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {t && <div className={`toast ${t.err ? 'err' : ''}`} role="status">{t.text}</div>}
    </ToastCtx.Provider>
  );
}

/** Загрузка данных с перезапросом */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    fn().then((d) => alive && (setData(d), setError(null))).catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, reload: () => setTick((x) => x + 1), setData };
}

/** Пометка над заказом, который не удалось обновить: на экране то, что успели загрузить раньше */
export function Stale({ error }: { error: string }) {
  return (
    <div className="row" role="status" style={{ background: 'rgba(255,181,71,.1)', borderRadius: 14, padding: 12, color: 'var(--warn)', fontSize: 14, lineHeight: 1.45 }}>
      Не удалось обновить: {error}
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`tog ${on ? 'on' : ''}`} onClick={() => onChange(!on)} />;
}

export function Back({ to }: { to: string }) {
  return (
    <a href={`#${to}`} className="row" style={{ gap: 4, color: 'var(--t)', fontWeight: 500 }}>
      <Icon name="back" /> Назад
    </a>
  );
}
