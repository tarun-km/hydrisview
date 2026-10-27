import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSoftcopy, checklistFromLines, fuseExtractions, type AuditExtraction, type AuditField, type AuditTable, type OcrLine } from '../src/index';

const field = (label: string, value: string, conf = 0.9, engine = 'x', unit: string | null = null): AuditField => ({
  id: `p1-${label.toLowerCase().replace(/\W+/g, '-')}`, label, value, unit, type: /^[\d.,]+$/.test(value) ? 'number' : 'text', page: 1, bbox: [0.1, 0.2, 0.5, 0.02], conf,
  sources: [{ engine, value, conf }], agreement: 'single', status: 'pending',
});
const table = (rows: string[][], engine: string): AuditTable => ({ id: 'p1-t1', page: 1, bbox: [0.05, 0.4, 0.9, 0.2], header: ['Parameter', 'Limit', 'Result'], rows, conf: 0.9, engine, status: 'pending', title: null });
const ex = (fields: AuditField[], tables: AuditTable[] = [], title = 'Monthly Effluent Compliance Audit'): AuditExtraction => ({ title, docType: 'general', summary: '', pages: [], fields, tables, figures: [], warnings: [] });

test('fusion: majority vote per field, decimals significant, disagreement flagged', () => {
  const f = fuseExtractions([
    { engine: 'ocr:server', extraction: ex([field('Outlet pH', '7.3', 0.9, 'ocr:server'), field('Auditor', 'Meera Pillai', 0.9, 'ocr:server')]) },
    { engine: 'ocr:device', extraction: ex([field('Outlet pH', '73', 0.95, 'ocr:device'), field('Auditor', 'Meera Pillai', 0.9, 'ocr:device')]) },
    { engine: 'vision:claude-opus-5-5', extraction: ex([field('Outlet pH', '7.3', 0.97, 'vision'), field('Auditor', 'Meera Pi1lai', 0.6, 'vision')]) },
  ]);
  const ph = f.fields.find((x) => x.label === 'Outlet pH')!;
  assert.equal(ph.value, '7.3', 'two engines read 7.3; 73 loses');
  assert.equal(ph.agreement, 'mismatch');
  assert.match(ph.note ?? '', /Engines disagree/);
  assert.equal(f.fields.find((x) => x.label === 'Auditor')!.value, 'Meera Pillai');
  assert.equal(f.engineStats.length, 3);
  assert.equal(f.engineStats.find((s) => s.engine === 'ocr:device')!.agreement, 0.5);
});

test('fusion: implausible winner loses to a plausible reading', () => {
  const f = fuseExtractions([
    { engine: 'a', extraction: ex([field('Outlet pH', '71', 0.9)]) },
    { engine: 'b', extraction: ex([field('Outlet pH', '71', 0.9)]) },
    { engine: 'c', extraction: ex([field('Outlet pH', '7.1', 0.8)]) },
  ]);
  assert.equal(f.fields[0]!.value, '7.1');
});

test('fusion: table cells voted and disagreements become issues', () => {
  const f = fuseExtractions([
    { engine: 'a', extraction: ex([], [table([['pH', '6.5-8.5', '7.3'], ['TSS', '100', '38']], 'a')]) },
    { engine: 'b', extraction: ex([], [table([['pH', '6.5-8.5', '7.3'], ['TSS', '100', '88']], 'b')]) },
    { engine: 'c', extraction: ex([], [table([['pH', '6.5-8.5', '7.3'], ['TSS', '100', '38']], 'c')]) },
  ]);
  assert.deepEqual(f.tables[0]!.rows, [['pH', '6.5-8.5', '7.3'], ['TSS', '100', '38']]);
  assert.equal(f.tables[0]!.issues?.length, 1);
  assert.equal(f.tables[0]!.issues![0]!.row, 1);
});

const ln = (y: number, text: string, x = 0.1): OcrLine => {
  const words = text.split(' ').map((t, i) => ({ text: t, conf: 90, bbox: [x + i * 0.07, y, 0.06, 0.015] as [number, number, number, number] }));
  return { text, conf: 90, bbox: [x, y, words.length * 0.07, 0.015], words };
};

test('soft copy model: letterhead, ordered blocks, checklist, remarks, signatures', () => {
  const lines = [ln(0.04, 'RIVERBEND PROCESS INDUSTRIES'), ln(0.08, 'Monthly Effluent Compliance Audit'), ln(0.6, 'Site Checklist'), ln(0.63, '[x] Sampling point labelled'), ln(0.66, '[ ] Discharge log up to date')];
  const x = ex([
    { ...field('Outlet pH', '7.3'), bbox: [0.1, 0.2, 0.4, 0.02] },
    { ...field('Remarks', 'All parameters within consent limits.'), bbox: [0.1, 0.8, 0.8, 0.02] },
    { ...field('Auditor Signature', 'Signature present'), type: 'signature', bbox: [0.1, 0.85, 0.5, 0.02] },
  ], [{ ...table([['pH', '6.5-8.5', '7.3']], 'a'), title: 'Laboratory Results' }]);
  const m = buildSoftcopy(x, { documentId: 'DOC-1', engines: ['ocr:server'], verification: 'Pending verification', lines: [lines] });
  assert.deepEqual(m.letterhead, ['RIVERBEND PROCESS INDUSTRIES']);
  assert.deepEqual(m.blocks.map((b) => b.kind), ['meta', 'table', 'checklist', 'paragraph', 'signatures']);
  const cl = m.blocks.find((b) => b.kind === 'checklist');
  assert.ok(cl && cl.kind === 'checklist');
  assert.deepEqual(cl.items.map((i) => [i.text, i.checked]), [['Sampling point labelled', true], ['Discharge log up to date', false]]);
  assert.equal(m.footer.documentId, 'DOC-1');
  assert.ok(checklistFromLines(lines, 1));
});
