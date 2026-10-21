/**
 * Audit document → PDF.
 *
 * For every scanned page the PDF contains:
 *  1. the original scan with an invisible OCR text layer (searchable / selectable), and
 *  2. a reconstructed page: verified fields, tables (as ruled grids), the figures cropped from
 *     the scan, and the page text.
 * A cover page carries the verification trail (machine cross-check + human review + approval).
 */
import { PDFDocument, StandardFonts, rgb, popGraphicsState, pushGraphicsState, rectangle, clip, endPath, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import { agreementScore, reviewProgress, type AuditExtraction, type OcrReading } from '@hydris/domain';

export interface PdfInput {
  title: string;
  docType: string;
  status: string;
  orgName: string;
  siteName: string | null;
  capturedBy: string | null;
  capturedVia: string;
  createdAt: Date;
  verifiedBy: string | null;
  verifiedAt: Date | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  rejectedReason: string | null;
  engines: string[];
  extraction: AuditExtraction;
  pages: { pageNo: number; mime: string; data: string; width: number; height: number; ocr: unknown }[];
}

const A4: [number, number] = [595.28, 841.89];
const M = 42;
const BLUE = rgb(0.098, 0.329, 0.945);
const INK = rgb(0.03, 0.07, 0.09);
const MUTED = rgb(0.42, 0.46, 0.5);
const LINE = rgb(0.85, 0.87, 0.9);

/** Standard PDF fonts only cover WinAnsi; replace anything else so drawing never throws. */
const safe = (s: string) => s.normalize('NFKD').replace(/[^\x20-\x7E\xA0-\xFF\n]/g, (c) => ({ '–': '-', '—': '-', '‘': "'", '’': "'", '“': '"', '”': '"', '•': '*', '✓': 'v', '✔': 'v', '☐': '[ ]', '☑': '[x]', '☒': '[x]' } as Record<string, string>)[c] ?? '');

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of safe(text).split('\n')) {
    let cur = '';
    for (const word of para.split(/\s+/)) {
      const next = cur ? `${cur} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) cur = next;
      else {
        if (cur) out.push(cur);
        cur = word;
        while (font.widthOfTextAtSize(cur, size) > width && cur.length > 1) {
          let cut = cur.length - 1;
          while (cut > 1 && font.widthOfTextAtSize(cur.slice(0, cut), size) > width) cut--;
          out.push(cur.slice(0, cut));
          cur = cur.slice(cut);
        }
      }
    }
    out.push(cur);
  }
  return out;
}

class Writer {
  page!: PDFPage;
  y = 0;
  constructor(private doc: PDFDocument, public font: PDFFont, public bold: PDFFont, private footer: string) {}
  newPage() {
    this.page = this.doc.addPage(A4);
    this.y = A4[1] - M;
    this.page.drawText(safe(this.footer), { x: M, y: 22, size: 7.5, font: this.font, color: MUTED });
    this.page.drawText(`Page ${this.doc.getPageCount()}`, { x: A4[0] - M - 40, y: 22, size: 7.5, font: this.font, color: MUTED });
  }
  need(h: number) {
    if (this.y - h < M + 14) this.newPage();
  }
  text(t: string, o: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; indent?: number; gap?: number } = {}) {
    const size = o.size ?? 9.5;
    const f = o.bold ? this.bold : this.font;
    for (const l of wrap(t, f, size, A4[0] - 2 * M - (o.indent ?? 0))) {
      this.need(size + 3);
      this.page.drawText(l, { x: M + (o.indent ?? 0), y: this.y - size, size, font: f, color: o.color ?? INK });
      this.y -= size + 3;
    }
    this.y -= o.gap ?? 2;
  }
  rule() {
    this.need(8);
    this.page.drawLine({ start: { x: M, y: this.y - 3 }, end: { x: A4[0] - M, y: this.y - 3 }, thickness: 0.6, color: LINE });
    this.y -= 9;
  }
  /** Ruled grid; columns share the width proportionally to their longest cell. */
  table(header: string[], rows: string[][]) {
    const width = A4[0] - 2 * M;
    const cols = Math.max(header.length, ...rows.map((r) => r.length), 1);
    const len = Array.from({ length: cols }, (_, c) => Math.max(4, ...[header, ...rows].map((r) => Math.min(40, safe(r[c] ?? '').length))));
    const total = len.reduce((a, b) => a + b, 0);
    const w = len.map((l) => (l / total) * width);
    const size = 8.5;
    const drawRow = (cells: string[], isHeader: boolean) => {
      const wrapped = Array.from({ length: cols }, (_, c) => wrap(cells[c] ?? '', isHeader ? this.bold : this.font, size, w[c]! - 6));
      const h = Math.max(...wrapped.map((x) => x.length)) * (size + 2) + 6;
      this.need(h);
      let x = M;
      if (isHeader) this.page.drawRectangle({ x: M, y: this.y - h, width, height: h, color: rgb(0.93, 0.95, 1) });
      for (let c = 0; c < cols; c++) {
        this.page.drawRectangle({ x, y: this.y - h, width: w[c]!, height: h, borderColor: LINE, borderWidth: 0.6 });
        wrapped[c]!.forEach((l, i) => this.page.drawText(l, { x: x + 3, y: this.y - 4 - size - i * (size + 2), size, font: isHeader ? this.bold : this.font, color: INK }));
        x += w[c]!;
      }
      this.y -= h;
    };
    if (header.length) drawRow(header, true);
    for (const r of rows) drawRow(r, false);
    this.y -= 8;
  }
}

/** Draw `img` scaled into the page box and clip to the normalized `crop` region. */
function drawCrop(page: PDFPage, img: PDFImage, crop: [number, number, number, number], at: { x: number; y: number; w: number }) {
  const [cx, cy, cw, ch] = crop.map((v) => Math.min(1, Math.max(0, v))) as [number, number, number, number];
  const scale = at.w / (cw * img.width);
  const fullW = img.width * scale;
  const fullH = img.height * scale;
  const h = ch * fullH;
  page.pushOperators(pushGraphicsState(), rectangle(at.x, at.y - h, at.w, h), clip(), endPath());
  page.drawImage(img, { x: at.x - cx * fullW, y: at.y - h - (1 - cy - ch) * fullH, width: fullW, height: fullH });
  page.pushOperators(popGraphicsState());
  return h;
}

export async function buildAuditPdf(input: PdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(safe(input.title));
  doc.setSubject(`Hydris audit document · ${input.docType}`);
  doc.setProducer('Hydris Field Glasses');
  doc.setCreator('Hydris audit scan');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const w = new Writer(doc, font, bold, `${input.orgName} · ${input.title} · generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`);
  const x = input.extraction;
  const prog = reviewProgress(x);
  const agree = agreementScore(x.fields);
  const fmt = (d: Date | null) => (d ? d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '-');

  // ---- cover
  w.newPage();
  w.page.drawRectangle({ x: 0, y: A4[1] - 6, width: A4[0], height: 6, color: BLUE });
  w.text('HYDRIS · AUDIT DOCUMENT', { size: 8, bold: true, color: BLUE, gap: 6 });
  w.text(input.title, { size: 20, bold: true, gap: 4 });
  w.text(`${input.docType} · ${input.pages.length} page${input.pages.length === 1 ? '' : 's'} · status ${input.status.replace('_', ' ')}`, { color: MUTED, gap: 10 });
  if (x.summary) w.text(x.summary, { gap: 10 });
  w.table(['Record', 'Value'], [
    ['Organization / site', `${input.orgName}${input.siteName ? ` · ${input.siteName}` : ''}`],
    ['Captured', `${fmt(input.createdAt)} by ${input.capturedBy ?? 'unknown'} via ${input.capturedVia}`],
    ['Extraction engines', input.engines.join(', ') || '-'],
    ['Machine cross-check', agree === null ? 'single reading only' : `${Math.round(agree * 100)}% of values agree between independent engines`],
    ['Verification 1 · field review', input.verifiedBy ? `${input.verifiedBy} · ${fmt(input.verifiedAt)} (${prog.done}/${prog.total} items confirmed or corrected)` : `pending (${prog.done}/${prog.total} reviewed)`],
    ['Verification 2 · approval', input.approvedBy ? `${input.status === 'rejected' ? 'Rejected' : 'Approved'} by ${input.approvedBy} · ${fmt(input.approvedAt)}${input.rejectedReason ? ` - ${input.rejectedReason}` : ''}` : 'pending'],
  ]);
  if (x.warnings.length) {
    w.text('Extraction warnings', { bold: true, size: 10.5, gap: 3 });
    for (const wn of x.warnings) w.text(`* ${wn}`, { indent: 6 });
  }

  for (const pg of input.pages) {
    const bytes = Buffer.from(pg.data, 'base64');
    const img = await (pg.mime === 'image/png' ? doc.embedPng(bytes) : doc.embedJpg(bytes)).catch(() => null);
    if (!img) {
      w.newPage();
      w.text(`Page ${pg.pageNo}: the scan image could not be embedded.`, { color: MUTED });
      continue;
    }

    // ---- 1. original scan + invisible OCR text layer
    const scan = doc.addPage(A4);
    const s = Math.min((A4[0] - 2 * M) / img.width, (A4[1] - 2 * M - 20) / img.height);
    const iw = img.width * s;
    const ih = img.height * s;
    const ox = (A4[0] - iw) / 2;
    const oy = (A4[1] - ih) / 2 - 8;
    scan.drawText(safe(`Original scan · page ${pg.pageNo}`), { x: M, y: A4[1] - M + 8, size: 8, font: bold, color: MUTED });
    scan.drawImage(img, { x: ox, y: oy, width: iw, height: ih });
    const readings = (pg.ocr as { readings?: OcrReading[] } | null)?.readings ?? [];
    for (const l of readings[0]?.lines ?? []) {
      for (const wd of l.words) {
        const size = Math.max(4, wd.bbox[3] * ih * 0.9);
        const t = safe(wd.text);
        if (!t.trim()) continue;
        scan.drawText(t, { x: ox + wd.bbox[0] * iw, y: oy + (1 - wd.bbox[1] - wd.bbox[3]) * ih + size * 0.15, size, font, opacity: 0 });
      }
    }

    // ---- 2. reconstructed page
    w.newPage();
    w.text(`Extracted content · page ${pg.pageNo}`, { size: 13, bold: true, gap: 6 });
    const fields = x.fields.filter((f) => f.page === pg.pageNo);
    if (fields.length) {
      w.text('Fields', { size: 10.5, bold: true, color: BLUE, gap: 3 });
      w.table(['Field', 'Value', 'Cross-check', 'Review'], fields.map((f) => [
        f.label,
        `${f.value}${f.unit ? ` ${f.unit}` : ''}${f.status === 'corrected' && f.extracted && f.extracted !== f.value ? ` (read as "${f.extracted}")` : ''}`,
        f.sources.length > 1 ? `${f.agreement} (${f.sources.map((src) => src.engine).join(' / ')})` : 'single reading',
        f.status,
      ]));
    }
    for (const t of x.tables.filter((tb) => tb.page === pg.pageNo)) {
      w.text(t.title || 'Table', { size: 10.5, bold: true, color: BLUE, gap: 3 });
      w.table(t.header, t.rows);
    }
    const figs = x.figures.filter((f) => f.page === pg.pageNo);
    if (figs.length) {
      w.text('Figures', { size: 10.5, bold: true, color: BLUE, gap: 4 });
      for (const f of figs) {
        // Keep figures at their size on the page (scan scale), never blown up beyond 45% of the width.
        const fw = Math.min((A4[0] - 2 * M) * 0.45, Math.max(90, f.bbox[2] * (A4[0] - 2 * M)));
        const fh = (f.bbox[3] * img.height) * (fw / (f.bbox[2] * img.width));
        w.need(Math.min(fh, 360) + 20);
        const drawn = drawCrop(w.page, img, f.bbox, { x: M, y: w.y, w: Math.min(fw, fw * (360 / Math.max(fh, 1))) });
        w.y -= drawn + 3;
        w.text(`${f.kind}: ${f.caption}`, { size: 8, color: MUTED, gap: 8 });
      }
    }
    const text = x.pages.find((p) => p.page === pg.pageNo)?.text;
    if (text) {
      w.text('Page text', { size: 10.5, bold: true, color: BLUE, gap: 3 });
      w.text(text.replace(/^\|.*\|$/gm, '').replace(/\n{3,}/g, '\n\n'), { size: 8.5 });
    }
  }
  return doc.save();
}
