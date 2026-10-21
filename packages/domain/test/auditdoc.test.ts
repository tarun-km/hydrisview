import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agreementOf, keyValuesFromLines, structureFromOcr, tablesFromLines, type OcrLine, type OcrReading, reviewProgress, splitUnit, similarity } from '../src/auditdoc';

// Build an OCR line from cells placed at x positions (normalized), one row at y.
const line = (y: number, cells: [number, string][], conf = 92): OcrLine => {
  const words = cells.flatMap(([x, t]) => t.split(' ').map((w, i) => ({ text: w, conf, bbox: [x + i * 0.05, y, 0.045, 0.02] as [number, number, number, number] })));
  const x0 = Math.min(...words.map((w) => w.bbox[0]));
  const x1 = Math.max(...words.map((w) => w.bbox[0] + w.bbox[2]));
  return { text: cells.map((c) => c[1]).join(' '), conf, bbox: [x0, y, x1 - x0, 0.02], words };
};

test('key/value lines become typed fields with units', () => {
  const f = keyValuesFromLines([line(0.1, [[0.05, 'Inspector: Asha Raman']]), line(0.13, [[0.05, 'Outlet pH: 7.4']]), line(0.16, [[0.05, 'Date: 12/10/2026']]), line(0.19, [[0.05, 'Inlet COD: 412 mg/L']])], 1, 'a');
  assert.deepEqual(f.map((x) => [x.label, x.value, x.type]), [['Inspector', 'Asha Raman', 'text'], ['Outlet pH', '7.4', 'number'], ['Date', '12/10/2026', 'date'], ['Inlet COD', '412', 'number']]);
  assert.equal(f[3]!.unit, 'mg/L');
});

test('aligned rows become a table with header', () => {
  const t = tablesFromLines([
    line(0.4, [[0.05, 'Parameter'], [0.35, 'Limit'], [0.6, 'Result']]),
    line(0.43, [[0.05, 'pH'], [0.35, '6.5-8.5'], [0.6, '7.2']]),
    line(0.46, [[0.05, 'TSS'], [0.35, '100'], [0.6, '38']]),
    line(0.49, [[0.05, 'COD'], [0.35, '250'], [0.6, '212']]),
  ], 1, 'a');
  assert.equal(t.length, 1);
  assert.deepEqual(t[0]!.header, ['Parameter', 'Limit', 'Result']);
  assert.deepEqual(t[0]!.rows[2], ['COD', '250', '212']);
});

test('two OCR passes cross-check values; numeric disagreement is a mismatch', () => {
  const a: OcrReading = { engine: 'ocr-a', text: '', conf: 90, lines: [line(0.1, [[0.05, 'Outlet pH: 7.4']]), line(0.13, [[0.05, 'Operator: Divya Nair']])] };
  const b: OcrReading = { engine: 'ocr-b', text: '', conf: 88, lines: [line(0.1, [[0.05, 'Outlet pH: 7.1']]), line(0.13, [[0.05, 'Operator: Divya Nalr']])] };
  const { fields } = structureFromOcr(1, [a, b]);
  assert.equal(fields.find((f) => f.label === 'Outlet pH')!.agreement, 'mismatch');
  assert.equal(fields.find((f) => f.label === 'Operator')!.agreement, 'close');
  assert.equal(agreementOf(['1O5', '105']), 'match'); // O/0 look-alike folded in numbers
});

test('helpers', () => {
  assert.deepEqual(splitUnit('3.2 NTU'), { value: '3.2', unit: 'NTU' });
  assert.ok(similarity('Riverbend', 'Rlverbend') > 0.85);
  assert.equal(reviewProgress({ fields: [], tables: [] }).complete, false);
});

test('decimal points matter when comparing readings; thousands separators do not', () => {
  assert.equal(agreementOf(['7.4', '74']), 'mismatch');
  assert.equal(agreementOf(['18,857', '18857']), 'match');
});

test('table columns returned as separate OCR blocks are re-joined into rows', () => {
  const col = (x: number, items: string[]) => items.map((t, i) => line(0.4 + i * 0.03, [[x, t]]));
  const lines = [...col(0.05, ['Parameter', 'pH', 'TSS', 'COD']), ...col(0.35, ['Limit', '6.5-8.5', '100', '250']), ...col(0.6, ['Result', '7.2', '38', '212'])];
  const t = tablesFromLines(lines, 1, 'a');
  assert.equal(t.length, 1);
  assert.deepEqual(t[0]!.rows[1], ['TSS', '100', '38']);
});

test('values both engines agree on are still range-checked (dropped decimal point)', () => {
  const a: OcrReading = { engine: 'ocr-a', text: '', conf: 92, lines: [line(0.1, [[0.05, 'Outlet pH: 71']])] };
  const { fields } = structureFromOcr(1, [a, { ...a, engine: 'ocr-b' }]);
  assert.equal(fields[0]!.agreement, 'match');
  assert.ok(fields[0]!.conf <= 0.4);
  assert.match(fields[0]!.note ?? '', /pH/);
});

test('table cells are range-checked; a matching labelled value is offered as the fix', () => {
  const lines = [
    line(0.10, [[0.05, 'Outlet pH: 7.3']]),
    line(0.40, [[0.05, 'Parameter'], [0.35, 'Limit'], [0.6, 'Result']]),
    line(0.43, [[0.05, 'pH'], [0.35, '6.5-8.5'], [0.6, '73']]),
    line(0.46, [[0.05, 'TSS'], [0.35, '100'], [0.6, '38']]),
    line(0.49, [[0.05, 'COD'], [0.35, '250'], [0.6, '212']]),
  ];
  const r = structureFromOcr(1, [{ engine: 'a', text: '', conf: 90, lines }]);
  const t = r.tables[0]!;
  assert.equal(t.issues?.length, 1);
  assert.deepEqual([t.issues![0]!.row, t.issues![0]!.col, t.issues![0]!.suggestion], [0, 2, '7.3']);
});
