/**
 * Soft copy typesetting: the fused document model (packages/domain/src/softcopy.ts) rendered as a
 * professionally typed A4 document, as PDF (pdf-lib) and DOCX (docx).
 *
 * Layout: letterhead lines, title with rule, metadata as a two-column ruled table, real tables with
 * a shaded header row, checklist with drawn check marks, figures cropped from the scan at their
 * natural proportions, remarks, a signature block, and a footer on every page with the document
 * ID, the engines used and the verification status.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import {
  AlignmentType, BorderStyle, Document, Footer, ImageRun, Packer, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType,
  type ParagraphChild,
} from 'docx';
import type { SoftcopyModel } from '@hydris/domain';

const A4: [number, number] = [595.28, 841.89];
const M = 56; // ~20 mm margins
const INK = rgb(0.07, 0.09, 0.12);
const MUTED = rgb(0.42, 0.46, 0.5);
const RULE = rgb(0.55, 0.58, 0.62);
const HEAD = rgb(0.92, 0.94, 0.98);
const ACCENT = rgb(0.098, 0.329, 0.945);
const FLAG = rgb(1, 0.95, 0.85);

const safe = (s: string) => s.normalize('NFKD').replace(/[^\x20-\x7E\xA0-\xFF]/g, (c) => ({ '–': '-', '—': '-', '‘': "'", '’': "'", '“': '"', '”': '"', '•': '*', '³': '3', '²': '2' } as Record<string, string>)[c] ?? '');
const dataUrlBytes = (u: string) => Buffer.from(u.slice(u.indexOf(',') + 1), 'base64');
export const fmtValue = (v: string, unit: string | null) => (unit ? `${v} ${unit}` : v);

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const word of safe(text).split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width || !cur) cur = next;
    else { out.push(cur); cur = word; }
  }
  out.push(cur);
  return out;
}

export async function buildSoftcopyPdf(m: SoftcopyModel): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(safe(m.title));
  pdf.setSubject(`Soft copy of ${m.documentId}`);
  pdf.setProducer('Hydris Field Glasses');
  const R = await pdf.embedFont(StandardFonts.Helvetica);
  const B = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = A4[0] - 2 * M;
  let page: PDFPage = pdf.addPage(A4);
  let y = A4[1] - M;
  const newPage = () => { page = pdf.addPage(A4); y = A4[1] - M; };
  const need = (h: number) => { if (y - h < M + 4) newPage(); };
  const text = (s: string, x: number, yy: number, size: number, font = R, color = INK) => page.drawText(safe(s), { x, y: yy, size, font, color });

  // Letterhead + title
  m.letterhead.forEach((l, i) => { text(l, M, y - 10, i === 0 ? 11 : 9, i === 0 ? B : R, i === 0 ? ACCENT : MUTED); y -= i === 0 ? 15 : 12; });
  if (m.letterhead.length) y -= 8;
  for (const l of wrap(m.title, B, 19, W)) { text(l, M, y - 19, 19, B); y -= 24; }
  page.drawLine({ start: { x: M, y: y - 4 }, end: { x: M + W, y: y - 4 }, thickness: 1.6, color: ACCENT });
  y -= 22;

  const grid = (header: string[] | null, rows: string[][], widths: number[], opts: { boldFirst?: boolean; flagged?: { row: number; col: number }[] } = {}) => {
    const size = 9.5;
    const pad = 3.6;
    const all = header ? [header, ...rows] : rows;
    all.forEach((row, ri) => {
      const isHead = !!header && ri === 0;
      const cells = widths.map((w, ci) => wrap(row[ci] ?? '', isHead || (opts.boldFirst && ci === 0) ? B : R, size, w - 2 * pad));
      const h = Math.max(...cells.map((c) => c.length)) * (size + 3) + 2 * pad;
      need(h);
      let x = M;
      widths.forEach((w, ci) => {
        const flag = !isHead && opts.flagged?.some((f) => f.row === ri - (header ? 1 : 0) && f.col === ci);
        page.drawRectangle({ x, y: y - h, width: w, height: h, borderColor: RULE, borderWidth: 0.6, color: isHead ? HEAD : flag ? FLAG : undefined });
        cells[ci]!.forEach((l, li) => text(l, x + pad, y - pad - size - li * (size + 3) + 1, size, isHead || (opts.boldFirst && ci === 0) ? B : R));
        x += w;
      });
      y -= h;
    });
    y -= 14;
  };
  const heading = (s: string) => { need(30); text(s, M, y - 12, 12, B); y -= 22; };

  for (const b of m.blocks) {
    if (b.kind === 'meta') {
      grid(null, b.items.map((k) => [k.label, fmtValue(k.value, k.unit)]), [W * 0.36, W * 0.64], { boldFirst: true, flagged: b.items.flatMap((k, i) => (k.attention ? [{ row: i, col: 1 }] : [])) });
    } else if (b.kind === 'table') {
      if (b.title) heading(b.title);
      const cols = Math.max(b.header.length, ...b.rows.map((r) => r.length));
      const widths = Array.from({ length: cols }, (_, i) => (i === 0 ? W * (cols > 2 ? 0.34 : 0.5) : (W * (cols > 2 ? 0.66 : 0.5)) / (cols - 1)));
      grid(b.header, b.rows, widths, { flagged: b.flagged });
    } else if (b.kind === 'checklist') {
      if (b.title) heading(b.title);
      for (const it of b.items) {
        const lines = wrap(it.text, R, 10.5, W - 26);
        need(lines.length * 14 + 6);
        page.drawRectangle({ x: M, y: y - 12, width: 11, height: 11, borderColor: INK, borderWidth: 0.9 });
        if (it.checked !== false) {
          page.drawLine({ start: { x: M + 2.2, y: y - 6.5 }, end: { x: M + 4.8, y: y - 9.8 }, thickness: 1.4, color: it.checked ? INK : MUTED });
          page.drawLine({ start: { x: M + 4.8, y: y - 9.8 }, end: { x: M + 9.5, y: y - 2.5 }, thickness: 1.4, color: it.checked ? INK : MUTED });
        }
        lines.forEach((l, i) => text(l, M + 20, y - 10.5 - i * 14, 10.5));
        y -= lines.length * 14 + 6;
      }
      y -= 10;
    } else if (b.kind === 'figure') {
      const f = b.figure;
      if (!f.image) continue;
      const img = await pdf.embedPng(dataUrlBytes(f.image));
      // Keep the figure's size on the page (fraction of A4 width), capped to the text block.
      const ar = f.aspect ?? img.width / img.height;
      let w = Math.min(W, Math.max(120, f.bbox[2] * A4[0]));
      let h = w / ar;
      if (h > 110) { h = 110; w = h * ar; }
      need(h + 24);
      const x = M + (W - w) / 2;
      page.drawImage(img, { x, y: y - h, width: w, height: h });
      page.drawRectangle({ x, y: y - h, width: w, height: h, borderColor: RULE, borderWidth: 0.5 });
      text(f.caption, x, y - h - 12, 8.5, R, MUTED);
      y -= h + 24;
    } else if (b.kind === 'paragraph') {
      const lines = wrap(b.text, R, 10.5, W - 70);
      need(lines.length * 14 + 10);
      if (b.title) text(`${b.title}:`, M, y - 11, 10.5, B);
      lines.forEach((l, i) => text(l, M + 70, y - 11 - i * 14, 10.5));
      y -= lines.length * 14 + 14;
    } else if (b.kind === 'signatures') {
      for (const s of b.items) {
        need(56);
        y -= 4;
        if (s.image) {
          const img = await pdf.embedPng(dataUrlBytes(s.image));
          const h = 34;
          const w = Math.min(200, h * (s.aspect ?? img.width / img.height));
          page.drawImage(img, { x: M + 150, y: y - h, width: w, height: h });
        } else if (s.present) text('(signed on paper)', M + 150, y - 22, 9, R, MUTED);
        page.drawLine({ start: { x: M + 140, y: y - 38 }, end: { x: M + 380, y: y - 38 }, thickness: 0.7, color: INK });
        text(s.label, M, y - 36, 10.5, B);
        y -= 50;
      }
    }
  }

  // Footer on every page
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: M - 8 }, end: { x: A4[0] - M, y: M - 8 }, thickness: 0.5, color: RULE });
    const left = `Document ${m.footer.documentId} · Engines: ${m.footer.engines.join(', ') || 'n/a'}`;
    p.drawText(safe(left).slice(0, 120), { x: M, y: M - 20, size: 7.5, font: R, color: MUTED });
    const right = `${m.footer.verification} · Page ${i + 1} of ${pages.length}`;
    p.drawText(safe(right), { x: A4[0] - M - R.widthOfTextAtSize(safe(right), 7.5), y: M - 31, size: 7.5, font: R, color: MUTED });
  });
  return pdf.save();
}

// ------------------------------------------------------------------ DOCX
const border = { style: BorderStyle.SINGLE, size: 4, color: '8C949E' };
const borders = { top: border, bottom: border, left: border, right: border };
const TW = 9026; // A4 text width in twips at 20 mm margins (11906 - 2 * 1134 - rounding)

function cell(text: string, width: number, o: { bold?: boolean; head?: boolean; flag?: boolean } = {}) {
  return new TableCell({
    borders, width: { size: width, type: WidthType.DXA },
    shading: o.head ? { type: ShadingType.CLEAR, color: 'auto', fill: 'EBF0FA' } : o.flag ? { type: ShadingType.CLEAR, color: 'auto', fill: 'FFF2D9' } : undefined,
    margins: { top: 70, bottom: 70, left: 110, right: 110 },
    children: [new Paragraph({ children: [new TextRun({ text, bold: o.bold || o.head, size: 19, font: 'Calibri' })] })],
  });
}

export async function buildSoftcopyDocx(m: SoftcopyModel): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [];
  m.letterhead.forEach((l, i) => children.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: l, bold: i === 0, color: i === 0 ? '1954F1' : '6B7580', size: i === 0 ? 22 : 18, font: 'Calibri' })] })));
  children.push(new Paragraph({
    spacing: { before: 200, after: 240 }, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: '1954F1', space: 6 } },
    children: [new TextRun({ text: m.title, bold: true, size: 38, font: 'Calibri' })],
  }));
  const heading = (s: string) => new Paragraph({ spacing: { before: 200, after: 100 }, children: [new TextRun({ text: s, bold: true, size: 24, font: 'Calibri' })] });
  const gap = () => new Paragraph({ spacing: { after: 120 }, children: [] });

  for (const b of m.blocks) {
    if (b.kind === 'meta') {
      const w = [Math.round(TW * 0.36), TW - Math.round(TW * 0.36)];
      children.push(new Table({ width: { size: TW, type: WidthType.DXA }, columnWidths: w, rows: b.items.map((k) => new TableRow({ children: [cell(k.label, w[0]!, { bold: true }), cell(fmtValue(k.value, k.unit), w[1]!, { flag: k.attention })] })) }), gap());
    } else if (b.kind === 'table') {
      if (b.title) children.push(heading(b.title));
      const cols = Math.max(b.header.length, ...b.rows.map((r) => r.length));
      const first = Math.round(TW * (cols > 2 ? 0.34 : 0.5));
      const w = Array.from({ length: cols }, (_, i) => (i === 0 ? first : Math.floor((TW - first) / (cols - 1))));
      const flagged = (r: number, c: number) => b.flagged.some((f) => f.row === r && f.col === c);
      children.push(new Table({
        width: { size: TW, type: WidthType.DXA }, columnWidths: w,
        rows: [
          new TableRow({ tableHeader: true, children: w.map((cw, i) => cell(b.header[i] ?? '', cw, { head: true })) }),
          ...b.rows.map((r, ri) => new TableRow({ children: w.map((cw, ci) => cell(r[ci] ?? '', cw, { flag: flagged(ri, ci) })) })),
        ],
      }), gap());
    } else if (b.kind === 'checklist') {
      if (b.title) children.push(heading(b.title));
      for (const it of b.items) children.push(new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: it.checked === false ? '☐  ' : '☑  ', font: 'Segoe UI Symbol', size: 22 }), new TextRun({ text: it.text, size: 21, font: 'Calibri' })] }));
      children.push(gap());
    } else if (b.kind === 'figure') {
      const f = b.figure;
      if (!f.image) continue;
      const wpx = Math.min(600, Math.max(160, f.bbox[2] * 794)); // 794 px = A4 width at 96 dpi
      const hpx = wpx / (f.aspect ?? 1.5);
      children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type: 'png', data: dataUrlBytes(f.image), transformation: { width: Math.round(wpx), height: Math.round(hpx) } })] }));
      children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: f.caption, italics: true, color: '6B7580', size: 17, font: 'Calibri' })] }));
    } else if (b.kind === 'paragraph') {
      children.push(new Paragraph({ spacing: { before: 120, after: 160 }, children: [...(b.title ? [new TextRun({ text: `${b.title}: `, bold: true, size: 21, font: 'Calibri' })] : []), new TextRun({ text: b.text, size: 21, font: 'Calibri' })] }));
    } else if (b.kind === 'signatures') {
      for (const s of b.items) {
        const run: ParagraphChild[] = [new TextRun({ text: `${s.label}   `, bold: true, size: 21, font: 'Calibri' })];
        if (s.image) run.push(new ImageRun({ type: 'png', data: dataUrlBytes(s.image), transformation: { width: Math.round(Math.min(220, 46 * (s.aspect ?? 4))), height: 46 } }));
        else run.push(new TextRun({ text: s.present ? '(signed on paper)' : '________________________', color: '6B7580', size: 19, font: 'Calibri' }));
        children.push(new Paragraph({ spacing: { before: 360, after: 120 }, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: '111111', space: 4 } }, children: run }));
      }
    }
  }
  const doc = new Document({
    creator: 'Hydris Field Glasses', title: m.title, description: `Soft copy of ${m.documentId}`,
    styles: { default: { document: { run: { font: 'Calibri', size: 21 } } } },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134, footer: 560 } } },
      footers: { default: new Footer({ children: [new Paragraph({ border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'C0C6CE', space: 4 } }, children: [new TextRun({ text: `Document ${m.footer.documentId} · Engines: ${m.footer.engines.join(', ')} · ${m.footer.verification}`, size: 15, color: '6B7580', font: 'Calibri' })] })] }) },
      children,
    }],
  });
  return Packer.toBuffer(doc);
}
