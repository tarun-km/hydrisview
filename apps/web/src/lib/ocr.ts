'use client';
/**
 * On-device OCR for audit scans (Tesseract.js, WebAssembly, runs in the browser / glasses web view).
 *
 * Each page is read twice, independently:
 *   - `ocr:original`  the photo as captured (downscaled),
 *   - `ocr:enhanced`  a contrast-normalized, binarized copy (different errors on glare/shadows).
 * The server cross-checks the two readings value by value (and against the vision engine when it
 * is configured), which is the machine half of the dual verification.
 */
import type { AuditFigure, OcrLine, OcrReading } from '@hydris/domain';

export interface PreparedPage { mime: 'image/jpeg'; data: string; width: number; height: number; dataUrl: string }
export interface ScannedPage extends PreparedPage { readings: OcrReading[]; figures: AuditFigure[] }
export type OcrProgress = (p: { stage: string; progress: number }) => void;

const MAX_SIDE = 2400;
const MAX_BYTES = 850 * 1024;

type TesseractWorker = Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>>;
let workerP: Promise<TesseractWorker> | null = null;
let progressCb: OcrProgress | null = null;

async function worker(): Promise<TesseractWorker> {
  workerP ??= import('tesseract.js').then(({ createWorker }) =>
    createWorker('eng', 1, {
      logger: (m: { status: string; progress: number }) => progressCb?.({ stage: m.status, progress: m.progress }),
    }),
  ).catch((e) => {
    workerP = null;
    throw e;
  });
  return workerP;
}

/** Start loading the OCR engine early (language data is cached by the browser afterwards). */
export function warmUpOcr() {
  void worker().catch(() => {});
}

export async function loadImage(src: string | Blob): Promise<HTMLImageElement> {
  const url = typeof src === 'string' ? src : URL.createObjectURL(src);
  const img = new Image();
  img.decoding = 'async';
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error('Could not read the image'));
    img.src = url;
  });
  return img;
}

function canvasOf(src: CanvasImageSource, w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, w, h);
  g.drawImage(src, 0, 0, w, h);
  return { c, g };
}

/** Downscale and JPEG-encode under the upload budget. */
export async function preparePage(src: CanvasImageSource & { width: number; height: number }): Promise<PreparedPage> {
  let scale = Math.min(1, MAX_SIDE / Math.max(src.width, src.height));
  for (let attempt = 0; attempt < 6; attempt++) {
    const w = Math.round(src.width * scale);
    const h = Math.round(src.height * scale);
    const { c } = canvasOf(src, w, h);
    for (const q of [0.85, 0.75, 0.65]) {
      const dataUrl = c.toDataURL('image/jpeg', q);
      const data = dataUrl.slice(dataUrl.indexOf(',') + 1);
      if (data.length * 0.75 <= MAX_BYTES) return { mime: 'image/jpeg', data, width: w, height: h, dataUrl };
    }
    scale *= 0.8;
  }
  throw new Error('This image is too large to upload');
}

/** Grayscale + percentile contrast stretch + local (Bradley) threshold → crisp black text on white. */
function enhanced(img: HTMLImageElement): HTMLCanvasElement {
  const { c, g } = canvasOf(img, img.width, img.height);
  const d = g.getImageData(0, 0, c.width, c.height);
  const px = d.data;
  const n = c.width * c.height;
  const gray = new Uint8ClampedArray(n);
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    const v = (px[i * 4]! * 299 + px[i * 4 + 1]! * 587 + px[i * 4 + 2]! * 114) / 1000;
    gray[i] = v;
    hist[gray[i]!]!++;
  }
  let lo = 0;
  let hi = 255;
  for (let acc = 0; lo < 255 && (acc += hist[lo]!) < n * 0.01; lo++);
  for (let acc = 0; hi > 0 && (acc += hist[hi]!) < n * 0.01; hi--);
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < n; i++) gray[i] = ((gray[i]! - lo) * 255) / span;
  // Integral image for adaptive thresholding (handles shadows and uneven light from head-worn cameras).
  const W = c.width;
  const H = c.height;
  const integral = new Float64Array((W + 1) * (H + 1));
  for (let y = 1; y <= H; y++) {
    let row = 0;
    for (let x = 1; x <= W; x++) {
      row += gray[(y - 1) * W + (x - 1)]!;
      integral[y * (W + 1) + x] = integral[(y - 1) * (W + 1) + x]! + row;
    }
  }
  const r = Math.max(8, Math.round(Math.min(W, H) / 32));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - r);
      const y0 = Math.max(0, y - r);
      const x1 = Math.min(W, x + r + 1);
      const y1 = Math.min(H, y + r + 1);
      const sum = integral[y1 * (W + 1) + x1]! - integral[y0 * (W + 1) + x1]! - integral[y1 * (W + 1) + x0]! + integral[y0 * (W + 1) + x0]!;
      const mean = sum / ((x1 - x0) * (y1 - y0));
      const v = gray[y * W + x]! < mean * 0.85 ? 0 : 255;
      const k = (y * W + x) * 4;
      px[k] = px[k + 1] = px[k + 2] = v;
      px[k + 3] = 255;
    }
  }
  // Remove ruling lines (table borders, underlines, form boxes) so the text inside cells is read as
  // ordinary rows instead of being skipped as graphics.
  const black = (x: number, y: number) => px[(y * W + x) * 4] === 0;
  const clear = (x: number, y: number) => { const k = (y * W + x) * 4; px[k] = px[k + 1] = px[k + 2] = 255; };
  const minH = Math.round(W * 0.2);
  for (let y = 0; y < H; y++) {
    let start = -1;
    for (let x = 0; x <= W; x++) {
      if (x < W && black(x, y)) { if (start < 0) start = x; continue; }
      if (start >= 0 && x - start >= minH) for (let i = start; i < x; i++) clear(i, y);
      start = -1;
    }
  }
  const minV = Math.round(H * 0.028);
  for (let x = 0; x < W; x++) {
    let start = -1;
    for (let y = 0; y <= H; y++) {
      if (y < H && black(x, y)) { if (start < 0) start = y; continue; }
      if (start >= 0 && y - start >= minV) for (let i = start; i < y; i++) clear(x, i);
      start = -1;
    }
  }
  g.putImageData(d, 0, 0);
  return c;
}

type TBox = { x0: number; y0: number; x1: number; y1: number };
const norm = (b: TBox, W: number, H: number): [number, number, number, number] => [b.x0 / W, b.y0 / H, (b.x1 - b.x0) / W, (b.y1 - b.y0) / H];

async function read(engine: string, image: HTMLCanvasElement | HTMLImageElement, W: number, H: number): Promise<OcrReading> {
  const w = await worker();
  const { data } = await w.recognize(image, {}, { blocks: true, text: true });
  const lines: OcrLine[] = [];
  for (const b of data.blocks ?? []) {
    for (const p of b.paragraphs) {
      for (const l of p.lines) {
        const words = l.words.filter((wd) => wd.text.trim()).map((wd) => ({ text: wd.text, conf: wd.confidence, bbox: norm(wd.bbox, W, H) }));
        if (!words.length) continue;
        lines.push({ text: l.text.replace(/\s+$/, ''), conf: l.confidence, bbox: norm(l.bbox, W, H), words });
      }
    }
  }
  return { engine, text: data.text, conf: data.confidence, lines };
}

/**
 * Figure detection without AI: regions with ink (dark or colourful pixels) that no OCR word covers.
 * A coarse grid is flood-filled into connected components; large ones are photos/diagrams, thin wide
 * ones next to a "signature" label are signatures. Each becomes a cropped image in the PDF.
 */
function detectFigures(img: HTMLImageElement, readings: OcrReading[], page: number): AuditFigure[] {
  const GX = 48;
  const GY = Math.round(GX * (img.height / img.width));
  const { g } = canvasOf(img, GX * 4, GY * 4);
  const px = g.getImageData(0, 0, GX * 4, GY * 4).data;
  // Only confident words count as text: OCR noise over photos/signatures must not hide them.
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
          const k = ((gy * 4 + y) * GX * 4 + gx * 4 + x) * 4;
          const r = px[k]!;
          const gg = px[k + 1]!;
          const b = px[k + 2]!;
          if ((r + gg + b) / 3 < 200) dark++;
          sat += Math.max(r, gg, b) - Math.min(r, gg, b);
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
    let x0 = GX;
    let y0 = GY;
    let x1 = 0;
    let y1 = 0;
    let n = 0;
    let col = 0;
    while (stack.length) {
      const c = stack.pop()!;
      const x = c % GX;
      const y = (c - x) / GX;
      n++;
      col += colour[c]!;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= GX || ny >= GY) continue;
          const j = ny * GX + nx;
          if (ink[j] && !seen[j]) {
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
    }
    const w = (x1 - x0 + 1) / GX;
    const h = (y1 - y0 + 1) / GY;
    // Skip specks, rules (thin lines), page-wide borders and table grids (mostly empty boxes).
    if (n < 6 || w * h < 0.004 || w > 0.95 || h > 0.9 || h < 0.015 || w < 0.015) continue;
    if (n / ((x1 - x0 + 1) * (y1 - y0 + 1)) < 0.12 && w * h > 0.05) continue;
    const bbox: [number, number, number, number] = [Math.max(0, x0 / GX - 0.005), Math.max(0, y0 / GY - 0.005), Math.min(1, w + 0.01), Math.min(1, h + 0.01)];
    const nearSig = lines.some((l) => /sign/i.test(l.text) && Math.abs(l.bbox[1] + l.bbox[3] / 2 - (bbox[1] + bbox[3] / 2)) < 0.04);
    const fill = n / ((x1 - x0 + 1) * (y1 - y0 + 1));
    const kind: AuditFigure['kind'] = nearSig || (w > h * 2.5 && fill < 0.5) ? 'signature' : bbox[1] < 0.12 && w * h < 0.03 ? 'logo' : col / n > 30 || fill > 0.6 ? 'photo' : 'diagram';
    const caption = { signature: 'Handwritten signature', logo: 'Logo / letterhead mark', photo: 'Photo / image region', diagram: 'Drawing or mark' }[kind as 'signature' | 'logo' | 'photo' | 'diagram'];
    out.push({ id: `p${page}-g${out.length + 1}`, page, bbox, kind, caption });
  }
  return out.slice(0, 12);
}

/** OCR one page image: prepare for upload, then two independent readings. */
export async function scanPage(src: Blob | string, onProgress?: OcrProgress): Promise<ScannedPage> {
  progressCb = onProgress ?? null;
  try {
    const original = await loadImage(src);
    onProgress?.({ stage: 'Preparing image', progress: 0.05 });
    const prepared = await preparePage(original);
    const img = await loadImage(prepared.dataUrl);
    onProgress?.({ stage: 'Reading text (pass 1 of 2)', progress: 0.1 });
    const a = await read('ocr:original', img, img.width, img.height);
    onProgress?.({ stage: 'Reading text (pass 2 of 2)', progress: 0.55 });
    const b = await read('ocr:enhanced', enhanced(img), img.width, img.height);
    onProgress?.({ stage: 'Locating figures and signatures', progress: 0.95 });
    const figures = detectFigures(img, [a, b], 1);
    onProgress?.({ stage: 'Done', progress: 1 });
    return { ...prepared, readings: [a, b], figures };
  } finally {
    progressCb = null;
  }
}

/** Body for POST /audit-docs. */
export const uploadBody = (pages: ScannedPage[], extra: { title?: string; siteId?: string } = {}) => ({
  ...extra,
  pages: pages.map(({ mime, data, width, height, readings, figures }, i) => ({ mime, data, width, height, readings, figures: figures.map((f, j) => ({ ...f, id: `p${i + 1}-g${j + 1}`, page: i + 1 })) })),
});
