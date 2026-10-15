import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { DEFAULT_UI_PROFILE_CONFIG, type UiProfileConfig } from '@hydris/domain';
import { deviceAssignments, devices, organizations, uiProfiles } from '../src/db/schema.js';
import { withSystem } from '../src/db/tenant.js';
import type { DomainEvent } from '../src/core/events.js';
import { as, Client, harness, type Harness } from './helpers.js';

let h: Harness;
let deviceId = '';
let glasses: Client;

before(async () => {
  h = await harness();
  // Register a paired device for the demo operator directly and mint a device token.
  const d = await withSystem(h.database.db, async (tx) => {
    const [dv] = await tx.insert(devices).values({ orgId: h.demo.orgId, siteId: h.demo.siteId, name: 'Profile test glasses', kind: 'simulator', hardwareId: 'hg-profile-test-000000001' }).returning();
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

const restricted = (): UiProfileConfig => ({
  ...structuredClone(DEFAULT_UI_PROFILE_CONFIG),
  screens: DEFAULT_UI_PROFILE_CONFIG.screens.map((s) => ({ ...s, enabled: !['notifications', 'ai'].includes(s.id) })),
  actions: { ...DEFAULT_UI_PROFILE_CONFIG.actions, acknowledge_alarm: false, submit_inspection: false, record_inspection: false, toggle_checklist: false, ask_ai: false, view_sops: false },
  measurements: { allow: ['ph'], orderByAssetType: {} },
});

async function createProfile(admin: Client, name: string, config: UiProfileConfig) {
  const id = (await admin.req('POST', '/api/ui-profiles', { name })).json().profile.id as string;
  assert.equal((await admin.req('PUT', `/api/ui-profiles/${id}/draft`, { config })).statusCode, 200);
  return id;
}

test('ui profiles: only org_admin edits; factory_manager reads; operators denied', async () => {
  const mgr = await as(h.app, 'manager');
  assert.equal((await mgr.req('GET', '/api/ui-profiles')).statusCode, 200);
  assert.equal((await mgr.req('POST', '/api/ui-profiles', { name: 'Nope' })).statusCode, 403);
  const op = await as(h.app, 'operator');
  assert.equal((await op.req('GET', '/api/ui-profiles')).statusCode, 403);
  assert.equal((await glasses.req('GET', '/api/ui-profiles')).statusCode, 403);
});

test('ui profiles: device context defaults to built-in profile', async () => {
  const c = (await glasses.req('GET', '/api/device/context')).json();
  assert.equal(c.profile.source, 'default');
  assert.equal(c.profile.id, null);
});

test('ui profiles: publish versioning, SSE to affected devices, enforcement, rollback', async () => {
  const admin = await as(h.app, 'admin');
  const events: DomainEvent[] = [];
  const off = h.ctx.bus.subscribe((e) => events.push(e));

  const id = await createProfile(admin, 'Restricted operators', restricted());
  const asg = await admin.req('POST', '/api/ui-profile-assignments', { scope: 'device', profileId: id, deviceId });
  assert.equal(asg.statusCode, 201);
  // Unpublished profile: falls through to default.
  assert.equal((await glasses.req('GET', '/api/device/context')).json().profile.source, 'default');

  const pub = await admin.req('POST', `/api/ui-profiles/${id}/publish`, { notes: 'first' });
  assert.equal(pub.statusCode, 200);
  assert.equal(pub.json().version.version, 1);
  const ev = events.find((e) => e.type === 'device.profile_changed' && e.payload && (e.payload as { reason: string }).reason === 'published');
  assert.ok(ev, 'SSE emitted on publish');
  assert.deepEqual(ev!.deviceIds, [deviceId]);

  const ctx = (await glasses.req('GET', '/api/device/context')).json();
  assert.equal(ctx.profile.id, id);
  assert.equal(ctx.profile.version, 1);
  assert.equal(ctx.profile.source, 'device');
  assert.ok(ctx.measurements.every((m: { measurand: string }) => m.measurand === 'ph'), 'disallowed measurands omitted');

  // Server enforcement.
  const alarmId = '00000000-0000-4000-8000-000000000000';
  const ack = await glasses.req('POST', `/api/alarms/${alarmId}/acknowledge`, {});
  assert.equal(ack.statusCode, 403);
  assert.equal(ack.json().error.code, 'profile_forbidden');
  assert.equal((await glasses.req('POST', `/api/inspections/${alarmId}/submit`, {})).statusCode, 403);
  assert.equal((await glasses.req('POST', `/api/inspections/${alarmId}/responses`, { ops: [] })).statusCode, 403);
  assert.equal((await glasses.req('POST', `/api/maintenance/${alarmId}/checklist/x`, { done: true })).statusCode, 403);
  assert.equal((await glasses.req('GET', '/api/assist?q=pump')).statusCode, 403);
  assert.equal((await glasses.req('GET', '/api/notifications')).statusCode, 403);
  assert.equal((await glasses.req('GET', '/api/documents')).statusCode, 403);
  // A user principal of the same operator is unaffected by device profiles.
  const op = await as(h.app, 'operator');
  assert.equal((await op.req('GET', '/api/notifications')).statusCode, 200);

  // v2 allows everything; then roll back to v1.
  await admin.req('PUT', `/api/ui-profiles/${id}/draft`, { config: DEFAULT_UI_PROFILE_CONFIG });
  assert.equal((await admin.req('POST', `/api/ui-profiles/${id}/publish`, {})).json().version.version, 2);
  assert.equal((await glasses.req('GET', '/api/notifications')).statusCode, 200);
  const detail = (await admin.req('GET', `/api/ui-profiles/${id}`)).json();
  const v1 = detail.versions.find((v: { version: number }) => v.version === 1);
  assert.equal(v1.status, 'superseded');
  assert.ok(detail.versions.find((v: { version: number }) => v.version === 2).changes.length > 0, 'diff summary present');
  const rb = await admin.req('POST', `/api/ui-profiles/${id}/rollback`, { versionId: v1.id });
  assert.equal(rb.statusCode, 200);
  assert.equal(rb.json().version.version, 3);
  assert.equal((await glasses.req('GET', '/api/notifications')).statusCode, 403, 'rollback re-applies v1 restrictions');
  const after = (await admin.req('GET', `/api/ui-profiles/${id}`)).json();
  assert.equal(after.versions.filter((v: { status: string }) => v.status === 'published').length, 1);
  assert.ok(events.some((e) => e.type === 'device.profile_changed' && (e.payload as { reason: string }).reason === 'rollback'));
  off();

  // Clean up for following tests.
  await admin.req('DELETE', `/api/ui-profile-assignments/${asg.json().assignment.id}`);
  assert.equal((await glasses.req('GET', '/api/notifications')).statusCode, 200);
});

test('ui profiles: precedence device > user > role > org via effective endpoint', async () => {
  const admin = await as(h.app, 'admin');
  const mk = async (n: string) => { const id = await createProfile(admin, n, DEFAULT_UI_PROFILE_CONFIG); await admin.req('POST', `/api/ui-profiles/${id}/publish`, {}); return id; };
  const [o, r, u, d] = [await mk('Org'), await mk('Role'), await mk('User'), await mk('Device')];
  const eff = async () => (await admin.req('GET', `/api/ui-profiles-effective?deviceId=${deviceId}`)).json().effective;
  await admin.req('POST', '/api/ui-profile-assignments', { scope: 'org', profileId: o });
  assert.equal((await eff()).profileId, o);
  await admin.req('POST', '/api/ui-profile-assignments', { scope: 'role', profileId: r, role: 'field_operator' });
  assert.equal((await eff()).source, 'role');
  const ua = (await admin.req('POST', '/api/ui-profile-assignments', { scope: 'user', profileId: u, userId: h.demo.users.operator })).json().assignment;
  assert.equal((await eff()).profileId, u);
  await admin.req('POST', '/api/ui-profile-assignments', { scope: 'device', profileId: d, deviceId });
  assert.equal((await eff()).profileId, d);
  // Replace rather than duplicate.
  const rep = await admin.req('POST', '/api/ui-profile-assignments', { scope: 'device', profileId: u, deviceId });
  assert.equal(rep.json().replaced, true);
  assert.equal((await eff()).source, 'device');
  assert.equal((await admin.req('GET', '/api/ui-profile-assignments')).json().assignments.filter((a: { scope: string }) => a.scope === 'device').length, 1);
  await admin.req('DELETE', `/api/ui-profile-assignments/${ua.id}`);
  const mgr = await as(h.app, 'manager');
  assert.equal((await mgr.req('GET', `/api/ui-profiles-effective?userId=${h.demo.users.operator}`)).json().effective.profileId, r);
});

test('ui profiles: assignment validation and cross-tenant isolation', async () => {
  const admin = await as(h.app, 'admin');
  const id = await createProfile(admin, 'Validation', DEFAULT_UI_PROFILE_CONFIG);
  const fake = '11111111-1111-4111-8111-111111111111';
  assert.equal((await admin.req('POST', '/api/ui-profile-assignments', { scope: 'user', profileId: id, userId: fake })).statusCode, 400);
  assert.equal((await admin.req('POST', '/api/ui-profile-assignments', { scope: 'device', profileId: id, deviceId: fake })).statusCode, 400);
  assert.equal((await admin.req('POST', '/api/ui-profile-assignments', { scope: 'role', profileId: id, role: 'wizard' })).statusCode, 400);
  assert.equal((await admin.req('PUT', `/api/ui-profiles/${id}/draft`, { config: { ...DEFAULT_UI_PROFILE_CONFIG, actions: { nope: true } } })).statusCode, 400);

  // A second organization cannot see or use this org's profiles or devices.
  const other = await withSystem(h.database.db, async (tx) => (await tx.insert(organizations).values({ name: 'Other Org', slug: `other-${Date.now()}` } as typeof organizations.$inferInsert).returning())[0]!);
  const foreign = await withSystem(h.database.db, async (tx) => (await tx.insert(uiProfiles).values({ orgId: other.id, name: 'Foreign' }).returning())[0]!);
  assert.equal((await admin.req('GET', `/api/ui-profiles/${foreign.id}`)).statusCode, 404, 'RLS hides other tenants');
  assert.equal((await admin.req('POST', '/api/ui-profile-assignments', { scope: 'org', profileId: foreign.id })).statusCode, 400);
  assert.ok(!(await admin.req('GET', '/api/ui-profiles')).json().profiles.some((x: { id: string }) => x.id === foreign.id));
  // Glasses cannot read profiles even of their own org.
  assert.equal((await glasses.req('GET', `/api/ui-profiles/${id}`)).statusCode, 403);
});
