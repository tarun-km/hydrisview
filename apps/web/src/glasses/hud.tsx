'use client';

import clsx from 'clsx';
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { InputKey } from './input';

/**
 * HUD presentation layer for an additive 600×600 display: pure black renders as
 * transparent, so content uses light strokes, large type (≥ 20 px) and a single
 * lime focus indicator. One column, short labels, one primary action per screen.
 */

export interface HudAction { key: string; onSelect: () => void; disabled?: boolean }
export interface HudControl { actions: HudAction[]; onKey?: (k: InputKey) => boolean }

const Ctx = createContext<{ cursor: number; register: (c: HudControl) => void; density?: 'compact' | 'comfortable' }>({ cursor: 0, register: () => {} });
export const HudContext = Ctx;

/** Register this screen's focusable actions; returns the current cursor index. */
export function useHud(control: HudControl): number {
  const { cursor, register } = useContext(Ctx);
  const ref = useRef(control);
  ref.current = control;
  useLayoutEffect(() => register({ actions: control.actions, onKey: (k) => ref.current.onKey?.(k) ?? false }));
  return cursor;
}

/**
 * Viewport layout.
 *  - "hud": a 600×600 canvas (the field of view of display glasses / the simulator), scaled to fit.
 *  - "phone": portrait phones and the Ray-Ban Meta companion app (camera glasses have no display, so
 *    the phone is the screen). The canvas keeps a 540-unit design width but grows to the phone's full
 *    height, so every screen fills the device instead of sitting in a letterboxed square.
 */
export const PHONE_DESIGN_WIDTH = 540;
export function useViewportLayout(forceHud = false) {
  const [v, setV] = useState({ mode: 'hud' as 'hud' | 'phone', scale: 1, w: 600, h: 600 });
  useEffect(() => {
    const f = () => {
      const W = window.innerWidth;
      const H = window.innerHeight;
      const q = new URLSearchParams(window.location.search).get('mode');
      const bridged = !!(window as { HydrisNative?: unknown }).HydrisNative;
      const phone = !forceHud && (q === 'phone' || bridged || (q !== 'hud' && W < 760 && H > W * 1.15));
      if (phone) {
        const scale = W / PHONE_DESIGN_WIDTH;
        setV({ mode: 'phone', scale, w: PHONE_DESIGN_WIDTH, h: Math.round(H / scale) });
      } else setV({ mode: 'hud', scale: Math.min(W / 600, H / 600), w: 600, h: 600 });
    };
    f();
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, [forceHud]);
  return v;
}

/** Scale a fixed 600×600 canvas to fit its container (simulator frames, standalone page). */
export function useFitScale(size = 600) {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const f = () => setScale(Math.min(window.innerWidth / size, window.innerHeight / size));
    f();
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, [size]);
  return scale;
}

export function HudItem({ active, children, tone, disabled, onClick }: { active: boolean; children: ReactNode; tone?: 'critical' | 'high' | 'lime' | 'muted'; disabled?: boolean; onClick?: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const compact = useContext(Ctx).density === 'compact';
  useEffect(() => {
    // Scroll only the nearest scrollable container — never the embedding page (iframe demos).
    const el = ref.current;
    if (!active || !el) return;
    let p = el.parentElement;
    while (p && p.scrollHeight <= p.clientHeight) p = p.parentElement;
    if (!p || p === document.body || p === document.documentElement) return;
    const top = el.offsetTop - p.offsetTop;
    if (top < p.scrollTop) p.scrollTop = top;
    else if (top + el.offsetHeight > p.scrollTop + p.clientHeight) p.scrollTop = top + el.offsetHeight - p.clientHeight;
  }, [active]);
  return (
    <button ref={ref} type="button" onClick={onClick} disabled={disabled} aria-current={active || undefined}
      className={clsx(
        'flex w-full items-center gap-4 rounded-[26px] border-2 px-6 text-left text-[23px] leading-tight transition-colors',
        compact ? 'py-[9px]' : 'py-[14px]',
        active ? 'border-lime bg-lime/10' : 'border-white/10',
        disabled && 'opacity-40',
        tone === 'critical' && 'text-[#ff8a80]', tone === 'high' && 'text-[#ff9a5c]', tone === 'muted' && 'text-white/60',
      )}>
      {children}
    </button>
  );
}

export function HudPill({ children, tone = 'line' }: { children: ReactNode; tone?: 'line' | 'lime' | 'critical' | 'high' | 'ok' | 'medium' }) {
  const cls = {
    line: 'border-white/25 text-white/80', lime: 'border-lime bg-lime text-[#141714]', critical: 'border-[#ff5a4e] text-[#ff8a80]', high: 'border-[#f26414] text-[#ff9a5c]',
    ok: 'border-[#4ed98e] text-[#7fe6ae]', medium: 'border-[#f5b83d] text-[#f7c96a]',
  }[tone];
  return <span className={clsx('inline-flex h-[34px] items-center gap-2 rounded-full border-2 px-4 text-[18px] font-medium', cls)}>{children}</span>;
}

export function HudTitle({ eyebrow, children }: { eyebrow?: ReactNode; children: ReactNode }) {
  return (
    <div className="mb-5">
      {eyebrow && <div className="mb-1 text-[17px] uppercase tracking-[0.14em] text-white/55">{eyebrow}</div>}
      <h1 className="text-[38px] font-normal leading-[1.05] tracking-[-0.03em]">{children}</h1>
    </div>
  );
}

export function HudMetric({ value, unit, label, tone }: { value: ReactNode; unit?: string; label: ReactNode; tone?: string }) {
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="num text-[52px] font-light leading-none tracking-[-0.04em]" style={tone ? { color: tone } : undefined}>{value}</span>
        {unit && <span className="text-[20px] text-white/60">{unit}</span>}
      </div>
      <div className="mt-1 text-[17px] text-white/60">{label}</div>
    </div>
  );
}

export const SEV_HUD: Record<string, 'critical' | 'high' | 'medium' | 'line'> = { critical: 'critical', high: 'high', medium: 'medium', low: 'line' };
