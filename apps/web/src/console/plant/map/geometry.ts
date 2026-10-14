import type { AssetSummary, InspectionTemplate } from '../types';

export interface Pt { x: number; y: number }

export const WALK_SPEED_MPS = 1.2;

export const hasPos = (a: Pick<AssetSummary, 'positionX' | 'positionY'>): a is AssetSummary & { positionX: number; positionY: number } =>
  a.positionX !== null && a.positionY !== null && Number.isFinite(a.positionX) && Number.isFinite(a.positionY);

export interface RouteStop {
  index: number;
  asset: AssetSummary | null; // null when the asset no longer exists / is archived
  assetId: string;
  pos: Pt | null;
  /** Straight-line metres from the previous positioned stop. */
  leg: number;
  /** Cumulative metres from the first positioned stop. */
  at: number;
  minutes: number | null;
}

export interface RouteMetrics {
  stops: RouteStop[];
  distanceM: number;
  walkMinutes: number;
  inspectMinutes: number;
  totalMinutes: number;
  unpositioned: number;
  missingEstimate: number;
}

/** Template used per stop at dispatch: the published template for the asset type (API rule). */
export function templateFor(asset: AssetSummary | null, templates: InspectionTemplate[], fallbackId?: string | null) {
  const published = templates.filter((t) => t.status === 'published');
  return (asset && published.find((t) => t.assetType === asset.type)) ?? (fallbackId ? published.find((t) => t.id === fallbackId) : undefined) ?? null;
}

export function routeMetrics(assetIds: string[], byId: Map<string, AssetSummary>, templates: InspectionTemplate[], fallbackId?: string | null): RouteMetrics {
  let prev: Pt | null = null;
  let at = 0;
  let unpositioned = 0, missingEstimate = 0, inspectMinutes = 0;
  const stops: RouteStop[] = assetIds.map((id, index) => {
    const asset = byId.get(id) ?? null;
    const pos = asset && hasPos(asset) ? { x: asset.positionX, y: asset.positionY } : null;
    let leg = 0;
    if (pos) {
      if (prev) leg = Math.hypot(pos.x - prev.x, pos.y - prev.y);
      at += leg;
      prev = pos;
    } else unpositioned++;
    const tpl = templateFor(asset, templates, fallbackId);
    const minutes = tpl?.estimatedMinutes ?? null;
    if (minutes === null) missingEstimate++;
    else inspectMinutes += minutes;
    return { index, asset, assetId: id, pos, leg, at, minutes };
  });
  const walkMinutes = at / WALK_SPEED_MPS / 60;
  return { stops, distanceM: at, walkMinutes, inspectMinutes, totalMinutes: walkMinutes + inspectMinutes, unpositioned, missingEstimate };
}

export function fmtMinutes(m: number) {
  if (m < 1) return '< 1 min';
  const r = Math.round(m);
  return r < 60 ? `${r} min` : `${Math.floor(r / 60)} h ${String(r % 60).padStart(2, '0')} min`;
}
export const fmtMetres = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);

/** Small deterministic PRNG so decorative contours are stable per site. */
function rng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Decorative contour-like rings (BikeRoute topo backdrop) in layout metres. Purely visual —
 * they do not represent real elevation and are drawn at very low contrast.
 */
export function contourPaths(w: number, h: number, seed: string): string[] {
  const r = rng(seed);
  const out: string[] = [];
  const centers = 3 + Math.floor(r() * 2);
  const span = Math.max(w, h);
  for (let c = 0; c < centers; c++) {
    const cx = w * (0.1 + r() * 0.8), cy = h * (0.1 + r() * 0.8);
    const p1 = r() * Math.PI * 2, p2 = r() * Math.PI * 2, p3 = r() * Math.PI * 2;
    const a1 = 0.12 + r() * 0.12, a2 = 0.05 + r() * 0.08;
    const rings = 7 + Math.floor(r() * 5);
    const step = span * (0.035 + r() * 0.02);
    for (let k = 1; k <= rings; k++) {
      const base = k * step;
      const n = 48;
      const pts: Pt[] = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const rr = base * (1 + a1 * Math.sin(3 * a + p1 + k * 0.15) + a2 * Math.sin(5 * a + p2) + 0.04 * Math.sin(9 * a + p3 + k));
        pts.push({ x: cx + rr * Math.cos(a), y: cy + rr * Math.sin(a) * 0.78 });
      }
      // Smooth closed path through midpoints.
      const mid = (a: Pt, b: Pt) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      const m0 = mid(pts[n - 1]!, pts[0]!);
      let d = `M${m0.x.toFixed(2)},${m0.y.toFixed(2)}`;
      for (let i = 0; i < n; i++) {
        const p = pts[i]!, m = mid(p, pts[(i + 1) % n]!);
        d += ` Q${p.x.toFixed(2)},${p.y.toFixed(2)} ${m.x.toFixed(2)},${m.y.toFixed(2)}`;
      }
      out.push(`${d} Z`);
    }
  }
  return out;
}

/** Nice grid / scale-bar step (metres) so that one step is at least `minPx` on screen. */
export function niceStep(pxPerM: number, minPx: number) {
  const steps = [0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];
  return steps.find((s) => s * pxPerM >= minPx) ?? 5000;
}

export function polygonCentroid(poly: [number, number][]): Pt {
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
}
