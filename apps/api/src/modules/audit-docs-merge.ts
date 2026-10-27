/** Vision extraction → AuditExtraction, each value cross-checked against OCR text inside its box. */
import {
  agreementOf, applyPlausibility, checkTables, crossCheck, inferType, keyValuesFromLines, normalizeValue, splitUnit,
  type AuditExtraction, type AuditField, type AuditTable, type BBox, type OcrLine, type OcrReading,
} from '@hydris/domain';
import { VISION_ENGINE, type VisionExtraction } from '../core/vision-extract';

// ------------------------------------------------------------------ vision merge
const toBox = (b: { x: number; y: number; w: number; h: number } | null): BBox | null => (b ? [b.x, b.y, b.w, b.h] : null);
const center = (b: BBox) => [b[0] + b[2] / 2, b[1] + b[3] / 2] as const;
const inside = (b: BBox, outer: BBox, pad = 0.01) => {
  const [cx, cy] = center(b);
  return cx >= outer[0] - pad && cx <= outer[0] + outer[2] + pad && cy >= outer[1] - pad && cy <= outer[1] + outer[3] + pad;
};

/** OCR text found inside a region (an independent reading of the same value). */
function ocrRegion(lines: OcrLine[], box: BBox, label: string): string | null {
  const words = lines.flatMap((l) => l.words).filter((w) => inside(w.bbox, box));
  if (!words.length) return null;
  let text = words.sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0]).map((w) => w.text).join(' ');
  // Boxes sometimes include the label - strip it so we compare values with values.
  const l = normalizeValue(label).toLowerCase();
  if (text.toLowerCase().startsWith(l)) text = text.slice(l.length).replace(/^\s*[:=\-.]+\s*/, '');
  return text.trim() || null;
}

export function mergeVision(v: VisionExtraction, readings: OcrReading[][]): AuditExtraction {
  const fields: AuditField[] = v.fields.map((f, i) => {
    const box = toBox(f.box);
    const sources = [{ engine: VISION_ENGINE, value: f.value, conf: f.confidence }];
    const pageReadings = readings[f.page - 1] ?? [];
    for (const r of pageReadings) {
      const value = box ? ocrRegion(r.lines, box, f.label) : null;
      if (value) sources.push({ engine: r.engine, value: splitUnit(value).value, conf: r.conf / 100 });
    }
    if (sources.length === 1) {
      // No usable region: fall back to label matching against OCR key/value lines.
      const kv = pageReadings.flatMap((r) => keyValuesFromLines(r.lines, f.page, r.engine));
      crossCheck([{ id: '', label: f.label, value: f.value, type: 'text', page: f.page, conf: 1, sources, agreement: 'single', status: 'pending' }], kv);
    }
    const value = normalizeValue(f.value);
    return {
      id: `p${f.page}-f${i + 1}`, label: f.label, value, unit: f.unit, type: f.type ?? inferType(value, f.label), page: f.page, bbox: box, conf: f.confidence,
      sources, agreement: agreementOf(sources.map((s) => splitUnit(s.value).value)), status: 'pending', extracted: value,
    };
  });
  applyPlausibility(fields);
  const tables: AuditTable[] = v.tables.map((t, i) => ({
    id: `p${t.page}-t${i + 1}`, title: t.title, page: t.page, bbox: toBox(t.box), header: t.header, rows: t.rows, conf: 0.9, engine: VISION_ENGINE, status: 'pending',
  }));
  checkTables(tables, fields);
  return {
    title: v.title, docType: v.doc_type, summary: v.summary,
    pages: v.pages.map((p) => ({ page: p.page, text: p.markdown, engine: VISION_ENGINE })),
    fields, tables,
    figures: v.figures.map((f, i) => ({ id: `p${f.page}-g${i + 1}`, page: f.page, bbox: [f.box.x, f.box.y, f.box.w, f.box.h], kind: f.kind, caption: f.caption })),
    warnings: v.warnings,
  };
}

