'use client';

/*
 * "Mist" art direction for the homepage: misty teal stages with dune forms, frosted glass
 * tiles and live micro-infographics (sun-arc curve, dot-matrix numerals, sparklines, dot grids).
 * All values are synthetic and drift live while the tile is on screen. Motion is built with
 * `motion/react` and collapses to static frames under prefers-reduced-motion.
 */

import clsx from 'clsx';
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { animate, motion, useInView, useMotionValue, useReducedMotion, useScroll, useSpring, useTransform } from 'motion/react';

const EASE = [0.22, 0.8, 0.24, 1] as const;

/* ------------------------------------------------------------------ Backdrop */

/** Layered mist, dunes, fine contour lines and a dotted particle field, with scroll parallax. */
export function MistBackdrop({ className, dunes = true, tone = 'ice' }: { className?: string; dunes?: boolean; tone?: 'ice' | 'dusk' }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });
  const yFar = useTransform(scrollYProgress, [0, 1], [0, reduced ? 0 : 60]);
  const yMid = useTransform(scrollYProgress, [0, 1], [0, reduced ? 0 : 140]);
  const yNear = useTransform(scrollYProgress, [0, 1], [0, reduced ? 0 : 230]);
  const glow = useTransform(scrollYProgress, [0, 1], [1, reduced ? 1 : 0.4]);
  const id = useId().replace(/:/g, '');
  const lines = useMemo(() => Array.from({ length: 26 }, (_, i) => i), []);

  return (
    <div ref={ref} aria-hidden className={clsx('mist-backdrop', tone === 'dusk' && 'mist-dusk', className)}>
      <motion.div className="mist-glow" style={{ opacity: glow }} />
      {dunes && (
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice">
          <defs>
            <linearGradient id={`${id}-far`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#6f93ff" stopOpacity="0.42" />
              <stop offset="1" stopColor="#c9d8ff" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`${id}-mid`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
              <stop offset="0.45" stopColor="#8fabff" stopOpacity="0.85" />
              <stop offset="1" stopColor="#1746e4" stopOpacity="0.9" />
            </linearGradient>
            <linearGradient id={`${id}-near`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#1954f1" stopOpacity="0.85" />
              <stop offset="1" stopColor="#0c1e85" stopOpacity="1" />
            </linearGradient>
            <filter id={`${id}-soft`} x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="18" /></filter>
            <filter id={`${id}-softer`} x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="6" /></filter>
            <clipPath id={`${id}-clip`}><path d="M560 900 C 640 640, 720 380, 820 300 C 880 250, 930 262, 980 330 C 1080 470, 1220 640, 1440 700 L1440 900 Z" /></clipPath>
          </defs>
          <motion.g style={{ y: yFar }}>
            <path d="M0 560 C 220 470, 380 420, 560 470 C 760 520, 900 380, 1100 400 C 1260 416, 1360 470, 1440 500 L1440 900 L0 900 Z" fill={`url(#${id}-far)`} filter={`url(#${id}-soft)`} />
          </motion.g>
          <motion.g style={{ y: yMid }}>
            <path d="M560 900 C 640 640, 720 380, 820 300 C 880 250, 930 262, 980 330 C 1080 470, 1220 640, 1440 700 L1440 900 Z" fill={`url(#${id}-mid)`} filter={`url(#${id}-softer)`} />
            <g clipPath={`url(#${id}-clip)`} opacity="0.35">
              {lines.map((i) => (
                <path key={i} d={`M540 ${330 + i * 22} C 700 ${300 + i * 22}, 860 ${380 + i * 20}, 1000 ${350 + i * 22} S 1300 ${420 + i * 21}, 1460 ${380 + i * 22}`} fill="none" stroke="#ffffff" strokeWidth="0.8" />
              ))}
            </g>
          </motion.g>
          <motion.g style={{ y: yNear }}>
            <path d="M0 760 C 180 700, 340 690, 520 740 C 700 790, 860 760, 1040 800 C 1200 836, 1340 820, 1440 800 L1440 900 L0 900 Z" fill={`url(#${id}-near)`} filter={`url(#${id}-softer)`} opacity="0.7" />
          </motion.g>
        </svg>
      )}
      <div className="mist-dots mist-dots-a" />
      <div className="mist-dots mist-dots-b" />
      <div className="mist-grain" />
    </div>
  );
}

/** Thin "+" registration marks scattered over a stage. */
export function CrossMarks({ points }: { points: [string, string][] }) {
  return (
    <>
      {points.map(([l, t], i) => (
        <span key={i} aria-hidden className="mist-cross" style={{ left: l, top: t }} />
      ))}
    </>
  );
}

/* ------------------------------------------------------------- Reveal helpers */

export function Rise({ children, delay = 0, className, as = 'div' }: { children: ReactNode; delay?: number; className?: string; as?: 'div' | 'li' | 'article' | 'h2' | 'p' }) {
  const reduced = useReducedMotion();
  const M = motion[as];
  return (
    <M
      className={className}
      initial={reduced ? false : { opacity: 0, y: 28, filter: 'blur(8px)' }}
      whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      viewport={{ once: true, margin: '0px 0px -10% 0px' }}
      transition={{ duration: 0.9, ease: EASE, delay }}
    >
      {children}
    </M>
  );
}

/** Headline that writes itself in word by word. */
export function SplitWords({ text, className, delay = 0 }: { text: string; className?: string; delay?: number }) {
  const reduced = useReducedMotion();
  const words = text.split(' ');
  return (
    <span className={className}>
      {words.map((w, i) => (
        <span key={i} className="inline-block overflow-hidden pb-[0.08em] align-bottom">
          <motion.span
            className="inline-block"
            initial={reduced ? false : { y: '105%', opacity: 0 }}
            animate={{ y: '0%', opacity: 1 }}
            transition={{ duration: 1.05, ease: EASE, delay: delay + i * 0.08 }}
          >
            {w}
            {i < words.length - 1 ? ' ' : ''}
          </motion.span>
        </span>
      ))}
    </span>
  );
}

/* ------------------------------------------------------------------ Glass tile */

/** Frosted tile with a gentle pointer tilt and a moving specular highlight. */
export function GlassTile({ children, className, tone = 'smoke', tilt = true, style }: { children: ReactNode; className?: string; tone?: 'smoke' | 'frost'; tilt?: boolean; style?: CSSProperties }) {
  const reduced = useReducedMotion();
  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const gx = useMotionValue(50);
  const gy = useMotionValue(20);
  const srx = useSpring(rx, { stiffness: 160, damping: 18 });
  const sry = useSpring(ry, { stiffness: 160, damping: 18 });
  const sheen = useTransform([gx, gy], ([x, y]) => `radial-gradient(420px circle at ${x}% ${y}%, rgb(255 255 255 / 0.22), transparent 55%)`);
  const on = tilt && !reduced;

  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (!on || e.pointerType !== 'mouse') return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    ry.set((px - 0.5) * 9);
    rx.set(-(py - 0.5) * 9);
    gx.set(px * 100);
    gy.set(py * 100);
  };
  const leave = () => { rx.set(0); ry.set(0); gx.set(50); gy.set(20); };

  return (
    <motion.div
      onPointerMove={move}
      onPointerLeave={leave}
      style={{ ...style, rotateX: srx, rotateY: sry, transformPerspective: 900 }}
      className={clsx('glass-tile', tone === 'frost' ? 'glass-frost' : 'glass-smoke', className)}
    >
      {on && <motion.span aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit]" style={{ background: sheen }} />}
      <div className="relative h-full">{children}</div>
    </motion.div>
  );
}

/** Thin-ring icon badge used on glass tiles. */
export function RingIcon({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={clsx('grid h-14 w-14 flex-none place-items-center rounded-full border border-white/35 text-white/90', className)}>{children}</span>;
}

/* ------------------------------------------------------------------ Live data */

/** A random-walk series that ticks while the element is on screen (static under reduced motion). */
export function useLiveSeries(seed: number[], { lo, hi, step, every = 1700 }: { lo: number; hi: number; step: number; every?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: '0px 0px -5% 0px' });
  const reduced = useReducedMotion();
  const [data, setData] = useState(seed);
  useEffect(() => {
    if (!inView || reduced) return;
    const t = window.setInterval(() => {
      setData((d) => {
        const last = d[d.length - 1];
        const next = Math.min(hi, Math.max(lo, last + (Math.random() - 0.5) * 2 * step));
        return [...d.slice(1), Math.round(next * 100) / 100];
      });
    }, every);
    return () => window.clearInterval(t);
  }, [inView, reduced, lo, hi, step, every]);
  return { ref, data, last: data[data.length - 1] };
}

/** Animated number that eases between values. */
export function Ticker({ value, decimals = 1, className }: { value: number; decimals?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(value);
  const reduced = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduced) { el.textContent = value.toFixed(decimals); prev.current = value; return; }
    const c = animate(prev.current, value, { duration: 0.9, ease: EASE, onUpdate: (v) => { el.textContent = v.toFixed(decimals); } });
    prev.current = value;
    return () => c.stop();
  }, [value, decimals, reduced]);
  return <span ref={ref} className={clsx('tabular-nums', className)}>{value.toFixed(decimals)}</span>;
}

/** Counts up once when scrolled into view. */
export function CountUp({ to, decimals = 0, suffix, className }: { to: number; decimals?: number; suffix?: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduced = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el || !inView) return;
    if (reduced) { el.textContent = to.toFixed(decimals); return; }
    const c = animate(0, to, { duration: 1.6, ease: EASE, onUpdate: (v) => { el.textContent = v.toFixed(decimals); } });
    return () => c.stop();
  }, [inView, to, decimals, reduced]);
  return <span className={className}><span ref={ref} className="tabular-nums">{to.toFixed(decimals)}</span>{suffix}</span>;
}

/* ------------------------------------------------------------- Infographics */

function linePath(data: number[], w: number, h: number, lo: number, hi: number, pad = 4) {
  const span = hi - lo || 1;
  return data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = pad + (1 - (v - lo) / span) * (h - pad * 2);
      return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}

/** Sparkline whose path morphs as new points arrive. */
export function Sparkline({ data, lo, hi, w = 160, h = 48, className, stroke = '#ffffff' }: { data: number[]; lo: number; hi: number; w?: number; h?: number; className?: string; stroke?: string }) {
  const id = useId().replace(/:/g, '');
  const d = linePath(data, w, h, lo, hi);
  const lastY = 4 + (1 - (data[data.length - 1] - lo) / (hi - lo || 1)) * (h - 8);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={className} aria-hidden>
      <defs>
        <linearGradient id={`${id}-a`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={stroke} stopOpacity="0.28" /><stop offset="1" stopColor={stroke} stopOpacity="0" /></linearGradient>
      </defs>
      <motion.path animate={{ d: `${d} L${w} ${h} L0 ${h} Z` }} transition={{ duration: 0.9, ease: EASE }} fill={`url(#${id}-a)`} />
      <motion.path animate={{ d }} transition={{ duration: 0.9, ease: EASE }} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <motion.circle animate={{ cy: lastY }} transition={{ duration: 0.9, ease: EASE }} cx={w} r="3.2" fill={stroke} />
    </svg>
  );
}

/** Bell "sun arc" curve with a marker riding along it (t ∈ 0..1), as on a daylight widget. */
export function SunArc({ t, className, accent = '#b9ccff' }: { t: number; className?: string; accent?: string }) {
  const W = 320, H = 130, base = 92, A = 74, c = 160, s = 62;
  const y = (x: number) => base + 26 - (A + 26) * Math.exp(-((x - c) ** 2) / (2 * s * s));
  const pts = Array.from({ length: 65 }, (_, i) => (i / 64) * W);
  const d = pts.map((x, i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y(x).toFixed(1)}`).join(' ');
  const upper = pts.filter((x) => y(x) <= base).map((x, i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y(x).toFixed(1)}`).join(' ');
  const mx = 30 + t * (W - 60);
  const my = y(mx);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className} aria-hidden>
      <line x1="0" x2={W} y1={base} y2={base} stroke="#ffffff" strokeOpacity="0.35" strokeDasharray="2 5" />
      <path d={d} fill="none" stroke="#ffffff" strokeOpacity="0.35" strokeWidth="1.4" />
      <path d={upper} fill="none" stroke={accent} strokeWidth="2" strokeLinecap="round" />
      <motion.line animate={{ x1: mx, x2: mx, y1: my }} y2={base} transition={{ duration: 1.2, ease: EASE }} stroke="#ffffff" strokeOpacity="0.7" strokeDasharray="2 3" />
      <motion.circle animate={{ cx: mx, cy: my }} transition={{ duration: 1.2, ease: EASE }} r="11" fill="#ffffff" fillOpacity="0.16" />
      <motion.circle animate={{ cx: mx, cy: my }} transition={{ duration: 1.2, ease: EASE }} r="4.5" fill="#ffffff" />
      <circle cx={c - s * 1.18} cy={base} r="3" fill="#ffffff" />
      <circle cx={c + s * 1.18} cy={base} r="3" fill="#ffffff" />
    </svg>
  );
}

// 3 × 5 dot glyphs.
const GLYPHS: Record<string, string> = {
  '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111', '4': '101101111001001',
  '5': '111100111001111', '6': '111100111101111', '7': '111001010010010', '8': '111101111101111', '9': '111101111001111',
  '.': '000000000000010', '-': '000000111000000', ' ': '000000000000000',
};

/** Dot-matrix numerals (display-style digits built from dots). */
export function DotMatrix({ text, dot = 7, gap = 3, className, on = '#ffffff' }: { text: string; dot?: number; gap?: number; className?: string; on?: string }) {
  const cell = dot + gap;
  const chars = text.split('');
  const widths = chars.map((ch) => (ch === '.' ? 1 : 3));
  const W = widths.reduce((a, b) => a + b, 0) * cell + (chars.length - 1) * cell;
  const H = 5 * cell;
  let x0 = 0;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className} role="img" aria-label={text}>
      {chars.map((ch, ci) => {
        const g = GLYPHS[ch] ?? GLYPHS[' '];
        const w = widths[ci];
        const nodes = [];
        for (let r = 0; r < 5; r++) {
          for (let c = 0; c < 3; c++) {
            const lit = g[r * 3 + c] === '1';
            if (w === 1 && c !== 1) continue;
            const cx = x0 + (w === 1 ? 0 : c * cell) + dot / 2;
            nodes.push(
              <motion.rect key={`${ci}-${r}-${c}`} x={cx - dot / 2} y={r * cell} width={dot} height={dot} rx={dot * 0.32}
                animate={{ opacity: lit ? 1 : 0.1 }} transition={{ duration: 0.35, delay: (r + c) * 0.025 }} fill={on} />,
            );
          }
        }
        x0 += w * cell + cell;
        return <g key={ci}>{nodes}</g>;
      })}
    </svg>
  );
}

/** Two-row dot grid (filled dots light up as a value grows). */
export function DotGrid({ filled, total = 16, className }: { filled: number; total?: number; className?: string }) {
  const cols = Math.ceil(total / 2);
  return (
    <svg viewBox={`0 0 ${cols * 14} 28`} className={className} aria-hidden>
      {Array.from({ length: total }, (_, i) => {
        const on = i < filled;
        return (
          <motion.circle key={i} cx={(i % cols) * 14 + 7} cy={i < cols ? 7 : 21} animate={{ r: on ? 3.6 : 3, fillOpacity: on ? 1 : 0, strokeOpacity: on ? 0 : 0.55 }}
            transition={{ duration: 0.4, delay: (i % cols) * 0.03 }} fill="#ffffff" stroke="#ffffff" strokeWidth="1" />
        );
      })}
    </svg>
  );
}

/** Mini bar chart (rounded bars on a baseline). */
export function MiniBars({ data, lo, hi, className }: { data: number[]; lo: number; hi: number; className?: string }) {
  const W = data.length * 12;
  return (
    <svg viewBox={`0 0 ${W} 40`} className={className} aria-hidden>
      <line x1="0" x2={W} y1="39.5" y2="39.5" stroke="#ffffff" strokeOpacity="0.4" />
      {data.map((v, i) => {
        const h = 4 + ((v - lo) / (hi - lo || 1)) * 32;
        return <motion.rect key={i} x={i * 12 + 4} width="3.4" rx="1.7" animate={{ y: 39 - h, height: h }} transition={{ duration: 0.8, ease: EASE }} fill="#ffffff" fillOpacity={i === data.length - 1 ? 1 : 0.75} />;
      })}
    </svg>
  );
}

/** Wave strip of arches (like a level/inflow cadence). */
export function Arches({ n = 5, active, className }: { n?: number; active: number; className?: string }) {
  return (
    <svg viewBox={`0 0 ${n * 30} 34`} className={className} aria-hidden>
      {Array.from({ length: n }, (_, i) => (
        <g key={i}>
          <path d={`M${i * 30 + 2} 32 C ${i * 30 + 2} 6, ${i * 30 + 26} 6, ${i * 30 + 26} 32`} fill="none" stroke="#ffffff" strokeOpacity={i === active ? 1 : 0.5} strokeWidth="1.3" />
          <motion.rect x={i * 30 + 8} width="12" height="2.4" rx="1.2" animate={{ y: i === active ? 18 : 30, opacity: i === active ? 1 : 0.85 }} transition={{ duration: 0.6, ease: EASE }} fill="#ffffff" />
        </g>
      ))}
    </svg>
  );
}

/* ------------------------------------------------------- Live tiles (composed) */

/** Ticking clock string (client only; renders a placeholder on the server). */
export function useClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = window.setInterval(() => setNow(new Date()), 15000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

/** A short pulsing "live" dot. */
export function LiveDot({ className }: { className?: string }) {
  const reduced = useReducedMotion();
  return (
    <span className={clsx('relative inline-flex h-2 w-2', className)} aria-hidden>
      {!reduced && <motion.span className="absolute inset-0 rounded-full bg-[#7dffa0]" animate={{ scale: [1, 2.6], opacity: [0.7, 0] }} transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }} />}
      <span className="relative h-2 w-2 rounded-full bg-[#7dffa0]" />
    </span>
  );
}
