import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { eq, sql } from 'drizzle-orm';
import { assets, organizations } from '../src/db/schema.js';
import { withTenant } from '../src/db/tenant.js';
import { ingest } from '../src/modules/telemetry.js';
import { SimulationEngine } from '../src/modules/simulation.js';
import { simulationRuns, sensors } from '../src/db/schema.js';
import { ADMIN, as, Client, harness, lastMailTo, linkToken, PW, type Harness } from './helpers.js';

let h: Harness;
before(async () => {
  h = await harness();
});
after(async () => {
  await h.app.close();
  await h.database.close();
});

test('no session, no data: data endpoints reject anonymous calls', async () => {
  const anon = new Client(h.app);
  for (const url of ['/api/overview', '/api/assets', '/api/alarms', '/api/devices', '/api/members', '/api/inspections', '/api/events/stream', '/api/device/context']) {
    assert.equal((await anon.req('GET', url)).statusCode, 401, url);
  }
  assert.equal((await anon.req('GET', '/api/health')).statusCode, 200);
});

test('login, refresh rotation, reuse detection, logout invalidates access immediately', async () => {
  const bad = await new Client(h.app).login('admin@demo.hydris.local', 'wrong-password-123');
  assert.equal(bad.statusCode, 401);
  assert.equal(bad.json().error.code, 'invalid_credentials');

  const c = await as(h.app, 'admin');
  const me = (await c.req('GET', '/api/auth/me')).json();
  assert.equal(me.role, 'admin');
  assert.ok(me.permissions.includes('member.manage'));

  const first = c.cookie;
  const r1 = await c.req('POST', '/api/auth/refresh');
  assert.equal(r1.statusCode, 200);
  c.absorb(r1);
  // A concurrent refresh from a second tab within the reuse interval is tolerated.
  const tab2 = await new Client(h.app).req('POST', '/api/auth/refresh', undefined, { cookie: first });
  assert.equal(tab2.statusCode, 200, 'concurrent tab refresh tolerated');
  // Replaying the rotated token after the interval kills the whole family, including the newest access token.
  const { withSystem } = await import('../src/db/tenant.js');
  const { authSessions } = await import('../src/db/schema.js');
  await withSystem(h.database.db, (tx) => tx.update(authSessions).set({ rotatedAt: new Date(Date.now() - 60_000) }).where(sql`${authSessions.rotatedAt} is not null`));
  const replay = await new Client(h.app).req('POST', '/api/auth/refresh', undefined, { cookie: first });
  assert.equal(replay.statusCode, 401);
  assert.equal((await c.req('GET', '/api/overview')).statusCode, 401);

  const c2 = await as(h.app, 'admin');
  assert.equal((await c2.req('GET', '/api/overview')).statusCode, 200);
  await c2.req('POST', '/api/auth/logout');
  assert.equal((await c2.req('GET', '/api/overview')).statusCode, 401, 'access token dead after logout');
});

test('database boundary: row-level security isolates tenants even without WHERE clauses', async () => {
  const otherOrg = await withTenant(h.database.db, h.demo.orgId, async () => null).then(async () => {
    const { withSystem } = await import('../src/db/tenant.js');
    return withSystem(h.database.db, async (tx) => (await tx.insert(organizations).values({ name: 'RLS Probe', slug: 'rls-probe' }).returning())[0]!);
  });
  const visibleToOther = await withTenant(h.database.db, otherOrg.id, (tx) => tx.select().from(assets));
  assert.equal(visibleToOther.length, 0, 'other tenant sees no demo assets');
  const visibleToDemo = await withTenant(h.database.db, h.demo.orgId, (tx) => tx.select().from(assets));
  assert.ok(visibleToDemo.length >= 7);
  await assert.rejects(
    withTenant(h.database.db, otherOrg.id, (tx) => tx.update(assets).set({ name: 'hijack' }).where(sql`true`).returning().then((r) => {
      if (r.length) throw new Error('updated rows across tenant'); else throw new Error('noop');
    })),
    /noop/,
  );
  await assert.rejects(withTenant(h.database.db, otherOrg.id, (tx) => tx.insert(assets).values({ ...visibleToDemo[0]!, id: undefined as never, tag: 'X-1' })),
    (e: Error & { cause?: Error }) => /row-level security/.test(String(e.cause?.message ?? e.message)));
});

test('API tenant isolation and invitation onboarding of a second organization', async () => {
  const root = new Client(h.app);
  assert.equal((await root.login(ADMIN)).statusCode, 200);
  const created = await root.req('POST', '/api/platform/organizations', { name: 'Northbank Water Authority', slug: 'northbank', admin: { name: 'Nora Admin', email: 'nora@northbank.test' } });
  assert.equal(created.statusCode, 201);
  const token = linkToken(created.json().adminInvitationLink, '/invite/');
  const preview = (await new Client(h.app).req('GET', `/api/auth/invitations/${token}`)).json();
  assert.equal(preview.role, 'admin');
  const nora = new Client(h.app);
  const acc = await nora.req('POST', '/api/auth/invitations/accept', { token, name: 'Nora Admin', password: 'another-strong-pass' });
  assert.equal(acc.statusCode, 200);
  nora.absorb(acc);
  assert.equal((await nora.req('POST', '/api/auth/invitations/accept', { token, password: 'another-strong-pass' })).statusCode, 400, 'invitation is single-use');

  const demoAsset = (await (await as(h.app, 'admin')).req('GET', '/api/assets')).json().assets[0];
  assert.equal((await nora.req('GET', `/api/assets/${demoAsset.id}`)).statusCode, 404);
  assert.equal((await nora.req('GET', '/api/assets')).json().assets.length, 0);
  assert.equal((await nora.req('GET', '/api/alarms')).json().alarms.length, 0);
  assert.equal((await nora.req('PATCH', `/api/assets/${demoAsset.id}`, { name: 'pwned' })).statusCode, 404);

  // Non-platform users cannot reach platform administration.
  assert.equal((await nora.req('GET', '/api/platform/organizations')).statusCode, 401);
});

test('role-based access is enforced by the API, including privilege escalation attempts', async () => {
  const viewer = await as(h.app, 'viewer');
  const op = await as(h.app, 'operator');
  const mgr = await as(h.app, 'manager');
  const alarms = (await mgr.req('GET', '/api/alarms')).json().alarms;
  assert.equal((await op.req('POST', '/api/assets', { facilityId: '00000000-0000-0000-0000-000000000000', tag: 'Z-1', name: 'Nope', type: 'pump' })).statusCode, 403);
  assert.equal((await viewer.req('POST', '/api/maintenance', { title: 'Operator request', siteId: h.demo.siteId })).statusCode, 201, 'operators raise maintenance requests');
  assert.equal((await op.req('POST', '/api/invitations', { email: 'boss@x.test', role: 'admin' })).statusCode, 403, 'operators cannot mint admins');
  assert.equal((await op.req('PATCH', `/api/members/${h.demo.users.admin}`, { role: 'operator' })).statusCode, 403, 'operators cannot change roles');
  assert.equal((await mgr.req('POST', '/api/invitations', { email: 'legacy@x.test', role: 'org_admin' })).statusCode, 400, 'legacy role names are rejected');
  assert.equal((await op.req('GET', '/api/members')).statusCode, 403);
  assert.equal((await op.req('GET', '/api/audit')).statusCode, 403);
  void alarms;
});

test('gateway ingestion: normalization, idempotency, validation and alarm generation', async () => {
  const mgr = await as(h.app, 'manager');
  const gw = await mgr.req('POST', '/api/gateways', { siteId: h.demo.siteId, name: 'Edge-01' });
  assert.equal(gw.statusCode, 201);
  const key = gw.json().apiKey;
  const send = (readings: unknown[]) => h.app.inject({ method: 'POST', url: '/api/ingest/v1/readings', payload: { readings }, headers: { authorization: `Bearer ${key}` } });
  assert.equal((await h.app.inject({ method: 'POST', url: '/api/ingest/v1/readings', payload: { readings: [] }, headers: { authorization: 'Bearer hgw_wrong' } })).statusCode, 401);

  const t0 = Date.now();
  const r = await send([
    { sensor: 'TT-201', ts: new Date(t0 - 60_000).toISOString(), value: 82.4, unit: '°F' },
    { sensor: 'ETP01.VT-101', ts: new Date(t0 - 30_000).toISOString(), value: 5.2 },
    { sensor: 'VT-101', ts: new Date(t0 - 30_000).toISOString(), value: 5.2 },
    { sensor: 'NOPE-9', ts: new Date(t0).toISOString(), value: 1 },
    { sensor: 'AIT-501', ts: new Date(t0 + 3600_000).toISOString(), value: 7 },
    { sensor: 'AIT-501', ts: new Date(t0).toISOString(), value: 22 },
    { sensor: 'AIT-501', ts: new Date(t0).toISOString(), value: 7, unit: 'mg/L' },
  ]);
  const body = r.json();
  assert.equal(r.statusCode, 200);
  assert.equal(body.accepted, 2);
  assert.equal(body.duplicates, 1);
  assert.deepEqual(body.rejected.map((x: { reason: string }) => x.reason).sort(), ['out_of_range', 'timestamp_in_future', 'unknown_sensor', 'unknown_unit']);
  assert.equal(body.alarmsRaised, 1, 'VT-101 above 4.5 raises a high alarm');

  const sensorsList = (await mgr.req('GET', '/api/sensors')).json().sensors;
  const tt = sensorsList.find((s: { tag: string }) => s.tag === 'TT-201');
  assert.ok(Math.abs(tt.lastValue - 28) < 0.01, '°F normalized to °C');
  const lab = sensorsList.find((s: { tag: string }) => s.tag === 'LAB-COD');
  assert.equal(lab.lastValue, null);
  assert.equal(lab.freshness, 'no_data', 'missing lab data is never shown as zero');

  // Out-of-order reading is stored but does not replace the newer latest value.
  const older = await send([{ sensor: 'TT-201', ts: new Date(t0 - 600_000).toISOString(), value: 20 }]);
  assert.equal(older.json().accepted, 1);
  const tt2 = (await mgr.req('GET', '/api/sensors')).json().sensors.find((s: { tag: string }) => s.tag === 'TT-201');
  assert.ok(Math.abs(tt2.lastValue - 28) < 0.01);

  // Synthetic data is refused for customer tenants at the pipeline level.
  const { withSystem } = await import('../src/db/tenant.js');
  const sens = await withSystem(h.database.db, async (tx) => (await tx.select().from(sensors).where(eq(sensors.tag, 'TT-201')))[0]!);
  const res = await withTenant(h.database.db, h.demo.orgId, (tx) => ingest(h.ctx, tx, h.demo.orgId, [{ sensorId: sens.id, ts: new Date(), value: 30 }], { source: 'simulator', isDemoOrg: false }));
  assert.equal(res.rejected[0]?.reason, 'synthetic_not_allowed');
});

test('alarm lifecycle: acknowledgement is separate from resolution and permissions are enforced', async () => {
  const mgr = await as(h.app, 'manager');
  const op = await as(h.app, 'operator');
  const eng = await as(h.app, 'engineer');
  const sup = await as(h.app, 'supervisor');
  const viewer = await as(h.app, 'viewer');
  const alarm = (await mgr.req('GET', '/api/alarms?state=open')).json().alarms.find((a: { sensorTag: string }) => a.sensorTag === 'VT-101');
  assert.ok(alarm, 'vibration alarm exists');
  assert.equal((await viewer.req('POST', `/api/alarms/${alarm.id}/assign`, { userId: h.demo.users.engineer })).statusCode, 403, 'operators cannot assign');
  assert.equal((await op.req('POST', `/api/alarms/${alarm.id}/close`)).statusCode, 403);
  assert.equal((await op.req('POST', `/api/alarms/${alarm.id}/acknowledge`)).statusCode, 200);
  assert.equal((await op.req('POST', `/api/alarms/${alarm.id}/acknowledge`)).statusCode, 409, 'cannot acknowledge twice');
  assert.equal((await sup.req('POST', `/api/alarms/${alarm.id}/assign`, { userId: h.demo.users.engineer })).statusCode, 200);
  // Field operators acknowledge, investigate and resolve in the field (with a note); only administrators close.
  assert.equal((await eng.req('POST', `/api/alarms/${alarm.id}/investigate`)).statusCode, 200);
  assert.equal((await eng.req('POST', `/api/alarms/${alarm.id}/resolve`, {})).statusCode, 400, 'resolution requires a note');
  assert.equal((await eng.req('POST', `/api/alarms/${alarm.id}/resolve`, { note: 'Realigned coupling, vibration 2.1 mm/s' })).statusCode, 200);
  assert.equal((await eng.req('POST', `/api/alarms/${alarm.id}/close`)).statusCode, 403, 'operators cannot close');
  assert.equal((await sup.req('POST', `/api/alarms/${alarm.id}/close`)).statusCode, 200);
  const detail = (await mgr.req('GET', `/api/alarms/${alarm.id}`)).json();
  assert.equal(detail.alarm.state, 'closed');
  assert.deepEqual(detail.history.map((x: { action: string }) => x.action), ['triggered', 'acknowledge', 'assigned', 'investigate', 'resolve', 'close']);
  const audit = (await mgr.req('GET', '/api/audit?action=alarm.')).json().events;
  assert.ok(audit.some((e: { action: string }) => e.action === 'alarm.acknowledge'));
});

test('glasses pairing, inspection on glasses, sync to console, review, revocation', async () => {
  const anon = new Client(h.app);
  const ch = await anon.req('POST', '/api/pairing/challenges', { hardwareId: 'sim-install-0001-abcdef', device: { kind: 'simulator', display: { width: 600, height: 600 } } });
  assert.equal(ch.statusCode, 201);
  const { challengeId, userCode, pollSecret, verificationUriComplete } = ch.json();
  assert.match(userCode, /^[2-9A-Z]{4}-[2-9A-Z]{4}$/);
  assert.ok(!verificationUriComplete.includes(pollSecret), 'QR never carries the device secret');

  const poll = () => anon.req('POST', `/api/pairing/challenges/${challengeId}/poll`, { pollSecret });
  assert.equal((await poll()).json().status, 'pending');
  assert.equal((await anon.req('POST', `/api/pairing/challenges/${challengeId}/poll`, { pollSecret: 'x'.repeat(40) })).statusCode, 404);

  assert.equal((await anon.req('GET', `/api/pairing/lookup?code=${userCode}`)).statusCode, 401);
  const op = await as(h.app, 'operator');
  const look = await op.req('GET', `/api/pairing/lookup?code=${userCode}`);
  assert.equal(look.statusCode, 200);
  assert.equal(look.json().canAssignOthers, false);
  assert.equal((await op.req('POST', '/api/pairing/approve', { code: userCode, siteId: h.demo.siteId, assigneeUserId: h.demo.users.operator2 })).statusCode, 403, 'operators pair only to themselves');
  assert.equal((await op.req('POST', '/api/pairing/approve', { code: userCode, siteId: h.demo.siteId })).statusCode, 200);
  assert.equal((await op.req('POST', '/api/pairing/approve', { code: userCode, siteId: h.demo.siteId })).statusCode, 404, 'code is single-use');

  await new Promise((r) => setTimeout(r, 2100));
  const done = (await poll()).json();
  assert.equal(done.status, 'completed');
  assert.ok(done.accessToken && done.refreshToken.startsWith('hgd_'));
  assert.equal((await poll()).json().status, 'completed');
  assert.equal((await poll()).json().accessToken, undefined, 'credentials are issued exactly once');

  const glasses = new Client(h.app);
  glasses.token = done.accessToken;
  const context = (await glasses.req('GET', '/api/device/context')).json();
  assert.equal(context.operator.id, h.demo.users.operator);
  const pump = context.inspections.find((i: { assetTag: string }) => i.assetTag === 'P-101');
  assert.ok(pump, 'assigned inspection retrievable on glasses');
  assert.equal((await glasses.req('GET', '/api/members')).statusCode, 403, 'device scope is narrower than the user role');

  const now = new Date().toISOString();
  const ops = [
    { opId: 'op-guard-0001', stepId: 'guard', value: { kind: 'check', checked: true }, recordedAt: now },
    { opId: 'op-leak-0001', stepId: 'leak', value: { kind: 'choice', option: 'Weeping' }, recordedAt: now },
    { opId: 'op-vib-00001', stepId: 'vib', value: { kind: 'reading', value: 6.3 }, note: 'Rough at DE bearing', recordedAt: now },
    { opId: 'op-noise-001', stepId: 'noise', value: { kind: 'check', checked: true }, recordedAt: now },
  ];
  const s1 = (await glasses.req('POST', `/api/inspections/${pump.id}/responses`, { ops })).json();
  assert.equal(s1.applied, 4);
  // Offline replay of the same queue is idempotent.
  const s2 = (await glasses.req('POST', `/api/inspections/${pump.id}/responses`, { ops })).json();
  assert.equal(s2.applied, 0);
  assert.equal(s2.duplicates, 4);
  const early = await glasses.req('POST', `/api/inspections/${pump.id}/submit`, {});
  assert.equal(early.statusCode, 400, 'required steps must be complete');
  await glasses.req('POST', `/api/inspections/${pump.id}/responses`, { ops: [{ opId: 'op-press-001', stepId: 'press', value: { kind: 'reading', value: 2.4 }, recordedAt: now }] });
  const sub = await glasses.req('POST', `/api/inspections/${pump.id}/submit`, {});
  assert.equal(sub.statusCode, 200);
  assert.ok(sub.json().followUpId, 'abnormal vibration opened a follow-up maintenance request');

  const sup = await as(h.app, 'supervisor');
  const insp = (await sup.req('GET', `/api/inspections/${pump.id}`)).json().inspection;
  assert.equal(insp.status, 'submitted');
  assert.equal(insp.submittedVia, 'glasses');
  assert.equal(insp.progress.abnormal, 1);
  assert.equal((await op.req('POST', `/api/inspections/${pump.id}/approve`, {})).statusCode, 403);
  assert.equal((await sup.req('POST', `/api/inspections/${pump.id}/approve`, { note: 'OK' })).statusCode, 200);
  const late = (await glasses.req('POST', `/api/inspections/${pump.id}/responses`, { ops: [{ opId: 'op-late-0001', stepId: 'notes', value: { kind: 'text', text: 'late' }, recordedAt: now }] })).json();
  assert.equal(late.conflicts[0].reason, 'inspection_approved', 'late offline edits surface as conflicts');

  // Revocation: tokens stop working immediately and refresh is rejected.
  const mgr = await as(h.app, 'manager');
  const device = (await mgr.req('GET', '/api/devices')).json().devices[0];
  assert.equal(device.state, 'connected');
  assert.equal((await mgr.req('POST', `/api/devices/${device.id}/revoke`, {})).statusCode, 400, 'reason required');
  assert.equal((await mgr.req('POST', `/api/devices/${device.id}/revoke`, { reason: 'Lost on site' })).statusCode, 200);
  assert.equal((await glasses.req('GET', '/api/device/context')).statusCode, 401);
  const rf = await anon.req('POST', '/api/device/refresh', { refreshToken: done.refreshToken });
  assert.equal(rf.statusCode, 401);
  assert.equal(rf.json().error.code, 'device_revoked');
  const audit = (await mgr.req('GET', '/api/audit?entityType=device')).json().events.map((e: { action: string }) => e.action);
  assert.ok(audit.includes('device.paired') && audit.includes('device.revoked'));
});

test('expired and denied pairing challenges cannot be used', async () => {
  const anon = new Client(h.app);
  const ch = (await anon.req('POST', '/api/pairing/challenges', { hardwareId: 'sim-install-0002-abcdef', device: { kind: 'simulator' } })).json();
  const { withSystem } = await import('../src/db/tenant.js');
  const { pairingChallenges } = await import('../src/db/schema.js');
  await withSystem(h.database.db, (tx) => tx.update(pairingChallenges).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(pairingChallenges.id, ch.challengeId)));
  const op = await as(h.app, 'operator');
  assert.equal((await op.req('GET', `/api/pairing/lookup?code=${ch.userCode}`)).statusCode, 404);
  assert.equal((await anon.req('POST', `/api/pairing/challenges/${ch.challengeId}/poll`, { pollSecret: ch.pollSecret })).json().status, 'expired');

  const ch2 = (await anon.req('POST', '/api/pairing/challenges', { hardwareId: 'sim-install-0003-abcdef', device: { kind: 'simulator' } })).json();
  assert.equal((await op.req('POST', '/api/pairing/deny', { code: ch2.userCode })).statusCode, 200);
  assert.equal((await anon.req('POST', `/api/pairing/challenges/${ch2.challengeId}/poll`, { pollSecret: ch2.pollSecret })).json().status, 'denied');
});

test('deactivated members lose access immediately', async () => {
  const admin = await as(h.app, 'admin');
  const op2 = await as(h.app, 'operator2');
  assert.equal((await op2.req('GET', '/api/overview')).statusCode, 200);
  assert.equal((await admin.req('PATCH', `/api/members/${h.demo.users.operator2}`, { status: 'deactivated' })).statusCode, 200);
  assert.equal((await op2.req('GET', '/api/overview')).statusCode, 401);
  assert.equal((await admin.req('PATCH', `/api/members/${h.demo.users.admin}`, { status: 'deactivated' })).statusCode, 403, 'cannot deactivate self');
  await admin.req('PATCH', `/api/members/${h.demo.users.operator2}`, { status: 'active' });
});

test('password reset via e-mailed single-use token', async () => {
  const anon = new Client(h.app);
  assert.equal((await anon.req('POST', '/api/auth/password-reset/request', { email: 'nobody@nowhere.test' })).statusCode, 200);
  await anon.req('POST', '/api/auth/password-reset/request', { email: 'viewer@demo.hydris.local' });
  const mail = await lastMailTo(h, 'viewer@demo.hydris.local');
  const token = linkToken(mail!.bodyText, '/reset-password');
  assert.equal((await anon.req('POST', '/api/auth/password-reset/complete', { token, password: 'short' })).statusCode, 400);
  assert.equal((await anon.req('POST', '/api/auth/password-reset/complete', { token, password: 'a-brand-new-password' })).statusCode, 200);
  assert.equal((await anon.req('POST', '/api/auth/password-reset/complete', { token, password: 'a-brand-new-password' })).statusCode, 400);
  assert.equal((await new Client(h.app).login('viewer@demo.hydris.local', 'a-brand-new-password')).statusCode, 200);
  assert.equal((await new Client(h.app).login('viewer@demo.hydris.local', PW)).statusCode, 401);
});

test('deterministic simulation scenario drives alarms through the real pipeline (demo tenant only)', async () => {
  const engine = new SimulationEngine(h.ctx);
  const { withSystem } = await import('../src/db/tenant.js');
  const run = await withTenant(h.database.db, h.demo.orgId, async (tx) => (await tx.insert(simulationRuns).values({ orgId: h.demo.orgId, siteId: h.demo.siteId, scenarioKey: 'high_priority_alert' }).returning())[0]!);
  for (const step of [0, 20, 40]) await withTenant(h.database.db, h.demo.orgId, (tx) => engine.applyStep(tx, run.id, h.demo.orgId, h.demo.siteId, 'high_priority_alert', step));
  const mgr = await as(h.app, 'manager');
  const alarms = (await mgr.req('GET', '/api/alarms?state=open')).json().alarms;
  const doAlarm = alarms.find((a: { sensorTag: string; severity: string }) => a.sensorTag === 'DO-201' && a.severity === 'critical');
  assert.ok(doAlarm, 'critical low-low DO alarm raised');
  assert.equal(doAlarm.synthetic, true);
  const viewerStart = await (await as(h.app, 'operator')).req('POST', '/api/simulation/start', { scenario: 'normal_operations', siteId: h.demo.siteId });
  assert.equal(viewerStart.statusCode, 403, 'simulation controls require simulation.control');
  void withSystem;
});

test('public enquiry: validation, consent and spam controls', async () => {
  const anon = new Client(h.app);
  const base = { kind: 'demo', name: 'Priya S', email: 'priya@factory.test', company: 'Acme Dyes', consent: true, startedAt: Date.now() - 10_000 };
  assert.equal((await anon.req('POST', '/api/public/inquiries', { ...base, consent: false })).statusCode, 400);
  assert.equal((await anon.req('POST', '/api/public/inquiries', { ...base, website: 'http://spam' })).statusCode, 400);
  assert.equal((await anon.req('POST', '/api/public/inquiries', { ...base, startedAt: Date.now() })).statusCode, 400);
  assert.equal((await anon.req('POST', '/api/public/inquiries', base)).statusCode, 201);
});

test('overview and reports are scoped and exportable', async () => {
  const mgr = await as(h.app, 'manager');
  const ov = (await mgr.req('GET', '/api/overview')).json();
  assert.ok(ov.sites.length === 1 && ov.alarmTrend.length === 14);
  const csv = await mgr.req('GET', '/api/reports/alarms?format=csv');
  assert.equal(csv.statusCode, 200);
  assert.match(csv.headers['content-type'] as string, /text\/csv/);
  assert.equal((await (await as(h.app, 'operator')).req('GET', '/api/reports/alarms?format=csv')).statusCode, 403);
  const assist = (await mgr.req('GET', '/api/assist?q=pump vibration')).json();
  assert.ok(assist.sources.length >= 1 && assist.sources[0].title.includes('vibration'));
});
