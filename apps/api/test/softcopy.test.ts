import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import JSZip from 'jszip';
import sharp from 'sharp';
import { as, harness, type Harness } from './helpers.js';
import { stopServerOcr } from '../src/core/server-ocr.js';
import { cleanPage, A4_W, A4_H } from '../src/core/doc-image.js';

let h: Harness;
before(async () => { h = await harness(); });
after(async () => { await stopServerOcr(); await h.app.close(); await h.database.close(); });

const SHEET = readFileSync(new URL('./fixtures/demo-audit-sheet.png', import.meta.url));

/** All text drawn in a pdf-lib PDF (content streams are Flate-compressed, strings hex-encoded). */
function pdfText(pdf: Buffer): string {
  let out = '';
  const s = pdf.toString('latin1');
  for (const m of s.matchAll(/stream\r?\n/g)) {
    const start = m.index! + m[0].length;
    const end = s.indexOf('endstream', start);
    let body = pdf.subarray(start, end);
    try { body = inflateSync(body); } catch { /* not compressed */ }
    for (const t of body.toString('latin1').matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) out += Buffer.from(t[1]!, 'hex').toString('latin1') + '\n';
  }
  return out;
}

test('preprocessing: rotated photo on a dark desk becomes a flat A4 page', async () => {
  const meta = await sharp(SHEET).metadata();
  const rotated = await sharp(SHEET).rotate(8, { background: '#2a2018' }).extend({ top: 200, bottom: 200, left: 250, right: 250, background: '#2a2018' }).jpeg().toBuffer();
  const c = await cleanPage(rotated);
  assert.equal(c.correction, 'perspective');
  assert.deepEqual([c.width, c.height], [A4_W, A4_H]);
  const flat = await cleanPage(SHEET);
  assert.notEqual(flat.correction, 'perspective', `flat ${meta.width}x${meta.height} scan is not re-warped`);
});

test('upload without device OCR → server pipeline → fused extraction → soft copy DOCX + clean PDF', { timeout: 180_000 }, async () => {
  const op = await as(h.app, 'operator');
  const c = await op.req('POST', '/api/audit-docs', { pages: [{ mime: 'image/png', data: SHEET.toString('base64'), width: 1241, height: 1754, readings: [] }] });
  assert.equal(c.statusCode, 201, c.body);
  const id = c.json().id;
  assert.equal(c.json().aiStatus, 'pending');

  const p = await op.req('POST', `/api/audit-docs/${id}/process`);
  assert.equal(p.statusCode, 200, p.body);
  const ocr = p.json().report.engines.find((e: { engine: string }) => e.engine === 'ocr:server');
  if (!ocr?.ok) {
    // The OCR model is fetched once from the tesseract.js CDN; without network the engine is skipped gracefully.
    assert.ok(ocr, 'server OCR reported');
    return;
  }
  const d = (await op.req('GET', `/api/audit-docs/${id}`)).json();
  const val = (label: string) => d.extraction.fields.find((f: { label: string }) => f.label === label);
  assert.equal(val('Outlet pH')?.value, '7.3');
  assert.equal(val('Outlet COD')?.value, '212');
  assert.equal(val('Audit No')?.value, 'ECA-2026-1052');
  assert.equal(d.title, 'Monthly Effluent Compliance Audit');
  const t = d.extraction.tables[0];
  assert.deepEqual(t.header, ['Parameter', 'Limit', 'Result', 'Status']);
  assert.deepEqual(t.rows[0], ['pH', '6.5-8.5', '7.3', 'PASS']);
  assert.equal(t.rows.length, 5);
  assert.ok(d.engines.includes('ocr:server'));

  const model = (await op.req('GET', `/api/audit-docs/${id}/softcopy`)).json();
  assert.ok(model.blocks.some((b: { kind: string }) => b.kind === 'checklist'));
  assert.ok(model.blocks.some((b: { kind: string; figure?: { image?: string } }) => b.kind === 'figure' && b.figure?.image?.startsWith('data:image/png')));

  const docx = await op.req('GET', `/api/audit-docs/${id}/softcopy.docx`);
  assert.equal(docx.statusCode, 200);
  assert.ok(docx.rawPayload.length > 5000);
  const xml = await (await JSZip.loadAsync(docx.rawPayload)).file('word/document.xml')!.async('string');
  for (const s of ['Monthly Effluent Compliance Audit', 'Laboratory Results', 'ECA-2026-1052', 'Oil and Grease', 'Sampling point labelled']) assert.ok(xml.includes(s), `DOCX contains ${s}`);

  const pdf = await op.req('GET', `/api/audit-docs/${id}/softcopy.pdf`);
  assert.equal(pdf.statusCode, 200);
  assert.equal(pdf.headers['content-type'], 'application/pdf');
  const text = pdfText(pdf.rawPayload);
  for (const s of ['Monthly Effluent Compliance Audit', 'Outlet pH', '7.3', 'Laboratory Results', `Document ${id}`]) assert.ok(text.includes(s), `PDF contains ${s}`);

  const clean = await op.req('GET', `/api/audit-docs/${id}/pages/1/clean`);
  assert.equal(clean.headers['content-type'], 'image/jpeg');

  // Auth required.
  const anon = await h.app.inject({ method: 'GET', url: `/api/audit-docs/${id}/softcopy.pdf` });
  assert.equal(anon.statusCode, 401);
});
