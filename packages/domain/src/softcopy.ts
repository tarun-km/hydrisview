/**
 * Multi-engine fusion and the "soft copy" document model.
 *
 * Fusion: several engines read the same page (on-device Tesseract passes, server Tesseract on the
 * clean page, Claude vision, ML Kit on Android). Each engine's structured extraction is one voter.
 * Fields are matched by page + label, table cells by table + row label + column; values are grouped
 * by the comparison key (decimal points significant, look-alike glyphs folded) and the group with
 * the highest confidence-weighted vote wins. Any disagreement is kept on the item (sources, note,
 * table issues) so the reviewer resolves it - the dual-verification flow is unchanged.
 *
 * Soft copy: the fused extraction plus page lines become an ordered document model (header,
 * key/value block, ruled tables, checklist, figures, signatures, remarks) that the console renders
 * as HTML and the API typesets as DOCX and PDF.
 */
import {
  agreementOf, applyPlausibility, checkTables, normalizeValue, plausibilityIssue, similarity, splitUnit, visualRows,
  type AuditExtraction, type AuditField, type AuditFigure, type AuditTable, type BBox, type OcrLine,
} from './auditdoc';

export interface EngineResult {
  /** Engine group name (e.g. 'ocr:device', 'ocr:server', 'vision:claude-opus-5-5', 'mlkit'). */
  engine: string;
  extraction: AuditExtraction;
  /** Vote weight (vision is better at layout and handwriting). */
  weight?: number;
}

export interface EngineStat { engine: string; fields: number; tables: number; conf: number | null; agreement: number | null }

export interface FusedExtraction extends AuditExtraction { engineStats: EngineStat[] }

const keyOf = (v: string) => normalizeValue(splitUnit(v).value).toLowerCase().replace(/(\d),(?=\d{3}(?!\d))/g, '$1').replace(/\s+/g, '');
const sameValue = (a: string, b: string) => keyOf(a) === keyOf(b) || similarity(splitUnit(a).value, splitUnit(b).value) === 1;

interface Vote { value: string; score: number; engines: string[]; conf: number }
function vote(cands: { engine: string; value: string; conf: number; weight: number }[]): Vote[] {
  const groups: Vote[] = [];
  for (const c of cands) {
    if (!normalizeValue(c.value)) continue;
    const g = groups.find((x) => sameValue(x.value, c.value));
    if (g) {
      g.score += c.conf * c.weight;
      g.engines.push(c.engine);
      g.conf = Math.max(g.conf, c.conf);
    } else groups.push({ value: c.value, score: c.conf * c.weight, engines: [c.engine], conf: c.conf });
  }
  return groups.sort((a, b) => b.engines.length - a.engines.length || b.score - a.score);
}

const DEFAULT_WEIGHT = (e: string) => (e.startsWith('vision:') ? 1.3 : e === 'ocr:server' ? 1.05 : 1);

/** Fuse per-engine extractions into one, field by field and cell by cell. */
export function fuseExtractions(results: EngineResult[]): FusedExtraction {
  const rs = results.filter((r) => r.extraction);
  if (!rs.length) return { title: '', docType: 'general', summary: '', pages: [], fields: [], tables: [], figures: [], warnings: ['No engine produced a reading'], engineStats: [] };
  const w = (r: EngineResult) => r.weight ?? DEFAULT_WEIGHT(r.engine);
  // Structure comes from the engine that found the most (vision first on ties).
  const base = [...rs].sort((a, b) => (b.extraction.fields.length + b.extraction.tables.length * 3) * w(b) - (a.extraction.fields.length + a.extraction.tables.length * 3) * w(a))[0]!;

  // ---- fields: cluster by page + label
  type Cluster = { label: string; page: number; members: { r: EngineResult; f: AuditField }[] };
  const clusters: Cluster[] = [];
  for (const r of [base, ...rs.filter((x) => x !== base)]) {
    for (const f of r.extraction.fields) {
      const c = clusters.find((x) => x.page === f.page && similarity(x.label, f.label) >= 0.8 && !x.members.some((m) => m.r === r));
      if (c) c.members.push({ r, f });
      else if (r === base || f.conf >= 0.6) clusters.push({ label: f.label, page: f.page, members: [{ r, f }] });
    }
  }
  const fields: AuditField[] = clusters.map((c, i) => {
    const lead = c.members[0]!.f;
    const votes = vote(c.members.map((m) => ({ engine: m.r.engine, value: m.f.value, conf: m.f.conf, weight: w(m.r) })));
    let win = votes[0];
    // A dropped decimal point can win a vote; prefer a plausible reading when the winner is not.
    if (win && plausibilityIssue({ label: c.label, value: win.value, unit: lead.unit, type: lead.type })) {
      const alt = votes.find((v) => !plausibilityIssue({ label: c.label, value: v.value, unit: lead.unit, type: lead.type }));
      if (alt) win = alt;
    }
    const value = normalizeValue(win?.value ?? lead.value);
    const sources = c.members.flatMap((m) => m.f.sources.length ? m.f.sources : [{ engine: m.r.engine, value: m.f.value, conf: m.f.conf }]);
    const uniq = sources.filter((s, j) => sources.findIndex((x) => x.engine === s.engine) === j);
    const agreement = c.members.length < 2 && uniq.length < 2 ? 'single' : agreementOf(uniq.map((s) => splitUnit(s.value).value));
    const dissent = votes.length > 1 ? votes.map((v) => `${v.engines.join('+')}: ${v.value}`).join(' · ') : null;
    const voters = c.members.length;
    const conf = Math.min(1, (win?.conf ?? lead.conf) * (voters > 1 && votes.length === 1 ? 1.05 : votes.length > 1 ? 0.8 : 1));
    return {
      ...lead,
      id: lead.id || `p${c.page}-f${i + 1}`,
      value, unit: c.members.map((m) => m.f.unit).find(Boolean) ?? null, conf,
      sources: uniq, agreement, extracted: value, status: 'pending',
      note: dissent ? `Engines disagree - ${dissent}` : null,
      bbox: c.members.map((m) => m.f.bbox).find(Boolean) ?? null,
    };
  });
  // Keep ids unique.
  const seen = new Set<string>();
  for (const f of fields) { let id = f.id; let n = 2; while (seen.has(id)) id = `${f.id}-${n++}`; f.id = id; seen.add(id); }
  applyPlausibility(fields);

  // ---- tables: base tables, cells voted with matching tables from other engines
  const tables: AuditTable[] = base.extraction.tables.map((t) => {
    const others = rs.filter((r) => r !== base).flatMap((r) => r.extraction.tables.filter((o) => o.page === t.page && similarity(o.header.join(' '), t.header.join(' ')) >= 0.6).slice(0, 1).map((o) => ({ r, o })));
    const issues: NonNullable<AuditTable['issues']> = [];
    const rows = t.rows.map((row, ri) => row.map((cell, ci) => {
      const cands = [{ engine: base.engine, value: cell, conf: t.conf, weight: w(base) }];
      for (const { r, o } of others) {
        const orow = o.rows.find((x) => similarity(x[0] ?? '', row[0] ?? '') >= 0.8) ?? o.rows[ri];
        const ocol = o.header.findIndex((h) => similarity(h, t.header[ci] ?? '') >= 0.8);
        const v = orow?.[ocol >= 0 ? ocol : ci];
        if (v !== undefined && v !== '') cands.push({ engine: r.engine, value: v, conf: o.conf, weight: w(r) });
      }
      const votes = vote(cands);
      if (votes.length > 1) issues.push({ row: ri, col: ci, message: `Engines disagree on "${row[0] ?? ''}" / ${t.header[ci] ?? `column ${ci + 1}`}: ${votes.map((v) => `${v.engines.join('+')} ${v.value}`).join(' · ')}`, suggestion: votes[0]!.value });
      return votes[0] ? normalizeValue(votes[0].value) : cell;
    }));
    return { ...t, rows, engine: [base.engine, ...others.map((x) => x.r.engine)].join('+'), conf: others.length ? Math.min(1, t.conf * (issues.length ? 0.9 : 1.05)) : t.conf, status: 'pending', ...(issues.length ? { issues } : { issues: undefined }) };
  });
  // checkTables replaces issues with plausibility findings: keep the engine disagreements too.
  const engineIssues = tables.map((t) => t.issues ?? []);
  checkTables(tables, fields);
  tables.forEach((t, i) => {
    const all = [...engineIssues[i]!, ...(t.issues ?? []).filter((x) => !engineIssues[i]!.some((e) => e.row === x.row && e.col === x.col && e.message === x.message))];
    t.issues = all.length ? all : undefined;
  });

  const figures: AuditFigure[] = (rs.find((r) => r.engine.startsWith('vision:') && r.extraction.figures.length) ?? rs.find((r) => r.extraction.figures.length) ?? base).extraction.figures;
  const engineStats: EngineStat[] = rs.map((r) => {
    const fs = r.extraction.fields;
    const agreeing = fs.filter((f) => { const fu = fields.find((x) => x.page === f.page && similarity(x.label, f.label) >= 0.8); return fu && sameValue(fu.value, f.value); }).length;
    return { engine: r.engine, fields: fs.length, tables: r.extraction.tables.length, conf: fs.length ? fs.reduce((s, f) => s + f.conf, 0) / fs.length : null, agreement: fs.length ? agreeing / fs.length : null };
  });
  const title = (rs.find((r) => r.engine.startsWith('vision:'))?.extraction.title || base.extraction.title || rs.map((r) => r.extraction.title).find(Boolean) || '').trim();
  return {
    title, docType: base.extraction.docType, summary: rs.map((r) => r.extraction.summary).find(Boolean) ?? '',
    pages: base.extraction.pages, fields, tables, figures,
    warnings: [...new Set(rs.flatMap((r) => r.extraction.warnings))],
    engineStats,
  };
}

// ------------------------------------------------------------------ soft copy model
export interface SoftKV { id: string; label: string; value: string; unit: string | null; attention: boolean }
export interface SoftChecklistItem { text: string; checked: boolean | null; bbox: BBox | null; page: number }
export interface SoftFigure { id: string; page: number; bbox: BBox; kind: AuditFigure['kind']; caption: string; /** PNG data URL, filled by the server. */ image?: string | null; aspect?: number }
export interface SoftSignature { label: string; present: boolean; figureId: string | null; image?: string | null; aspect?: number }
export type SoftBlock =
  | { kind: 'meta'; items: SoftKV[] }
  | { kind: 'table'; title: string | null; header: string[]; rows: string[][]; flagged: { row: number; col: number }[] }
  | { kind: 'checklist'; title: string | null; items: SoftChecklistItem[] }
  | { kind: 'figure'; figure: SoftFigure }
  | { kind: 'paragraph'; title: string | null; text: string }
  | { kind: 'signatures'; items: SoftSignature[] };

export interface SoftcopyModel {
  documentId: string;
  title: string;
  docType: string;
  letterhead: string[];
  blocks: SoftBlock[];
  footer: { documentId: string; engines: string[]; verification: string; pages: number };
}

const LETTERS = (s: string) => (s.match(/[A-Za-z]/g) ?? []).length;
const clean = (s: string) => normalizeValue(s.replace(/^[^A-Za-z0-9]+/, '').replace(/^\S{1,2}\s+(?=[A-Z]{3})/, '').replace(/[\s|_\]\[}{=~]+$/, ''));
/** OCR noise around list items: box glyphs read as "v/|", "[|", stray 1-2 character tokens at the ends. */
const cleanItem = (s: string) => {
  let t = clean(s).split(' ');
  while (t.length > 1 && (/[^A-Za-z0-9'-]/.test(t[0]!) && t[0]!.length <= 3 || t[0]!.length === 1 && !/^[AI]$/.test(t[0]!))) t.shift();
  while (t.length > 1 && (/[^A-Za-z0-9.'-]/.test(t[t.length - 1]!) || t[t.length - 1]!.length <= 2 && t[t.length - 1] !== t[t.length - 1]!.toUpperCase())) t.pop();
  return t.join(' ');
};
const looksLikeText = (s: string) => s.length >= 4 && LETTERS(s) / s.length >= 0.6;
const isHeading = (s: string) => looksLikeText(s) && s.split(' ').length <= 6 && !/[:.]$/.test(s) && /^[A-Z]/.test(s);

/**
 * Checklist items: rows under a "...checklist" heading (or rows that start with a tick box glyph),
 * up to the next field, caption or blank region. `checked` is null when the box state is unknown
 * (the server fills it from the pixels inside the box).
 */
export function checklistFromLines(lines: OcrLine[], page: number): { title: string | null; items: SoftChecklistItem[]; y: number } | null {
  const rows = visualRows(lines);
  const hi = rows.findIndex((r) => /check\s?list/i.test(r.text) && r.text.length < 60);
  const box = /^\s*(\[[ xX✓✔]?\]|[☐☑☒✓✔]|\|?\s?[vVxX/]\s?\|)\s*/;
  const items: SoftChecklistItem[] = [];
  const start = hi >= 0 ? hi + 1 : rows.findIndex((r) => box.test(r.text));
  if (start < 0) return null;
  let lastY = rows[start - 1]?.bbox[1] ?? rows[start]!.bbox[1];
  for (let i = start; i < rows.length; i++) {
    const r = rows[i]!;
    const raw = r.text;
    const text = cleanItem(raw.replace(box, ''));
    if (/:/.test(text) || /^fig(ure)?\b/i.test(text) || !looksLikeText(text)) { if (items.length) break; continue; }
    if (r.bbox[1] - lastY > 0.06 && items.length) break;
    const m = box.exec(raw);
    const checked = m ? /[xX✓✔☑☒vV/]/.test(m[1]!) ? true : /☐|\[ ?\]/.test(m[1]!) ? false : null : null;
    // Text left of the box column (e.g. a figure caption on the same row) stays out.
    // Box from the first real word: the tick box sits just left of it.
    const ws = r.words.filter((wd) => /[A-Za-z]{2,}/.test(wd.text));
    const bbox: BBox = ws.length ? [ws[0]!.bbox[0], ws[0]!.bbox[1], ws[ws.length - 1]!.bbox[0] + ws[ws.length - 1]!.bbox[2] - ws[0]!.bbox[0], ws[0]!.bbox[3]] : r.bbox;
    items.push({ text, checked, bbox, page });
    lastY = r.bbox[1];
    if (items.length >= 30) break;
  }
  if (!items.length) return null;
  return { title: hi >= 0 ? cleanItem(rows[hi]!.text) : null, items, y: rows[hi >= 0 ? hi : start]!.bbox[1] };
}

const REMARK = /^(remarks?|comments?|notes?|observations?)$/i;
const SIGN = /sign(ature|ed)?\b/i;

export function buildSoftcopy(x: AuditExtraction, opts: { documentId: string; engines: string[]; verification: string; lines?: OcrLine[][]; pageCount?: number }): SoftcopyModel {
  const placed: { page: number; y: number; block: SoftBlock }[] = [];
  const lines = opts.lines ?? [];
  const rows1 = visualRows(lines[0] ?? []);
  const titleKey = x.title.toLowerCase();
  // Letterhead: text lines above the title on page 1.
  const ti = rows1.findIndex((r) => similarity(r.text.toLowerCase(), titleKey) >= 0.8);
  const letterhead = (ti > 0 ? rows1.slice(0, ti) : []).map((r) => clean(r.text)).filter(looksLikeText).slice(0, 3);

  const meta: SoftKV[] = [];
  const sigs: SoftSignature[] = [];
  const remarks: { page: number; y: number; title: string; text: string }[] = [];
  let metaPos: { page: number; y: number } | null = null;
  for (const f of x.fields) {
    if (f.type === 'signature' || SIGN.test(f.label)) {
      const fig = x.figures.find((g) => g.kind === 'signature' && g.page === f.page && (!f.bbox || Math.abs(g.bbox[1] + g.bbox[3] / 2 - (f.bbox[1] + f.bbox[3] / 2)) < 0.05));
      sigs.push({ label: f.label, present: !!fig || !!normalizeValue(f.value), figureId: fig?.id ?? null });
      continue;
    }
    // Small print at the foot of the page ("Form X - printed ...") is not a key/value of the record.
    if (f.bbox && f.bbox[1] > 0.92 && f.value.length > 40) continue;
    if (REMARK.test(f.label)) { remarks.push({ page: f.page, y: f.bbox?.[1] ?? 0.9, title: f.label, text: f.value }); continue; }
    meta.push({ id: f.id, label: f.label, value: f.value, unit: f.unit ?? null, attention: f.agreement === 'mismatch' || !!f.note || f.conf < 0.75 });
    metaPos ??= { page: f.page, y: f.bbox?.[1] ?? 0.15 };
  }
  if (!sigs.length) for (const g of x.figures.filter((g) => g.kind === 'signature').slice(0, 3)) sigs.push({ label: 'Signature', present: true, figureId: g.id });
  if (meta.length) placed.push({ page: metaPos!.page, y: metaPos!.y, block: { kind: 'meta', items: meta } });

  for (const t of x.tables) {
    let title = t.title ?? null;
    if (!title && t.bbox) {
      const above = visualRows(lines[t.page - 1] ?? []).filter((r) => r.bbox[1] < t.bbox![1] && t.bbox![1] - r.bbox[1] < 0.06).pop();
      if (above && isHeading(clean(above.text))) title = clean(above.text);
    }
    placed.push({ page: t.page, y: t.bbox?.[1] ?? 0.5, block: { kind: 'table', title, header: t.header, rows: t.rows, flagged: (t.issues ?? []).map((i) => ({ row: i.row, col: i.col })) } });
  }
  lines.forEach((ls, i) => {
    const c = checklistFromLines(ls, i + 1);
    if (c) placed.push({ page: i + 1, y: c.y, block: { kind: 'checklist', title: c.title, items: c.items } });
  });
  // Rules and underlines (very wide, very thin) are layout, not figures.
  const aspect = (g: AuditFigure) => (g.bbox[2] * 210) / Math.max(1e-6, g.bbox[3] * 297);
  const overlap = (a: BBox, b: BBox) => Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
  // A "figure" mostly inside a table is a header cell or rule the detector picked up.
  const overlapsTable = (g: AuditFigure) => x.tables.some((t) => t.page === g.page && t.bbox && overlap(g.bbox, t.bbox) > 0.3 * g.bbox[2] * g.bbox[3]);
  const keep = (g: AuditFigure) => g.kind !== 'signature' && g.kind !== 'logo' && aspect(g) < 8 && aspect(g) > 0.125 && g.bbox[2] * g.bbox[3] >= 0.012 && !overlapsTable(g);
  for (const g of x.figures.filter(keep)) {
    // Caption printed under the figure ("Fig 1. ...") beats the generic kind label.
    const cap = visualRows(lines[g.page - 1] ?? []).find((r) => /^fig(ure)?\.?\s*\d/i.test(clean(r.text)) && r.bbox[1] > g.bbox[1] + g.bbox[3] * 0.6 && r.bbox[1] < g.bbox[1] + g.bbox[3] + 0.05);
    // Keep the printed caption out of the cropped image.
    const bbox: BBox = cap && cap.bbox[1] > g.bbox[1] + 0.02 ? [g.bbox[0], g.bbox[1], g.bbox[2], Math.min(g.bbox[3], cap.bbox[1] - g.bbox[1] - 0.003)] : g.bbox;
    placed.push({ page: g.page, y: g.bbox[1], block: { kind: 'figure', figure: { ...g, bbox, caption: cap ? clean(cap.text) : g.caption } } });
  }
  for (const r of remarks) placed.push({ page: r.page, y: r.y, block: { kind: 'paragraph', title: r.title || null, text: r.text } });
  placed.sort((a, b) => a.page - b.page || a.y - b.y);
  const blocks = placed.map((p) => p.block);
  if (sigs.length) blocks.push({ kind: 'signatures', items: sigs });
  return {
    documentId: opts.documentId, title: x.title || 'Audit document', docType: x.docType, letterhead, blocks,
    footer: { documentId: opts.documentId, engines: opts.engines, verification: opts.verification, pages: opts.pageCount ?? Math.max(1, x.pages.length) },
  };
}
