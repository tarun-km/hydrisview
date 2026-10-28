/**
 * Phase 3 Field Operator app: GET /me/profile, /me/shift and /me/work are scoped to the caller's
 * membership sites and assignments; another site's alarms, rounds, tasks and readings never leak,
 * and administrators can use the same endpoints (they use the app for glasses too).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { alarmEvents, inspections, maintenanceTasks, membershipSites, memberships, sensors, sites } from '../src/db/schema.js';
import { withSystem } from '../src/db/tenant.js';
import { demoId } from '../src/seed/ids.js';
import { as, harness, type Harness } from './helpers.js';

let h: Harness;
let otherSite = '';
before(async () => {
  h = await harness();
  // A second site with its own alarm, sensor, round and task, all for the demo operator.
  otherSite = await withSystem(h.database.db, async (tx) => {
    const orgId = h.demo.orgId;
    const [s] = await tx.insert(sites).values({ orgId, name: 'Northgate Pumping Station', code: 'NGS' }).returning();
    await tx.insert(sensors).values({ orgId, siteId: s!.id, tag: 'NGS-PT-1', name: 'Northgate header pressure', measurand: 'pressure', unit: 'bar', lastValue: 2.4, lastTs: new Date() });
    await tx.insert(alarmEvents).values({ orgId, siteId: s!.id, severity: 'critical', condition: 'high', title: 'Northgate overflow', triggeredAt: new Date(), assignedTo: h.demo.users.operator });
    const [seed] = await tx.select().from(inspections).where(eq(inspections.id, demoId('inspection', 'seed-p101')));
    await tx.insert(inspections).values({ ...seed!, id: undefined as never, siteId: s!.id, assetId: null, routeId: null, title: 'Northgate round', createdAt: new Date(), updatedAt: new Date() });
    await tx.insert(maintenanceTasks).values({ orgId, siteId: s!.id, title: 'Northgate valve service', status: 'assigned', assignedTo: h.demo.users.operator, requestedBy: h.demo.users.supervisor });
    return s!.id;
  });
});
after(async () => {
  await h.app.close();
  await h.database.close();
});

async function scopeOperatorTo(siteIds: string[] | 'all') {
  await withSystem(h.database.db, async (tx) => {
    const mid = demoId('membership', 'operator');
    await tx.delete(membershipSites).where(eq(membershipSites.membershipId, mid));
    await tx.update(memberships).set({ allSites: siteIds === 'all' }).where(eq(memberships.id, mid));
    if (siteIds !== 'all') for (const siteId of siteIds) await tx.insert(membershipSites).values({ membershipId: mid, siteId, orgId: h.demo.orgId });
  });
}

test('profile: employee id, phone, shift and sites', async () => {
  await scopeOperatorTo([h.demo.siteId]);
  const op = await as(h.app, 'operator');
  const r = await op.req('GET', '/api/me/profile');
  assert.equal(r.statusCode, 200, r.body);
  const p = r.json().profile;
  assert.equal(p.accountType, 'operator');
  assert.match(p.employeeId, /^RPI-/);
  assert.ok(p.phone);
  assert.match(p.shiftLabel, /shift/);
  assert.deepEqual(p.sites.map((s: { id: string }) => s.id), [h.demo.siteId]);
  assert.ok(Array.isArray(p.glasses));
});

test('shift: rounds, next round, alarms, tasks and plant are limited to my sites', async () => {
  await scopeOperatorTo([h.demo.siteId]);
  const op = await as(h.app, 'operator');
  const r = await op.req('GET', '/api/me/shift');
  assert.equal(r.statusCode, 200, r.body);
  const s = r.json();
  assert.ok(s.progress.assigned >= 2, 'seeded rounds assigned to the operator');
  assert.equal(s.progress.done, 0);
  assert.ok(s.nextRound);
  assert.equal(s.nextRound.mine, true);
  for (const x of s.rounds) assert.equal(x.siteId, h.demo.siteId);
  assert.ok(!s.rounds.some((x: { title: string }) => x.title === 'Northgate round'));
  assert.ok(!s.alarms.items.some((a: { siteId: string }) => a.siteId === otherSite));
  assert.ok(!s.tasks.items.some((t: { siteId: string }) => t.siteId === otherSite));
  assert.ok(s.plant.length > 0);
  assert.ok(s.plant.every((m: { siteId: string }) => m.siteId === h.demo.siteId));
  for (const a of s.alarms.items) assert.ok(Array.isArray(a.allowedActions));

  // Rounds by other operators are not part of my shift.
  assert.ok(!s.rounds.some((x: { assignedTo: string }) => x.assignedTo !== h.demo.users.operator));
});

test('work: mine vs site, and the other site is excluded until it is assigned', async () => {
  await scopeOperatorTo([h.demo.siteId]);
  const op = await as(h.app, 'operator');
  const mine = (await op.req('GET', '/api/me/work?scope=mine')).json();
  const site = (await op.req('GET', '/api/me/work?scope=site')).json();
  assert.equal(mine.scope, 'mine');
  assert.ok(mine.alarms.every((a: { mine: boolean }) => a.mine));
  assert.ok(mine.tasks.every((t: { mine: boolean }) => t.mine));
  assert.ok(site.alarms.length >= mine.alarms.length);
  for (const list of [mine.alarms, mine.inspections, mine.tasks, site.alarms, site.inspections, site.tasks]) {
    assert.ok(!list.some((x: { siteId: string }) => x.siteId === otherSite), 'other site leaked');
  }
  // Operators only see their own rounds even in site scope.
  assert.ok(site.inspections.every((i: { mine: boolean }) => i.mine));

  // Given the second site, its records appear.
  await scopeOperatorTo([h.demo.siteId, otherSite]);
  const both = (await op.req('GET', '/api/me/work?scope=mine')).json();
  assert.ok(both.alarms.some((a: { siteId: string; allowedActions: string[] }) => a.siteId === otherSite && a.allowedActions.includes('acknowledge')));
  assert.ok(both.inspections.some((i: { title: string }) => i.title === 'Northgate round'));
  assert.ok(both.tasks.some((t: { siteId: string; allowedActions: string[] }) => t.siteId === otherSite && t.allowedActions.includes('start')));
  await scopeOperatorTo('all');
});

test('another operator does not see my assignments', async () => {
  const op2 = await as(h.app, 'operator2');
  const w = (await op2.req('GET', '/api/me/work?scope=mine')).json();
  assert.ok(!w.inspections.some((i: { assignedTo: string }) => i.assignedTo === h.demo.users.operator));
  assert.ok(!w.tasks.some((t: { assignedTo: string }) => t.assignedTo === h.demo.users.operator));
});

test('admin can use the operator endpoints (all sites)', async () => {
  const admin = await as(h.app, 'admin');
  const p = (await admin.req('GET', '/api/me/profile')).json().profile;
  assert.equal(p.accountType, 'admin');
  assert.ok(p.sites.some((s: { id: string }) => s.id === otherSite));
  const shift = await admin.req('GET', '/api/me/shift');
  assert.equal(shift.statusCode, 200, shift.body);
  const site = (await admin.req('GET', '/api/me/work?scope=site')).json();
  assert.ok(site.alarms.some((a: { siteId: string }) => a.siteId === otherSite));
  assert.ok(site.alarms.find((a: { allowedActions: string[] }) => a.allowedActions.includes('acknowledge')));
});

test('unauthenticated requests are rejected', async () => {
  const r = await h.app.inject({ method: 'GET', url: '/api/me/shift' });
  assert.equal(r.statusCode, 401);
});
