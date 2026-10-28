/**
 * Console v2 command center (modules/command.ts): dashboard aggregates match the data, work
 * assignment to operators and teams, access helpers, organization policy settings, operators are
 * forbidden and every figure is tenant scoped.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { alarmEvents, auditDocuments, inspections, inspectionTemplates, memberships, organizations, users } from '../src/db/schema.js';
import { withSystem } from '../src/db/tenant.js';
import { hashPassword } from '../src/core/crypto.js';
import { demoEmail } from '../src/seed/demo.js';
import { as, harness, lastMailTo, PW, type Harness } from './helpers.js';

let h: Harness;
before(async () => {
  h = await harness();
});
after(async () => {
  await h.app.close();
  await h.database.close();
});

const OPEN = ['active', 'acknowledged', 'investigating'] as const;

test('dashboard aggregates match the tenant data', async () => {
  const admin = await as(h.app, 'admin');
  const r = await admin.req('GET', '/api/command/dashboard');
  assert.equal(r.statusCode, 200, r.body);
  const d = r.json();
  const expected = await withSystem(h.database.db, async (tx) => {
    const org = h.demo.orgId;
    const [ops] = await tx.select({ n: sql<number>`count(*)::int` }).from(memberships).where(and(eq(memberships.orgId, org), eq(memberships.role, 'operator'), eq(memberships.status, 'active')));
    const [al] = await tx.select({ n: sql<number>`count(*)::int`, crit: sql<number>`count(*) filter (where ${alarmEvents.severity} = 'critical')::int` }).from(alarmEvents)
      .where(and(eq(alarmEvents.orgId, org), inArray(alarmEvents.state, [...OPEN])));
    const [ins] = await tx.select({ n: sql<number>`count(*)::int` }).from(inspections).where(and(eq(inspections.orgId, org), eq(inspections.status, 'submitted')));
    const [docs] = await tx.select({ n: sql<number>`count(*)::int` }).from(auditDocuments).where(and(eq(auditDocuments.orgId, org), inArray(auditDocuments.status, ['in_review', 'verified'])));
    return { operators: ops!.n, openAlarms: al!.n, critical: al!.crit, inspections: ins!.n, scans: docs!.n };
  });
  assert.equal(d.kpis.operators, expected.operators);
  assert.equal(d.onShift.length, expected.operators);
  assert.equal(d.kpis.openAlarms, expected.openAlarms);
  assert.equal(d.kpis.criticalAlarms, expected.critical);
  assert.equal(d.approvals.inspections, expected.inspections);
  assert.equal(d.approvals.scans, expected.scans);
  assert.equal(d.kpis.approvals, expected.inspections + expected.scans);
  assert.ok(d.alarms.length <= 8);
  for (const a of d.alarms) assert.ok(OPEN.includes(a.state));
  assert.equal(typeof d.fleet.glasses.total, 'number');
  assert.ok(d.fleet.glasses.connected <= d.fleet.glasses.total);
  assert.ok(Array.isArray(d.activity));
  // Every operator card names the operator and carries the expected fields.
  for (const o of d.onShift) {
    assert.equal(o.role, 'operator');
    assert.ok('glasses' in o && 'current' in o && 'alarm' in o && 'lastActiveAt' in o);
  }
});

test('assigning work to an operator and to a team (shift) updates rounds progress', async () => {
  const admin = await as(h.app, 'admin');
  const before = (await admin.req('GET', '/api/command/dashboard')).json();
  const tpl = await withSystem(h.database.db, async (tx) => (await tx.select().from(inspectionTemplates).where(and(eq(inspectionTemplates.orgId, h.demo.orgId), eq(inspectionTemplates.status, 'published'))).limit(1))[0]!);
  const due = new Date(Date.now() + 3600_000).toISOString();
  const op = h.demo.users.operator!;
  const one = await admin.req('POST', '/api/command/assign', { kind: 'inspection', userIds: [op], templateId: tpl.id, siteId: h.demo.siteId, dueAt: due });
  assert.equal(one.statusCode, 201, one.body);
  assert.equal(one.json().created, 1);
  const after1 = (await admin.req('GET', '/api/command/dashboard')).json();
  assert.equal(after1.kpis.roundsAssigned, before.kpis.roundsAssigned + 1);
  const row = after1.rounds.find((x: { userId: string }) => x.userId === op);
  const prev = before.rounds.find((x: { userId: string }) => x.userId === op);
  assert.equal(row.assigned, (prev?.assigned ?? 0) + 1);

  // Team: every active operator on the A shift.
  const shiftOps = await withSystem(h.database.db, async (tx) => tx.select({ id: memberships.userId }).from(memberships)
    .where(and(eq(memberships.orgId, h.demo.orgId), eq(memberships.role, 'operator'), eq(memberships.status, 'active'), eq(memberships.shiftLabel, 'A shift (06:00-14:00)'))));
  assert.ok(shiftOps.length > 0);
  const team = await admin.req('POST', '/api/command/assign', { kind: 'maintenance', team: { shiftLabel: 'a shift (06:00-14:00)' }, title: 'Grease bearings', siteId: h.demo.siteId, checklist: ['Drive end', 'Non-drive end'] });
  assert.equal(team.statusCode, 201, team.body);
  assert.equal(team.json().assignees, shiftOps.length);
  const stats = (await admin.req('GET', '/api/command/operators')).json().operators as { userId: string; openTasks: number }[];
  for (const o of shiftOps) assert.ok(stats.find((s) => s.userId === o.id)!.openTasks >= 1);

  const bad = await admin.req('POST', '/api/command/assign', { kind: 'maintenance', team: { shiftLabel: 'No such shift' }, title: 'Nobody', siteId: h.demo.siteId });
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.json().error.code, 'no_assignees');
});

test('operator detail, password reset and revoke-all sessions', async () => {
  const admin = await as(h.app, 'admin');
  const op = await as(h.app, 'operator2');
  const id = h.demo.users.operator2!;
  const detail = await admin.req('GET', `/api/command/operators/${id}`);
  assert.equal(detail.statusCode, 200, detail.body);
  const body = detail.json();
  assert.equal(body.stats.userId, id);
  assert.ok(Array.isArray(body.timeline) && Array.isArray(body.alarmsHandled) && Array.isArray(body.scans));
  assert.ok(body.sessions.length >= 1, 'the operator signed in above');

  const reset = await admin.req('POST', `/api/command/operators/${id}/reset-access`, {});
  assert.equal(reset.statusCode, 200, reset.body);
  const mail = await lastMailTo(h, demoEmail('operator2'));
  assert.ok(mail && /reset-password\?token=/.test(mail.bodyText));

  assert.equal((await op.req('GET', '/api/auth/me')).statusCode, 200);
  const rv = await admin.req('POST', `/api/command/operators/${id}/sessions/revoke`, {});
  assert.equal(rv.statusCode, 200, rv.body);
  assert.ok(rv.json().revoked >= 1);
  assert.equal((await op.req('GET', '/api/devices')).statusCode, 401, 'access token dies with its session family');
  assert.equal((await admin.req('POST', `/api/command/operators/${h.demo.users.admin}/sessions/revoke`, {})).statusCode, 403, 'not on yourself');
});

test('organization policy: require admin approval for new glasses (default off)', async () => {
  const admin = await as(h.app, 'admin');
  const g = await admin.req('GET', '/api/org/settings');
  assert.equal(g.statusCode, 200);
  assert.equal(g.json().settings.requireDeviceApproval, false);
  const p = await admin.req('PATCH', '/api/org/settings', { requireDeviceApproval: true });
  assert.equal(p.statusCode, 200, p.body);
  assert.equal((await admin.req('GET', '/api/org/settings')).json().settings.requireDeviceApproval, true);
  assert.equal((await admin.req('PATCH', '/api/org/settings', { unknown: 1 })).statusCode, 400);
  assert.equal((await admin.req('PATCH', '/api/org/settings', { requireDeviceApproval: false })).statusCode, 200);
});

test('operators are forbidden from every command endpoint', async () => {
  const op = await as(h.app, 'operator');
  for (const [m, url, body] of [
    ['GET', '/api/command/dashboard'], ['GET', '/api/command/operators'], ['GET', `/api/command/operators/${h.demo.users.operator2}`],
    ['GET', '/api/command/approvals'], ['GET', '/api/command/fleet'], ['GET', '/api/org/settings'],
    ['PATCH', '/api/org/settings', { requireDeviceApproval: true }],
    ['POST', '/api/command/assign', { kind: 'maintenance', userIds: [h.demo.users.operator], title: 'Sneaky', siteId: h.demo.siteId }],
    ['POST', `/api/command/operators/${h.demo.users.operator2}/reset-access`, {}],
    ['POST', `/api/command/operators/${h.demo.users.operator2}/sessions/revoke`, {}],
  ] as const) {
    const r = await op.req(m, url, body);
    assert.equal(r.statusCode, 403, `${m} ${url}`);
  }
});

test('tenant isolation: another organization sees none of the demo tenant', async () => {
  const other = await withSystem(h.database.db, async (tx) => {
    const [org] = await tx.insert(organizations).values({ name: 'Other Plant', slug: 'other-plant-cmd' }).returning();
    const [u] = await tx.insert(users).values({ email: 'boss@other.test', name: 'Other Boss', passwordHash: await hashPassword(PW), emailVerifiedAt: new Date(), defaultOrgId: org!.id }).returning();
    await tx.insert(memberships).values({ orgId: org!.id, userId: u!.id, role: 'admin', allSites: true });
    return org!;
  });
  const boss = await as(h.app, 'boss@other.test');
  const d = (await boss.req('GET', '/api/command/dashboard')).json();
  assert.equal(d.kpis.operators, 0);
  assert.equal(d.kpis.openAlarms, 0);
  assert.equal(d.approvals.inspections + d.approvals.scans, 0);
  assert.equal(d.fleet.glasses.total, 0);
  assert.ok(d.activity.every((a: { actorUserId: string | null }) => !Object.values(h.demo.users).includes(a.actorUserId ?? '')));
  const ops = (await boss.req('GET', '/api/command/operators')).json().operators as { userId: string }[];
  assert.deepEqual(ops.map((o) => o.userId).filter((x) => Object.values(h.demo.users).includes(x)), []);
  assert.equal((await boss.req('GET', `/api/command/operators/${h.demo.users.operator}`)).statusCode, 404);
  assert.equal((await boss.req('POST', `/api/command/operators/${h.demo.users.operator}/sessions/revoke`, {})).statusCode, 404);
  const assign = await boss.req('POST', '/api/command/assign', { kind: 'maintenance', userIds: [h.demo.users.operator], title: 'Cross-tenant', siteId: h.demo.siteId });
  assert.equal(assign.statusCode, 400, 'foreign operators are not assignable');
  assert.equal((await boss.req('GET', '/api/command/approvals')).json().inspections.length, 0);
  // Settings are per organization.
  await boss.req('PATCH', '/api/org/settings', { requireDeviceApproval: true });
  const admin = await as(h.app, 'admin');
  assert.equal((await admin.req('GET', '/api/org/settings')).json().settings.requireDeviceApproval, false);
  assert.ok(other.id);
});

test('resend invitation issues a fresh link and retires the old one', async () => {
  const admin = await as(h.app, 'admin');
  const inv = await admin.req('POST', '/api/invitations', { email: 'resend.me@plant.test', role: 'operator', shiftLabel: 'C shift' });
  assert.equal(inv.statusCode, 201, inv.body);
  const first = inv.json().invitationLink as string;
  const list = (await admin.req('GET', '/api/members')).json().invitations as { id: string; email: string }[];
  const id = list.find((i) => i.email === 'resend.me@plant.test')!.id;
  const r = await admin.req('POST', `/api/invitations/${id}/resend`, {});
  assert.equal(r.statusCode, 201, r.body);
  const second = r.json().invitationLink as string;
  assert.ok(second && second !== first);
  const after = (await admin.req('GET', '/api/members')).json().invitations as { email: string; shiftLabel: string | null }[];
  const mine = after.filter((i) => i.email === 'resend.me@plant.test');
  assert.equal(mine.length, 1, 'old invitation revoked');
  assert.equal(mine[0]!.shiftLabel, 'C shift', 'profile carried over');
  const op = await as(h.app, 'operator');
  assert.equal((await op.req('POST', `/api/invitations/${id}/resend`, {})).statusCode, 403);
});
