'use client';

import clsx from 'clsx';
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { useEffect, useId, useMemo, type ReactNode } from 'react';

/**
 * Futuristic HUD primitives: glass panels, live tickers, dot-matrix numerals, self-drawing sparklines,
 * a daylight arc and dot-grid health. Built for the additive display (black = see-through), so every
 * effect is light on dark: thin luminous strokes and soft glows, never large bright fills.
 */
export const ACCENT = '#7aa2ff';
export const ICE = '#a8ecff';
export const WARN = '#ff9a5c';
export const CRIT = '#ff8a80';
const EASE = [0.22, 0.8, 0.24, 1] as const;

export function Glass({ children, className, tone }: { children: ReactNode; className?: string; tone?: 'warn' | 'crit' }) {
  return (
    <div className={clsx('hud-glass', tone === 'warn' && 'hud-glass-warn', tone === 'crit' && 'hud-glass-crit', className)}>
      {children}
    </div>
  );
}

/** Number that glides to each new value. */
export function Ticker({ value, decimals = 0, className }: { value: number; decimals?: number; className?: string }) {
  const reduced = useReducedMotion();
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => v.toFixed(decimals));
  useEffect(() => {
    if (reduced) { mv.set(value); return; }
    const c = animate(mv, value, { duration: 0.9, ease: EASE });
    return () => c.stop();
  }, [value, reduced, mv]);
  return <motion.span className={clsx('num', className)}>{text}</motion.span>;
}

// 5×7 dot-matrix glyphs.
const GLYPHS: Record<string, string[]> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

/** Dot-matrix numeral (reference: a weather widget's LED digits). Dots light up column by column. */
export function DotMatrix({ text, dot = 5, gap = 2, color = '#fff', label }: { text: string; dot?: number; gap?: number; color?: string; label?: string }) {
  const reduced = useReducedMotion();
  const chars = text.split('').filter((c) => GLYPHS[c]);
  const cell = dot + gap;
  const charW = 5 * cell + cell;
  const w = chars.length * charW - cell;
  const h = 7 * cell - gap;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label ?? text} className="block flex-none">
      {chars.map((c, ci) => GLYPHS[c]!.flatMap((row, y) => row.split('').map((bit, x) => (
        <motion.rect key={`${ci}-${x}-${y}`} x={ci * charW + x * cell} y={y * cell} width={dot} height={dot} rx={dot * 0.38}
          fill={color} initial={false}
          animate={{ opacity: bit === '1' ? 1 : 0.07 }}
          transition={reduced ? { duration: 0 } : { duration: 0.35, delay: (ci * 5 + x) * 0.018 }} />
      ))))}
    </svg>
  );
}

/** Resample to a fixed number of points so the path can morph smoothly as data arrives. */
function resample(values: number[], n: number): number[] {
  if (values.length === 0) return Array(n).fill(0.5);
  if (values.length === 1) return Array(n).fill(values[0]);
  return Array.from({ length: n }, (_, i) => {
    const t = (i / (n - 1)) * (values.length - 1);
    const a = Math.floor(t), b = Math.min(values.length - 1, a + 1);
    return values[a]! + (values[b]! - values[a]!) * (t - a);
  });
}

function smoothPath(pts: [number, number][]): string {
  if (!pts.length) return '';
  let d = `M${pts[0]![0].toFixed(1)},${pts[0]![1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]!, [x1, y1] = pts[i]!;
    const mx = (x0 + x1) / 2;
    d += ` C${mx.toFixed(1)},${y0.toFixed(1)} ${mx.toFixed(1)},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  return d;
}

/** Self-drawing sparkline with a glowing head that follows the newest value. */
export function Sparkline({ values, width = 120, height = 30, color = ICE, range }: { values: number[]; width?: number; height?: number; color?: string; range?: [number, number] | null }) {
  const reduced = useReducedMotion();
  const id = useId().replace(/:/g, '');
  const { line, area, head } = useMemo(() => {
    const v = resample(values, 18);
    const lo = Math.min(...v, range?.[0] ?? Infinity), hi = Math.max(...v, range?.[1] ?? -Infinity);
    const span = hi - lo || 1;
    const pad = 4;
    const pts = v.map((y, i) => [pad + (i / (v.length - 1)) * (width - pad * 2), pad + (1 - (y - lo) / span) * (height - pad * 2)] as [number, number]);
    const line = smoothPath(pts);
    return { line, area: `${line} L${width - pad},${height} L${pad},${height} Z`, head: pts[pts.length - 1]! };
  }, [values, width, height, range]);
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} aria-hidden className="block h-auto overflow-visible">
      <defs>
        <linearGradient id={`sf${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity="0.28" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient>
        <linearGradient id={`sl${id}`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor={color} stopOpacity="0.15" /><stop offset="1" stopColor={color} /></linearGradient>
      </defs>
      <motion.path d={area} fill={`url(#sf${id})`} initial={false} animate={{ d: area }} transition={{ duration: reduced ? 0 : 0.8, ease: EASE }} />
      <motion.path d={line} fill="none" stroke={`url(#sl${id})`} strokeWidth={2} strokeLinecap="round"
        initial={reduced ? false : { pathLength: 0 }} animate={{ pathLength: 1, d: line }} transition={{ pathLength: { duration: 1.2, ease: EASE }, d: { duration: reduced ? 0 : 0.8, ease: EASE } }} />
      <motion.circle r={3.2} fill={color} initial={false} animate={{ cx: head[0], cy: head[1] }} transition={{ duration: reduced ? 0 : 0.8, ease: EASE }} />
      {!reduced && <motion.circle r={3.2} fill="none" stroke={color} initial={false} animate={{ cx: head[0], cy: head[1], r: [3, 10], opacity: [0.7, 0] }}
        transition={{ cx: { duration: 0.8 }, cy: { duration: 0.8 }, r: { duration: 1.6, repeat: Infinity }, opacity: { duration: 1.6, repeat: Infinity } }} />}
    </svg>
  );
}

/** Daylight arc: a bell curve over a dotted horizon with sunrise/sunset ticks and the sun's position now. */
export function SunArc({ sunrise, sunset, now, width = 220, height = 64 }: { sunrise: Date; sunset: Date; now: Date; width?: number; height?: number }) {
  const reduced = useReducedMotion();
  const id = useId().replace(/:/g, '');
  const horizon = height * 0.68;
  const x0 = width * 0.2, x1 = width * 0.8; // sunrise / sunset on the horizon
  // Curve spans the whole day (midnight → midnight) so the night dips below the horizon.
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const toX = (d: Date) => ((d.getTime() - dayStart.getTime()) / 86_400_000) * width;
  const rx = toX(sunrise), sx = toX(sunset);
  const xr = Number.isFinite(rx) && rx > 0 && sx > rx ? rx : x0, xs = Number.isFinite(sx) && sx > xr ? sx : x1;
  const mid = (xr + xs) / 2, sigma = (xs - xr) / 2.4;
  const peak = height * 0.08, trough = height * 0.98;
  const yAt = (x: number) => { const g = Math.exp(-((x - mid) ** 2) / (2 * sigma * sigma)); return trough - (trough - peak) * g; };
  const pts = Array.from({ length: 49 }, (_, i) => { const x = (i / 48) * width; return [x, yAt(x)] as [number, number]; });
  const path = smoothPath(pts);
  const nx = Math.max(0, Math.min(width, toX(now)));
  const ny = yAt(nx);
  const up = ny < horizon;
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} aria-hidden className="block h-auto overflow-visible">
      <defs>
        <linearGradient id={`sa${id}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0.15" /><stop offset="0.5" stopColor={ICE} /><stop offset="1" stopColor="#fff" stopOpacity="0.15" />
        </linearGradient>
        <clipPath id={`up${id}`}><rect x="0" y="0" width={width} height={horizon} /></clipPath>
      </defs>
      <line x1="0" x2={width} y1={horizon} y2={horizon} stroke="#fff" strokeOpacity="0.28" strokeDasharray="1.5 5" strokeLinecap="round" />
      <path d={path} fill="none" stroke="#fff" strokeOpacity="0.22" strokeWidth={1.5} />
      <motion.path d={path} fill="none" stroke={`url(#sa${id})`} strokeWidth={2.2} clipPath={`url(#up${id})`} strokeLinecap="round"
        initial={reduced ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.6, ease: EASE }} />
      {[xr, xs].map((x) => <circle key={x} cx={x} cy={horizon} r={3} fill="#fff" />)}
      <motion.g initial={reduced ? false : { x: xr, y: horizon, opacity: 0 }} animate={{ x: nx, y: ny, opacity: 1 }} transition={{ duration: reduced ? 0 : 1.6, ease: EASE }}>
        <line x1={0} x2={0} y1={0} y2={horizon - ny} stroke="#fff" strokeOpacity="0.5" strokeDasharray="1.5 3" />
        <circle r={11} fill={up ? ICE : '#fff'} fillOpacity={0.14} />
        {!reduced && <motion.circle r={11} fill="none" stroke={up ? ICE : '#fff'} strokeOpacity={0.6} animate={{ r: [8, 16], opacity: [0.8, 0] }} transition={{ duration: 2.4, repeat: Infinity }} />}
        <circle r={4.5} fill={up ? '#fff' : '#9aa4b8'} />
      </motion.g>
    </svg>
  );
}

/** Progress ring with an animated sweep. */
export function Ring({ value, size = 44, stroke = 4, color = ACCENT, children }: { value: number; size?: number; stroke?: number; color?: string; children?: ReactNode }) {
  const reduced = useReducedMotion();
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return (
    <span className="relative inline-grid flex-none place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#fff" strokeOpacity="0.12" strokeWidth={stroke} />
        <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c}
          initial={reduced ? false : { strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - Math.max(0, Math.min(1, value))) }} transition={{ duration: 1.1, ease: EASE }} />
      </svg>
      <span className="relative">{children}</span>
    </span>
  );
}

/** One dot per item: solid = healthy, coloured = attention, hollow = no data. */
export function DotGrid({ items, cols = 8, size = 7, gap = 6 }: { items: ('ok' | 'warn' | 'crit' | 'off')[]; cols?: number; size?: number; gap?: number }) {
  const reduced = useReducedMotion();
  return (
    <span className="inline-grid flex-none" style={{ gridTemplateColumns: `repeat(${Math.min(cols, Math.max(1, items.length))}, ${size}px)`, gap }} aria-hidden>
      {items.map((s, i) => (
        <motion.span key={i} className="block rounded-full" style={{ width: size, height: size, background: s === 'off' ? 'transparent' : s === 'ok' ? '#fff' : s === 'warn' ? WARN : CRIT, boxShadow: s === 'off' ? 'inset 0 0 0 1.2px rgb(255 255 255 / 0.4)' : s === 'ok' ? 'none' : `0 0 8px ${s === 'warn' ? WARN : CRIT}` }}
          initial={reduced ? false : { scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: i * 0.03, type: 'spring', stiffness: 380, damping: 22 }} />
      ))}
    </span>
  );
}

/** Screen-to-screen transition: a soft rise out of blur. */
export function ScreenFx({ children, id }: { children: ReactNode; id: string }) {
  const reduced = useReducedMotion();
  return (
    <motion.div key={id} className="h-full" initial={reduced ? false : { opacity: 0, y: 14, filter: 'blur(8px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} transition={{ duration: 0.38, ease: EASE }}>
      {children}
    </motion.div>
  );
}

/** Staggered entrance for a group of tiles. */
export const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.05, delayChildren: 0.05 } } };
export const rise = { hidden: { opacity: 0, y: 12, scale: 0.98 }, show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.45, ease: EASE } } };

/** HUD frame: corner brackets that draw in once, marking the display's safe area. */
export function HudFrame() {
  const reduced = useReducedMotion();
  const c = 'M2,20 L2,2 L20,2';
  const corners = [{ l: 10, t: 10, r: 0 }, { l: 'auto', t: 10, r: 90 }, { l: 'auto', t: 'auto', r: 180 }, { l: 10, t: 'auto', r: 270 }] as const;
  return (
    <div className="pointer-events-none absolute inset-0 z-0" aria-hidden>
      {corners.map((k, i) => (
        <svg key={i} width="22" height="22" className="absolute" style={{ left: k.l === 'auto' ? undefined : k.l, right: k.l === 'auto' ? 10 : undefined, top: k.t === 'auto' ? undefined : k.t, bottom: k.t === 'auto' ? 10 : undefined, transform: `rotate(${k.r}deg)` }}>
          <motion.path d={c} fill="none" stroke="#fff" strokeOpacity="0.35" strokeWidth="1.5" initial={reduced ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, delay: 0.1 * i, ease: EASE }} />
        </svg>
      ))}
    </div>
  );
}

/** Phone only (an opaque screen, not an additive lens): slow aurora light behind the glass. */
export function Aurora() {
  const reduced = useReducedMotion();
  const blob = (c: string, x: string[], y: string[], d: number) => (
    <motion.span className="absolute h-[70%] w-[90%] rounded-full blur-[90px]" style={{ background: c }}
      animate={reduced ? undefined : { x, y }} transition={{ duration: d, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' }} />
  );
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-70" aria-hidden>
      {blob('radial-gradient(circle, rgba(25,84,241,0.55), transparent 65%)', ['-30%', '10%'], ['-20%', '5%'], 18)}
      {blob('radial-gradient(circle, rgba(80,200,255,0.30), transparent 65%)', ['40%', '0%'], ['60%', '35%'], 22)}
      {blob('radial-gradient(circle, rgba(120,90,255,0.22), transparent 65%)', ['10%', '45%'], ['90%', '60%'], 26)}
    </div>
  );
}
