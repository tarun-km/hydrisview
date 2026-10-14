import clsx from 'clsx';
import { SIM_PLANT } from '@hydris/domain';

/* Crafted SVG illustrations. No stock imagery: glasses line-art, contour fields and a
 * schematic of the reference plant that uses the same tags as the simulator. */

function contourPath(cx: number, cy: number, r: number, k: number, seed: number) {
  const pts: string[] = [];
  const n = 96;
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    const rr = r * (1 + 0.11 * Math.sin(3 * t + seed + k * 0.22) + 0.05 * Math.sin(5 * t + 1.3 * seed) + 0.03 * Math.cos(7 * t + k * 0.4));
    const x = cx + rr * Math.cos(t) * 1.35;
    const y = cy + rr * Math.sin(t);
    pts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return `${pts.join(' ')}Z`;
}

/** Topographic contour field (decorative). */
export function ContourField({ className, rings = 16, cx = 620, cy = 300, gap = 26, seed = 1.7, strong = false }: { className?: string; rings?: number; cx?: number; cy?: number; gap?: number; seed?: number; strong?: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 1200 640" preserveAspectRatio="xMidYMid slice" className={clsx('pointer-events-none', className)}>
      <g className="contour-drift" fill="none" stroke="currentColor">
        {Array.from({ length: rings }, (_, k) => (
          <path key={k} d={contourPath(cx, cy, 24 + k * gap, k, seed)} strokeWidth={strong && k % 4 === 0 ? 1.4 : 0.8} opacity={k % 4 === 0 ? 0.55 : 0.28} />
        ))}
      </g>
    </svg>
  );
}

/** Monocular display smart glasses, front view line-art. */
export function GlassesArt({ className, title = 'Line illustration of monocular-display smart glasses' }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 660 260" role="img" aria-label={title} className={className}>
      <defs>
        <linearGradient id="lensFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.07" />
          <stop offset="1" stopColor="#fff" stopOpacity="0.01" />
        </linearGradient>
        <radialGradient id="hudGlow" cx="0.5" cy="0.5" r="0.6">
          <stop offset="0" stopColor="var(--color-lime)" stopOpacity="0.55" />
          <stop offset="1" stopColor="var(--color-lime)" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* temples */}
      <path d="M44 92 C 26 96, 14 104, 6 122" fill="none" stroke="currentColor" strokeWidth="10" strokeLinecap="round" opacity="0.55" />
      <path d="M616 92 C 634 96, 646 104, 654 122" fill="none" stroke="currentColor" strokeWidth="10" strokeLinecap="round" opacity="0.55" />
      {/* frame front */}
      <path d="M40 78 C 40 66, 52 60, 66 60 L 286 60 C 304 60, 312 72, 330 72 C 348 72, 356 60, 374 60 L 594 60 C 608 60, 620 66, 620 78 L 620 104 L 40 104 Z" fill="#1d1d1d" stroke="currentColor" strokeWidth="2" />
      {/* lenses */}
      <rect x="66" y="74" width="218" height="140" rx="56" fill="url(#lensFill)" stroke="currentColor" strokeWidth="9" />
      <rect x="376" y="74" width="218" height="140" rx="56" fill="url(#lensFill)" stroke="currentColor" strokeWidth="9" />
      {/* bridge */}
      <path d="M284 112 C 300 94, 360 94, 376 112" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
      {/* camera + sensor */}
      <circle cx="84" cy="80" r="6" fill="#0a0a0a" stroke="currentColor" strokeWidth="2" />
      <circle cx="576" cy="80" r="3" fill="var(--color-lime)" />
      {/* in-lens display (right eye) */}
      <ellipse cx="486" cy="146" rx="90" ry="60" fill="url(#hudGlow)" />
      <rect x="440" y="116" width="92" height="62" rx="10" fill="rgb(216 255 101 / 0.12)" stroke="var(--color-lime)" strokeWidth="1.5" />
      <path d="M452 132 h40 M452 146 h64 M452 160 h28" stroke="var(--color-lime)" strokeWidth="3" strokeLinecap="round" />
      <circle cx="512" cy="160" r="4" fill="var(--color-lime)" />
    </svg>
  );
}

/* ---------- Reference plant schematic ---------- */
const LINKS: [string, string][] = [
  ['T-101', 'P-101'], ['P-101', 'AB-201'], ['BL-102', 'AB-201'], ['AB-201', 'CL-401'], ['DP-301', 'CL-401'], ['CL-401', 'AN-501'],
];
const ROUND = ['T-101', 'P-101', 'BL-102', 'AB-201', 'DP-301', 'CL-401', 'AN-501'];

/** Schematic of the simulator's reference ETP with the operator round drawn as a route line. */
export function PlantSchematic({ className, highlight, showRoute = true, tone = 'dark' }: { className?: string; highlight?: string; showRoute?: boolean; tone?: 'dark' | 'paper' }) {
  const pos = (tag: string) => {
    const a = SIM_PLANT.assets.find((x) => x.tag === tag)!;
    return { x: 6 + a.x * 0.92, y: 8 + a.y * 0.9 };
  };
  const ink = tone === 'paper' ? '#111211' : '#f3f4f1';
  const route = ROUND.map((t, i) => { const p = pos(t); return `${i ? 'L' : 'M'}${p.x} ${p.y}`; }).join(' ');
  return (
    <svg viewBox="0 0 100 80" role="img" aria-label={`Schematic of reference plant ${SIM_PLANT.facility.code}: ${SIM_PLANT.assets.map((a) => a.tag).join(', ')}, with the operator inspection round`} className={className}>
      <g opacity="0.16" stroke={ink} strokeWidth="0.15">
        {Array.from({ length: 11 }, (_, i) => <line key={`v${i}`} x1={i * 10} x2={i * 10} y1="0" y2="80" />)}
        {Array.from({ length: 9 }, (_, i) => <line key={`h${i}`} y1={i * 10} y2={i * 10} x1="0" x2="100" />)}
      </g>
      {LINKS.map(([a, b]) => {
        const p = pos(a), q = pos(b);
        return <path key={a + b} d={`M${p.x} ${p.y} C ${(p.x + q.x) / 2} ${p.y}, ${(p.x + q.x) / 2} ${q.y}, ${q.x} ${q.y}`} fill="none" stroke={ink} strokeOpacity="0.45" strokeWidth="0.45" />;
      })}
      {showRoute && (
        <path d={route} fill="none" stroke={tone === 'paper' ? '#111211' : 'var(--color-lime)'} strokeWidth="0.55" className="flow-line flow-line-slow" style={{ strokeDasharray: '0.6 1.6' }} />
      )}
      {SIM_PLANT.assets.map((a) => {
        const p = pos(a.tag);
        const hot = a.tag === highlight;
        return (
          <g key={a.tag}>
            {hot && <circle cx={p.x} cy={p.y} r="3.2" fill="var(--color-high)" className="flow-pulse" />}
            <circle cx={p.x} cy={p.y} r={a.type === 'tank' || a.type === 'clarifier' ? 3 : 2} fill={hot ? 'var(--color-high)' : tone === 'paper' ? '#e9e9e7' : '#111211'} stroke={hot ? 'var(--color-high)' : ink} strokeWidth="0.45" />
            <text x={p.x + 3.6} y={p.y + 1} fontSize="2.6" fill={ink} fillOpacity="0.85" fontFamily="var(--font-sans)">{a.tag}</text>
          </g>
        );
      })}
    </svg>
  );
}

/* ---------- Small line icons for the frontline-realities grid ---------- */
export function RealityIcon({ kind }: { kind: 'noise' | 'wet' | 'gloves' | 'rounds' | 'permit' | 'light' }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <svg viewBox="0 0 48 48" width="48" height="48" aria-hidden>
      <circle cx="24" cy="24" r="23" fill="none" stroke="currentColor" strokeOpacity="0.2" />
      {kind === 'noise' && <g {...common}><path d="M14 20v8h5l7 6V14l-7 6z" /><path d="M30 19c2 2.5 2 7.5 0 10M33.5 16c4 4.5 4 11.5 0 16" /></g>}
      {kind === 'wet' && <g {...common}><path d="M24 12c5 7 8 11 8 15a8 8 0 0 1-16 0c0-4 3-8 8-15z" /><path d="M20 28a4 4 0 0 0 4 4" /></g>}
      {kind === 'gloves' && <g {...common}><path d="M17 35V22c0-1.5 2.5-1.5 2.5 0v-6c0-1.6 2.6-1.6 2.6 0v-2c0-1.6 2.6-1.6 2.6 0v2c0-1.6 2.6-1.6 2.6 0v8l2-2.6c1-1.3 3.2-.2 2.4 1.4L28 35z" /></g>}
      {kind === 'rounds' && <g {...common}><circle cx="15" cy="31" r="2.5" /><circle cx="33" cy="17" r="2.5" /><path d="M17 29c4-4 3-10 8-10s3 0 6-1" strokeDasharray="2 3" /></g>}
      {kind === 'permit' && <g {...common}><rect x="15" y="13" width="18" height="22" rx="2" /><path d="M19 19h10M19 24h10M19 29h6" /><circle cx="31" cy="31" r="4" fill="#0a0a0a" /><path d="M29.5 31l1 1 2-2" /></g>}
      {kind === 'light' && <g {...common}><circle cx="24" cy="24" r="5" /><path d="M24 13v3M24 32v3M13 24h3M32 24h3M16.5 16.5l2 2M29.5 29.5l2 2M16.5 31.5l2-2M29.5 18.5l2-2" /></g>}
    </svg>
  );
}
