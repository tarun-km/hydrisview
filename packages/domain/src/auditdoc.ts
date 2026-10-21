/**
 * Audit document scanning: shared types and pure logic.
 *
 * Pipeline: camera capture → two independent OCR readings on the device (original +
 * contrast-normalized image) → server structuring (key/value fields, tables, figures),
 * optionally refined by a vision model → per-value cross-check between engines
 * (machine verification) → human field review + independent approval (dual verification).
 */

/** Normalized box on the page: x, y, width, height in 0..1 (origin top-left). */
export type BBox = [number, number, number, number];

export interface OcrWord { text: string; conf: number; bbox: BBox }
export interface OcrLine { text: string; conf: number; bbox: BBox; words: OcrWord[] }
/** One OCR reading of one page (engine = which pass produced it). */
export interface OcrReading { engine: string; text: string; conf: number; lines: OcrLine[] }

export type FieldType = 'text' | 'number' | 'date' | 'id' | 'checkbox' | 'signature';
export type FieldStatus = 'pending' | 'confirmed' | 'corrected' | 'flagged';
export type Agreement = 'match' | 'close' | 'mismatch' | 'single';

export interface FieldSource { engine: string; value: string; conf: number }
export interface AuditField {
  id: string;
  label: string;
  value: string;
  type: FieldType;
  unit?: string | null;
  page: number;
  bbox?: BBox | null;
  conf: number;
  sources: FieldSource[];
  agreement: Agreement;
  status: FieldStatus;
  /** Value as first extracted; kept when a reviewer corrects the field (history is never overwritten). */
  extracted?: string;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  note?: string | null;
}

export interface AuditTable {
  id: string;
  title?: string | null;
  page: number;
  bbox?: BBox | null;
  header: string[];
  rows: string[][];
  conf: number;
  engine: string;
  status: FieldStatus;
  /** Cells that failed a plausibility check (row, column, message). */
  issues?: { row: number; col: number; message: string; suggestion?: string }[];
}

export type FigureKind = 'photo' | 'diagram' | 'chart' | 'signature' | 'stamp' | 'logo' | 'other';
export interface AuditFigure { id: string; page: number; bbox: BBox; kind: FigureKind; caption: string }

export interface AuditPageText { page: number; text: string; engine: string }

export interface AuditExtraction {
  title: string;
  docType: string;
  summary: string;
  pages: AuditPageText[];
  fields: AuditField[];
  tables: AuditTable[];
  figures: AuditFigure[];
  warnings: string[];
}

// ------------------------------------------------------------------ normalization & comparison
const CONFUSABLE: Record<string, string> = { O: '0', o: '0', I: '1', l: '1', '|': '1', S: '5', B: '8', Z: '2' };

export function normalizeValue(v: string): string {
  return v.normalize('NFKC').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
}

/**
 * Comparison key: case/space/punctuation-insensitive; digit look-alikes folded inside numbers.
 * Decimal points are significant (7.4 vs 74 is a disagreement); thousands separators are not.
 */
function compareKey(v: string): string {
  const n = normalizeValue(v).toLowerCase();
  if (/\d/.test(n)) {
    return n.replace(/(\d),(?=\d{3}(?!\d))/g, '$1').replace(/[\s:;'"`_\-/\()[\]]/g, '').replace(/[oilsbz|]/g, (c) => CONFUSABLE[c] ?? CONFUSABLE[c.toUpperCase()] ?? c);
  }
  return n.replace(/[\s.,:;'"`_\-/\\()[\]]/g, '');
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length]!;
}

/** 0..1 similarity of two readings of the same value. */
export function similarity(a: string, b: string): number {
  const x = compareKey(a);
  const y = compareKey(b);
  if (!x && !y) return 1;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
}

export function agreementOf(values: string[]): Agreement {
  if (values.length < 2) return 'single';
  let worst = 1;
  for (let i = 1; i < values.length; i++) worst = Math.min(worst, similarity(values[0]!, values[i]!));
  // Numbers must match exactly (after look-alike folding); text may differ by a character or two.
  const numeric = values.every((v) => /^[\s\d.,:/+\-%°]+[a-zA-Z%°/³²µ]*$/.test(normalizeValue(v)));
  if (worst === 1) return 'match';
  if (!numeric && worst >= 0.85) return 'close';
  return 'mismatch';
}

export function inferType(value: string, label = ''): FieldType {
  const v = normalizeValue(value);
  if (/sign|signature/i.test(label)) return 'signature';
  if (/^(☑|☒|✔|✓|\[x\]|yes|no|y|n|ok|pass|fail)$/i.test(v)) return 'checkbox';
  if (/^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/.test(v) || /^\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4}$/.test(v)) return 'date';
  if (/^[-+]?\d[\d,]*(\.\d+)?\s*[a-zA-Z%°/³²µ]{0,6}$/.test(v)) return 'number';
  if (/^[A-Z]{1,5}[-/]?\d{2,}[A-Z0-9-]*$/.test(v)) return 'id';
  return 'text';
}

const UNIT_RE = /^([-+]?\d[\d,]*(?:\.\d+)?)\s*(mg\/l|mg\/L|ppm|ntu|NTU|°C|C|bar|kPa|m3\/h|m³\/h|l\/s|L\/s|%|pH|kW|A|V|mm\/s|hrs?|h|kg|m)$/;
export function splitUnit(value: string): { value: string; unit: string | null } {
  const m = UNIT_RE.exec(normalizeValue(value));
  return m ? { value: m[1]!, unit: m[2]! } : { value: normalizeValue(value), unit: null };
}

// ------------------------------------------------------------------ OCR structuring (no AI)
const unionBox = (boxes: BBox[]): BBox => {
  const x0 = Math.min(...boxes.map((b) => b[0]));
  const y0 = Math.min(...boxes.map((b) => b[1]));
  const x1 = Math.max(...boxes.map((b) => b[0] + b[2]));
  const y1 = Math.max(...boxes.map((b) => b[1] + b[3]));
  return [x0, y0, x1 - x0, y1 - y0];
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'field';

/** "Label: value" / "Label - value" / "Label ..... value" lines → fields. */
export function keyValuesFromLines(lines: OcrLine[], page: number, engine: string): AuditField[] {
  const out: AuditField[] = [];
  const seen = new Map<string, number>();
  for (const l of lines) {
    const text = normalizeValue(l.text);
    const m = /^([A-Za-z][A-Za-z0-9 #&/().'-]{1,48}?)\s*(?::|=|\.{3,}|\s-\s|\s–\s)\s*(.+)$/.exec(text);
    if (!m) continue;
    const label = m[1]!.trim().replace(/\s*\.+$/, '');
    let raw = m[2]!.trim();
    if (!raw || label.split(' ').length > 7) continue;
    // Handwriting next to a signature label is a signature, not text to transcribe.
    if (/sign(ature|ed)?\b/i.test(label) && l.conf < 85) raw = 'Signature present';
    const { value, unit } = splitUnit(raw);
    const base = slug(label);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    out.push({
      id: n > 1 ? `p${page}-${base}-${n}` : `p${page}-${base}`, label, value, unit, type: inferType(value, label), page, bbox: l.bbox, conf: l.conf / 100,
      sources: [{ engine, value: raw, conf: l.conf / 100 }], agreement: 'single', status: 'pending', extracted: value,
    });
  }
  return out;
}

/**
 * Table detection from word geometry: consecutive lines whose words fall into the same set of
 * column bands (≥ 3 columns, ≥ 3 rows) form a table. The first row is the header.
 */
/** Merge OCR lines that sit on the same visual row (table columns often come back as separate blocks). */
export function visualRows(lines: OcrLine[]): OcrLine[] {
  const sorted = [...lines].sort((a, b) => a.bbox[1] + a.bbox[3] / 2 - (b.bbox[1] + b.bbox[3] / 2));
  const rows: OcrLine[][] = [];
  for (const l of sorted) {
    const cy = l.bbox[1] + l.bbox[3] / 2;
    const row = rows[rows.length - 1];
    const ref = row?.[0];
    if (ref && Math.abs(cy - (ref.bbox[1] + ref.bbox[3] / 2)) < Math.min(ref.bbox[3], l.bbox[3]) * 0.6) row!.push(l);
    else rows.push([l]);
  }
  return rows.map((r) => {
    const parts = r.sort((a, b) => a.bbox[0] - b.bbox[0]);
    return { text: parts.map((p) => p.text).join(' '), conf: parts.reduce((s, p) => s + p.conf, 0) / parts.length, bbox: unionBox(parts.map((p) => p.bbox)), words: parts.flatMap((p) => p.words) };
  });
}

/**
 * Table detection from word geometry: consecutive visual rows whose words fall into a consistent
 * set of column bands (>= 3 columns, >= 3 rows) form a table. The first row is the header.
 */
export function tablesFromLines(lines: OcrLine[], page: number, engine: string): AuditTable[] {
  const rowCells = (l: OcrLine): { x: number; text: string }[] => {
    const ws = [...l.words].sort((a, b) => a.bbox[0] - b.bbox[0]);
    if (!ws.length) return [];
    const hs = ws.map((w) => w.bbox[3]).sort((a, b) => a - b);
    const h = hs[Math.floor(hs.length / 2)]!;
    const cells: { x: number; words: OcrWord[] }[] = [{ x: ws[0]!.bbox[0], words: [ws[0]!] }];
    for (let i = 1; i < ws.length; i++) {
      const gap = ws[i]!.bbox[0] - (ws[i - 1]!.bbox[0] + ws[i - 1]!.bbox[2]);
      if (gap > h * 1.4) cells.push({ x: ws[i]!.bbox[0], words: [ws[i]!] });
      else cells[cells.length - 1]!.words.push(ws[i]!);
    }
    return cells.map((c) => ({ x: c.x, text: c.words.map((w) => w.text).join(' ') }));
  };
  const tables: AuditTable[] = [];
  let run: { line: OcrLine; cells: { x: number; text: string }[] }[] = [];
  const flush = () => {
    if (run.length >= 3) {
      const cols = run[0]!.cells.map((c) => c.x);
      const rows = run.map((r) => cols.map((x, ci) => {
        const next = cols[ci + 1] ?? Infinity;
        return r.cells.filter((c) => c.x >= x - 0.03 && c.x < next - 0.03).map((c) => c.text).join(' ');
      }));
      tables.push({
        id: `p${page}-t${tables.length + 1}`, page, bbox: unionBox(run.map((r) => r.line.bbox)), header: rows[0]!, rows: rows.slice(1),
        conf: run.reduce((s, r) => s + r.line.conf, 0) / run.length / 100, engine, status: 'pending', title: null,
      });
    }
    run = [];
  };
  for (const l of visualRows(lines)) {
    const cells = rowCells(l);
    if (cells.length >= 3) {
      const prev = run[run.length - 1];
      const aligned = !prev || (Math.abs(prev.cells.length - cells.length) <= 1 && cells.filter((c) => prev.cells.some((p) => Math.abs(p.x - c.x) < 0.04)).length >= Math.min(cells.length, prev.cells.length) - 1);
      if (!aligned) flush();
      run.push({ line: l, cells });
    } else flush();
  }
  flush();
  return tables;
}

/**
 * Domain plausibility: a value both engines read identically can still be wrong (e.g. a dropped
 * decimal point turns pH 7.1 into 71). Out-of-range values get low confidence and a note so they are
 * never bulk-confirmed and the reviewer checks them against the paper.
 */
const RANGES: { re: RegExp; min: number; max: number; what: string }[] = [
  { re: /\bph\b/i, min: 0, max: 14, what: 'pH must be between 0 and 14' },
  { re: /\b(do|dissolved oxygen)\b/i, min: 0, max: 25, what: 'dissolved oxygen above 25 mg/L is implausible' },
  { re: /\b(temp|temperature)\b/i, min: -20, max: 120, what: 'temperature outside -20..120' },
  { re: /(%|percent|efficiency|removal)/i, min: 0, max: 100, what: 'percentages must be 0-100' },
  { re: /\b(turbidity|ntu)\b/i, min: 0, max: 4000, what: 'turbidity outside 0-4000 NTU' },
];

export function plausibilityIssue(f: Pick<AuditField, 'label' | 'value' | 'unit' | 'type'>): string | null {
  if (f.type !== 'number') return null;
  const n = Number(normalizeValue(f.value).replace(/,(?=\d{3}\b)/g, ''));
  if (!Number.isFinite(n)) return null;
  const subject = `${f.label} ${f.unit ?? ''}`;
  for (const r of RANGES) if (r.re.test(subject) && (n < r.min || n > r.max)) return `Implausible value: ${r.what}`;
  return null;
}

/** Range-check numeric table cells against the measurand named in the row (first cell). */
export function checkTables(tables: AuditTable[], fields: AuditField[] = []): void {
  for (const t of tables) {
    const issues: NonNullable<AuditTable['issues']> = [];
    t.rows.forEach((row, ri) => {
      const label = row[0] ?? '';
      row.forEach((cell, ci) => {
        if (ci === 0 || !/^\s*[-+]?\d[\d,]*(\.\d+)?\s*$/.test(cell)) return; // single numbers only (not "6.5-8.5")
        const issue = plausibilityIssue({ label, value: cell.trim(), unit: null, type: 'number' });
        if (!issue) return;
        // A labelled value on the page with the same digits is the likely reading (dropped decimal point).
        const digits = cell.replace(/\D/g, '');
        const twin = fields.find((f) => similarity(f.label.replace(/^(outlet|inlet|final|raw)\s+/i, ''), label) >= 0.8 && f.value.replace(/\D/g, '') === digits && !plausibilityIssue(f));
        issues.push({ row: ri, col: ci, message: `${label}: "${cell}" - ${issue.replace('Implausible value: ', '')}`, suggestion: twin?.value });
      });
    });
    if (issues.length) t.issues = issues;
  }
}

export function applyPlausibility(fields: AuditField[]): void {
  for (const f of fields) {
    const issue = plausibilityIssue(f);
    if (!issue) continue;
    f.conf = Math.min(f.conf, 0.4);
    f.note = issue;
  }
}

/** Structure one page from OCR readings: primary reading drives structure, the other cross-checks values. */
export function structureFromOcr(page: number, readings: OcrReading[], figures: AuditFigure[] = []): { fields: AuditField[]; tables: AuditTable[]; figures: AuditFigure[]; text: AuditPageText } {
  const [primary, ...others] = readings;
  if (!primary) return { fields: [], tables: [], figures, text: { page, text: '', engine: 'none' } };
  // Ruled tables are often only readable in the line-removed pass: take tables from the reading that finds the most rows.
  const tables = readings.map((r) => tablesFromLines(r.lines, page, r.engine)).sort((a, b) => b.reduce((n, t) => n + t.rows.length, 0) - a.reduce((n, t) => n + t.rows.length, 0))[0] ?? [];
  const inTable = (b: BBox) => tables.some((t) => t.bbox && b[1] >= t.bbox[1] - 0.005 && b[1] + b[3] <= t.bbox[1] + t.bbox[3] + 0.005);
  const fields = keyValuesFromLines(primary.lines.filter((l) => !inTable(l.bbox)), page, primary.engine);
  for (const other of others) crossCheck(fields, keyValuesFromLines(other.lines, page, other.engine));
  applyPlausibility(fields);
  checkTables(tables, fields);
  return { fields, tables, figures, text: { page, text: visualRows(primary.lines).map((l) => l.text).join('\n'), engine: primary.engine } };
}

/** Attach a second engine's readings to matching fields (same page, same label) and recompute agreement. */
export function crossCheck(fields: AuditField[], other: AuditField[]): void {
  for (const f of fields) {
    const match = other.find((o) => o.page === f.page && similarity(o.label, f.label) >= 0.8);
    if (match) for (const s of match.sources) if (!f.sources.some((x) => x.engine === s.engine)) f.sources.push(s);
    f.agreement = agreementOf(f.sources.map((s) => splitUnit(s.value).value));
  }
}

/** Overall machine agreement (share of multi-source fields whose engines agree). */
export function agreementScore(fields: AuditField[]): number | null {
  const multi = fields.filter((f) => f.sources.length > 1);
  if (!multi.length) return null;
  return multi.filter((f) => f.agreement === 'match' || f.agreement === 'close').length / multi.length;
}

// ------------------------------------------------------------------ verification workflow
export type AuditDocStatus = 'processing' | 'in_review' | 'verified' | 'approved' | 'rejected';

export function reviewProgress(x: Pick<AuditExtraction, 'fields' | 'tables'>) {
  const items = [...x.fields, ...x.tables];
  const done = items.filter((i) => i.status === 'confirmed' || i.status === 'corrected').length;
  const flagged = items.filter((i) => i.status === 'flagged').length;
  return { total: items.length, done, flagged, pending: items.length - done - flagged, complete: items.length > 0 && done === items.length };
}

/** Fields the reviewer must look at first: disagreement between engines or low confidence. */
export const needsAttention = (f: AuditField) => f.agreement === 'mismatch' || f.conf < 0.75;

/** Largest-type line near the top of page 1 that is not a label/value pair (OCR noise tokens stripped). */
export function guessTitle(readings: OcrReading[][]): string | null {
  const lines = readings[0]?.[0]?.lines ?? [];
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
  const cand = lines.slice(0, 8).map((l) => {
    const words = l.words.filter((w) => /[A-Za-z0-9]{2,}/.test(w.text) && w.conf > 50);
    return { text: normalizeValue(words.map((w) => w.text).join(' ')), h: median(words.map((w) => w.bbox[3])), conf: l.conf };
  }).filter((c) => c.text.length >= 6 && !/[:=]/.test(c.text) && c.conf > 55);
  cand.sort((a, b) => b.h - a.h);
  return cand[0] ? cand[0].text.slice(0, 120) : null;
}
