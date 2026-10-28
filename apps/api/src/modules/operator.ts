import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ALARM_ACTIONS, ALARM_TRANSITIONS, INSPECTION_EDITABLE, OPEN_ALARM_STATES, canTransitionAlarm, canTransitionMaintenance, freshness } from '@hydris/domain';
import type { Ctx } from '../context';
import { authenticate, tenant } from '../context';
import {
  alarmEvents, assets, deviceAssignments, devices, inspectionResponses, inspections, maintenanceTasks, memberships, organizations, sensors, sites, users,
} from '../db/schema';
import type { Tx } from '../db/client';
import { notFound } from '../core/errors';
import { has, requirePerm, siteScope, type Principal } from '../core/principal';

/**
 * Field Operator app ("My shift"): one-call views for the Android app, scoped by the caller's
 * membership sites (membership_sites, or every site when allSites) and their own assignments.
 * Read-only: every write still goes through the regular inspection / alarm / maintenance routes,
 * so permissions, audit and optimistic concurrency stay in one place.
 */
const OPEN_TASK = ['open', 'assigned', 'in_progress', 'on_hold'] as const;
const DONE_INSPECTION = ['submitted', 'approved'] as const;

function startOfDay(tz: string, now = new Date()): Date {
  // Midnight in the organization's timezone, expressed as a UTC instant.
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(now);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
    const offset = asUtc - Math.floor(now.getTime() / 1000) * 1000;
    return new Date(Date.UTC(get('year'), get('month') - 1, get('day')) - offset);
  } catch {
    const d = new Date(now);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }
}

async function profile(tx: Tx, p: Principal) {
  const [row] = await tx.select({ m: memberships, name: users.name, email: users.email, orgName: organizations.name, isDemo: organizations.isDemo, timezone: organizations.timezone })
    .from(memberships).innerJoin(users, eq(users.id, memberships.userId)).innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .where(and(eq(memberships.userId, p.userId), eq(memberships.orgId, p.orgId)));
  if (!row) throw notFound('Membership');
  const siteRows = await tx.select({ id: sites.id, name: sites.name, code: sites.code, city: sites.city }).from(sites)
    .where(siteScope(p, sites.id))
    .orderBy(asc(sites.name));
  const glasses = await tx.select({ id: devices.id, name: devices.name, model: devices.model, status: devices.status, lastSeenAt: devices.lastSeenAt, siteId: devices.siteId, assignedAt: deviceAssignments.assignedAt })
    .from(deviceAssignments).innerJoin(devices, eq(devices.id, deviceAssignments.deviceId))
    .where(and(eq(deviceAssignments.userId, p.userId), isNull(deviceAssignments.unassignedAt), inArray(devices.status, ['active', 'suspended'])))
    .orderBy(desc(deviceAssignments.assignedAt));
  return {
    user: { id: p.userId, name: row.name, email: row.email },
    accountType: p.role,
    org: { id: p.orgId, name: row.orgName, isDemo: row.isDemo, timezone: row.timezone },
    title: row.m.title, employeeId: row.m.employeeId, phone: row.m.phone, shiftLabel: row.m.shiftLabel,
    allSites: row.m.allSites, sites: siteRows, glasses,
  };
}

function alarmActions(p: Principal, state: string) {
  return ALARM_ACTIONS.filter((a) => canTransitionAlarm(state as never, a) && has(p, ALARM_TRANSITIONS[a].permission));
}

async function myAlarms(tx: Tx, p: Principal, mineOnly: boolean, limit = 100) {
  const rows = await tx.select({ e: alarmEvents, assetTag: assets.tag, assetName: assets.name, sensorTag: sensors.tag, assigneeName: users.name, siteName: sites.name })
    .from(alarmEvents).leftJoin(assets, eq(assets.id, alarmEvents.assetId)).leftJoin(sensors, eq(sensors.id, alarmEvents.sensorId))
    .leftJoin(users, eq(users.id, alarmEvents.assignedTo)).innerJoin(sites, eq(sites.id, alarmEvents.siteId))
    .where(and(siteScope(p, alarmEvents.siteId), inArray(alarmEvents.state, [...OPEN_ALARM_STATES]), mineOnly ? eq(alarmEvents.assignedTo, p.userId) : undefined))
    .orderBy(sql`case ${alarmEvents.severity} when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end`,
      sql`case ${alarmEvents.state} when 'active' then 0 when 'acknowledged' then 1 else 2 end`, desc(alarmEvents.triggeredAt))
    .limit(limit);
  return rows.map((r) => ({
    ...r.e, assetTag: r.assetTag, assetName: r.assetName, sensorTag: r.sensorTag, assigneeName: r.assigneeName, siteName: r.siteName,
    mine: r.e.assignedTo === p.userId, allowedActions: alarmActions(p, r.e.state),
  }));
}

async function myInspections(tx: Tx, p: Principal, mineOnly: boolean, since: Date) {
  const rows = await tx.select({ i: inspections, assetTag: assets.tag, assetName: assets.name, assigneeName: users.name, siteName: sites.name })
    .from(inspections).leftJoin(assets, eq(assets.id, inspections.assetId)).leftJoin(users, eq(users.id, inspections.assignedTo)).innerJoin(sites, eq(sites.id, inspections.siteId))
    .where(and(
      siteScope(p, inspections.siteId),
      mineOnly ? eq(inspections.assignedTo, p.userId) : undefined,
      or(inArray(inspections.status, [...INSPECTION_EDITABLE]), and(inArray(inspections.status, [...DONE_INSPECTION]), gte(inspections.submittedAt, since))),
    ))
    .orderBy(sql`case when ${inspections.status} in ('in_progress','paused') then 0 when ${inspections.status} in ('scheduled','rejected') then 1 else 2 end`, asc(inspections.dueAt), desc(inspections.createdAt))
    .limit(200);
  const ids = rows.map((r) => r.i.id);
  const counts = ids.length ? await tx.select({ id: inspectionResponses.inspectionId, n: sql<number>`count(distinct ${inspectionResponses.stepId})::int` })
    .from(inspectionResponses).where(inArray(inspectionResponses.inspectionId, ids)).groupBy(inspectionResponses.inspectionId) : [];
  const answered = new Map(counts.map((c) => [c.id, Number(c.n)]));
  return rows.map(({ i, ...r }) => ({
    id: i.id, title: i.title, status: i.status, priority: i.priority, dueAt: i.dueAt, siteId: i.siteId, assetId: i.assetId, assignedTo: i.assignedTo,
    startedAt: i.startedAt, submittedAt: i.submittedAt, revision: i.revision, stepCount: i.steps.length, answered: answered.get(i.id) ?? 0,
    mine: i.assignedTo === p.userId, ...r,
  }));
}

async function myTasks(tx: Tx, p: Principal, mineOnly: boolean) {
  const rows = await tx.select({ t: maintenanceTasks, assetTag: assets.tag, assetName: assets.name, assigneeName: users.name, siteName: sites.name })
    .from(maintenanceTasks).leftJoin(assets, eq(assets.id, maintenanceTasks.assetId)).leftJoin(users, eq(users.id, maintenanceTasks.assignedTo)).innerJoin(sites, eq(sites.id, maintenanceTasks.siteId))
    .where(and(siteScope(p, maintenanceTasks.siteId), inArray(maintenanceTasks.status, [...OPEN_TASK]), mineOnly ? eq(maintenanceTasks.assignedTo, p.userId) : undefined))
    .orderBy(sql`case ${maintenanceTasks.status} when 'in_progress' then 0 when 'assigned' then 1 when 'open' then 2 else 3 end`,
      sql`case ${maintenanceTasks.priority} when 'urgent' then 0 when 'high' then 1 when 'medium' then 2 else 3 end`, desc(maintenanceTasks.createdAt))
    .limit(200);
  return rows.map(({ t, ...r }) => {
    const mine = t.assignedTo === p.userId;
    const manage = has(p, 'maintenance.manage');
    const exec = manage || (mine && has(p, 'maintenance.execute'));
    const allowedActions = exec ? (['start', 'hold', 'complete'] as const).filter((a) => canTransitionMaintenance(t.status, a)) : [];
    return { ...t, ...r, mine, allowedActions };
  });
}

async function plant(tx: Tx, p: Principal) {
  const now = new Date();
  const rows = await tx.select({ s: sensors, assetTag: assets.tag, siteName: sites.name,
    openAlarms: sql<number>`(select count(*)::int from alarm_events e where e.sensor_id = ${sensors.id} and e.state in ('active','acknowledged','investigating'))` })
    .from(sensors).leftJoin(assets, eq(assets.id, sensors.assetId)).innerJoin(sites, eq(sites.id, sensors.siteId))
    .where(and(siteScope(p, sensors.siteId), isNull(sensors.archivedAt), eq(sensors.enabled, true)))
    .orderBy(asc(sensors.tag)).limit(60);
  return rows.map((r) => ({
    id: r.s.id, tag: r.s.tag, name: r.s.name, measurand: r.s.measurand, unit: r.s.unit, value: r.s.lastValue, ts: r.s.lastTs, source: r.s.lastSource,
    siteId: r.s.siteId, siteName: r.siteName, assetTag: r.assetTag, openAlarms: Number(r.openAlarms), freshness: freshness(r.s.lastTs, r.s.expectedIntervalS, now),
  }));
}

export async function operatorRoutes(app: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: authenticate(ctx) };

  app.get('/me/profile', auth, async (req) => tenant(ctx, req, async (tx, p) => ({ profile: await profile(tx, p) })));

  /** Home: greeting, shift, progress, next round, my alarms / tasks and plant status for my sites. */
  app.get('/me/shift', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'inspection.read');
    const prof = await profile(tx, p);
    const since = startOfDay(prof.org.timezone);
    const rounds = await myInspections(tx, p, true, since);
    const open = rounds.filter((r) => (INSPECTION_EDITABLE as readonly string[]).includes(r.status));
    const done = rounds.filter((r) => (DONE_INSPECTION as readonly string[]).includes(r.status));
    const alarms = has(p, 'alarm.read') ? await myAlarms(tx, p, false, 50) : [];
    const tasks = has(p, 'maintenance.read') ? await myTasks(tx, p, true) : [];
    return {
      profile: prof,
      generatedAt: new Date().toISOString(),
      dayStartedAt: since.toISOString(),
      progress: { done: done.length, assigned: done.length + open.length, inProgress: open.filter((r) => r.status === 'in_progress' || r.status === 'paused').length,
        overdue: open.filter((r) => r.dueAt && r.dueAt.getTime() < Date.now()).length },
      nextRound: open[0] ?? null,
      rounds,
      alarms: { items: alarms.slice(0, 8), open: alarms.length, mine: alarms.filter((a) => a.mine).length, critical: alarms.filter((a) => a.severity === 'critical').length },
      tasks: { items: tasks.slice(0, 6), open: tasks.length },
      plant: has(p, 'telemetry.read') ? await plant(tx, p) : [],
    };
  }));

  /** Work tab: alarms, rounds and maintenance, either assigned to me ("mine") or everything at my sites ("site"). */
  app.get('/me/work', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    const q = z.object({ scope: z.enum(['mine', 'site']).default('mine') }).parse(req.query);
    const mine = q.scope === 'mine';
    const prof = await profile(tx, p);
    const since = startOfDay(prof.org.timezone);
    // Executors only ever see inspections assigned to them (same rule as GET /inspections).
    const inspectionsMineOnly = mine || (!has(p, 'inspection.manage') && !has(p, 'inspection.review'));
    return {
      scope: q.scope,
      sites: prof.sites,
      alarms: has(p, 'alarm.read') ? await myAlarms(tx, p, mine) : [],
      inspections: has(p, 'inspection.read') ? await myInspections(tx, p, inspectionsMineOnly, since) : [],
      tasks: has(p, 'maintenance.read') ? await myTasks(tx, p, mine) : [],
    };
  }));
}
