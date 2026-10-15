'use client';

import clsx from 'clsx';
import * as RPopover from '@radix-ui/react-popover';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { Flag, Layers, LocateFixed, Minus, Plus } from 'lucide-react';
import { Switch, Tooltip } from '@/ui';
import type { AssetSummary, ProcessArea } from '../types';
import { healthColor, healthLabel } from '../util';
import { contourPaths, hasPos, niceStep, type Pt } from './geometry';

export interface MapLayers { areas: boolean; assets: boolean; alarms: boolean; route: boolean; labels: boolean }
export const DEFAULT_LAYERS: MapLayers = { areas: true, assets: true, alarms: true, route: true, labels: true };
const LAYER_LABELS: Record<keyof MapLayers, string> = { areas: 'Process areas', assets: 'Asset pins', alarms: 'Alarm pulse', route: 'Inspection route', labels: 'Labels' };

interface View { cx: number; cy: number; s: number } // centre in metres, scale in px per metre

export interface PlantCanvasProps {
  siteKey: string;
  widthM: number;
  heightM: number;
  areas: ProcessArea[];
  assets: AssetSummary[];
  layers: MapLayers;
  onLayersChange: (l: MapLayers) => void;
  selectedId: string | null;
  /** Ordered stop asset ids; drawn as the route when not null. */
  route: string[] | null;
  routeMode: 'off' | 'edit' | 'preview';
  hoverStop: number | null;
  onHoverStop: (i: number | null) => void;
  onPinClick: (a: AssetSummary) => void;
  onBackgroundClick?: (p: Pt) => void;
  placing?: boolean;
  focus?: { x: number; y: number; nonce: number } | null;
  /** Extra class on the right-hand control rail (e.g. to clear an open side sheet). */
  railClassName?: string;
  children?: ReactNode;
}

/**
 * Plant layout map (BikeRoute map language without third-party tiles): near-black canvas with
 * a metre grid and faint contour rings, process-area zones, asset pins as 44px buttons, and the
 * inspection route as a lime line on a dark casing. Pan by dragging, zoom with wheel/pinch/buttons,
 * or use the keyboard (arrows, +/-, 0) when the map has focus.
 */
export function PlantCanvas(p: PlantCanvasProps) {
  const { widthM: W, heightM: H } = p;
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View | null>(null);
  const fitted = useRef<string | null>(null);

  const fitView = useCallback((w: number, h: number): View => {
    const s = Math.min(w / W, h / H) * 0.9;
    return { cx: W / 2, cy: H / 2, s: Math.max(0.05, s) };
  }, [W, H]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const r = e!.contentRect;
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit on first layout and whenever the site changes.
  useEffect(() => {
    if (!size.w || !size.h) return;
    if (fitted.current !== p.siteKey) {
      fitted.current = p.siteKey;
      setView(fitView(size.w, size.h));
    }
  }, [size.w, size.h, p.siteKey, fitView]);

  const fit = size.w ? fitView(size.w, size.h) : null;
  const minS = (fit?.s ?? 1) * 0.5, maxS = Math.max((fit?.s ?? 1) * 14, 60);
  const clampView = useCallback((v: View): View => {
    const s = Math.min(maxS, Math.max(minS, v.s));
    // Keep the layout reachable: centre may not leave the layout bounds (+ margin).
    const mx = W * 0.25, my = H * 0.25;
    return { s, cx: Math.min(W + mx, Math.max(-mx, v.cx)), cy: Math.min(H + my, Math.max(-my, v.cy)) };
  }, [minS, maxS, W, H]);

  const zoomAt = useCallback((factor: number, sx?: number, sy?: number) => {
    setView((v) => {
      if (!v) return v;
      const px = sx ?? size.w / 2, py = sy ?? size.h / 2;
      const wx = v.cx + (px - size.w / 2) / v.s, wy = v.cy + (py - size.h / 2) / v.s;
      const s = Math.min(maxS, Math.max(minS, v.s * factor));
      return clampView({ s, cx: wx - (px - size.w / 2) / s, cy: wy - (py - size.h / 2) / s });
    });
  }, [size.w, size.h, minS, maxS, clampView]);

  // Programmatic focus (e.g. "locate" from the text list).
  useEffect(() => {
    if (!p.focus) return;
    setView((v) => (v ? clampView({ s: Math.max(v.s, (fit?.s ?? 1) * 2.2), cx: p.focus!.x, cy: p.focus!.y }) : v));
  }, [p.focus?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // Wheel zoom needs a non-passive listener to prevent page scroll.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  // ---- pointer pan / pinch / click
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ moved: boolean; startX: number; startY: number; pinchD?: number } | null>(null);
  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest('[data-map-ui]')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.current.size === 1) gesture.current = { moved: false, startX: e.clientX, startY: e.clientY };
    if (ptrs.current.size === 2) {
      const [a, b] = [...ptrs.current.values()];
      gesture.current = { moved: true, startX: 0, startY: 0, pinchD: Math.hypot(a!.x - b!.x, a!.y - b!.y) };
    }
  };
  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const prev = ptrs.current.get(e.pointerId);
    if (!prev || !gesture.current) return;
    const cur = { x: e.clientX, y: e.clientY };
    ptrs.current.set(e.pointerId, cur);
    if (ptrs.current.size === 2 && gesture.current.pinchD) {
      const [a, b] = [...ptrs.current.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      const r = e.currentTarget.getBoundingClientRect();
      zoomAt(d / gesture.current.pinchD, (a!.x + b!.x) / 2 - r.left, (a!.y + b!.y) / 2 - r.top);
      gesture.current.pinchD = d;
      return;
    }
    if (!gesture.current.moved && Math.hypot(cur.x - gesture.current.startX, cur.y - gesture.current.startY) < 5) return;
    gesture.current.moved = true;
    const dx = cur.x - prev.x, dy = cur.y - prev.y;
    setView((v) => (v ? clampView({ ...v, cx: v.cx - dx / v.s, cy: v.cy - dy / v.s }) : v));
  };
  const onPointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    ptrs.current.delete(e.pointerId);
    if (ptrs.current.size === 0) {
      if (g && !g.moved && view && p.onBackgroundClick) {
        const r = e.currentTarget.getBoundingClientRect();
        const x = view.cx + (e.clientX - r.left - size.w / 2) / view.s, y = view.cy + (e.clientY - r.top - size.h / 2) / view.s;
        if (x >= 0 && y >= 0 && x <= W && y <= H) p.onBackgroundClick({ x, y });
      }
      gesture.current = null;
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const step = 80;
    const pan = (dx: number, dy: number) => setView((v) => (v ? clampView({ ...v, cx: v.cx + dx / v.s, cy: v.cy + dy / v.s }) : v));
    switch (e.key) {
      case 'ArrowLeft': pan(-step, 0); break;
      case 'ArrowRight': pan(step, 0); break;
      case 'ArrowUp': pan(0, -step); break;
      case 'ArrowDown': pan(0, step); break;
      case '+': case '=': zoomAt(1.4); break;
      case '-': case '_': zoomAt(1 / 1.4); break;
      case '0': if (fit) setView(fit); break;
      default: return;
    }
    e.preventDefault();
  };

  const contours = useMemo(() => contourPaths(W, H, p.siteKey), [W, H, p.siteKey]);
  const positioned = p.assets.filter(hasPos);
  const byId = useMemo(() => new Map(p.assets.map((a) => [a.id, a])), [p.assets]);
  const stopIndex = useMemo(() => {
    const m = new Map<string, number>();
    p.route?.forEach((id, i) => { if (!m.has(id)) m.set(id, i); });
    return m;
  }, [p.route]);
  const routePts = (p.route ?? []).map((id) => byId.get(id)).filter((a): a is AssetSummary & { positionX: number; positionY: number } => !!a && hasPos(a));
  const showRoute = p.layers.route && p.routeMode !== 'off' && routePts.length > 0;

  const v = view;
  const toScreen = (x: number, y: number) => (v ? { x: (x - v.cx) * v.s + size.w / 2, y: (y - v.cy) * v.s + size.h / 2 } : { x: 0, y: 0 });
  const vb = v ? `${v.cx - size.w / 2 / v.s} ${v.cy - size.h / 2 / v.s} ${size.w / v.s} ${size.h / v.s}` : `0 0 ${W} ${H}`;
  const grid = v ? niceStep(v.s, 36) : 10;
  const scale = v ? niceStep(v.s, 70) : 10;

  const firstStop = p.route?.find((id) => { const a = byId.get(id); return a && hasPos(a); });
  const lastStop = [...(p.route ?? [])].reverse().find((id) => { const a = byId.get(id); return a && hasPos(a); });

  return (
    <div ref={box} tabIndex={0} onKeyDown={onKeyDown}
      role="region" aria-roledescription="map" aria-label={`Plant layout map, ${W} by ${H} metres. Drag or use arrow keys to pan, plus and minus to zoom, 0 to fit.`}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      className={clsx('relative h-full w-full touch-none select-none overflow-hidden bg-bg outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-lime', p.placing ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing')}>
      {v && (
        <svg width={size.w} height={size.h} viewBox={vb} className="absolute inset-0" aria-hidden>
          {/* metre grid across the layout */}
          <g stroke="var(--color-text)" strokeOpacity={0.05} strokeWidth={1} vectorEffect="non-scaling-stroke">
            {Array.from({ length: Math.floor(W / grid) + 1 }, (_, i) => <line key={`gx${i}`} x1={i * grid} y1={0} x2={i * grid} y2={H} vectorEffect="non-scaling-stroke" />)}
            {Array.from({ length: Math.floor(H / grid) + 1 }, (_, i) => <line key={`gy${i}`} x1={0} y1={i * grid} x2={W} y2={i * grid} vectorEffect="non-scaling-stroke" />)}
          </g>
          {/* contour backdrop (decorative) */}
          <g fill="none" stroke="var(--color-text)" strokeOpacity={0.08} strokeWidth={1}>
            {contours.map((d, i) => <path key={i} d={d} vectorEffect="non-scaling-stroke" />)}
          </g>
          <rect x={0} y={0} width={W} height={H} fill="none" stroke="var(--color-text)" strokeOpacity={0.24} strokeWidth={1.2} strokeDasharray="6 6" vectorEffect="non-scaling-stroke" />
          {p.layers.areas && p.areas.filter((a) => a.polygon && a.polygon.length >= 3).map((a) => (
            <polygon key={a.id} points={a.polygon!.map(([x, y]) => `${x},${y}`).join(' ')} fill="var(--color-tint)" stroke="var(--color-text)" strokeOpacity={0.34} strokeWidth={1.2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          ))}
          {showRoute && (
            <g fill="none" strokeLinecap="round" strokeLinejoin="round">
              <polyline points={routePts.map((a) => `${a.positionX},${a.positionY}`).join(' ')} stroke="var(--color-bg)" strokeWidth={11} strokeOpacity={0.9} vectorEffect="non-scaling-stroke" />
              <polyline points={routePts.map((a) => `${a.positionX},${a.positionY}`).join(' ')} stroke="var(--color-lime)" strokeWidth={4} vectorEffect="non-scaling-stroke"
                strokeDasharray={p.routeMode === 'edit' ? '10 7' : undefined} />
            </g>
          )}
        </svg>
      )}

      {/* HTML overlay: crisp labels and 44px pin buttons that keep their size at any zoom */}
      {v && (
        <div className="pointer-events-none absolute inset-0">
          {p.layers.areas && p.layers.labels && p.areas.filter((a) => a.polygon && a.polygon.length >= 3).map((a) => {
            const xs = a.polygon!.map((q) => q[0]), ys = a.polygon!.map((q) => q[1]);
            const tl = toScreen(Math.min(...xs), Math.min(...ys));
            const wpx = (Math.max(...xs) - Math.min(...xs)) * v.s;
            if (wpx < 50) return null;
            return (
              <span key={a.id} className="absolute truncate text-[11px] uppercase tracking-[0.12em] text-text-2/80" style={{ left: tl.x + 8, top: tl.y + 6, maxWidth: Math.max(40, wpx - 16) }}>
                {a.name}
              </span>
            );
          })}

          {p.layers.assets && positioned.map((a) => {
            const s = toScreen(a.positionX, a.positionY);
            if (s.x < -40 || s.y < -40 || s.x > size.w + 40 || s.y > size.h + 40) return null;
            const idx = stopIndex.get(a.id);
            const inRoute = p.routeMode !== 'off' && p.layers.route && idx !== undefined;
            const hovered = inRoute && p.hoverStop === idx;
            const selected = p.selectedId === a.id;
            const color = healthColor(a);
            const dim = p.routeMode !== 'off' && !inRoute;
            const name = `${a.tag}, ${a.name}. ${healthLabel(a)}.${inRoute ? ` Stop ${idx! + 1}.` : ''}`;
            return (
              <div key={a.id} className="absolute" style={{ left: s.x - 22, top: s.y - 22 }}>
                <button type="button" data-map-ui
                  aria-label={p.routeMode === 'edit' ? `${name} ${inRoute ? 'Remove from route' : 'Add to route'}` : name}
                  aria-pressed={p.routeMode === 'edit' ? inRoute : selected}
                  onClick={() => p.onPinClick(a)}
                  onMouseEnter={() => inRoute && p.onHoverStop(idx!)} onMouseLeave={() => inRoute && p.onHoverStop(null)}
                  onFocus={() => inRoute && p.onHoverStop(idx!)} onBlur={() => inRoute && p.onHoverStop(null)}
                  className="pointer-events-auto relative grid h-11 w-11 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-lime">
                  {p.layers.alarms && a.openAlarms > 0 && (
                    <span className="absolute h-7 w-7 animate-ping rounded-full opacity-60" style={{ background: color }} aria-hidden />
                  )}
                  {inRoute ? (
                    <span className={clsx('relative grid h-7 w-7 place-items-center rounded-full border-2 border-bg bg-lime text-[12px] font-semibold text-lime-ink shadow-[0_0_0_2px_rgb(25_84_241/0.25)] transition-transform num', hovered && 'scale-125 shadow-[0_0_0_4px_var(--color-text)]')}>
                      {idx! + 1}
                      <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border border-bg" style={{ background: color }} aria-hidden />
                    </span>
                  ) : (
                    <span className={clsx('relative rounded-full transition-all', selected ? 'h-5 w-5 ring-[3px] ring-cobalt-2 ring-offset-2 ring-offset-bg' : 'h-3.5 w-3.5 ring-2 ring-bg', dim && 'opacity-45')}
                      style={{ background: color, boxShadow: `0 0 0 5px color-mix(in srgb, ${color} 22%, transparent)` }} aria-hidden />
                  )}
                </button>
                {p.layers.labels && (v.s > 3 || selected || hovered) && (
                  <span className={clsx('pointer-events-none absolute left-1/2 top-[40px] -translate-x-1/2 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px]', selected ? 'bg-cobalt-2 text-white' : 'bg-surface/85 text-text-2 shadow-[var(--shadow-1)]', dim && 'opacity-50')}>{a.tag}</span>
                )}
                {showRoute && a.id === firstStop && (
                  <span className="pointer-events-none absolute bottom-[38px] left-[30px] inline-flex items-center gap-1 rounded-full bg-lime px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-lime-ink">Start</span>
                )}
                {showRoute && a.id === lastStop && lastStop !== firstStop && (
                  <span className="pointer-events-none absolute bottom-[38px] left-[30px] inline-flex items-center gap-1 rounded-full border border-lime bg-bg px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-lime"><Flag size={11} aria-hidden />Finish</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Right-edge circular controls */}
      <div data-map-ui className={clsx('absolute right-3 top-1/2 flex -translate-y-1/2 flex-col gap-2', p.railClassName)}>
        <MapBtn label="Zoom in" onClick={() => zoomAt(1.4)}><Plus size={18} /></MapBtn>
        <MapBtn label="Zoom out" onClick={() => zoomAt(1 / 1.4)}><Minus size={18} /></MapBtn>
        <MapBtn label="Fit layout to view" onClick={() => fit && setView(fit)}><LocateFixed size={18} /></MapBtn>
        <RPopover.Root>
          <Tooltip label="Map layers">
            <RPopover.Trigger asChild>
              <button type="button" aria-label="Map layers" className="icon-btn border-line-2 bg-surface/90 backdrop-blur"><Layers size={18} /></button>
            </RPopover.Trigger>
          </Tooltip>
          <RPopover.Portal>
            <RPopover.Content side="left" align="center" sideOffset={10} className="z-40 grid w-[230px] gap-3 rounded-[var(--radius-xl)] border border-line-2 bg-surface p-4 shadow-[var(--shadow-3)] fade-in">
              <div className="t-eyebrow">Layers</div>
              {(Object.keys(LAYER_LABELS) as (keyof MapLayers)[]).map((k) => (
                <Switch key={k} label={LAYER_LABELS[k]} checked={p.layers[k]} onChange={(val) => p.onLayersChange({ ...p.layers, [k]: val })} />
              ))}
            </RPopover.Content>
          </RPopover.Portal>
        </RPopover.Root>
      </div>

      {/* Scale bar */}
      {v && (
        <div data-map-ui className="pointer-events-none absolute bottom-3 right-3 flex flex-col items-end gap-1 text-[11px] text-text-2">
          <span className="num">{scale} m</span>
          <span className="block h-1.5 border-x border-b border-text-2" style={{ width: scale * v.s }} aria-hidden />
        </div>
      )}

      {p.children}
    </div>
  );
}

function MapBtn({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip label={label}>
      <button type="button" aria-label={label} onClick={onClick} className="icon-btn border-line-2 bg-surface/90 backdrop-blur">{children}</button>
    </Tooltip>
  );
}
