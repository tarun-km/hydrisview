import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { asc } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig, type Config } from '../src/config.js';
import { createDatabase, type Database } from '../src/db/client.js';
import { alarmEvents, assets, devices, inspections, maintenanceTasks, sensors, sites, users } from '../src/db/schema.js';
import { withSystem } from '../src/db/tenant.js';
import { bootDemo, DemoTicker } from '../src/demo.js';
import type { Ctx } from '../src/context.js';
import { DEMO_ORG_ID } from '../src/seed/showcase.js';
import { Client } from './helpers.js';

// Demo mode: zero-config, in-memory, deterministic synthetic tenant that works across instances.
interface Instance { app: FastifyInstance; ctx: Ctx; database: Database; config: Config }
let a: Instance;
let b: Instance;

async function instance(): Promise<Instance> {
  // Only DEMO_MODE: everything else (database, secrets, realtime mode) comes from demo defaults.
  const config = loadConfig({ DEMO_MODE: 'true', NODE_ENV: 'test', DATABASE_URL: '', JWT_SECRET: '', DATA_KEY: '', STORAGE_DIR: './data/test-files' });
  const database = await createDatabase(config.DATABASE_URL);
  await database.migrate();
  await bootDemo(database);
  const { app, ctx } = await buildApp({ db: database.db, config, relaxedLimits: true });
  await app.ready();
  return { app, ctx, database, config };
}

before(async () => {
  a = await instance();
  b = await instance();
});
after(async () => {
  for (const i of [a, b].filter(Boolean)) {
    await i.app.close();
    await i.database.close();
  }
});

async function login(app: FastifyInstance, email = 'tarun@hydris.ai', password = 'demo@123') {
  const c = new Client(app);
  const r = await c.login(email, password);
  assert.equal(r.statusCode, 200, r.body);
  return c;
}

test('demo defaults: in-memory database, demo flag, db realtime, simulator on', () => {
  assert.equal(a.config.demoMode, true);
  assert.equal(a.config.DATABASE_URL, 'memory://');
  assert.equal(a.config.REALTIME_MODE, 'db');
  assert.equal(a.config.SIMULATOR_ENABLED, 'true');
  assert.ok(a.config.JWT_SECRET.length >= 32);
  assert.equal(loadConfig({ DEMO_MODE: 'false', VERCEL: '1', JWT_SECRET: 'x'.repeat(48), DATA_KEY: 'a'.repeat(64) }).demoMode, false);
});

test('owner logs in with demo@123 and is org admin of the demo org and platform admin', async () => {
  const c = await login(a.app);
  const me = (await c.req('GET', '/api/auth/me')).json();
  assert.equal(me.user.name, 'Tarun KM');
  assert.equal(me.user.isPlatformAdmin, true);
  assert.equal(me.role, 'org_admin');
  assert.equal(me.org.isDemo, true);
  // Demo role accounts share the demo password.
  await login(a.app, 'operator@demo.hydris.local');
  const bad = await new Client(a.app).login('tarun@hydris.ai', 'wrong-password');
  assert.equal(bad.statusCode, 401);
});

test('seeding is deterministic across instances (identical ids)', async () => {
  const ids = async (db: Database['db']) => withSystem(db, async (tx) => ({
    users: (await tx.select({ id: users.id }).from(users).orderBy(asc(users.id))).map((r) => r.id),
    sites: (await tx.select({ id: sites.id }).from(sites).orderBy(asc(sites.id))).map((r) => r.id),
    assets: (await tx.select({ id: assets.id }).from(assets).orderBy(asc(assets.id))).map((r) => r.id),
    sensors: (await tx.select({ id: sensors.id }).from(sensors).orderBy(asc(sensors.id))).map((r) => r.id),
    alarms: (await tx.select({ id: alarmEvents.id }).from(alarmEvents).orderBy(asc(alarmEvents.id))).map((r) => r.id),
    inspections: (await tx.select({ id: inspections.id }).from(inspections).orderBy(asc(inspections.id))).map((r) => r.id),
    tasks: (await tx.select({ id: maintenanceTasks.id }).from(maintenanceTasks).orderBy(asc(maintenanceTasks.id))).map((r) => r.id),
    devices: (await tx.select({ id: devices.id }).from(devices).orderBy(asc(devices.id))).map((r) => r.id),
  }));
  const [x, y] = await Promise.all([ids(a.database.db), ids(b.database.db)]);
  assert.deepEqual(x, y);
  assert.equal(x.sites.length, 2);
  assert.ok(x.alarms.length >= 20);
  // Inspections and maintenance tasks cover every lifecycle state.
  const st = await withSystem(a.database.db, async (tx) => ({
    insp: new Set((await tx.select({ s: inspections.status }).from(inspections)).map((r) => r.s)),
    task: new Set((await tx.select({ s: maintenanceTasks.status }).from(maintenanceTasks)).map((r) => r.s)),
    alarm: new Set((await tx.select({ s: alarmEvents.state }).from(alarmEvents)).map((r) => r.s)),
    dev: new Set((await tx.select({ s: devices.status }).from(devices)).map((r) => r.s)),
  }));
  for (const s of ['scheduled', 'in_progress', 'paused', 'submitted', 'approved', 'rejected']) assert.ok(st.insp.has(s as never), `inspection ${s}`);
  for (const s of ['open', 'assigned', 'in_progress', 'on_hold', 'completed', 'cancelled']) assert.ok(st.task.has(s as never), `task ${s}`);
  for (const s of ['active', 'acknowledged', 'investigating', 'resolved', 'closed']) assert.ok(st.alarm.has(s as never), `alarm ${s}`);
  for (const s of ['active', 'suspended', 'revoked']) assert.ok(st.dev.has(s as never), `device ${s}`);
});

test('overview, reports, assist, telemetry history and UI profiles have content', async () => {
  const c = await login(a.app);
  const ov = (await c.req('GET', '/api/overview')).json();
  assert.ok(ov.metrics.length > 0);
  assert.ok(ov.metrics.every((m: { value: number | null }) => m.value !== null));
  assert.ok(ov.alarms.open > 0);
  assert.ok(ov.recentAlarms.length > 0);
  assert.ok(ov.alarmTrend.some((d: { n: number }) => d.n > 0));
  assert.equal(ov.sites.length, 2);
  assert.ok(ov.activity.length > 0);
  for (const kind of ['alarms', 'inspections', 'maintenance', 'devices', 'operators']) {
    const r = await c.req('GET', `/api/reports/${kind}`);
    assert.equal(r.statusCode, 200, r.body);
    assert.ok(r.json().rows.length > 0, kind);
  }
  const assist = (await c.req('GET', '/api/assist?q=pump%20vibration')).json();
  assert.ok(assist.sources.length > 0);
  assert.match(assist.sources.map((s: { title: string }) => s.title).join('|'), /PMP-07/);
  const sensor = ov.metrics[0];
  const hist = await c.req('GET', `/api/telemetry/sensors/${sensor.id}/history?from=${new Date(Date.now() - 6 * 86400_000).toISOString()}`);
  assert.equal(hist.statusCode, 200, hist.body);
  const profiles = (await c.req('GET', '/api/ui-profiles')).json();
  assert.ok(JSON.stringify(profiles).includes('Field operator focus'));
  const notes = (await c.req('GET', '/api/notifications')).json();
  assert.ok(JSON.stringify(notes).length > 50);
});

test('a token issued on one instance is accepted on another (sessions are per instance)', async () => {
  const c = await login(a.app);
  const other = new Client(b.app);
  other.token = c.token;
  const me = await other.req('GET', '/api/overview');
  assert.equal(me.statusCode, 200, me.body);
  // Refresh on the other instance falls back to the signed demo cookie.
  const set = (await new Client(a.app).req('POST', '/api/auth/login', { email: 'tarun@hydris.ai', password: 'demo@123' })).headers['set-cookie'];
  const cookies = (Array.isArray(set) ? set : [set]).filter(Boolean).map((x) => x!.split(';')[0]).join('; ');
  assert.match(cookies, /hg_demo=/);
  const r = await b.app.inject({ method: 'POST', url: '/api/auth/refresh', headers: { cookie: cookies } });
  assert.equal(r.statusCode, 200, r.body);
  assert.ok(r.json().accessToken);
  // Logout on an instance revokes the family there.
  const lo = await b.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: r.headers['set-cookie'] ? (Array.isArray(r.headers['set-cookie']) ? r.headers['set-cookie'] : [r.headers['set-cookie']]).map((x) => x.split(';')[0]).join('; ') : '' } });
  assert.equal(lo.statusCode, 200);
});

test('glasses paired on one instance work on another (device rebuilt from token claims)', async () => {
  const c = await login(a.app);
  const ch = await a.app.inject({ method: 'POST', url: '/api/pairing/challenges', payload: { hardwareId: 'demo-test-hw-0000000001', device: { kind: 'simulator', name: 'Test sim' } } });
  assert.equal(ch.statusCode, 201, ch.body);
  const { challengeId, userCode, pollSecret } = ch.json();
  const sites = (await c.req('GET', '/api/sites')).json();
  const siteId = (sites.sites ?? sites)[0].id;
  const ap = await c.req('POST', '/api/pairing/approve', { code: userCode, siteId });
  assert.equal(ap.statusCode, 200, ap.body);
  const poll = await a.app.inject({ method: 'POST', url: `/api/pairing/challenges/${challengeId}/poll`, payload: { pollSecret } });
  const pj = poll.json();
  assert.equal(pj.status, 'completed', poll.body);
  // Instance B never saw the pairing.
  const ctxB = await b.app.inject({ method: 'GET', url: '/api/device/context', headers: { authorization: `Bearer ${pj.accessToken}` } });
  assert.equal(ctxB.statusCode, 200, ctxB.body);
  const body = ctxB.json();
  assert.equal(body.operator.name, 'Tarun KM');
  assert.ok(body.inspections.length > 0);
  assert.ok(body.measurements.length > 0);
  // Stateless refresh token also works on B.
  const rf = await b.app.inject({ method: 'POST', url: '/api/device/refresh', payload: { refreshToken: pj.refreshToken } });
  assert.equal(rf.statusCode, 200, rf.body);
  assert.ok(pj.refreshToken.length <= 120);
});

test('lazy ticker advances live data through the ingestion pipeline', async () => {
  const ticker = (a.ctx as Ctx & { demoTicker?: DemoTicker }).demoTicker!;
  assert.ok(ticker);
  const before = await withSystem(a.database.db, async (tx) => (await tx.select({ t: sensors.lastTs, tag: sensors.tag }).from(sensors)).filter((r) => r.tag === 'FT-601' || r.tag === 'LT-101'));
  await ticker.step();
  const afterRows = await withSystem(a.database.db, async (tx) => (await tx.select({ t: sensors.lastTs, tag: sensors.tag }).from(sensors)).filter((r) => r.tag === 'FT-601' || r.tag === 'LT-101'));
  for (const r of afterRows) {
    const prev = before.find((x) => x.tag === r.tag)!;
    assert.ok(r.t! > prev.t!, `${r.tag} advanced`);
  }
  assert.equal(DEMO_ORG_ID.length, 36);
});

// ---------------------------------------------------------------- named guests + cross-instance pairing
async function guest(app: FastifyInstance, name: string) {
  const c = new Client(app);
  const r = await c.req('POST', '/api/auth/demo', { name });
  assert.equal(r.statusCode, 200, r.body);
  c.absorb(r);
  return c;
}

/** Glasses on `g`, approval on `h`: the full RFC 8628-style flow across two instances. */
async function pairAcross(g: FastifyInstance, h: FastifyInstance, approver: Client, hardwareId: string, assigneeUserId?: string) {
  const cr = await g.inject({ method: 'POST', url: '/api/pairing/challenges', payload: { hardwareId, device: { kind: 'simulator', name: 'Demo viewport' } } });
  assert.equal(cr.statusCode, 201, cr.body);
  const ch = cr.json();
  const hc = new Client(h);
  hc.token = approver.token;
  const lk = await hc.req('GET', `/api/pairing/lookup?code=${ch.userCode}`);
  assert.equal(lk.statusCode, 200, lk.body);
  const ap = await hc.req('POST', '/api/pairing/approve', { code: ch.userCode, siteId: lk.json().sites[0].id, ...(assigneeUserId ? { assigneeUserId } : {}) });
  assert.equal(ap.statusCode, 200, ap.body);
  const pl = await g.inject({ method: 'POST', url: `/api/pairing/challenges/${ch.challengeId}/poll`, payload: { pollSecret: ch.pollSecret } });
  assert.equal(pl.statusCode, 200, pl.body);
  const done = pl.json();
  assert.equal(done.status, 'completed', pl.body);
  return done as { accessToken: string; refreshToken: string };
}

test('demo guest: named account works on every instance and owns personal work', async () => {
  const c = await guest(a.app, 'Priya Sharma');
  const me = await c.req('GET', '/api/auth/me');
  assert.equal(me.statusCode, 200, me.body);
  assert.equal(me.json().user.name, 'Priya Sharma');
  // Same token on the other instance (which has never seen this guest).
  const onB = new Client(b.app);
  onB.token = c.token;
  const meB = await onB.req('GET', '/api/auth/me');
  assert.equal(meB.statusCode, 200, meB.body);
  assert.equal(meB.json().user.name, 'Priya Sharma');
});

test('demo pairing: works across instances, shows the guest name and tasks, survives logout + re-pair cycles', async () => {
  const c = await guest(a.app, 'Arjun Rao');
  const hw = 'hw-cross-instance-0001';
  for (let round = 0; round < 3; round++) {
    // Alternate which instance hosts the glasses and which approves.
    const [g, h] = round % 2 === 0 ? [a.app, b.app] : [b.app, a.app];
    const t = await pairAcross(g, h, c, hw);
    for (const app of [a.app, b.app]) {
      const ctxR = await app.inject({ method: 'GET', url: '/api/device/context', headers: { authorization: `Bearer ${t.accessToken}` } });
      assert.equal(ctxR.statusCode, 200, `round ${round} on ${app === a.app ? "a" : "b"}: ${ctxR.body}`);
      const body = ctxR.json();
      assert.equal(body.operator.name, 'Arjun Rao');
      assert.ok(body.inspections.length + body.tasks.length > 0, 'guest has assigned work on the glasses');
    }
    const rf = await h.inject({ method: 'POST', url: '/api/device/refresh', payload: { refreshToken: t.refreshToken } });
    assert.equal(rf.statusCode, 200, rf.body);
    const out = await g.inject({ method: 'POST', url: '/api/device/logout', headers: { authorization: `Bearer ${t.accessToken}` } });
    assert.equal(out.statusCode, 204, out.body);
  }
  // A brand-new device for the same person also pairs.
  const t2 = await pairAcross(b.app, a.app, c, 'hw-cross-instance-0002');
  const r = await a.app.inject({ method: 'GET', url: '/api/device/context', headers: { authorization: `Bearer ${t2.accessToken}` } });
  assert.equal(r.json().operator.name, 'Arjun Rao');
});

test('demo audit scans are visible and reviewable from every instance', async () => {
  const c = await guest(a.app, 'Nisha Audit');
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const ln = { text: 'Outlet pH: 7.2', conf: 90, bbox: [0.05, 0.1, 0.3, 0.02], words: [{ text: 'Outlet', conf: 90, bbox: [0.05, 0.1, 0.07, 0.02] }, { text: 'pH:', conf: 90, bbox: [0.13, 0.1, 0.05, 0.02] }, { text: '7.2', conf: 90, bbox: [0.19, 0.1, 0.04, 0.02] }] };
  const r = await c.req('POST', '/api/audit-docs', { title: 'Cross-instance scan', pages: [{ mime: 'image/png', data: PNG, width: 800, height: 1000, readings: [{ engine: 'ocr:original', text: ln.text, conf: 90, lines: [ln] }, { engine: 'ocr:enhanced', text: ln.text, conf: 90, lines: [ln] }] }] });
  assert.equal(r.statusCode, 201, r.body);
  const onB = new Client(b.app);
  onB.token = c.token;
  const list = await onB.req('GET', '/api/audit-docs');
  assert.ok(list.json().some((d: { id: string }) => d.id === r.json().id), 'listed on the other instance');
  assert.equal((await onB.req('POST', `/api/audit-docs/${r.json().id}/confirm-agreed`)).statusCode, 200);
  assert.equal((await onB.req('POST', `/api/audit-docs/${r.json().id}/verify`, {})).statusCode, 200);
  const back = await c.req('GET', `/api/audit-docs/${r.json().id}`);
  assert.equal(back.json().status, 'verified', 'instance a sees the verification made on b');
});

test('voice assistant answers from the connected account (user and paired glasses)', async () => {
  const c = await guest(a.app, 'Voice Tester');
  const ask = async (cl: Client, text: string) => {
    const r = await cl.req('POST', '/api/assistant/ask', { text });
    assert.equal(r.statusCode, 200, r.body);
    return r.json() as { answer: string; intent: string; facts: { label: string; value: string; ref?: string }[]; engine: string };
  };
  const ph = await ask(c, "Hey Hydris, what's the current pH value?");
  assert.equal(ph.intent, 'reading');
  assert.match(ph.answer, /pH/);
  // The spoken value is exactly the stored sensor value for that tag.
  const sensorRows = await withSystem(a.database.db, (tx) => tx.select().from(sensors));
  const f = ph.facts[0]!;
  const s = sensorRows.find((x) => x.tag === f.ref)!;
  assert.equal(s.measurand, 'ph');
  assert.equal(Number(f.value).toFixed(2), s.lastValue!.toFixed(2));
  assert.ok(ph.answer.includes(f.value), ph.answer);

  assert.equal((await ask(c, 'hey hydris any alarms')).intent, 'alarms');
  const work = await ask(c, 'what are my tasks');
  assert.equal(work.intent, 'my_work');
  assert.match(work.answer, /inspection/);
  assert.equal((await ask(c, 'hey hydris dissolved oxygen')).facts.length > 0, true);
  assert.equal((await ask(c, 'what is the meaning of life')).intent, 'unknown');

  // Same question from paired glasses (device token) on the other instance.
  const t = await pairAcross(a.app, b.app, c, 'hw-voice-test-000001');
  const glasses = new Client(b.app);
  glasses.token = t.accessToken;
  const g = await ask(glasses, 'Hey Hydris what is the current pH');
  assert.equal(g.intent, 'reading');
  assert.match(g.answer, /pH/);
});
