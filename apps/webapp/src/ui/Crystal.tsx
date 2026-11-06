import { useId } from 'react';
import { BIAS, CUTS, GLYPHS, INK, KERNEL, RAMPS, type Cut, type GlyphName, type Tint } from './crystal-data';

/**
 * Стиль «Кристалл»: гранёный кварц со светящимся ядром и гравировкой глифа на передней грани.
 * Только полигоны и градиенты, без фильтров и растров: дёшево для WebView Telegram.
 */

const f2 = (v: number) => Math.round(v * 100) / 100;

/** Звезда из n лучей (R внешний, r внутренний радиус): искры и вспышки */
export function starPoints(cx: number, cy: number, R: number, r: number, n = 4) {
  return Array.from({ length: n * 2 }, (_, i) => {
    const a = ((-90 + (i * 180) / n) * Math.PI) / 180;
    const rr = i % 2 ? r : R;
    return `${f2(cx + rr * Math.cos(a))},${f2(cy + rr * Math.sin(a))}`;
  }).join(' ');
}

export interface CrystalProps {
  cut?: Cut; tint?: Tint; glyph?: GlyphName | null; x?: number; y?: number; scale?: number; glyphSize?: number;
  sparkle?: boolean; ground?: boolean; aura?: number; kernelO?: number; groundO?: number;
}

/** Один кристалл внутри чужого <svg>: x, y — центр, scale — масштаб */
export function Crystal({
  cut = 'point', tint = 'lime', glyph = null, x = 100, y = 100, scale = 1.25,
  glyphSize = 30, sparkle = true, ground = true, aura = 0, kernelO = 0.9, groundO = 0.5,
}: CrystalProps) {
  const id = 'k' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const C = CUTS[cut];
  const R = RAMPS[tint];
  const K = KERNEL[tint];
  const idx = (f: (typeof C.facets)[number]) => {
    const i = Math.min(7, Math.max(0, f.step + BIAS[tint]));
    return f.front ? Math.max(i, 3) : i;
  };
  const gs = glyphSize / 24;
  const { c, A, B } = C.glyph;
  const m = [A[0] * gs, A[1] * gs, B[0] * gs, B[1] * gs, c[0] - 12 * (A[0] + B[0]) * gs, c[1] - 12 * (A[1] + B[1]) * gs].map(f2);
  const [bx0, by0, bx1, by1] = C.bbox;
  const gy = C.bottom[1] + 2;
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} aria-hidden="true">
      <defs>
        <clipPath id={`${id}c`}>{C.facets.map((f, i) => <polygon key={i} points={f.pts} />)}</clipPath>
        {C.facets.map((f, i) => (
          <linearGradient key={i} id={`${id}f${i}`} gradientUnits="userSpaceOnUse" x1={f.g[0]} y1={f.g[1]} x2={f.g[2]} y2={f.g[3]}>
            <stop offset="0" stopColor={R[Math.max(0, idx(f) - (f.kind === 'term' ? 1 : 0))]} />
            <stop offset="1" stopColor={R[Math.min(7, idx(f) + 2)]} />
          </linearGradient>
        ))}
        <radialGradient id={`${id}k`} gradientUnits="userSpaceOnUse" cx={C.kernel[0]} cy={C.kernel[1]} r={C.H * 0.36}>
          <stop offset="0" stopColor={K} stopOpacity={kernelO} />
          <stop offset=".3" stopColor={K} stopOpacity={kernelO * 0.45} />
          <stop offset="1" stopColor={K} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}g`} gradientUnits="userSpaceOnUse" cx={C.kernel[0]} cy={gy} r="58"
          gradientTransform={`translate(0 ${gy}) scale(1 .26) translate(0 ${-gy})`}>
          <stop offset="0" stopColor={K} stopOpacity={groundO} />
          <stop offset=".35" stopColor={R[3]} stopOpacity={groundO * 0.3} />
          <stop offset="1" stopColor={R[4]} stopOpacity="0" />
        </radialGradient>
        {aura > 0 && (
          <radialGradient id={`${id}a`} gradientUnits="userSpaceOnUse" cx={C.kernel[0]} cy={C.kernel[1]} r={C.H * 0.75}>
            <stop offset="0" stopColor={K} stopOpacity={aura} />
            <stop offset="1" stopColor={K} stopOpacity="0" />
          </radialGradient>
        )}
        {sparkle && (
          <radialGradient id={`${id}s`}>
            <stop offset="0" stopColor="#fff" stopOpacity=".9" />
            <stop offset=".25" stopColor={K} stopOpacity=".35" />
            <stop offset="1" stopColor={K} stopOpacity="0" />
          </radialGradient>
        )}
      </defs>
      {aura > 0 && <circle cx={C.kernel[0]} cy={C.kernel[1]} r={C.H * 0.75} fill={`url(#${id}a)`} />}
      {ground && <ellipse cx={C.kernel[0]} cy={gy} rx="58" ry="15" fill={`url(#${id}g)`} />}
      {C.facets.map((f, i) => <polygon key={i} points={f.pts} fill={`url(#${id}f${i})`} />)}
      <g clipPath={`url(#${id}c)`}>
        {C.back.map((l, i) => <line key={i} x1={l[0]} y1={l[1]} x2={l[2]} y2={l[3]} stroke={R[1]} strokeOpacity=".14" strokeWidth=".7" />)}
        <polygon points={C.streak[0]} fill="#fff" fillOpacity=".10" />
        <polygon points={C.streak[1]} fill="#fff" fillOpacity=".07" />
        <rect className="kernel" x={bx0} y={by0} width={bx1 - bx0} height={by1 - by0} fill={`url(#${id}k)`} />
      </g>
      <g fill="none" strokeLinejoin="round">
        {C.facets.map((f, i) => <polygon key={i} points={f.pts} stroke={R[0]} strokeOpacity={idx(f) <= 2 ? 0.7 : 0.22} strokeWidth=".6" />)}
      </g>
      {glyph && (
        <g transform={`matrix(${m.join(' ')})`}>
          <path d={GLYPHS[glyph]} fill="none" stroke={K} strokeOpacity=".28" strokeWidth="2.6" strokeLinejoin="round" />
          <path d={GLYPHS[glyph]} fill={R[7]} fillOpacity=".7" fillRule="evenodd" transform="translate(-.6 -.6)" />
          <path d={GLYPHS[glyph]} fill={INK[tint]} fillRule="evenodd" />
        </g>
      )}
      {sparkle && (
        <g transform={`translate(${C.apex[0]} ${C.apex[1]})`}>
          <circle r="10" fill={`url(#${id}s)`} />
          <polygon points={starPoints(0, 0, 8, 0.7)} fill="#fff" />
        </g>
      )}
    </g>
  );
}

/** Обложка товара: один кристалл в квадрате size×size */
export function CrystalCover({ size = 100, ...p }: { size?: number } & CrystalProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden="true" style={{ display: 'block', overflow: 'visible' }}>
      <Crystal x={100} y={100} scale={1.25} {...p} />
    </svg>
  );
}

/** Иконки товаров из админки → глиф кристалла; «стекло» товара → тинт */
const GLYPH_OF: Record<string, GlyphName> = { star: 'premium', starO: 'stars', spark: 'ai', pad: 'steam', bolt: 'nitro', gift: 'gift', wave: 'wave' };
const TINT_OF: Record<string, Tint> = { RED: 'lime', WHITE: 'ice', DARK: 'graphite' };
export const glyphOf = (icon: string): GlyphName => GLYPH_OF[icon] ?? 'premium';
export const tintOf = (glass: string): Tint => TINT_OF[glass] ?? 'lime';

/** Спектральная лента: свет выходит из кристалла и расходится влево четырьмя волосяными линиями */
export function Ribbon({ from, ys, toX = -12 }: { from: [number, number]; ys: number[]; toX?: number }) {
  const id = 'r' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const colors = ['#FFC978', '#E2FF8C', '#C6F94E', '#9BE7FF'];
  const widths = [0.9, 1, 1.2, 0.9];
  return (
    <g aria-hidden="true">
      <defs>
        {ys.map((y, i) => (
          <linearGradient key={i} id={`${id}${i}`} gradientUnits="userSpaceOnUse" x1={from[0]} y1={from[1]} x2={toX} y2={y}>
            <stop offset="0" stopColor="#fff" stopOpacity=".95" />
            <stop offset=".06" stopColor={colors[i % 4]} stopOpacity=".95" />
            <stop offset=".5" stopColor={colors[i % 4]} stopOpacity=".48" />
            <stop offset="1" stopColor={colors[i % 4]} stopOpacity="0" />
          </linearGradient>
        ))}
        <radialGradient id={`${id}fl`}>
          <stop offset="0" stopColor="#fff" stopOpacity=".95" />
          <stop offset=".3" stopColor="#E2FF8C" stopOpacity=".4" />
          <stop offset="1" stopColor="#C6F94E" stopOpacity="0" />
        </radialGradient>
      </defs>
      {ys.map((y, i) => <line key={i} x1={from[0]} y1={from[1]} x2={toX} y2={y} stroke={`url(#${id}${i})`} strokeWidth={widths[i % 4]} strokeLinecap="round" />)}
      <circle cx={from[0]} cy={from[1]} r="9" fill={`url(#${id}fl)`} />
      <polygon points={starPoints(from[0], from[1], 7, 0.6)} fill="#fff" />
    </g>
  );
}

/**
 * Друза героя: дымчатый сосед, главный лаймовый кристалл и ледяной осколок, плюс спектральная лента под заголовком.
 * Рисуется в правой части экрана шириной 390 и прижимается к правому краю: на широких экранах не разъезжается.
 */
const DRUSE = {
  catalog: { h: 300, glyph: 'k', main: { x: 318, y: 144, scale: 1.2, glyphSize: 26, aura: 0.1, groundO: 0.55 }, shard: { x: 372, y: 156, scale: 0.8, kernelO: 0.7 }, stub: { x: 352, y: 228, scale: 0.5 }, ribbon: { from: [276, 160], ys: [154, 159, 164.5, 170] } },
  product: { h: 240, glyph: 'premium', main: { x: 312, y: 102, scale: 1.08, glyphSize: 30, aura: 0.12 }, shard: { x: 374, y: 110, scale: 0.72 }, stub: { x: 352, y: 166, scale: 0.44 }, ribbon: { from: [272, 160], ys: [158, 162.5, 167.5, 172.5] } },
  review: { h: 260, glyph: 'check', main: { x: 308, y: 118, scale: 1.16, glyphSize: 28, aura: 0.14 }, shard: { x: 372, y: 120, scale: 0.78 }, stub: { x: 350, y: 192, scale: 0.48 }, ribbon: { from: [270, 186], ys: [186, 190.5, 195.5, 200.5] } },
} as const;

export function Druse({ kind, glyph, tint = 'lime', top = 0 }: { kind: keyof typeof DRUSE; glyph?: GlyphName; tint?: Tint; top?: number }) {
  const d = DRUSE[kind];
  return (
    <svg className="druse" width="390" height={d.h} viewBox={`0 0 390 ${d.h}`} style={{ top }} aria-hidden="true">
      <Crystal cut="shard" tint="graphite" sparkle={false} ground={false} {...d.shard} />
      <Crystal cut="tower" tint={tint} glyph={glyph ?? d.glyph} {...d.main} />
      <Crystal cut="stub" tint="ice" sparkle={false} ground={false} {...d.stub} />
      <Ribbon from={[d.ribbon.from[0], d.ribbon.from[1]]} ys={[...d.ribbon.ys]} />
    </svg>
  );
}

/** Монограмма K из трёх осколков */
function shard(a: [number, number], b: [number, number], hw: number, light: string, dark: string, edge: string, key: string) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
  const px = (-dy / L) * hw, py = (dx / L) * hw;
  const mid = [a[0] + dx * 0.5, a[1] + dy * 0.5];
  const s1 = [mid[0] + px, mid[1] + py], s2 = [mid[0] - px, mid[1] - py];
  const P = (pts: number[][]) => pts.map((p) => `${f2(p[0])},${f2(p[1])}`).join(' ');
  return (
    <g key={key}>
      <polygon points={P([a, s2, b])} fill={light} />
      <polygon points={P([a, b, s1])} fill={dark} />
      <polygon points={P([a, s2, b, s1])} fill="none" stroke={edge} strokeWidth=".6" strokeLinejoin="round" strokeOpacity=".9" />
    </g>
  );
}

export function Monogram({ size = 30 }: { size?: number }) {
  const R = RAMPS.lime;
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <polygon points="5.2,6.2 9.4,2.6 9.4,37.4 5.2,33.8" fill={R[1]} />
      <polygon points="9.4,2.6 13.4,6.2 13.4,33.8 9.4,37.4" fill={R[3]} />
      <polygon points="5.2,6.2 9.4,2.6 13.4,6.2 13.4,33.8 9.4,37.4 5.2,33.8" fill="none" stroke={R[0]} strokeWidth=".6" strokeLinejoin="round" />
      {shard([16.2, 19.2], [35.4, 3.4], 3.6, R[0], R[2], R[0], 'u')}
      {shard([16.2, 21.0], [35.4, 37.0], 3.6, R[2], R[5], R[1], 'd')}
    </svg>
  );
}

export function Brand() {
  return (
    <span className="brand">
      <Monogram size={30} />
      <span className="wordmark">Krynel</span>
    </span>
  );
}

/** Гранёная звезда оценки: 10 треугольников, свет сверху слева */
export function FacetStar({ size = 16, on = true, glow = false }: { size?: number; on?: boolean; glow?: boolean }) {
  const id = 's' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const R = on ? RAMPS.lime : RAMPS.graphite;
  const cx = 50, cy = 52, Ro = 46, Ri = 19.5;
  const outer: number[][] = [], inner: number[][] = [];
  for (let i = 0; i < 5; i++) {
    const a = ((-90 + i * 72) * Math.PI) / 180, b = ((-90 + i * 72 + 36) * Math.PI) / 180;
    outer.push([cx + Ro * Math.cos(a), cy + Ro * Math.sin(a)]);
    inner.push([cx + Ri * Math.cos(b), cy + Ri * Math.sin(b)]);
  }
  const L = (-128 * Math.PI) / 180;
  const tris: { pts: string; fill: string }[] = [];
  for (let i = 0; i < 5; i++) {
    const O = outer[i], prev = inner[(i + 4) % 5], next = inner[i];
    [[prev, O], [O, next]].forEach(([p, q], h) => {
      const ang = Math.atan2((p[1] + q[1]) / 2 - cy, (p[0] + q[0]) / 2 - cx);
      const b = Math.min(1, Math.max(0, 0.5 + 0.5 * Math.cos(ang - L) + (h === 0 ? 0.06 : -0.06)));
      const step = Math.max(0, Math.min(7, Math.round((1 - b) * 5.6) + (on ? 0 : 1)));
      tris.push({ pts: [[cx, cy], p, q].map((v) => `${f2(v[0])},${f2(v[1])}`).join(' '), fill: R[step] });
    });
  }
  const outline = outer.flatMap((o, i) => [o, inner[i]]).map((v) => `${f2(v[0])},${f2(v[1])}`).join(' ');
  return (
    <svg width={size} height={size} viewBox={glow ? '-6 -6 112 112' : '0 0 100 100'} aria-hidden="true" style={{ display: 'block', flex: 'none' }}>
      {on && glow && (
        <>
          <defs>
            <radialGradient id={`${id}g`}>
              <stop offset="0" stopColor={RAMPS.lime[2]} stopOpacity=".55" />
              <stop offset="1" stopColor={RAMPS.lime[2]} stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="50" cy="54" r="50" fill={`url(#${id}g)`} />
        </>
      )}
      {tris.map((t, i) => <polygon key={i} points={t.pts} fill={t.fill} />)}
      <polygon points={outline} fill="none" stroke={on ? R[0] : '#6B707A'} strokeOpacity={on ? 0.85 : 0.55} strokeWidth={on ? 1.4 : 1.6} strokeLinejoin="round" />
      {outer.map((o, i) => <line key={i} x1={cx} y1={cy} x2={f2(o[0])} y2={f2(o[1])} stroke={R[0]} strokeOpacity={on ? 0.35 : 0.18} strokeWidth=".9" />)}
    </svg>
  );
}
