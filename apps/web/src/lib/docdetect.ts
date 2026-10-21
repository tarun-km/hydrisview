'use client';
/**
 * Live A4 document detection + perspective correction for guided capture.
 *
 * Detection runs on a small downscaled frame (~200 px wide) every animation frame:
 *  1. grayscale → Otsu threshold → the paper is the largest bright connected region;
 *  2. its four corners are the extreme points along the diagonals (convex quad);
 *  3. the quad is scored: coverage of the view, A4 aspect (1:√2), corner angles (skew),
 *     border contact, sharpness (Laplacian variance) and stability between frames.
 * Capture warps the full-resolution photo to a flat 1240×1754 (A4 @150 dpi) page with a
 * homography and bilinear sampling, which is what OCR needs.
 */

export type Pt = { x: number; y: number };
export type Quad = [Pt, Pt, Pt, Pt]; // tl, tr, br, bl in 0..1 frame coordinates

export interface Detection {
  quad: Quad | null;
  coverage: number;
  aspect: number; // long / short side
  skewDeg: number; // max corner deviation from 90°
  tiltDeg: number; // in-plane rotation of the page (top edge vs horizontal)
  portrait: boolean;
  touchesEdge: boolean;
  sharpness: number;
}

export type GuidanceCode = 'no_document' | 'move_back' | 'move_closer' | 'straighten' | 'level' | 'flatten' | 'rotate' | 'hold_still' | 'ready';
export interface Guidance { code: GuidanceCode; message: string; ok: boolean }

const A4 = Math.SQRT2;
const DW = 200;

let work: { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null = null;
function small(src: CanvasImageSource, w: number, h: number) {
  const H = Math.max(1, Math.round((DW * h) / w));
  if (!work) {
    const c = document.createElement('canvas');
    work = { c, g: c.getContext('2d', { willReadFrequently: true })! };
  }
  work.c.width = DW;
  work.c.height = H;
  work.g.drawImage(src, 0, 0, DW, H);
  return { data: work.g.getImageData(0, 0, DW, H).data, W: DW, H };
}

function otsu(gray: Uint8Array): number {
  const hist = new Array<number>(256).fill(0);
  for (const v of gray) hist[v]!++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i]!;
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]!;
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t]!;
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      thr = t;
    }
  }
  return thr;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const angle = (a: Pt, b: Pt, c: Pt) => {
  const v1 = { x: a.x - b.x, y: a.y - b.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };
  const cos = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y) || 1);
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
};
const polyArea = (q: Pt[]) => Math.abs(q.reduce((s, p, i) => { const n = q[(i + 1) % q.length]!; return s + p.x * n.y - n.x * p.y; }, 0)) / 2;

/** Detect the brightest large quadrilateral (a sheet of paper) in a frame. */
export function detectDocument(src: CanvasImageSource, w: number, h: number): Detection {
  const { data, W, H } = small(src, w, h);
  const n = W * H;
  const gray = new Uint8Array(n);
  for (let i = 0; i < n; i++) gray[i] = (data[i * 4]! * 299 + data[i * 4 + 1]! * 587 + data[i * 4 + 2]! * 114) / 1000;
  const thr = Math.max(otsu(gray), 90);
  const bright = new Uint8Array(n);
  for (let i = 0; i < n; i++) bright[i] = gray[i]! > thr ? 1 : 0;

  // Largest bright connected component (4-connectivity; text inside the page is enclosed by paper).
  const label = new Int32Array(n).fill(-1);
  let bestId = -1;
  let bestSize = 0;
  const stack: number[] = [];
  let id = 0;
  for (let s = 0; s < n; s++) {
    if (!bright[s] || label[s] !== -1) continue;
    let size = 0;
    stack.push(s);
    label[s] = id;
    while (stack.length) {
      const p = stack.pop()!;
      size++;
      const x = p % W;
      const y = (p - x) / W;
      if (x > 0 && bright[p - 1] && label[p - 1] === -1) { label[p - 1] = id; stack.push(p - 1); }
      if (x < W - 1 && bright[p + 1] && label[p + 1] === -1) { label[p + 1] = id; stack.push(p + 1); }
      if (y > 0 && bright[p - W] && label[p - W] === -1) { label[p - W] = id; stack.push(p - W); }
      if (y < H - 1 && bright[p + W] && label[p + W] === -1) { label[p + W] = id; stack.push(p + W); }
    }
    if (size > bestSize) { bestSize = size; bestId = id; }
    id++;
  }
  const none: Detection = { quad: null, coverage: 0, aspect: 0, skewDeg: 90, tiltDeg: 0, portrait: true, touchesEdge: false, sharpness: 0 };
  if (bestId < 0 || bestSize < n * 0.06) return none;

  // Corners = extreme points along the two diagonals; edge contact counted on the border.
  let tl = { s: Infinity, x: 0, y: 0 }, br = { s: -Infinity, x: 0, y: 0 }, tr = { s: -Infinity, x: 0, y: 0 }, bl = { s: Infinity, x: 0, y: 0 };
  let edge = 0;
  for (let p = 0; p < n; p++) {
    if (label[p] !== bestId) continue;
    const x = p % W;
    const y = (p - x) / W;
    if (x === 0 || y === 0 || x === W - 1 || y === H - 1) edge++;
    const a = x + y;
    const d = x - y;
    if (a < tl.s) tl = { s: a, x, y };
    if (a > br.s) br = { s: a, x, y };
    if (d > tr.s) tr = { s: d, x, y };
    if (d < bl.s) bl = { s: d, x, y };
  }
  const q: Quad = [tl, tr, br, bl].map((c) => ({ x: (c.x + 0.5) / W, y: (c.y + 0.5) / H })) as Quad;
  // Measure in pixels so the frame aspect does not distort side lengths / angles.
  const px = q.map((p) => ({ x: p.x * w, y: p.y * h }));
  const top = dist(px[0]!, px[1]!), right = dist(px[1]!, px[2]!), bottom = dist(px[2]!, px[3]!), left = dist(px[3]!, px[0]!);
  const horiz = (top + bottom) / 2;
  const vert = (left + right) / 2;
  const angles = [angle(px[3]!, px[0]!, px[1]!), angle(px[0]!, px[1]!, px[2]!), angle(px[1]!, px[2]!, px[3]!), angle(px[2]!, px[3]!, px[0]!)];

  // Sharpness: Laplacian variance inside the quad's bounding box (relative units).
  const x0 = Math.floor(Math.min(...q.map((p) => p.x)) * W) + 2, x1 = Math.ceil(Math.max(...q.map((p) => p.x)) * W) - 2;
  const y0 = Math.floor(Math.min(...q.map((p) => p.y)) * H) + 2, y1 = Math.ceil(Math.max(...q.map((p) => p.y)) * H) - 2;
  let m = 0, m2 = 0, k = 0;
  for (let y = Math.max(1, y0); y < Math.min(H - 1, y1); y++) {
    for (let x = Math.max(1, x0); x < Math.min(W - 1, x1); x++) {
      const i = y * W + x;
      const lap = 4 * gray[i]! - gray[i - 1]! - gray[i + 1]! - gray[i - W]! - gray[i + W]!;
      m += lap; m2 += lap * lap; k++;
    }
  }
  const sharp = k ? m2 / k - (m / k) ** 2 : 0;

  return {
    quad: q,
    coverage: polyArea(px) / (w * h),
    aspect: Math.max(horiz, vert) / Math.max(1, Math.min(horiz, vert)),
    skewDeg: Math.max(...angles.map((a) => Math.abs(a - 90))),
    tiltDeg: (Math.atan2(px[1]!.y - px[0]!.y, px[1]!.x - px[0]!.x) * 180) / Math.PI,
    portrait: vert >= horiz,
    touchesEdge: edge > (2 * (W + H)) * 0.08,
    sharpness: sharp,
  };
}

/** Turn a detection into one actionable instruction for the wearer. */
export function guide(d: Detection, stable: boolean): Guidance {
  if (!d.quad) return { code: 'no_document', message: 'Place the A4 sheet in view, on a dark surface', ok: false };
  if (d.touchesEdge || d.coverage > 0.92) return { code: 'move_back', message: 'Move back - show all four corners of the page', ok: false };
  if (d.coverage < 0.28) return { code: 'move_closer', message: 'Move closer - fill the frame with the page', ok: false };
  if (!d.portrait) return { code: 'rotate', message: 'Turn the sheet to portrait (long side vertical)', ok: false };
  if (d.skewDeg > 10) return { code: 'straighten', message: 'Look straight down at the page - reduce the tilt', ok: false };
  if (Math.abs(d.tiltDeg) > 8) return { code: 'level', message: `Level the page - rotate it ${d.tiltDeg > 0 ? 'left' : 'right'} until upright`, ok: false };
  if (Math.abs(d.aspect - A4) > 0.2) return { code: 'flatten', message: 'Hold the sheet flat and square to your view', ok: false };
  if (!stable || d.sharpness < 60) return { code: 'hold_still', message: 'Hold still…', ok: false };
  return { code: 'ready', message: 'Perfect - capturing', ok: true };
}

/** Max corner movement between two quads (fraction of the frame). */
export function quadMotion(a: Quad | null, b: Quad | null): number {
  if (!a || !b) return 1;
  return Math.max(...a.map((p, i) => dist(p, b[i]!)));
}

// ------------------------------------------------------------------ perspective correction
/** Homography mapping the unit square corners (0,0),(1,0),(1,1),(0,1) to quad `q` (pixels). */
function squareToQuad(q: Pt[]): number[] {
  const [p0, p1, p2, p3] = q as [Pt, Pt, Pt, Pt];
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
  const den = dx1 * dy2 - dx2 * dy1 || 1e-9;
  const g = (dx3 * dy2 - dx2 * dy3) / den;
  const h = (dx1 * dy3 - dx3 * dy1) / den;
  return [p1.x - p0.x + g * p1.x, p3.x - p0.x + h * p3.x, p0.x, p1.y - p0.y + g * p1.y, p3.y - p0.y + h * p3.y, p0.y, g, h];
}

/** Warp the page inside `quad` (0..1 coordinates of `src`) to a flat A4 canvas. */
export function warpToA4(src: HTMLCanvasElement | HTMLImageElement | ImageBitmap, quad: Quad, outW = 1654): HTMLCanvasElement {
  const sw = src.width;
  const sh = src.height;
  const sc = document.createElement('canvas');
  sc.width = sw;
  sc.height = sh;
  const sg = sc.getContext('2d', { willReadFrequently: true })!;
  sg.drawImage(src, 0, 0);
  const s = sg.getImageData(0, 0, sw, sh).data;
  const outH = Math.round(outW * A4);
  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const og = out.getContext('2d')!;
  const o = og.createImageData(outW, outH);
  const [a, b, c, d, e, f, g, h] = squareToQuad(quad.map((p) => ({ x: p.x * sw, y: p.y * sh })));
  for (let y = 0; y < outH; y++) {
    const v = (y + 0.5) / outH;
    for (let x = 0; x < outW; x++) {
      const u = (x + 0.5) / outW;
      const w = g! * u + h! * v + 1;
      const sx = (a! * u + b! * v + c!) / w - 0.5;
      const sy = (d! * u + e! * v + f!) / w - 0.5;
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const fx = sx - x0, fy = sy - y0;
      const k = (y * outW + x) * 4;
      if (x0 < 0 || y0 < 0 || x0 >= sw - 1 || y0 >= sh - 1) { o.data[k] = o.data[k + 1] = o.data[k + 2] = 255; o.data[k + 3] = 255; continue; }
      const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
      for (let ch = 0; ch < 3; ch++) {
        o.data[k + ch] = (s[i00 + ch]! * (1 - fx) + s[i10 + ch]! * fx) * (1 - fy) + (s[i01 + ch]! * (1 - fx) + s[i11 + ch]! * fx) * fy;
      }
      o.data[k + 3] = 255;
    }
  }
  og.putImageData(o, 0, 0);
  return out;
}

/** Shrink a quad slightly toward its centre-free margin so the paper edge shadow is excluded. */
export function insetQuad(q: Quad, amount = 0.004): Quad {
  const cx = q.reduce((s, p) => s + p.x, 0) / 4;
  const cy = q.reduce((s, p) => s + p.y, 0) / 4;
  return q.map((p) => ({ x: p.x + Math.sign(cx - p.x) * amount, y: p.y + Math.sign(cy - p.y) * amount })) as Quad;
}
