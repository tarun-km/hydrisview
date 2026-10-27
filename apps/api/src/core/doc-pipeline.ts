/**
 * Server-side audit document processing, run on upload (glasses, phone, console) or on demand:
 *
 *   page photo ─► clean A4 page (sharp: EXIF, perspective / deskew, margins, contrast)
 *              ─► engines, each producing a structured extraction:
 *                   1. ocr:server  Tesseract.js in this process on the clean page
 *                   2. ocr:device  the on-device Tesseract passes sent with the upload
 *                   3. vision:*    Claude vision on the clean pages (when a key is configured)
 *                   4. mlkit:*     ML Kit readings sent by the Android app
 *              ─► fusion (field by field, cell by cell; disagreements flagged for the reviewer)
 *
 * Every engine is optional: whatever fails is reported and the rest carry on, so a document is
 * never lost because one engine (model download, API key, time budget) is unavailable.
 */
import { buildSoftcopy, fuseExtractions, guessTitle, structureFromOcr, type AuditExtraction, type AuditFigure, type EngineResult, type FusedExtraction, type OcrReading, type SoftcopyModel } from '@hydris/domain';
import sharp from 'sharp';
import { cleanPage, cropBox, detectFigures, type CleanPage } from './doc-image';
import { serverOcr, SERVER_OCR_ENGINE } from './server-ocr';
import { extractWithVision, describeVisionError, visionAvailable, VISION_ENGINE } from './vision-extract';
import { mergeVision } from '../modules/audit-docs-merge';

export interface StoredPage { pageNo: number; mime: string; data: string; width: number; height: number; ocr: unknown }
export interface PageOcr { readings?: OcrReading[]; clean?: Omit<CleanPage, 'steps'> & { steps?: string[] }; server?: OcrReading | null; figures?: AuditFigure[] }
export interface ProcessReport { engines: { engine: string; ok: boolean; ms: number; message?: string }[]; steps: string[] }

const pageOcr = (p: StoredPage): PageOcr => (p.ocr as PageOcr | null) ?? {};

/** Group device readings: browser Tesseract passes vs ML Kit (Android app uploads). */
function deviceGroups(readings: OcrReading[], deviceEngine: string): Map<string, OcrReading[]> {
  const g = new Map<string, OcrReading[]>();
  for (const r of readings) {
    if (r.engine === SERVER_OCR_ENGINE) continue;
    const key = /mlkit/i.test(r.engine) ? 'mlkit:android' : deviceEngine;
    g.set(key, [...(g.get(key) ?? []), r]);
  }
  return g;
}

function extractionOf(readingsPerPage: OcrReading[][], figuresPerPage: AuditFigure[][], title: string): AuditExtraction {
  const out: AuditExtraction = { title, docType: 'general', summary: '', pages: [], fields: [], tables: [], figures: [], warnings: [] };
  readingsPerPage.forEach((r, i) => {
    const s = structureFromOcr(i + 1, r, figuresPerPage[i] ?? []);
    out.fields.push(...s.fields);
    out.tables.push(...s.tables);
    out.figures.push(...s.figures);
    out.pages.push(s.text);
  });
  return out;
}

export async function processDocument(pages: StoredPage[], opts: { title: string; useVision?: boolean; budgetMs?: number; /** Engine name for readings sent with the upload (ML Kit for the Android app). */ deviceEngine?: string }): Promise<{ extraction: FusedExtraction; pageOcr: PageOcr[]; engines: string[]; report: ProcessReport }> {
  const t0 = Date.now();
  const budget = opts.budgetMs ?? 50_000;
  const report: ProcessReport = { engines: [], steps: [] };
  const timed = async <T>(engine: string, fn: () => Promise<T>): Promise<T | null> => {
    const s = Date.now();
    try {
      const v = await fn();
      report.engines.push({ engine, ok: true, ms: Date.now() - s });
      return v;
    } catch (e) {
      report.engines.push({ engine, ok: false, ms: Date.now() - s, message: e instanceof Error ? e.message.slice(0, 200) : String(e) });
      return null;
    }
  };

  // 1. Clean pages
  const out: PageOcr[] = [];
  for (const p of pages) {
    const prev = pageOcr(p);
    let clean: CleanPage | null = null;
    try {
      clean = await cleanPage(Buffer.from(p.data, 'base64'));
      report.steps.push(`Page ${p.pageNo}: ${clean.steps.join(' · ')}`);
    } catch (e) {
      report.steps.push(`Page ${p.pageNo}: preprocessing failed (${e instanceof Error ? e.message : e}) - using the original image`);
    }
    out.push({ ...prev, clean: clean ?? { mime: 'image/jpeg', data: p.data, width: p.width, height: p.height, correction: 'none' } });
  }

  // 2. Server OCR on the clean pages (skipped when the time budget is spent)
  for (const [i, po] of out.entries()) {
    if (Date.now() - t0 > budget * 0.6) { report.engines.push({ engine: SERVER_OCR_ENGINE, ok: false, ms: 0, message: `Skipped page ${i + 1}: time budget` }); continue; }
    const img = Buffer.from(po.clean!.data, 'base64');
    po.server = await timed(SERVER_OCR_ENGINE, () => serverOcr(img, po.clean!.width, po.clean!.height, Math.max(10_000, budget - (Date.now() - t0))));
    po.figures = await detectFigures(img, po.server ? [po.server] : [], i + 1).catch(() => []);
  }

  const results: EngineResult[] = [];
  const serverReadings = out.map((po) => (po.server ? [po.server] : []));
  if (serverReadings.some((r) => r.length)) results.push({ engine: SERVER_OCR_ENGINE, extraction: extractionOf(serverReadings, out.map((po) => po.figures ?? []), opts.title) });
  // Device engines (coordinates are relative to the uploaded photo, so their figures are not reused).
  const groups = out.map((po) => deviceGroups(po.readings ?? [], opts.deviceEngine ?? 'ocr:device'));
  for (const key of new Set(groups.flatMap((g) => [...g.keys()]))) {
    const per = groups.map((g) => g.get(key) ?? []);
    if (per.some((r) => r.length)) results.push({ engine: key, extraction: extractionOf(per, [], opts.title) });
  }

  // 3. Vision on the clean pages
  if ((opts.useVision ?? true) && visionAvailable() && Date.now() - t0 < budget * 0.75) {
    const v = await timed(VISION_ENGINE, async () => {
      try { return await extractWithVision(out.map((po) => ({ mime: po.clean!.mime, data: po.clean!.data }))); } catch (e) { throw new Error(describeVisionError(e)); }
    });
    if (v) results.push({ engine: VISION_ENGINE, extraction: mergeVision(v, serverReadings) });
  } else if (!visionAvailable()) report.engines.push({ engine: 'vision', ok: false, ms: 0, message: 'ANTHROPIC_API_KEY not set' });

  const extraction = fuseExtractions(results);
  extraction.title = (results.find((r) => r.engine.startsWith('vision:'))?.extraction.title || guessTitle(serverReadings.some((r) => r.length) ? serverReadings : out.map((po) => po.readings ?? [])) || opts.title).trim();
  if (!results.length) extraction.warnings.push('No OCR engine could read this document - review the page images.');
  return { extraction, pageOcr: out, engines: results.map((r) => r.engine), report };
}

/** Fraction of dark pixels in a normalised box of a page image. */
async function inkRatio(img: Buffer, box: [number, number, number, number]): Promise<number> {
  const m = await sharp(img).metadata();
  const W = m.width!;
  const H = m.height!;
  const left = Math.max(0, Math.round(box[0] * W));
  const top = Math.max(0, Math.round(box[1] * H));
  const width = Math.max(1, Math.min(W - left, Math.round(box[2] * W)));
  const height = Math.max(1, Math.min(H - top, Math.round(box[3] * H)));
  const { data } = await sharp(img).extract({ left, top, width, height }).greyscale().raw().toBuffer({ resolveWithObject: true });
  let n = 0;
  for (const v of data) if (v < 120) n++;
  return n / data.length;
}

/** Soft copy model with figure crops, signature crops and checkbox states read from the clean pages. */
export async function softcopyFor(doc: { id: string; extraction: AuditExtraction; engines: string[]; status: string; pageCount: number }, pages: StoredPage[]): Promise<SoftcopyModel> {
  const po = pages.map(pageOcr);
  const lines = po.map((p) => (p.server ?? p.readings?.[0])?.lines ?? []);
  const verification = { in_review: 'Pending verification', verified: 'Verified - awaiting approval', approved: 'Verified and approved', rejected: 'Rejected', processing: 'Processing' }[doc.status] ?? doc.status;
  const x = structuredClone(doc.extraction);
  // Use server-located figures when the extraction has none for a page.
  for (const [i, p] of po.entries()) if (!x.figures.some((f) => f.page === i + 1) && p.figures?.length) x.figures.push(...p.figures);
  const model = buildSoftcopy(x, { documentId: doc.id, engines: doc.engines, verification, lines, pageCount: doc.pageCount });
  const img = (page: number) => {
    const p = po[page - 1];
    const src = p?.clean?.data ?? pages[page - 1]?.data;
    return src ? Buffer.from(src, 'base64') : null;
  };
  for (const b of model.blocks) {
    if (b.kind === 'figure') {
      const im = img(b.figure.page);
      if (!im) continue;
      const c = await cropBox(im, b.figure.bbox).catch(() => null);
      if (c) { b.figure.image = `data:image/png;base64,${c.png.toString('base64')}`; b.figure.aspect = c.width / c.height; }
    } else if (b.kind === 'checklist') {
      for (const it of b.items) {
        if (it.checked !== null || !it.bbox) continue;
        const im = img(it.page);
        if (!im) continue;
        const h = it.bbox[3];
        const boxW = h * 1.4 * (2339 / 1654);
        const outer: [number, number, number, number] = [Math.max(0, it.bbox[0] - boxW - 0.008), it.bbox[1] - h * 0.2, boxW, h * 1.4];
        const inner: [number, number, number, number] = [outer[0] + outer[2] * 0.25, outer[1] + outer[3] * 0.25, outer[2] * 0.5, outer[3] * 0.5];
        const [o, n] = await Promise.all([inkRatio(im, outer).catch(() => 0), inkRatio(im, inner).catch(() => 0)]);
        // Empty box: only its outline is dark; a tick adds ink in the middle.
        it.checked = o < 0.02 ? null : n > 0.03 || o > 0.2;
      }
    } else if (b.kind === 'signatures') {
      for (const s of b.items) {
        const f = x.figures.find((g) => g.id === s.figureId);
        const im = f ? img(f.page) : null;
        if (!f || !im) continue;
        const c = await cropBox(im, f.bbox, 600).catch(() => null);
        if (c) { s.image = `data:image/png;base64,${c.png.toString('base64')}`; s.aspect = c.width / c.height; }
      }
    }
  }
  return model;
}
