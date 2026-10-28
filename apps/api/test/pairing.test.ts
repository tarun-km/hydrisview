/**
 * Phase 4 pairing: auto-registration (POST /devices/claim), ownership transfer with session
 * revocation, the requireDeviceApproval policy (pending → approved / denied), canonical hardware id
 * dedupe (+ migration 0012 merge), QR approval by an operator (deep-link payload), suspension of the
 * owner signing the glasses out, and tenant isolation.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { pairingCodeFromPayload, pairingDeepLink } from '@hydris/domain';
import { auditEvents, deviceAssignments, devices, memberships, notifications, organizations, users } from '../src/db/schema.js';
import { withSystem } from '../src/db/tenant.js';
import { defaultMigrationsFolder } from '../src/db/client.js';
import { hashPassword } from '../src/core/crypto.js';
import type { DomainEvent } from '../src/core/events.js';
import { as, Client, harness, PW, type Harness } from './helpers.js';

let h: Harness;
before(async () => {
  h = await harness();
});
after(async () => {
  await h.app.close();
  await h.database.close();
});

const hw = (n: string) => `rbm-${n.padEnd(32, '0')}`;
const claim = (c: Client, hardwareId: string, extra: Record<string, unknown> = {}) =>
  c.req('POST', '/api/devices/claim', { hardwareId, model: 'Ray-Ban Meta Gen 2', name: 'Ray-Ban Meta', firmware: 'v20.1', ...extra });
const deviceClient = (token: string) => { const c = new Client(h.app); c.token = token; return c; };
function capture() {
  const events: DomainEvent[] = [];
  const unsub = h.ctx.bus.subscribe((e) => events.push(e));
  return { events, unsub };
}
async function setPolicy(on: boolean) {
  const admin = await as(h.app, 'admin');
  assert.equal((await admin.req('PATCH', '/api/org/settings', { requireDeviceApproval: on })).statusCode, 200);
}

test('claim creates the device, assigns it to the caller and issues device tokens in one step', async () => {
  const op = await as(h.app, 'operator');
  const r = await claim(op, hw('a1'));
  assert.equal(r.statusCode, 200, r.body);
  const b = r.json();
  assert.equal(b.status, 'active');
  assert.equal(b.created, true);
  assert.equal(b.owner.id, h.demo.users.operator);
  assert.ok(b.accessToken && b.refreshToken?.startsWith('hgd_'));
  const ctx = (await deviceClient(b.accessToken).req('GET', '/api/device/context')).json();
  assert.equal(ctx.operator.id, h.demo.users.operator);
  assert.equal(ctx.device.id, b.device.id);

  // Idempotent: the app claims again on every sign-in; same record, earlier tokens keep working.
  const again = (await claim(op, hw('a1'), { firmware: 'v21.0' })).json();
  assert.equal(again.device.id, b.device.id);
  assert.equal(again.created, false);
  assert.equal((await deviceClient(b.accessToken).req('GET', '/api/device/context')).statusCode, 200);
  const [row] = await withSystem(h.database.db, (tx) => tx.select().from(devices).where(eq(devices.id, b.device.id)));
  assert.equal(row!.firmwareVersion, 'v21.0');
  assert.equal(row!.model, 'Ray-Ban Meta Gen 2');

  const audit = await withSystem(h.database.db, (tx) => tx.select().from(auditEvents).where(and(eq(auditEvents.action, 'device.registered'), eq(auditEvents.entityId, b.device.id))));
  assert.equal(audit.length, 1);
  // Device tokens and anonymous callers cannot claim.
  assert.equal((await claim(deviceClient(b.accessToken), hw('a2'))).statusCode, 403);
  assert.equal((await claim(new Client(h.app), hw('a2'))).statusCode, 401);
});

test('a claim by another user transfers the glasses, revokes the old device session, keeps history, audits and notifies admins', async () => {
  const op = await as(h.app, 'operator');
  const first = (await claim(op, hw('b1'))).json();
  const op2 = await as(h.app, 'operator2');
  const { events, unsub } = capture();
  const r = await claim(op2, hw('b1'));
  unsub();
  assert.equal(r.statusCode, 200, r.body);
  const b = r.json();
  assert.equal(b.status, 'active');
  assert.equal(b.transferred, true);
  assert.equal(b.device.id, first.device.id);

  // The previous owner's device session is dead (access and refresh), the new one works.
  assert.equal((await deviceClient(first.accessToken).req('GET', '/api/device/context')).statusCode, 401);
  assert.equal((await new Client(h.app).req('POST', '/api/device/refresh', { refreshToken: first.refreshToken })).statusCode, 401);
  const ctx = (await deviceClient(b.accessToken).req('GET', '/api/device/context')).json();
  assert.equal(ctx.operator.id, h.demo.users.operator2);

  // Realtime: glasses stream signed out, the previous owner's app told.
  assert.deepEqual(events.find((e) => e.type === 'session.revoked')?.deviceIds, [first.device.id]);
  assert.deepEqual(events.find((e) => e.type === 'device.transferred')?.userIds, [h.demo.users.operator]);

  const hist = await withSystem(h.database.db, (tx) => tx.select().from(deviceAssignments).where(eq(deviceAssignments.deviceId, first.device.id)));
  assert.equal(hist.length, 2, 'history kept');
  assert.equal(hist.find((a) => a.userId === h.demo.users.operator)!.reason, 'transferred');
  const audit = await withSystem(h.database.db, (tx) => tx.select().from(auditEvents).where(and(eq(auditEvents.action, 'device.transferred'), eq(auditEvents.entityId, first.device.id))));
  assert.equal(audit.length, 1);
  assert.deepEqual(audit[0]!.metadata, { from: h.demo.users.operator, to: h.demo.users.operator2, via: 'claim' });
  const notes = await withSystem(h.database.db, (tx) => tx.select().from(notifications).where(and(eq(notifications.kind, 'device.transferred'), eq(notifications.entityId, first.device.id))));
  assert.ok(notes.some((n) => n.userId === h.demo.users.admin), 'administrators notified');
  // The console sees the new owner and the history.
  const admin = await as(h.app, 'admin');
  const det = (await admin.req('GET', `/api/devices/${first.device.id}`)).json();
  assert.equal(det.device.assignee.id, h.demo.users.operator2);
  assert.equal(det.assignments.length, 2);
});

test('approval policy: first registration and transfer wait for an administrator (approve / deny)', async () => {
  await setPolicy(true);
  try {
    const op = await as(h.app, 'operator');
    const admin = await as(h.app, 'admin');
    const { events, unsub } = capture();
    const p1 = (await claim(op, hw('c1'))).json();
    unsub();
    assert.equal(p1.status, 'pending');
    assert.equal(p1.accessToken, undefined, 'no tokens before approval');
    const pendingEvt = events.find((e) => e.type === 'device.pending');
    assert.equal(pendingEvt?.permission, 'device.manage');
    assert.equal((await claim(op, hw('c1'))).json().status, 'pending', 'polling stays pending');

    // Console: Devices and the Approvals queue list it.
    const q = (await admin.req('GET', '/api/command/approvals')).json();
    const item = q.devices.find((d: { id: string }) => d.id === p1.device.id);
    assert.ok(item);
    assert.equal(item.pendingUserId, h.demo.users.operator);
    assert.equal(item.transfer, false);
    assert.ok((await admin.req('GET', '/api/command/dashboard')).json().approvals.devices >= 1);
    assert.equal((await op.req('POST', `/api/devices/${p1.device.id}/approve`)).statusCode, 403, 'operators cannot approve');

    const ev2 = capture();
    assert.equal((await admin.req('POST', `/api/devices/${p1.device.id}/approve`)).statusCode, 200);
    ev2.unsub();
    assert.deepEqual(ev2.events.find((e) => e.type === 'device.claim_approved')?.userIds, [h.demo.users.operator]);
    const ok = (await claim(op, hw('c1'))).json();
    assert.equal(ok.status, 'active');
    assert.ok(ok.accessToken);
    assert.equal((await admin.req('POST', `/api/devices/${p1.device.id}/approve`)).statusCode, 409, 'nothing pending any more');

    // Transfer under the policy: the owner keeps working until an admin decides; denied → owner keeps it.
    const op2 = await as(h.app, 'operator2');
    const t = (await claim(op2, hw('c1'))).json();
    assert.equal(t.status, 'pending');
    assert.equal((await deviceClient(ok.accessToken).req('GET', '/api/device/context')).statusCode, 200);
    assert.equal((await admin.req('GET', '/api/command/approvals')).json().devices.find((d: { id: string }) => d.id === p1.device.id).transfer, true);
    assert.equal((await admin.req('POST', `/api/devices/${p1.device.id}/deny`)).statusCode, 200);
    assert.equal((await claim(op2, hw('c1'))).json().status, 'denied');
    assert.equal((await deviceClient(ok.accessToken).req('GET', '/api/device/context')).statusCode, 200);

    // Transfer approved: the old session is revoked.
    const engineer = await as(h.app, 'engineer');
    assert.equal((await claim(engineer, hw('c1'))).json().status, 'pending');
    assert.equal((await admin.req('POST', `/api/devices/${p1.device.id}/approve`)).statusCode, 200);
    assert.equal((await deviceClient(ok.accessToken).req('GET', '/api/device/context')).statusCode, 401);
    assert.equal((await claim(engineer, hw('c1'))).json().status, 'active');

    // A denied first registration.
    const n = (await claim(op2, hw('c2'))).json();
    assert.equal(n.status, 'pending');
    assert.equal((await admin.req('POST', `/api/devices/${n.device.id}/deny`)).statusCode, 200);
    const denied = (await claim(op2, hw('c2'))).json();
    assert.equal(denied.status, 'denied');
    assert.equal(denied.device.approvalState, 'denied');

    // Administrators are not subject to the policy.
    assert.equal((await claim(admin, hw('c3'))).json().status, 'active');
  } finally {
    await setPolicy(false);
  }
});

test('canonical hardware id: case variants and both pairing paths resolve to one device record', async () => {
  const op = await as(h.app, 'operator');
  const id = 'RBM-D1D1D1D1D1D1D1D1D1D1D1D1D1D1D1D1';
  const a = (await claim(op, id)).json();
  const b = (await claim(op, id.toLowerCase())).json();
  assert.equal(a.device.id, b.device.id);
  // The WebView bridge pairs the same glasses through the QR/device flow with the same canonical id.
  const anon = new Client(h.app);
  const ch = (await anon.req('POST', '/api/pairing/challenges', { hardwareId: `  ${id}  `.trim(), device: { kind: 'hardware', model: 'Web viewport' } })).json();
  assert.equal((await op.req('POST', '/api/pairing/approve', { code: ch.qrPayload })).statusCode, 200);
  await new Promise((r) => setTimeout(r, 2100));
  const done = (await anon.req('POST', `/api/pairing/challenges/${ch.challengeId}/poll`, { pollSecret: ch.pollSecret })).json();
  assert.equal(done.status, 'completed');
  assert.equal(done.device.id, a.device.id);
  const rows = await withSystem(h.database.db, (tx) => tx.select().from(devices).where(eq(devices.hardwareId, id.toLowerCase())));
  assert.equal(rows.length, 1);
  // The database refuses a second live record for the same id in the same org.
  await assert.rejects(withSystem(h.database.db, (tx) => tx.insert(devices).values({ orgId: h.demo.orgId, name: 'dupe', kind: 'hardware', hardwareId: id.toLowerCase() })));
});

test('QR pairing: the glasses QR encodes the Hydris Field deep link; an operator scan approves it for themselves', async () => {
  const anon = new Client(h.app);
  const ch = (await anon.req('POST', '/api/pairing/challenges', { hardwareId: 'hg-qrpairing0000000000000001', device: { kind: 'hardware', model: 'Web viewport', display: { width: 600, height: 600 } } })).json();
  assert.equal(ch.qrPayload, pairingDeepLink(ch.userCode));
  assert.ok(ch.qrPayload.startsWith('hydrisfield://pair?code='));
  assert.equal(pairingCodeFromPayload(ch.qrPayload), ch.userCode);
  assert.equal(pairingCodeFromPayload(`https://x.test/pair?code=${ch.userCode}`), ch.userCode);
  assert.equal(pairingCodeFromPayload('hydrisfield://pair?code=nope'), null);

  const op = await as(h.app, 'operator2');
  // No siteId needed: the scan pairs to the operator's own site.
  const r = await op.req('POST', '/api/pairing/approve', { code: ch.qrPayload });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().needsAdminApproval, false);
  await new Promise((r2) => setTimeout(r2, 2100));
  const done = (await anon.req('POST', `/api/pairing/challenges/${ch.challengeId}/poll`, { pollSecret: ch.pollSecret })).json();
  assert.equal(done.status, 'completed');
  const ctx = (await deviceClient(done.accessToken).req('GET', '/api/device/context')).json();
  assert.equal(ctx.operator.id, h.demo.users.operator2, 'the glasses enter with the scanning operator');

  // Scanning glasses that someone else holds transfers them (old glasses session ends).
  const ch2 = (await anon.req('POST', '/api/pairing/challenges', { hardwareId: 'hg-qrpairing0000000000000001', device: { kind: 'hardware', model: 'Web viewport' } })).json();
  const op1 = await as(h.app, 'operator');
  const { events, unsub } = capture();
  assert.equal((await op1.req('POST', '/api/pairing/approve', { code: ch2.qrPayload })).statusCode, 200);
  await new Promise((r2) => setTimeout(r2, 2100));
  const done2 = (await anon.req('POST', `/api/pairing/challenges/${ch2.challengeId}/poll`, { pollSecret: ch2.pollSecret })).json();
  unsub();
  assert.equal(done2.device.id, done.device.id);
  assert.equal((await deviceClient(done.accessToken).req('GET', '/api/device/context')).statusCode, 401);
  assert.ok(events.some((e) => e.type === 'device.transferred' && e.userIds?.includes(h.demo.users.operator2!)));
  const audit = await withSystem(h.database.db, (tx) => tx.select().from(auditEvents).where(and(eq(auditEvents.action, 'device.transferred'), eq(auditEvents.entityId, done.device.id))));
  assert.equal(audit.length, 1);
});

test('QR pairing under the approval policy waits for an administrator, then completes', async () => {
  await setPolicy(true);
  try {
    const anon = new Client(h.app);
    const ch = (await anon.req('POST', '/api/pairing/challenges', { hardwareId: 'hg-qrpolicy00000000000000001', device: { kind: 'hardware', model: 'Web viewport' } })).json();
    const op = await as(h.app, 'operator');
    const r = (await op.req('POST', '/api/pairing/approve', { code: ch.qrPayload })).json();
    assert.equal(r.needsAdminApproval, true);
    await new Promise((r2) => setTimeout(r2, 2100));
    const wait = (await anon.req('POST', `/api/pairing/challenges/${ch.challengeId}/poll`, { pollSecret: ch.pollSecret })).json();
    assert.equal(wait.status, 'awaiting_approval');
    assert.ok(new Date(wait.expiresAt).getTime() > Date.now() + 20 * 60_000, 'challenge kept alive');
    const admin = await as(h.app, 'admin');
    const pending = (await admin.req('GET', '/api/devices/pending')).json().devices as { id: string; pendingUserId: string }[];
    const item = pending.find((d) => d.pendingUserId === h.demo.users.operator)!;
    assert.equal((await admin.req('POST', `/api/devices/${item.id}/approve`)).statusCode, 200);
    await new Promise((r2) => setTimeout(r2, 2100));
    const done = (await anon.req('POST', `/api/pairing/challenges/${ch.challengeId}/poll`, { pollSecret: ch.pollSecret })).json();
    assert.equal(done.status, 'completed');
    assert.equal(done.device.id, item.id);
  } finally {
    await setPolicy(false);
  }
});

test('suspending the owner signs their claimed glasses out at once (token, refresh, SSE event)', async () => {
  const admin = await as(h.app, 'admin');
  const user = await withSystem(h.database.db, async (tx) => {
    const [u] = await tx.insert(users).values({ email: 'claimer@plant.test', name: 'Claim Er', passwordHash: await hashPassword(PW), emailVerifiedAt: new Date(), defaultOrgId: h.demo.orgId }).returning();
    await tx.insert(memberships).values({ orgId: h.demo.orgId, userId: u!.id, role: 'operator', allSites: true });
    return u!;
  });
  const op = await as(h.app, 'claimer@plant.test');
  const d = (await claim(op, hw('e1'))).json();
  assert.equal(d.status, 'active');
  const { events, unsub } = capture();
  assert.equal((await admin.req('POST', `/api/members/${user.id}/suspend`, { reason: 'test' })).statusCode, 200);
  unsub();
  assert.equal((await deviceClient(d.accessToken).req('GET', '/api/device/context')).statusCode, 401);
  assert.equal((await new Client(h.app).req('POST', '/api/device/refresh', { refreshToken: d.refreshToken })).statusCode, 401);
  assert.deepEqual(events.find((e) => e.type === 'session.revoked')?.deviceIds, [d.device.id]);
  // Suspended users cannot claim.
  assert.notEqual((await claim(op, hw('e2'))).statusCode, 200);
});

test('tenant isolation: another organization can neither claim, see nor approve these glasses', async () => {
  const op = await as(h.app, 'operator');
  const mine = (await claim(op, hw('f1'))).json();
  await withSystem(h.database.db, async (tx) => {
    const [org] = await tx.insert(organizations).values({ name: 'Other Works', slug: 'other-works-pair' }).returning();
    const [u] = await tx.insert(users).values({ email: 'chief@otherworks.test', name: 'Other Chief', passwordHash: await hashPassword(PW), emailVerifiedAt: new Date(), defaultOrgId: org!.id }).returning();
    await tx.insert(memberships).values({ orgId: org!.id, userId: u!.id, role: 'admin', allSites: true });
    const { sites } = await import('../src/db/schema.js');
    await tx.insert(sites).values({ orgId: org!.id, name: 'Other site', code: 'OTH' });
  });
  const other = await as(h.app, 'chief@otherworks.test');
  const r = await claim(other, hw('f1'));
  assert.equal(r.statusCode, 409);
  assert.equal(r.json().error.code, 'device_owned_elsewhere');
  assert.equal((await other.req('GET', `/api/devices/${mine.device.id}`)).statusCode, 404);
  assert.equal((await other.req('POST', `/api/devices/${mine.device.id}/approve`)).statusCode, 404);
  assert.equal((await other.req('GET', '/api/devices/pending')).json().devices.length, 0);
  // Its own glasses register fine and stay invisible to the demo tenant.
  const own = (await claim(other, hw('f2'))).json();
  assert.equal(own.status, 'active');
  const admin = await as(h.app, 'admin');
  assert.equal((await admin.req('GET', `/api/devices/${own.device.id}`)).statusCode, 404);
  assert.equal((await claim(op, hw('f2'))).statusCode, 409);
});

test('migration 0012 canonicalizes hardware ids and merges duplicate live records', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hydris-mig12-'));
  try {
    cpSync(defaultMigrationsFolder(), dir, { recursive: true });
    const journalPath = join(dir, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
    const full = structuredClone(journal);
    journal.entries = journal.entries.filter((e: { tag: string }) => e.tag < '0012');
    writeFileSync(journalPath, JSON.stringify(journal));
    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle } = await import('drizzle-orm/pglite');
    const { migrate } = await import('drizzle-orm/pglite/migrator');
    const client = new PGlite();
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: dir });
    const org = '11111111-1111-4111-8111-111111111111';
    await client.exec(`insert into organizations (id, name, slug) values ('${org}', 'Dupes', 'dupes')`);
    await client.exec(`insert into users (id, email, name) values ('22222222-2222-4222-8222-000000000001', 'u@dupes.test', 'U')`);
    await client.exec(`insert into devices (id, org_id, name, kind, hardware_id, last_seen_at) values
      ('33333333-3333-4333-8333-000000000001', '${org}', 'old', 'hardware', 'RBM-ABCDEF0123456789ABCD', now() - interval '2 days'),
      ('33333333-3333-4333-8333-000000000002', '${org}', 'new', 'hardware', 'rbm-abcdef0123456789abcd', now()),
      ('33333333-3333-4333-8333-000000000003', '${org}', 'other', 'hardware', 'rbm-ffffffffffffffffffff', now())`);
    await client.exec(`insert into device_assignments (org_id, device_id, user_id) values ('${org}', '33333333-3333-4333-8333-000000000001', '22222222-2222-4222-8222-000000000001')`);
    writeFileSync(journalPath, JSON.stringify(full));
    await migrate(db, { migrationsFolder: dir });
    const rows = (await client.query<{ name: string; status: string; hardware_id: string; revoke_reason: string | null }>(`select name, status::text as status, hardware_id, revoke_reason from devices order by name`)).rows;
    const by = Object.fromEntries(rows.map((r) => [r.name, r]));
    assert.equal(by.new!.status, 'active');
    assert.equal(by.old!.status, 'revoked');
    assert.equal(by.old!.hardware_id, 'rbm-abcdef0123456789abcd');
    assert.match(by.old!.revoke_reason!, /Merged duplicate of 33333333-3333-4333-8333-000000000002/);
    assert.equal(by.other!.status, 'active');
    const open = (await client.query<{ n: number }>(`select count(*)::int as n from device_assignments where unassigned_at is null`)).rows[0]!.n;
    assert.equal(open, 0, 'assignment of the merged duplicate closed (history kept)');
    await client.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
