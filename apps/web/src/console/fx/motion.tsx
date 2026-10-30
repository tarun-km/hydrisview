'use client';

import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { motion, useMotionTemplate, useMotionValue, useReducedMotion, useSpring, useTransform, type Variants } from 'motion/react';
import clsx from 'clsx';

/** Bento entrance: children rise out of a soft blur, one after another. */
export const bento: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
};
export const rise: Variants = {
  hidden: { opacity: 0, y: 18, scale: 0.985, filter: 'blur(8px)' },
  show: { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)', transition: { type: 'spring', stiffness: 170, damping: 24, mass: 0.9 } },
};

/**
 * Frosted glass tile with depth: tilts a few degrees toward the pointer and carries a specular glare that follows it.
 * Static under reduced motion. Use `as="section"` etc. for semantics.
 */
export function GlassTile({ children, className, style, tilt = 5, as = 'div', glare = true, ...rest }: {
  children: ReactNode; className?: string; style?: CSSProperties; tilt?: number; as?: 'div' | 'section' | 'article' | 'li'; glare?: boolean;
} & Record<`data-${string}` | `aria-${string}`, string | undefined>) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLElement | null>(null);
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const rx = useSpring(useTransform(py, [0, 1], [tilt, -tilt]), { stiffness: 160, damping: 18 });
  const ry = useSpring(useTransform(px, [0, 1], [-tilt, tilt]), { stiffness: 160, damping: 18 });
  const gx = useTransform(px, (v) => `${v * 100}%`);
  const gy = useTransform(py, (v) => `${v * 100}%`);
  const glareBg = useMotionTemplate`radial-gradient(420px circle at ${gx} ${gy}, rgb(255 255 255 / 0.10), transparent 45%)`;
  const M = motion[as];
  const onMove = (e: React.PointerEvent) => {
    if (reduced || e.pointerType !== 'mouse' || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    px.set((e.clientX - r.left) / r.width);
    py.set((e.clientY - r.top) / r.height);
  };
  const onLeave = () => { px.set(0.5); py.set(0.5); };
  return (
    <M
      ref={ref as never}
      variants={rise}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      style={reduced ? style : { ...style, rotateX: rx, rotateY: ry, transformPerspective: 1100 }}
      className={clsx('card glass-edge fx-tile relative', className)}
      {...rest}
    >
      {glare && !reduced && <motion.span aria-hidden className="fx-glare" style={{ background: glareBg }} />}
      {children}
    </M>
  );
}

/** Number that glides to its new value (spring), formatted with fixed decimals. */
export function Ticker({ value, decimals = 0, className }: { value: number; decimals?: number; className?: string }) {
  const reduced = useReducedMotion();
  const mv = useMotionValue(value);
  const spring = useSpring(mv, { stiffness: 90, damping: 20 });
  const text = useTransform(reduced ? mv : spring, (v) => v.toFixed(decimals));
  useEffect(() => { mv.set(value); }, [mv, value]);
  return <motion.span className={clsx('num', className)}>{text}</motion.span>;
}

/** requestAnimationFrame clock in seconds (stops under reduced motion). */
export function useClock(enabled = true) {
  const t = useMotionValue(0);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!enabled || reduced) return;
    let id = 0;
    const start = performance.now();
    const loop = (now: number) => { t.set(Math.max(0, now - start) / 1000); id = requestAnimationFrame(loop); };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [enabled, reduced, t]);
  return t;
}
