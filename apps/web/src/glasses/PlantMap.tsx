'use client';

import { useMemo } from 'react';
import { mulberry32 } from '@hydris/domain';

export interface GMap {
  widthM: number;
  heightM: number;
  areas: { id: string; name: string; code: string; polygon: [number, number][] | null }[];
  assets: { id: string; tag: string; name: string; status: string; x: number | null; y: number | null; openAlarms: number }[];
}

const BLUE = '#6F93FF';

/**
 * Plant map in the Rydeon style: charcoal "city blocks" (structures inside process
 * areas), thin street outlines, one luminous route with glowing endpoints, a white
 * distance callout and circular HUD controls. Geometry is the site layout in metres.
 */
export function PlantMap({ map, fromId, toId, zoom = 1, showAll = true, size = 536 }: { map: GMap; fromId?: string | null; toId?: string | null; zoom?: number; showAll?: boolean; size?: number }) {
  const pins = map.assets.filter((a) => a.x !== null && a.y !== null) as (GMap['assets'][number] & { x: number; y: number })[];
  const from = pins.find((p) => p.id === fromId) ?? null;
  const to = pins.find((p) => p.id === toId) ?? null;

  // Deterministic building blocks inside each process area (visual texture, not data).
  const blocks = useMemo(() => {
    const out: { x: number; y: number; w: number; h: number }[] = [];
    for (const a of map.areas) {
      if (!a.polygon?.length) continue;
      const xs = a.polygon.map((p) => p[0]), ys = a.polygon.map((p) => p[1]);
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      const rnd = mulberry32(a.code.split('').reduce((s, c) => s + c.charCodeAt(0), 7));
      for (let y = y0 + 1.5; y < y1 - 3; y += 4.5 + rnd() * 2) {
        for (let x = x0 + 1.5; x < x1 - 3; x += 5 + rnd() * 3) {
          if (rnd() < 0.18) continue;
          out.push({ x, y, w: 2.5 + rnd() * 3, h: 2 + rnd() * 2.4 });
        }
      }
    }
    return out;
  }, [map.areas]);

  // Orthogonal walking route (streets), like turn-by-turn navigation lines.
  const route = from && to ? [[from.x, from.y], [from.x, (from.y + to.y) / 2], [to.x, (from.y + to.y) / 2], [to.x, to.y]] as [number, number][] : null;
  const dist = route ? Math.round(route.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - route[i]![0], p[1] - route[i]![1]), 0)) : null;

  // Camera: centre on the route/target and apply zoom.
  const cx = to ? (from ? (from.x + to.x) / 2 : to.x) : map.widthM / 2;
  const cy = to ? (from ? (from.y + to.y) / 2 : to.y) : map.heightM / 2;
  const span = Math.max(map.widthM, map.heightM) / zoom;
  const vb = `${cx - span / 2} ${cy - span / 2} ${span} ${span}`;
  const k = span / size; // metres per pixel, for constant stroke widths
  const callout = route ? route[Math.floor(route.length / 2)]! : null;

  return (
    <svg viewBox={vb} width={size} height={size} role="img" aria-label={to ? `Map: route to ${to.tag}, about ${dist} metres` : 'Plant map'} style={{ background: '#121314', borderRadius: 30 }}>
      <defs>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation={3 * k} result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        <pattern id="streets" width="6" height="6" patternUnits="userSpaceOnUse"><path d="M6 0H0V6" fill="none" stroke="#2a2c2e" strokeWidth={0.6 * k} /></pattern>
      </defs>
      <rect x={-50} y={-50} width={map.widthM + 100} height={map.heightM + 100} fill="url(#streets)" />
      {map.areas.map((a) => a.polygon && (
        <g key={a.id}>
          <polygon points={a.polygon.map((p) => p.join(',')).join(' ')} fill="#1b1d1f" stroke="#3a3d40" strokeWidth={1.2 * k} />
          <text x={Math.min(...a.polygon.map((p) => p[0])) + 1} y={Math.min(...a.polygon.map((p) => p[1])) + 3.4} fill="#7b7f84" fontSize={13 * k} fontWeight={500}>{a.code}</text>
        </g>
      ))}
      {blocks.map((b, i) => <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} rx={0.4} fill="#26292c" stroke="#33373a" strokeWidth={0.6 * k} />)}
      {route && <polyline points={route.map((p) => p.join(',')).join(' ')} fill="none" stroke={BLUE} strokeWidth={3.2 * k} strokeLinejoin="round" filter="url(#glow)" />}
      {pins.filter((p) => showAll || p.id === toId || p.id === fromId).map((p) => {
        const isEnd = p.id === toId || p.id === fromId;
        const col = p.openAlarms ? '#FF5A3C' : p.status === 'down' ? '#FF5A3C' : isEnd ? BLUE : '#9aa0a6';
        return (
          <g key={p.id}>
            {isEnd && <circle cx={p.x} cy={p.y} r={11 * k} fill={col} opacity={0.25} filter="url(#glow)" />}
            <circle cx={p.x} cy={p.y} r={(isEnd ? 7 : 4.5) * k} fill={col} stroke="#0d0e0f" strokeWidth={1.5 * k} filter={isEnd ? 'url(#glow)' : undefined} />
            {(isEnd || p.openAlarms > 0) && <text x={p.x + 10 * k} y={p.y + 5 * k} fill="#e8eaed" fontSize={15 * k} fontWeight={600}>{p.tag}</text>}
          </g>
        );
      })}
      {callout && dist !== null && (
        <g transform={`translate(${callout[0]} ${callout[1] - 22 * k})`}>
          <rect x={-40 * k} y={-17 * k} width={80 * k} height={32 * k} rx={10 * k} fill="#fff" />
          <path d={`M${-6 * k} ${15 * k}L0 ${22 * k}L${6 * k} ${15 * k}Z`} fill="#fff" />
          <text x={0} y={5 * k} textAnchor="middle" fill="#0b0c0d" fontSize={17 * k} fontWeight={600}>{dist} m</text>
        </g>
      )}
    </svg>
  );
}

export function routeDistance(map: GMap, fromId?: string | null, toId?: string | null): number | null {
  const f = map.assets.find((a) => a.id === fromId), t = map.assets.find((a) => a.id === toId);
  if (!f || !t || f.x === null || t.x === null || f.y === null || t.y === null) return null;
  return Math.round(Math.abs(f.x - t.x) + Math.abs(f.y - t.y));
}
