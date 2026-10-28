import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import type { OcrLine, OcrReading } from '@hydris/domain';
import { as, harness, type Harness } from './helpers.js';
import { mergeVision } from '../src/modules/audit-docs.js';

let h: Harness;
before(async () => { h = await harness(); });
after(async () => { await h.app.close(); await h.database.close(); });

// 1x1 PNG (valid image for PDF embedding).
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const line = (y: number, text: string, conf = 91): OcrLine => {
  const words = text.split(' ').map((t, i) => ({ text: t, conf, bbox: [0.05 + i * 0.08, y, 0.07, 0.02] as [number, number, number, number] }));
  return { text, conf, bbox: [0.05, y, words.length * 0.08, 0.02], words };
};
const reading = (engine: string, lines: OcrLine[]): OcrReading => ({ engine, text: lines.map((l) => l.text).join('\n'), conf: 90, lines });
const page = (a: OcrLine[], b: OcrLine[]) => ({ mime: 'image/png', data: PNG, width: 1200, height: 1600, readings: [reading('ocr:original', a), reading('ocr:enhanced', b)] });

test('capture → review → verify → independent approval → PDF', async () => {
  const op = await as(h.app, 'operator');
  const a = [line(0.05, 'Monthly Effluent Compliance Audit'), line(0.12, 'Inspector: Divya Nair'), line(0.15, 'Outlet pH: 7.4'), line(0.18, 'Outlet TSS: 38 mg/L')];
  const b = [line(0.05, 'Monthly Effluent Compliance Audit'), line(0.12, 'Inspector: Divya Nair'), line(0.15, 'Outlet pH: 7.1'), line(0.18, 'Outlet TSS: 38 mg/L')];
  const c = await op.req('POST', '/api/audit-docs', { pages: [page(a, b)] });
  assert.equal(c.statusCode, 201, c.body);
  const id = c.json().id;
  assert.equal(c.json().title, 'Monthly Effluent Compliance Audit');

  const d = (await op.req('GET', `/api/audit-docs/${id}`)).json();
  const ph = d.extraction.fields.find((f: { label: string }) => f.label === 'Outlet pH');
  assert.equal(ph.agreement, 'mismatch', 'engines disagree on pH');
  assert.equal(d.extraction.fields.find((f: { label: string }) => f.label === 'Outlet TSS').agreement, 'match');

  const sup = await as(h.app, 'supervisor');
  // Bulk-confirm only values both engines agree on; the mismatching pH stays pending.
  const bulk = await sup.req('POST', `/api/audit-docs/${id}/confirm-agreed`);
  assert.equal(bulk.statusCode, 200, bulk.body);
  assert.equal(bulk.json().review.pending, 1);
  let v = await sup.req('POST', `/api/audit-docs/${id}/verify`, {});
  assert.equal(v.statusCode, 400, 'cannot verify with pending items');
  const fix = await sup.req('PATCH', `/api/audit-docs/${id}/items/${ph.id}`, { action: 'correct', value: '7.4', note: 'Checked against paper' });
  assert.equal(fix.statusCode, 200, fix.body);
  assert.equal(fix.json().item.status, 'confirmed', 'correcting to the extracted value counts as confirmation');
  v = await sup.req('POST', `/api/audit-docs/${id}/verify`, { note: 'All values checked' });
  assert.equal(v.statusCode, 200, v.body);

  // Four-eyes: the verifier cannot approve their own verification (non-demo tenant).
  const admin = await as(h.app, 'admin');
  const self = await admin.req('POST', `/api/audit-docs/${id}/approve`, { decision: 'approve' });
  assert.equal(self.statusCode, 200, self.body); // admin is a different person from the supervisor
  const done = (await op.req('GET', `/api/audit-docs/${id}`)).json();
  assert.equal(done.status, 'approved');
  const bad = await op.req('POST', '/api/audit-docs', { pages: [{ ...page(a, b), mime: 'image/jpeg', data: 'aGVsbG8=' }] });
  assert.equal(bad.statusCode, 400, 'non-image data rejected');
  assert.ok(done.events.some((e: { action: string }) => e.action === 'item.correct'), 'correction kept in history');

  const locked = await sup.req('PATCH', `/api/audit-docs/${id}/items/${ph.id}`, { action: 'flag' });
  assert.equal(locked.statusCode, 409);

  const pdf = await op.req('GET', `/api/audit-docs/${id}/pdf`);
  assert.equal(pdf.statusCode, 200, pdf.body);
  assert.equal(pdf.headers['content-type'], 'application/pdf');
  const parsed = await PDFDocument.load(pdf.rawPayload);
  assert.ok(parsed.getPageCount() >= 3, 'cover + scan + reconstructed page');
});

test('verifier self-approval is only allowed (and recorded) in demo tenants; operators capture but cannot verify', async () => {
  const op = await as(h.app, 'operator');
  const id = (await op.req('POST', '/api/audit-docs', { title: 'Permit check', pages: [page([line(0.1, 'Permit No: EP-2231')], [line(0.1, 'Permit No: EP-2231')])] })).json().id;
  const mgr = await as(h.app, 'manager');
  await mgr.req('POST', `/api/audit-docs/${id}/confirm-agreed`);
  assert.equal((await mgr.req('POST', `/api/audit-docs/${id}/verify`, {})).statusCode, 200);
  const r = await mgr.req('POST', `/api/audit-docs/${id}/approve`, { decision: 'approve' });
  assert.equal(r.statusCode, 200, r.body); // the test tenant is the demo tenant
  const ev = (await mgr.req('GET', `/api/audit-docs/${id}`)).json().events;
  assert.ok(ev.some((e: { action: string; note: string | null }) => e.action === 'approved' && e.note?.includes('Self-approved')));
  // 'viewer' was a read-only role; it is a Field Operator now (legacy mapping), so it captures scans.
  const viewer = await as(h.app, 'viewer');
  assert.equal((await viewer.req('POST', '/api/audit-docs', { pages: [page([line(0.1, 'A: 1')], [line(0.1, 'A: 1')])] })).statusCode, 201);
  assert.equal((await viewer.req('GET', `/api/audit-docs/${id}`)).statusCode, 200);
  assert.equal((await op.req('POST', `/api/audit-docs/${id}/verify`, {})).statusCode, 403, 'operators cannot verify');
});

test('vision output is cross-checked against OCR text inside each value box', () => {
  const ocr = [reading('ocr:original', [line(0.2, 'Outlet COD: 212 mg/L')])];
  const merged = mergeVision({
    title: 'Lab report', doc_type: 'lab report', summary: 's', pages: [{ page: 1, markdown: 'x' }],
    fields: [{ label: 'Outlet COD', value: '212', unit: 'mg/L', type: 'number', page: 1, box: { x: 0.18, y: 0.19, w: 0.2, h: 0.04 }, confidence: 0.95 }],
    tables: [], figures: [{ page: 1, box: { x: 0.6, y: 0.8, w: 0.3, h: 0.1 }, kind: 'signature', caption: 'Chemist signature' }], warnings: [],
  }, [ocr]);
  const f = merged.fields[0]!;
  assert.equal(f.sources.length, 2);
  assert.equal(f.agreement, 'match', JSON.stringify(f.sources));
  assert.equal(merged.figures[0]!.kind, 'signature');
});
