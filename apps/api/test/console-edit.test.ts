import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { sensors, telemetryReadings } from '../src/db/schema.js';
import { withSystem, withTenant } from '../src/db/tenant.js';
import { ingest } from '../src/modules/telemetry.js';
import { ADMIN, as, Client, harness, linkToken, type Harness } from './helpers.js';

let h: Harness;
let sensorId = '';
const t0 = Date.now() - 10 * 60_000;
const at = (i: number) => new Date(t0 + i * 60_000);

before(async () => {
  h = await harness();
  const s = await withSystem(h.database.db, async (tx) => (await tx.select().from(sensors).where(eq(sensors.tag, 'TT-201')))[0]!);
  sensorId = s.id;
  // Five instrument readings, one minute apart: 20, 21, 22, 23, 24 °C.
  await withTenant(h.database.db, h.demo.orgId, (tx) => ingest(h.ctx, tx, h.demo.orgId, [0, 1, 2, 3, 4].map((i) => ({ sensorId, ts: at(i), value: 20 + i })), { source: 'gateway', isDemoOrg: true }));
});
after(async () => {
  await h.app.close();
  await h.database.close();
});

const rawRow = (id: number) => withSystem(h.database.db, async (tx) => (await tx.select().from(telemetryReadings).where(eq(telemetryReadings.id, id)))[0]!);

async function readings(c: Client, qs = '') {
  const r = await c.req('GET', `/api/telemetry/sensors/${sensorId}/readings?limit=50${qs}`);
  assert.equal(r.statusCode, 200, r.body);
  return r.json() as { total: number; readings: { id: number; ts: string; source: string; originalValue: number; effectiveValue: number | null; status: string; recordedBy: { name: string } | null; corrections: { action: string; reason: string; correctedBy: { name: string } }[] }[] };
}

test('readings list exposes provenance; manual entries record who entered them', async () => {
  const sup = await as(h.app, 'supervisor');
  const manual = await sup.req('POST', '/api/telemetry/manual', { sensorId, value: 25, ts: at(5).toISOString(), source: 'manual' });
  assert.equal(manual.statusCode, 201, manual.body);
  const dupe = await sup.req('POST', '/api/telemetry/manual', { sensorId, value: 26, ts: at(5).toISOString(), source: 'manual' });
  assert.equal(dupe.statusCode, 409, 'a manual entry never overwrites an existing reading');
  const viewer = await as(h.app, 'viewer');
  const list = await readings(viewer);
  assert.equal(list.total, 6);
  const newest = list.readings[0]!;
  assert.equal(newest.source, 'manual');
  assert.equal(newest.recordedBy?.name, 'Meera Pillai');
  assert.equal(list.readings[1]!.source, 'gateway');
  assert.equal(list.readings[1]!.recordedBy, null);
  assert.equal((await readings(viewer, '&source=gateway')).total, 5);
});

test('corrections are append-only, validated, permissioned, and drive history and the latest value', async () => {
  const mgr = await as(h.app, 'manager');
  const op = await as(h.app, 'operator');
  const viewer = await as(h.app, 'viewer');
  const list = await readings(mgr);
  const latest = list.readings[0]!; // manual 25 @ t5
  const mid = list.readings.find((r) => r.originalValue === 22)!;
  const before = await rawRow(mid.id);

  for (const c of [viewer, op]) {
    assert.equal((await c.req('POST', `/api/telemetry/readings/${mid.id}/corrections`, { action: 'correct', correctedValue: 30, reason: 'Probe was fouled' })).statusCode, 403);
  }
  const missingReason = await mgr.req('POST', `/api/telemetry/readings/${mid.id}/corrections`, { action: 'correct', correctedValue: 30, reason: '' });
  assert.equal(missingReason.statusCode, 400);
  assert.ok(missingReason.json().error.details.some((d: { path: string }) => d.path === 'reason'));
  const noValue = await mgr.req('POST', `/api/telemetry/readings/${mid.id}/corrections`, { action: 'correct', reason: 'Probe was fouled' });
  assert.equal(noValue.statusCode, 400);
  const implausible = await mgr.req('POST', `/api/telemetry/readings/${mid.id}/corrections`, { action: 'correct', correctedValue: 5000, reason: 'Probe was fouled' });
  assert.equal(implausible.statusCode, 400, 'validated via normalizeMeasurement');
  assert.equal(implausible.json().error.details[0].path, 'correctedValue');

  const ok = await mgr.req('POST', `/api/telemetry/readings/${mid.id}/corrections`, { action: 'correct', correctedValue: 30, reason: 'Probe was fouled; value from handheld' });
  assert.equal(ok.statusCode, 201, ok.body);
  const after = await rawRow(mid.id);
  assert.deepEqual(after, before, 'original reading row is untouched');

  const again = await mgr.req('POST', `/api/telemetry/readings/${mid.id}/corrections`, { action: 'correct', correctedValue: 31, unit: '°C', reason: 'Recalculated with calibration offset' });
  assert.equal(again.statusCode, 201);
  const view = (await readings(mgr)).readings.find((r) => r.id === mid.id)!;
  assert.equal(view.originalValue, 22);
  assert.equal(view.effectiveValue, 31);
  assert.equal(view.status, 'corrected');
  assert.equal(view.corrections.length, 2, 'full correction trail is kept');
  assert.equal(view.corrections[0]!.correctedBy.name, 'Vikram Iyer');

  const from = encodeURIComponent(at(-1).toISOString());
  const hist = (await mgr.req('GET', `/api/telemetry/sensors/${sensorId}/history?from=${from}`)).json();
  assert.ok(hist.points.some((p: { v: number }) => p.v === 31), 'history uses the effective value');
  assert.ok(!hist.points.some((p: { v: number }) => p.v === 22), 'superseded original is not plotted');
  assert.equal(hist.corrections.corrected, 1);

  // Invalidate the latest reading: it is excluded and the sensor's latest value falls back to the previous one.
  assert.equal((await mgr.req('POST', `/api/telemetry/readings/${latest.id}/corrections`, { action: 'invalidate', reason: 'Entered against the wrong tank' })).statusCode, 201);
  assert.equal((await mgr.req('POST', `/api/telemetry/readings/${latest.id}/corrections`, { action: 'invalidate', reason: 'Entered against the wrong tank' })).statusCode, 409);
  const sensor = (await mgr.req('GET', `/api/sensors/${sensorId}`)).json().sensor;
  assert.equal(sensor.lastValue, 24);
  assert.equal(new Date(sensor.lastTs).getTime(), at(4).getTime());
  const hist2 = (await mgr.req('GET', `/api/telemetry/sensors/${sensorId}/history?from=${from}`)).json();
  assert.equal(hist2.totalReadings, 5, 'invalidated reading excluded from history');
  assert.equal(hist2.corrections.invalidated, 1);
  assert.equal((await readings(mgr, '&status=invalidated')).total, 1);

  // Correcting the newest valid reading updates the latest value.
  const t4 = (await readings(mgr)).readings.find((r) => r.originalValue === 24)!;
  assert.equal((await mgr.req('POST', `/api/telemetry/readings/${t4.id}/corrections`, { action: 'correct', correctedValue: 24.5, reason: 'Transcription error' })).statusCode, 201);
  assert.equal((await mgr.req('GET', `/api/sensors/${sensorId}`)).json().sensor.lastValue, 24.5);

  // CSV export keeps both values and the correction columns.
  const csv = (await mgr.req('GET', `/api/telemetry/sensors/${sensorId}/export.csv?from=${from}&to=${encodeURIComponent(new Date().toISOString())}`)).body;
  const lines = csv.split('\n');
  assert.match(lines[0]!, /original_value,effective_value,.*source.*status,correction_reason/);
  assert.ok(lines.some((l) => l.includes(',22,31,') && l.includes('corrected') && l.includes('calibration offset')));
  assert.ok(lines.some((l) => l.includes(',25,,') && l.includes('invalidated') && l.includes(',manual,')));

  // Audit trail and per-entity history.
  const histEv = (await mgr.req('GET', `/api/history/sensor/${sensorId}`)).json().events;
  assert.ok(histEv.some((e: { action: string }) => e.action === 'telemetry.reading_corrected'));
  assert.ok(histEv.some((e: { action: string }) => e.action === 'telemetry.reading_invalidated'));
  assert.ok(histEv.some((e: { action: string }) => e.action === 'telemetry.manual_entry'));
});

test('cross-tenant correction attempts and history lookups return 404', async () => {
  const root = new Client(h.app);
  assert.equal((await root.login(ADMIN)).statusCode, 200);
  const created = await root.req('POST', '/api/platform/organizations', { name: 'Southbank Utility', slug: 'southbank', admin: { name: 'Sam Admin', email: 'sam@southbank.test' } });
  assert.equal(created.statusCode, 201);
  const token = linkToken(created.json().adminInvitationLink, '/invite/');
  const sam = new Client(h.app);
  const acc = await sam.req('POST', '/api/auth/invitations/accept', { token, name: 'Sam Admin', password: 'another-strong-pass' });
  assert.equal(acc.statusCode, 200);
  sam.absorb(acc);
  const mgr = await as(h.app, 'manager');
  const r = (await readings(mgr)).readings[2]!;
  assert.equal((await sam.req('POST', `/api/telemetry/readings/${r.id}/corrections`, { action: 'invalidate', reason: 'Hostile tenant attempt' })).statusCode, 404);
  assert.equal((await sam.req('GET', `/api/telemetry/sensors/${sensorId}/readings`)).statusCode, 404);
  assert.equal((await sam.req('GET', `/api/history/sensor/${sensorId}`)).statusCode, 404);
  const asset = (await mgr.req('GET', '/api/assets')).json().assets[0];
  assert.equal((await sam.req('GET', `/api/history/asset/${asset.id}`)).statusCode, 404);
  assert.equal((await mgr.req('GET', `/api/history/nope/${asset.id}`)).statusCode, 400);
  assert.equal((await mgr.req('GET', '/api/history/asset/00000000-0000-4000-8000-000000000000')).statusCode, 404);
  const view = (await readings(mgr)).readings.find((x) => x.id === r.id)!;
  assert.equal(view.corrections.length, 0, 'nothing was appended by the other tenant');
});

test('asset and sensor archive/restore with validation, permissions and history', async () => {
  const mgr = await as(h.app, 'manager');
  const op = await as(h.app, 'operator');
  const viewer = await as(h.app, 'viewer');
  const asset = (await mgr.req('GET', '/api/assets')).json().assets.find((a: { tag: string }) => a.tag === 'P-101');
  assert.equal((await op.req('PATCH', `/api/assets/${asset.id}`, { archived: true })).statusCode, 403);
  const bad = await mgr.req('PATCH', `/api/assets/${asset.id}`, { name: 'x' });
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.json().error.details[0].path, 'name');
  assert.equal((await mgr.req('PATCH', `/api/assets/${asset.id}`, { manufacturer: 'Grundfos', criticality: 'high' })).statusCode, 200);
  assert.equal((await mgr.req('PATCH', `/api/assets/${asset.id}`, { archived: true })).statusCode, 200);
  assert.ok(!(await mgr.req('GET', '/api/assets')).json().assets.some((a: { id: string }) => a.id === asset.id), 'archived assets hidden by default');
  assert.ok((await mgr.req('GET', '/api/assets?archived=true')).json().assets.some((a: { id: string }) => a.id === asset.id));
  assert.equal((await mgr.req('PATCH', `/api/assets/${asset.id}`, { archived: false })).statusCode, 200);
  const ev = (await viewer.req('GET', `/api/history/asset/${asset.id}`)).json().events.map((e: { action: string }) => e.action);
  assert.deepEqual(ev.slice(0, 3), ['asset.restored', 'asset.archived', 'asset.updated']);
  const upd = (await mgr.req('GET', `/api/history/asset/${asset.id}`)).json().events.find((e: { action: string }) => e.action === 'asset.updated');
  assert.equal(upd.metadata.changes.manufacturer.to, 'Grundfos');
  assert.equal(upd.actor.name, 'Vikram Iyer');

  // Sensors: interval validation, gateway binding must be on the same site, archive hides from the list.
  assert.equal((await op.req('PATCH', `/api/sensors/${sensorId}`, { expectedIntervalS: 30 })).statusCode, 403);
  assert.equal((await mgr.req('PATCH', `/api/sensors/${sensorId}`, { expectedIntervalS: 0 })).statusCode, 400);
  assert.equal((await mgr.req('PATCH', `/api/sensors/${sensorId}`, { gatewayId: '00000000-0000-4000-8000-000000000000' })).statusCode, 400);
  const gw = (await mgr.req('POST', '/api/gateways', { siteId: h.demo.siteId, name: 'Edge-Bind' })).json().gateway;
  assert.equal((await mgr.req('PATCH', `/api/sensors/${sensorId}`, { gatewayId: gw.id, expectedIntervalS: 30 })).statusCode, 200);
  const detail = (await mgr.req('GET', `/api/sensors/${sensorId}`)).json();
  assert.equal(detail.gateway.id, gw.id);
  assert.equal(detail.sensor.expectedIntervalS, 30);
  assert.equal((await mgr.req('PATCH', `/api/sensors/${sensorId}`, { archived: true })).statusCode, 200);
  assert.ok(!(await mgr.req('GET', '/api/sensors')).json().sensors.some((s: { id: string }) => s.id === sensorId));
  assert.ok((await mgr.req('GET', '/api/sensors?archived=only')).json().sensors.some((s: { id: string }) => s.id === sensorId));
  assert.equal((await mgr.req('PATCH', `/api/sensors/${sensorId}`, { archived: false })).statusCode, 200);
  const sev = (await mgr.req('GET', `/api/history/sensor/${sensorId}`)).json().events.map((e: { action: string }) => e.action);
  assert.ok(sev.includes('sensor.archived') && sev.includes('sensor.restored'));
});

test('templates, tasks, rules and documents: edit, status changes and history', async () => {
  const mgr = await as(h.app, 'manager');
  const op = await as(h.app, 'operator');
  const tpl = (await mgr.req('GET', '/api/inspection-templates')).json().templates[0];
  assert.equal((await op.req('POST', `/api/inspection-templates/${tpl.id}/status`, { status: 'archived' })).statusCode, 403);
  assert.equal((await mgr.req('POST', `/api/inspection-templates/${tpl.id}/status`, { status: 'archived' })).statusCode, 200);
  assert.equal((await mgr.req('POST', `/api/inspection-templates/${tpl.id}/status`, { status: 'archived' })).statusCode, 409);
  const assetForTpl = (await mgr.req('GET', '/api/assets')).json().assets[0];
  assert.equal((await mgr.req('POST', '/api/inspections', { templateId: tpl.id, assetId: assetForTpl.id })).statusCode, 400, 'archived templates cannot be dispatched');
  assert.equal((await mgr.req('POST', `/api/inspection-templates/${tpl.id}/status`, { status: 'published' })).statusCode, 200);
  const oneRes = await mgr.req("GET", `/api/inspection-templates/${tpl.id}`);
  assert.equal(oneRes.statusCode, 200, oneRes.body);
  const one = oneRes.json();
  assert.equal(one.template.version, tpl.version, 'status change does not bump content version');
  const tev = (await mgr.req('GET', `/api/history/inspection_template/${tpl.id}`)).json().events.map((e: { action: string }) => e.action);
  assert.deepEqual(tev.slice(0, 2), ['inspection_template.published', 'inspection_template.archived']);

  // Maintenance checklist editing keeps completion state of retained items.
  const task = (await mgr.req('POST', '/api/maintenance', { title: 'Replace seal kit', siteId: h.demo.siteId, checklist: ['Isolate', 'Replace seal'] })).json().task;
  await mgr.req('POST', `/api/maintenance/${task.id}/checklist/${task.checklist[0].id}`, { done: true });
  const edited = await mgr.req('PATCH', `/api/maintenance/${task.id}`, { checklist: [{ id: task.checklist[0].id, label: 'Isolate and lock out' }, { label: 'Leak test' }], priority: 'high' });
  assert.equal(edited.statusCode, 200, edited.body);
  const cl = edited.json().task.checklist;
  assert.deepEqual(cl.map((c: { label: string }) => c.label), ['Isolate and lock out', 'Leak test']);
  assert.equal(cl[0].done, true);
  assert.equal((await mgr.req('PATCH', `/api/maintenance/${task.id}`, { checklist: [{ id: 'zzz', label: 'x' }] })).statusCode, 400);
  const mev = (await mgr.req('GET', `/api/history/maintenance/${task.id}`)).json().events;
  assert.ok(mev[0].metadata.changes.checklist && mev[0].metadata.changes.priority);

  // Alarm rule: a threshold rule cannot lose its threshold; changes show on the sensor history.
  const rule = (await mgr.req('GET', '/api/alarm-rules')).json().rules.find((r: { condition: string }) => r.condition !== 'stale');
  assert.equal((await mgr.req('PATCH', `/api/alarm-rules/${rule.id}`, { threshold: null })).statusCode, 400);
  assert.equal((await mgr.req('PATCH', `/api/alarm-rules/${rule.id}`, { threshold: (rule.threshold ?? 0) + 1 })).statusCode, 200);
  assert.ok((await mgr.req('GET', `/api/history/alarm_rule/${rule.id}`)).json().events.some((e: { action: string }) => e.action === 'alarm_rule.updated'));
  assert.ok((await mgr.req('GET', `/api/history/sensor/${rule.sensorId}`)).json().events.some((e: { action: string }) => e.action === 'sensor.threshold_changed'));

  // Documents: archive/restore are audited; operators cannot read drafts' history.
  const doc = (await mgr.req('POST', '/api/documents', { title: 'Seal replacement SOP', kind: 'sop', body: 'Step 1', siteId: h.demo.siteId })).json().document;
  assert.equal((await mgr.req('PATCH', `/api/documents/${doc.id}`, { status: 'archived' })).statusCode, 200);
  assert.equal((await mgr.req('PATCH', `/api/documents/${doc.id}`, { status: 'draft' })).statusCode, 200);
  const dev = (await mgr.req('GET', `/api/history/document/${doc.id}`)).json().events.map((e: { action: string }) => e.action);
  assert.deepEqual(dev, ['document.restored', 'document.archived', 'document.created']);
  assert.equal((await op.req('GET', `/api/history/document/${doc.id}`)).statusCode, 404);
});
