/**
 * Engine 1: Tesseract.js (WebAssembly) running in the API process on the clean page image.
 *
 * The English LSTM model ships with the API (apps/api/tessdata/eng.traineddata.gz, ~3 MB) and is
 * traced into the Vercel function, so no download is needed: the CDN fetch timed out on Vercel.
 * TESSDATA_PATH overrides the location; without a bundled copy the model is fetched from the
 * tesseract.js data CDN and cached in the OS temp dir.
 * Any failure (no network for the model, timeout) is reported and the pipeline carries on with
 * the remaining engines.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { OcrLine, OcrReading } from '@hydris/domain';

export const SERVER_OCR_ENGINE = 'ocr:server';

type Worker = Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>>;
let workerP: Promise<Worker> | null = null;

/** The bundled model directory, wherever the API runs from (repo root, apps/api or apps/web on Vercel). */
function bundledLangPath(): string | undefined {
  if (process.env.TESSDATA_PATH) return process.env.TESSDATA_PATH;
  const cwd = process.cwd();
  return [resolve(cwd, 'tessdata'), resolve(cwd, 'apps/api/tessdata'), resolve(cwd, '../api/tessdata'), resolve(cwd, '../../apps/api/tessdata')]
    .find((d) => existsSync(join(d, 'eng.traineddata.gz')));
}

async function worker(): Promise<Worker> {
  workerP ??= (async () => {
    const { createWorker } = await import('tesseract.js');
    const cachePath = join(tmpdir(), 'hydris-tessdata');
    mkdirSync(cachePath, { recursive: true });
    const langPath = bundledLangPath();
    return createWorker('eng', 1, { cachePath, ...(langPath ? { langPath, cacheMethod: 'none' } : {}) });
  })().catch((e) => {
    workerP = null;
    throw e;
  });
  return workerP;
}

const withTimeout = <T>(p: Promise<T>, ms: number, what: string) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${what} timed out after ${Math.round(ms / 1000)} s`)), ms).unref?.())]);

type TBox = { x0: number; y0: number; x1: number; y1: number };

/** OCR one page image (JPEG/PNG buffer of known size). */
export async function serverOcr(image: Buffer, W: number, H: number, timeoutMs = 45_000): Promise<OcrReading> {
  const w = await withTimeout(worker(), timeoutMs, 'Loading the server OCR model');
  const { data } = await withTimeout(w.recognize(image, {}, { blocks: true, text: true }), timeoutMs, 'Server OCR');
  const norm = (b: TBox): [number, number, number, number] => [b.x0 / W, b.y0 / H, (b.x1 - b.x0) / W, (b.y1 - b.y0) / H];
  const lines: OcrLine[] = [];
  for (const b of data.blocks ?? []) {
    for (const p of b.paragraphs) {
      for (const l of p.lines) {
        const words = l.words.filter((wd) => wd.text.trim()).map((wd) => ({ text: wd.text, conf: wd.confidence, bbox: norm(wd.bbox) }));
        if (!words.length) continue;
        lines.push({ text: l.text.replace(/\s+$/, ''), conf: l.confidence, bbox: norm(l.bbox), words });
      }
    }
  }
  return { engine: SERVER_OCR_ENGINE, text: data.text, conf: data.confidence, lines };
}

/** Release the worker (tests / graceful shutdown). */
export async function stopServerOcr() {
  const p = workerP;
  workerP = null;
  if (p) await p.then((w) => w.terminate()).catch(() => {});
}
