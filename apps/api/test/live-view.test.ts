import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { deviceAssignments, devices, organizations } from '../src/db/schema.js';
import { withSystem } from '../src/db/tenant.js';
import type { DomainEvent } from '../src/core/events.js';
import { as, Client, harness, type Harness } from './helpers.js';

let h: Harness;
let deviceId = '';
let glasses: Client;

// Smallest valid JPEG prefix (SOI + APP0 marker) padded to a given size.
const jpeg = (bytes = 64) => `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(Math.max(0, bytes - 4), 1)]).toString('base64')}`;

before(async () => {
  h = await harness();
  const d = await withSystem(h.database.db, async (tx) => {
    const [dv] = await tx.insert(devices).values({ orgId: h.demo.orgId, siteId: h.demo.siteId, name: 'Live view glasses', kind: 'simulator', hardwareId: 'hg-live-view-test-0000001' }).returning();
    await tx.insert(deviceAssignments).values({ orgId: h.demo.orgId, deviceId: dv!.id, userId: h.demo.users.operator! });
    return dv!;
  });
  deviceId = d.id;
  glasses = new Client(h.app);
  glasses.token = h.app.jwt.sign({ typ: 'device', sub: d.id, org: d.orgId, sv: d.sessionVersion });
});
after(async () => {
  await h.app.close();
  await h.database.close();
});

test('live view: glasses post a snapshot, the console reads it back with the wearer', async () => {
  const mgr = await as(h.app, 'manager');
  const empty = (await mgr.req('GET', `/api/devices/${deviceId}/live`)).json();
  assert.equal(empty.live, false);
  assert.equal(empty.view, null);

  const seen: DomainEvent[] = [];
  const unsub = h.ctx.bus.subscribe((e) => seen.push(e));
  const r = await glasses.req('POST', '/api/device/live', { screen: 'alarms', title: 'Alarms', summary: ['2 open alarms'], view: jpeg(), camera: jpeg(), cameraActive: true });
  unsub();
  assert.equal(r.statusCode, 202);
  const ev = seen.find((e) => e.type === 'device.live');
  assert.ok(ev, 'device.live published');
  assert.deepEqual(Object.keys(ev!.payload as object).sort(), ['deviceId', 'screen', 'updatedAt'], 'no image payload on the event bus');

  const v = (await mgr.req('GET', `/api/devices/${deviceId}/live`)).json();
  assert.equal(v.live, true);
  assert.equal(v.screen, 'alarms');
  assert.equal(v.title, 'Alarms');
  assert.deepEqual(v.summary, ['2 open alarms']);
  assert.equal(v.operator.id, h.demo.users.operator);
  assert.ok(v.operator.name);
  assert.equal(v.deviceName, 'Live view glasses');
  assert.ok(v.view.startsWith('data:image/jpeg;base64,'));
  assert.ok(v.camera);
  assert.equal(v.cameraActive, true);

  const list = (await mgr.req('GET', '/api/devices/live')).json().live;
  const mine = list.find((x: { deviceId: string }) => x.deviceId === deviceId);
  assert.ok(mine?.live);
  assert.equal(mine.camera, undefined, 'fleet list carries no camera frames');

  // Users cannot post as glasses; viewers without device.read cannot watch.
  assert.equal((await mgr.req('POST', '/api/device/live', { screen: 'home', title: 'Home' })).statusCode, 403);
  assert.equal((await glasses.req('GET', `/api/devices/${deviceId}/live`)).statusCode, 403);
});

test('live view: another organization cannot read the snapshot', async () => {
  const other = await withSystem(h.database.db, async (tx) => (await tx.insert(organizations).values({ name: 'Other Live Org', slug: `other-live-${Date.now()}` } as typeof organizations.$inferInsert).returning())[0]!);
  const foreign = new Client(h.app);
  foreign.token = h.app.jwt.sign({ typ: 'device', sub: deviceId, org: other.id, sv: 0 });
  // A token claiming another org does not resolve this org's device.
  assert.notEqual((await foreign.req('POST', '/api/device/live', { screen: 'home', title: 'Spoof' })).statusCode, 202);
  const admin = await as(h.app, 'admin');
  const own = (await admin.req('GET', `/api/devices/${deviceId}/live`)).json();
  assert.notEqual(own.title, 'Spoof');
  // A user of another org gets 404 (RLS hides the device; the store key is org-scoped).
  const { users, memberships } = await import('../src/db/schema.js');
  const outsider = await withSystem(h.database.db, async (tx) => {
    const [u] = await tx.insert(users).values({ email: `live-outsider-${Date.now()}@other.test`, name: 'Outsider' } as typeof users.$inferInsert).returning();
    await tx.insert(memberships).values({ orgId: other.id, userId: u!.id, role: 'org_admin', status: 'active', allSites: true } as typeof memberships.$inferInsert);
    return u!;
  });
  const c = new Client(h.app);
  c.token = h.app.jwt.sign({ typ: 'user', sub: outsider.id, org: other.id, sv: 0 } as never);
  const r = await c.req('GET', `/api/devices/${deviceId}/live`);
  assert.ok([401, 403, 404].includes(r.statusCode), `foreign org rejected (${r.statusCode})`);
  assert.equal(r.json().view, undefined);
});

test('live view: validates image size and JPEG magic bytes', async () => {
  const big = await glasses.req('POST', '/api/device/live', { screen: 'home', title: 'Home', view: jpeg(130 * 1024) });
  assert.equal(big.statusCode, 400);
  const png = `data:image/jpeg;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]).toString('base64')}`;
  assert.equal((await glasses.req('POST', '/api/device/live', { screen: 'home', title: 'Home', camera: png })).statusCode, 400);
  assert.equal((await glasses.req('POST', '/api/device/live', { screen: 'home', title: 'Home', view: 'https://example.com/x.jpg' })).statusCode, 400);
  assert.equal((await glasses.req('POST', '/api/device/live', { screen: 'home', title: 'Home', summary: Array(13).fill('x') })).statusCode, 400);
  assert.equal((await glasses.req('POST', '/api/device/live', { screen: 'home', title: 'Home', view: jpeg(100 * 1024) })).statusCode, 202);
});
