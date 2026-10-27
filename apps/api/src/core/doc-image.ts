/**
 * Server-side page image preprocessing for audit scans (sharp + a little pixel math in JS).
 *
 * A photo of a paper record (glasses, phone or webcam) becomes a clean, A4-proportioned page:
 *   1. auto-rotate by EXIF,
 *   2. find the sheet (largest bright region) and, when background is visible, perspective-correct
 *      its four corners straight onto an A4 canvas (this also removes rotation and keystone),
 *   3. otherwise (already flat scans) deskew by projection profile and crop the margins,
 *   4. contrast-normalise and place on a 1654 x 2339 px page (A4 at 200 dpi).
 *
 * Figures (photos, diagrams, signatures) are located as ink regions that no OCR word covers and
 * cropped from the clean page for the re-typeset soft copy.
 */
import sharp, { type Sharp, type OutputInfo } from 'sharp';
import type { AuditFigure, BBox, OcrReading } from '@hydris/domain';

export const A4_W = 1654;
export const A4_H = 2339;

export interface CleanPage {
  mime: 'image/jpeg';
  data: string; // base64
  width: number;
  height: number;
  /** What was done, for the processing report. */
  steps: string[];
  /** Detected skew (deg) or 'perspective' when the sheet corners were found. */
  correction: 'perspective' | 'deskew' | 'none';
}

type Pt = { x: number; y: number };

/** Otsu threshold of an 8-bit luminance histogram. */
function otsu(hist: Uint32Array, total: number): number {
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
    if (between > best) { best = between; thr = t; }
  }
  return thr;
}

function luminance(rgb: Buffer, n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (rgb[i * 3]! * 299 + rgb[i * 3 + 1]! * 587 + rgb[i * 3 + 2]! * 114) / 1000;
  return out;
}

/**
 * Sheet corners in a downscaled luminance image: the largest connected bright region, corners from
 * the extremes of x+y and x-y. Returns null when the sheet fills (almost) the whole frame.
 */
export function findSheet(lum: Uint8Array, W: number, H: number): { quad: [Pt, Pt, Pt, Pt]; coverage: number } | null {
  const hist = new Uint32Array(256);
  for (const v of lum) hist[v]!++;
  const thr = otsu(hist, lum.length);
  // A sheet needs real contrast with its background (dark desk, table, hand).
  const mean = (a: number, b: number) => { let s = 0; let n = 0; for (let i = a; i <= b; i++) { s += i * hist[i]!; n += hist[i]!; } return n ? s / n : 0; };
  if (mean(thr + 1, 255) - mean(0, thr) < 60) return null;
  const bright = new Uint8Array(lum.length);
  for (let i = 0; i < lum.length; i++) bright[i] = lum[i]! > thr ? 1 : 0;
  // Close small gaps (text on the sheet is dark): mark a pixel bright if most of its 5x5 block is bright is costly;
  // instead flood through dark pixels that are enclosed by the sheet later via the convex corners.
  const label = new Int32Array(lum.length).fill(-1);
  let bestId = -1;
  let bestN = 0;
  let id = 0;
  const stack: number[] = [];
  for (let i = 0; i < lum.length; i++) {
    if (!bright[i] || label[i] !== -1) continue;
    let n = 0;
    stack.push(i);
    label[i] = id;
    while (stack.length) {
      const c = stack.pop()!;
      n++;
      const x = c % W;
      const y = (c - x) / W;
      if (x > 0 && bright[c - 1] && label[c - 1] === -1) { label[c - 1] = id; stack.push(c - 1); }
      if (x < W - 1 && bright[c + 1] && label[c + 1] === -1) { label[c + 1] = id; stack.push(c + 1); }
      if (y > 0 && bright[c - W] && label[c - W] === -1) { label[c - W] = id; stack.push(c - W); }
      if (y < H - 1 && bright[c + W] && label[c + W] === -1) { label[c + W] = id; stack.push(c + W); }
    }
    if (n > bestN) { bestN = n; bestId = id; }
    id++;
  }
  if (bestId < 0) return null;
  let tl = { x: 0, y: 0, s: Infinity };
  let br = { x: 0, y: 0, s: -Infinity };
  let tr = { x: 0, y: 0, s: -Infinity };
  let bl = { x: 0, y: 0, s: Infinity };
  let touches = 0;
  for (let i = 0; i < lum.length; i++) {
    if (label[i] !== bestId) continue;
    const x = i % W;
    const y = (i - x) / W;
    if (x === 0 || y === 0 || x === W - 1 || y === H - 1) touches++;
    if (x + y < tl.s) tl = { x, y, s: x + y };
    if (x + y > br.s) br = { x, y, s: x + y };
    if (x - y > tr.s) tr = { x, y, s: x - y };
    if (x - y < bl.s) bl = { x, y, s: x - y };
  }
  const quad: [Pt, Pt, Pt, Pt] = [tl, tr, br, bl].map((p) => ({ x: p.x, y: p.y })) as [Pt, Pt, Pt, Pt];
  const area = Math.abs(quad.reduce((s, p, i) => { const q = quad[(i + 1) % 4]!; return s + p.x * q.y - q.x * p.y; }, 0)) / 2;
  const coverage = area / (W * H);
  // Sheet touching the frame on a long run means the corners are not all visible.
  if (coverage < 0.15 || coverage > 0.93 || touches > (W + H) * 0.25) return null;
  return { quad, coverage };
}

/** Homography mapping the unit rectangle (dst w x h) to the source quad (tl, tr, br, bl). */
function homography(w: number, h: number, q: [Pt, Pt, Pt, Pt]): number[] {
  const src = [[0, 0], [w, 0], [w, h], [0, h]] as const;
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i]!;
    const { x: u, y: v } = q[i]!;
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  // Gaussian elimination with partial pivoting.
  const n = 8;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[p]![c]!)) p = r;
    [A[c], A[p]] = [A[p]!, A[c]!];
    [b[c], b[p]] = [b[p]!, b[c]!];
    for (let r = c + 1; r < n; r++) {
      const f = A[r]![c]! / A[c]![c]!;
      for (let k = c; k < n; k++) A[r]![k]! -= f * A[c]![k]!;
      b[r]! -= f * b[c]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r]!;
    for (let k = r + 1; k < n; k++) s -= A[r]![k]! * x[k]!;
    x[r] = s / A[r]![r]!;
  }
  return [...x, 1];
}

function warp(rgb: Buffer, W: number, H: number, quad: [Pt, Pt, Pt, Pt], ow: number, oh: number): Buffer {
  const m = homography(ow, oh, quad);
  const out = Buffer.alloc(ow * oh * 3, 255);
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      const d = m[6]! * x + m[7]! * y + m[8]!;
      const sx = (m[0]! * x + m[1]! * y + m[2]!) / d;
      const sy = (m[3]! * x + m[4]! * y + m[5]!) / d;
      if (sx < 0 || sy < 0 || sx >= W - 1 || sy >= H - 1) continue;
      const x0 = sx | 0;
      const y0 = sy | 0;
      const fx = sx - x0;
      const fy = sy - y0;
      const i00 = (y0 * W + x0) * 3;
      const i10 = i00 + 3;
      const i01 = i00 + W * 3;
      const i11 = i01 + 3;
      const o = (y * ow + x) * 3;
      for (let c = 0; c < 3; c++) {
        const top = rgb[i00 + c]! * (1 - fx) + rgb[i10 + c]! * fx;
        const bot = rgb[i01 + c]! * (1 - fx) + rgb[i11 + c]! * fx;
        out[o + c] = top * (1 - fy) + bot * fy;
      }
    }
  }
  return out;
}

/** Text skew (deg) by projection profile: the angle whose row histogram of dark pixels is sharpest. */
export function estimateSkew(lum: Uint8Array, W: number, H: number, maxDeg = 8): number {
  const hist = new Uint32Array(256);
  for (const v of lum) hist[v]!++;
  const thr = Math.min(otsu(hist, lum.length), 160);
  const pts: number[] = [];
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) if (lum[y * W + x]! < thr) pts.push(x, y);
  if (pts.length < 200) return 0;
  const step = Math.max(1, Math.floor(pts.length / 2 / 40000));
  const score = (deg: number) => {
    const t = (deg * Math.PI) / 180;
    const s = Math.sin(t);
    const c = Math.cos(t);
    const bins = new Float64Array(H * 2 + W);
    for (let i = 0; i < pts.length; i += 2 * step) bins[Math.round(pts[i + 1]! * c - pts[i]! * s + W)]! += 1;
    let v = 0;
    for (let i = 1; i < bins.length; i++) v += (bins[i]! - bins[i - 1]!) ** 2;
    return v;
  };
  let best = 0;
  let bestS = -1;
  for (let d = -maxDeg; d <= maxDeg + 1e-9; d += 0.5) { const s = score(d); if (s > bestS) { bestS = s; best = d; } }
  for (let d = best - 0.4; d <= best + 0.4 + 1e-9; d += 0.1) { const s = score(d); if (s > bestS) { bestS = s; best = d; } }
  return Math.round(best * 10) / 10;
}

const ANALYSIS = 900;

/** Photo or scan → clean A4 page (JPEG). Never throws on odd images: falls back to a plain fit. */
export async function cleanPage(input: Buffer): Promise<CleanPage> {
  const steps: string[] = ['EXIF orientation applied'];
  const base = sharp(input, { failOn: 'none' }).rotate();
  const { data: full, info } = await base.clone().removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const k = Math.min(1, ANALYSIS / Math.max(W, H));
  const sw = Math.max(1, Math.round(W * k));
  const sh = Math.max(1, Math.round(H * k));
  const small = await sharp(full, { raw: { width: W, height: H, channels: 3 } }).resize(sw, sh, { fit: 'fill' }).raw().toBuffer();
  const lum = luminance(small, sw * sh);
  const sheet = findSheet(lum, sw, sh);

  let page: Sharp;
  let correction: CleanPage['correction'] = 'none';
  if (sheet) {
    const cx = sheet.quad.reduce((s, p) => s + p.x, 0) / 4;
    const cy = sheet.quad.reduce((s, p) => s + p.y, 0) / 4;
    // Pull the corners in slightly so no desk shows along the page edges.
    const q = sheet.quad.map((p) => ({ x: (cx + (p.x - cx) * 0.988) / k, y: (cy + (p.y - cy) * 0.988) / k })) as [Pt, Pt, Pt, Pt];
    const d = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
    const landscape = (d(q[0], q[1]) + d(q[3], q[2])) > (d(q[0], q[3]) + d(q[1], q[2])) * 1.15;
    const [ow, oh] = landscape ? [A4_H, A4_W] : [A4_W, A4_H];
    const flat = warp(full, W, H, q, ow, oh);
    page = sharp(flat, { raw: { width: ow, height: oh, channels: 3 } });
    correction = 'perspective';
    steps.push(`Sheet found (${Math.round(sheet.coverage * 100)}% of frame) - perspective corrected to A4`);
  } else {
    const skew = estimateSkew(lum, sw, sh);
    let img = sharp(full, { raw: { width: W, height: H, channels: 3 } });
    if (Math.abs(skew) >= 0.3) {
      const r = await img.rotate(-skew, { background: '#ffffff' }).raw().toBuffer({ resolveWithObject: true });
      img = sharp(r.data, { raw: { width: r.info.width, height: r.info.height, channels: r.info.channels } });
      correction = 'deskew';
      steps.push(`Deskewed by ${-skew}°`);
    }
    // Crop white margins, then re-margin uniformly on the A4 page.
    let trimmed: { data: Buffer; info: OutputInfo };
    try {
      trimmed = await img.trim({ background: '#ffffff', threshold: 40 }).raw().toBuffer({ resolveWithObject: true });
      steps.push('Margins cropped');
    } catch {
      trimmed = await img.raw().toBuffer({ resolveWithObject: true });
    }
    const t = trimmed.info;
    const landscape = t.width > t.height * 1.15;
    const [ow, oh] = landscape ? [A4_H, A4_W] : [A4_W, A4_H];
    const m = Math.round(ow * 0.06);
    const inner = await sharp(trimmed.data, { raw: { width: t.width, height: t.height, channels: t.channels } })
      .resize(ow - 2 * m, oh - 2 * m, { fit: 'inside', withoutEnlargement: false, background: '#ffffff' }).raw().toBuffer({ resolveWithObject: true });
    page = sharp({ create: { width: ow, height: oh, channels: 3, background: '#ffffff' } })
      .composite([{ input: inner.data, raw: { width: inner.info.width, height: inner.info.height, channels: inner.info.channels }, left: m, top: m }]);
  }
  const out = await sharp(await page.png().toBuffer()).normalise({ lower: 1, upper: 99 }).sharpen({ sigma: 0.8 }).jpeg({ quality: 86, mozjpeg: true }).toBuffer({ resolveWithObject: true });
  steps.push(`Contrast normalised · ${out.info.width}x${out.info.height} px (A4 @ 200 dpi)`);
  return { mime: 'image/jpeg', data: out.data.toString('base64'), width: out.info.width, height: out.info.height, steps, correction };
}

/**
 * Figures on a clean page: regions of ink (dark or colourful) that no confident OCR word covers.
 * Same idea as the on-device detector (apps/web/src/lib/ocr.ts), run on the server's clean page.
 */
export async function detectFigures(jpeg: Buffer, readings: OcrReading[], page: number): Promise<AuditFigure[]> {
  const meta = await sharp(jpeg).metadata();
  const GX = 60;
  const GY = Math.round(GX * ((meta.height ?? A4_H) / (meta.width ?? A4_W)));
  const { data: px } = await sharp(jpeg).resize(GX * 4, GY * 4, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const words = readings.flatMap((r) => r.lines.flatMap((l) => l.words)).filter((w) => w.conf >= 70 && /[A-Za-z0-9]{2,}/.test(w.text));
  const lines = readings[0]?.lines ?? [];
  const ink = new Uint8Array(GX * GY);
  const colour = new Float32Array(GX * GY);
  for (let gy = 0; gy < GY; gy++) {
    for (let gx = 0; gx < GX; gx++) {
      let dark = 0;
      let sat = 0;
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          const k = ((gy * 4 + y) * GX * 4 + gx * 4 + x) * 3;
          const r = px[k]!;
          const g = px[k + 1]!;
          const b = px[k + 2]!;
          if ((r + g + b) / 3 < 200) dark++;
          sat += Math.max(r, g, b) - Math.min(r, g, b);
        }
      }
      const cx = (gx + 0.5) / GX;
      const cy = (gy + 0.5) / GY;
      const covered = words.some((w) => cx >= w.bbox[0] - 0.01 && cx <= w.bbox[0] + w.bbox[2] + 0.01 && cy >= w.bbox[1] - 0.006 && cy <= w.bbox[1] + w.bbox[3] + 0.006);
      colour[gy * GX + gx] = sat / 16;
      ink[gy * GX + gx] = !covered && (dark >= 3 || sat / 16 > 40) ? 1 : 0;
    }
  }
  const seen = new Uint8Array(GX * GY);
  const out: AuditFigure[] = [];
  for (let i = 0; i < GX * GY; i++) {
    if (!ink[i] || seen[i]) continue;
    const stack = [i];
    seen[i] = 1;
    let x0 = GX; let y0 = GY; let x1 = 0; let y1 = 0; let n = 0; let col = 0;
    while (stack.length) {
      const c = stack.pop()!;
      const x = c % GX;
      const y = (c - x) / GX;
      n++;
      col += colour[c]!;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= GX || ny >= GY) continue;
          const j = ny * GX + nx;
          if (ink[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
        }
      }
    }
    const w = (x1 - x0 + 1) / GX;
    const h = (y1 - y0 + 1) / GY;
    if (n < 6 || w * h < 0.004 || w > 0.95 || h > 0.9 || h < 0.015 || w < 0.015) continue;
    const fill = n / ((x1 - x0 + 1) * (y1 - y0 + 1));
    if (fill < 0.12 && w * h > 0.05) continue;
    const bbox: BBox = [Math.max(0, x0 / GX - 0.004), Math.max(0, y0 / GY - 0.004), Math.min(1, w + 0.008), Math.min(1, h + 0.008)];
    const nearSig = lines.some((l) => /sign/i.test(l.text) && Math.abs(l.bbox[1] + l.bbox[3] / 2 - (bbox[1] + bbox[3] / 2)) < 0.04);
    const kind: AuditFigure['kind'] = nearSig || (w > h * 2.5 && fill < 0.5) ? 'signature' : bbox[1] < 0.12 && w * h < 0.03 ? 'logo' : col / n > 30 || fill > 0.6 ? 'photo' : 'diagram';
    const caption = { signature: 'Handwritten signature', logo: 'Logo / letterhead mark', photo: 'Photo / image region', diagram: 'Drawing or mark' }[kind as 'signature' | 'logo' | 'photo' | 'diagram'];
    out.push({ id: `p${page}-g${out.length + 1}`, page, bbox, kind, caption });
  }
  return out.slice(0, 12);
}

/** PNG crop of a normalised box from a page image. */
export async function cropBox(jpeg: Buffer, box: BBox, maxSide = 900): Promise<{ png: Buffer; width: number; height: number }> {
  const meta = await sharp(jpeg).metadata();
  const W = meta.width ?? A4_W;
  const H = meta.height ?? A4_H;
  const left = Math.max(0, Math.round(box[0] * W));
  const top = Math.max(0, Math.round(box[1] * H));
  const width = Math.max(1, Math.min(W - left, Math.round(box[2] * W)));
  const height = Math.max(1, Math.min(H - top, Math.round(box[3] * H)));
  const r = await sharp(jpeg).extract({ left, top, width, height }).resize(maxSide, maxSide, { fit: 'inside', withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
  return { png: r.data, width: r.info.width, height: r.info.height };
}
