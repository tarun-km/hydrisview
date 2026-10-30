'use client';

import { useId, useMemo, useRef } from 'react';
import { motion, useReducedMotion, useTransform } from 'motion/react';
import { useClock } from './motion';

const spring = { type: 'spring', stiffness: 120, damping: 20 } as const;

/** Smooth path through points (Catmull–Rom → cubic Bézier). Fixed command count so Motion can morph between datasets. */
function smooth(pts: [number, number][]): string {
  if (!pts.length) return '';
  let d = `M${pts[0][0].toFixed(2)},${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(2)},${c1[1].toFixed(2)} ${c2[0].toFixed(2)},${c2[1].toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
  }
  return d;
}

function resample(values: number[], n: number): number[] {
  if (!values.length) return Array(n).fill(0);
  if (values.length === 1) return Array(n).fill(values[0]);
  return Array.from({ length: n }, (_, i) => {
    const x = (i / (n - 1)) * (values.length - 1);
    const a = Math.floor(x), b = Math.min(values.length - 1, a + 1);
    return values[a] + (values[b] - values[a]) * (x - a);
  });
}

/**
 * Sun arc (reference: weather tile). A day-long curve that crosses a dashed horizon at sunrise and sunset;
 * the daylight part is lit, the sun glides along it to "now" with a dotted plumb line to the horizon.
 * Hours are local fractional hours (0–24).
 */
export function SunArc({ now, rise, set, className }: { now: number; rise: number; set: number; className?: string }) {
  const id = useId().replace(/:/g, '');
  const W = 320, H = 116, base = 74, amp = 54;
  const noon = (rise + set) / 2;
  const h = (t: number) => Math.cos((2 * Math.PI * (t - noon)) / 24) - Math.cos((2 * Math.PI * (rise - noon)) / 24);
  const peak = h(noon);
  const y = (t: number) => base - (h(t) / (peak || 1)) * amp * 0.82;
  const xs = (t: number) => (t / 24) * W;
  const pts = Array.from({ length: 97 }, (_, i) => [xs(i / 4), y(i / 4)] as [number, number]);
  const d = smooth(pts);
  const sx = xs(now), sy = y(now);
  const day = now > rise && now < set;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className} role="img" aria-label={`Sun ${day ? 'above' : 'below'} the horizon`}>
      <defs>
        <linearGradient id={`${id}-g`} x1="0" x2="1">
          <stop offset="0" stopColor="var(--g-curve)" stopOpacity="0.2" />
          <stop offset="0.5" stopColor="#ffd27a" />
          <stop offset="1" stopColor="var(--g-curve)" stopOpacity="0.2" />
        </linearGradient>
        <clipPath id={`${id}-sky`}><rect x="0" y="0" width={W} height={base} /></clipPath>
        <radialGradient id={`${id}-sun`}><stop offset="0" stopColor="#ffe3a3" stopOpacity="0.9" /><stop offset="1" stopColor="#ffd27a" stopOpacity="0" /></radialGradient>
      </defs>
      <line x1="0" x2={W} y1={base} y2={base} stroke="var(--g-ink-dim)" strokeDasharray="2 5" />
      <path d={d} fill="none" stroke="var(--g-ink-dim)" strokeWidth="1.5" />
      <motion.path d={d} fill="none" stroke={`url(#${id}-g)`} strokeWidth="2.2" clipPath={`url(#${id}-sky)`} strokeLinecap="round"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.6, ease: [0.22, 1, 0.36, 1] }} />
      {[rise, set].map((t) => <circle key={t} cx={xs(t)} cy={base} r="3.4" fill="var(--color-text)" />)}
      <motion.g initial={{ x: xs(rise), y: base, opacity: 0 }} animate={{ x: sx, y: sy, opacity: 1 }} transition={{ ...spring, delay: 0.5 }}>
        <line x1="0" x2="0" y1="0" y2={base - sy} stroke="var(--color-text)" strokeOpacity="0.55" strokeDasharray="1.5 3.5" />
        <circle r="16" fill={`url(#${id}-sun)`} opacity={day ? 1 : 0.35} />
        <circle r="5.5" fill={day ? '#fff6dc' : 'var(--color-muted)'} stroke="rgb(0 0 0 / 0.25)" />
      </motion.g>
    </svg>
  );
}

/**
 * Live wave: smooth area sparkline that morphs when data changes, with a typical-range band, a pulsing "now" head and a
 * scanner bead that keeps travelling the curve so the tile always reads as live.
 */
export function LiveWave({ values, band, className, height = 120, color = 'var(--g-curve)' }: { values: number[]; band?: [number, number] | null; className?: string; height?: number; color?: string }) {
  const id = useId().replace(/:/g, '');
  const reduced = useReducedMotion();
  const W = 400, H = height, N = 40;
  const series = useMemo(() => resample(values, N), [values]);
  // Scale to the data (the band would flatten small live swings); the band is clamped into view behind the curve.
  const dMin = Math.min(...series), dMax = Math.max(...series);
  const pad = Math.max((dMax - dMin) * 0.35, Math.abs(dMax) * 0.004, 1e-3);
  const lo = dMin - pad, hi = dMax + pad;
  const span = hi - lo;
  const yOf = (v: number) => H - 10 - ((v - lo) / span) * (H - 24);
  const clampY = (y: number) => Math.max(0, Math.min(H, y));
  const pts = series.map((v, i) => [(i / (N - 1)) * W, yOf(v)] as [number, number]);
  const line = smooth(pts);
  const area = `${line} L${W},${H} L0,${H} Z`;
  const ptsRef = useRef(pts);
  ptsRef.current = pts;
  const clock = useClock(!reduced);
  const phase = (t: number) => (((t / 7) % 1) + 1) % 1;
  const bx = useTransform(clock, (t) => phase(t) * W);
  const by = useTransform(clock, (t) => {
    const x = phase(t) * (N - 1);
    const a = Math.floor(x), b = Math.min(N - 1, a + 1);
    const p = ptsRef.current;
    return p[a][1] + (p[b][1] - p[a][1]) * (x - a);
  });
  const head = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={className} aria-hidden>
      <defs>
        <linearGradient id={`${id}-a`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={color} stopOpacity="0.32" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient>
        <linearGradient id={`${id}-l`} x1="0" x2="1"><stop offset="0" stopColor={color} stopOpacity="0.15" /><stop offset="0.7" stopColor={color} /><stop offset="1" stopColor="var(--g-head)" /></linearGradient>
      </defs>
      {band && clampY(yOf(band[0])) > clampY(yOf(band[1])) && <rect x="0" width={W} y={clampY(yOf(band[1]))} height={clampY(yOf(band[0])) - clampY(yOf(band[1]))} fill={color} opacity="0.06" />}
      {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="var(--g-ink-faint)" strokeDasharray="2 6" vectorEffect="non-scaling-stroke" />)}
      <motion.path initial={false} animate={{ d: area }} transition={spring} fill={`url(#${id}-a)`} />
      <motion.path initial={false} animate={{ d: line }} transition={spring} fill="none" stroke={`url(#${id}-l)`} strokeWidth="2.2" vectorEffect="non-scaling-stroke" strokeLinecap="round" />
      {!reduced && <motion.circle cx={bx} cy={by} r="3" fill={color} style={{ filter: `drop-shadow(0 0 6px ${color})` }} />}
      <motion.circle initial={false} animate={{ cx: head[0] - 4, cy: head[1] }} transition={spring} r="4.5" fill="var(--g-head)" stroke={color} strokeWidth="1.5" />
      {!reduced && <motion.circle initial={false} animate={{ cx: head[0] - 4, cy: head[1], r: [5, 16], opacity: [0.6, 0] }}
        transition={{ r: { duration: 1.8, repeat: Infinity }, opacity: { duration: 1.8, repeat: Infinity }, cx: spring, cy: spring }} fill="none" stroke={color} strokeWidth="1.5" />}
    </svg>
  );
}

/** Bar ticks (reference: payment history): bars rise on a hairline baseline; values re-flow with a spring. */
export function BarTicks({ values, colors, className, labels }: { values: number[]; colors?: string[]; className?: string; labels?: string[] }) {
  const W = 120, H = 44, max = Math.max(1, ...values), n = values.length, bw = 5, step = W / n;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className={className} role="img" aria-label={labels ? values.map((v, i) => `${labels[i]} ${v}`).join(', ') : undefined}>
      <line x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} stroke="var(--g-ink-dim)" />
      {values.map((v, i) => {
        const h = v ? Math.max(4, (v / max) * (H - 6)) : 2;
        return <motion.rect key={i} x={i * step + step / 2 - bw / 2} width={bw} rx={1.5} fill={colors?.[i] ?? 'currentColor'} opacity={v ? 1 : 0.3}
          initial={{ height: 0, y: H }} animate={{ height: h, y: H - h }} transition={{ ...spring, delay: 0.25 + i * 0.06 }} />;
      })}
    </svg>
  );
}

/** Dot grid (reference: hard inquiries): `filled` lit dots out of `total`, the lit ones breathe in sequence. */
export function DotGrid({ total, filled, cols = 8, className, color = 'currentColor' }: { total: number; filled: number; cols?: number; className?: string; color?: string }) {
  const reduced = useReducedMotion();
  const n = Math.max(total, 1), rows = Math.ceil(n / cols), p = 13;
  return (
    <svg viewBox={`0 0 ${cols * p} ${rows * p}`} width={cols * p} height={rows * p} className={className} aria-hidden>
      {Array.from({ length: n }, (_, i) => {
        const cx = (i % cols) * p + p / 2, cy = Math.floor(i / cols) * p + p / 2;
        const on = i < filled;
        return on ? (
          <motion.circle key={i} cx={cx} cy={cy} r="4" fill={color} initial={{ scale: 0 }} style={{ transformOrigin: `${cx}px ${cy}px` }}
            animate={reduced ? { scale: 1 } : { scale: [1, 1.25, 1], opacity: [1, 0.75, 1] }}
            transition={reduced ? spring : { duration: 2.4, repeat: Infinity, delay: i * 0.18, ease: 'easeInOut' }} />
        ) : <circle key={i} cx={cx} cy={cy} r="3.4" fill="none" stroke="var(--g-ink-dim)" strokeWidth="1.2" />;
      })}
    </svg>
  );
}

/** Arches (reference: total accounts): one arch per item, drawn in turn; dashes mark empty slots. */
export function Bumps({ count, slots = 6, className }: { count: number; slots?: number; className?: string }) {
  const W = 140, H = 40, s = W / slots;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className={className} aria-hidden>
      {Array.from({ length: slots }, (_, i) => {
        const x0 = i * s + 3, x1 = (i + 1) * s - 3;
        return i < count ? (
          <motion.path key={i} d={`M${x0},${H - 2} C${x0},${6} ${x1},${6} ${x1},${H - 2}`} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.7, delay: 0.3 + i * 0.12, ease: 'easeOut' }} />
        ) : <line key={i} x1={x0 + 4} x2={x1 - 4} y1={H - 3} y2={H - 3} stroke="var(--g-ink-dim)" strokeWidth="2.4" strokeLinecap="round" />;
      })}
    </svg>
  );
}

/** Progress ring with a sweeping highlight. */
export function Ring({ value, size = 64, thickness = 6, className, color = 'var(--g-curve)' }: { value: number | null; size?: number; thickness?: number; className?: string; color?: string }) {
  const reduced = useReducedMotion();
  const r = (size - thickness) / 2, c = 2 * Math.PI * r, v = Math.max(0, Math.min(1, value ?? 0));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={className} aria-hidden style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--g-ink-dim)" strokeWidth={thickness} strokeDasharray="2 3" />
      <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={thickness} strokeLinecap="round" strokeDasharray={c}
        initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - v) }} transition={{ ...spring, delay: 0.3 }} />
      {!reduced && v > 0 && (
        <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#fff" strokeOpacity="0.55" strokeWidth={thickness} strokeLinecap="round"
          strokeDasharray={`${c * 0.04} ${c}`} animate={{ strokeDashoffset: [0, -c * v + c * 0.04] }} transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut', repeatDelay: 1.2 }} />
      )}
    </svg>
  );
}
