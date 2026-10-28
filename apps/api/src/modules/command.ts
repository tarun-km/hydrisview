/**
 * Administrator command center (console v2): dashboard aggregates, per-operator statistics and
 * activity, access helpers (password reset, revoke sessions), bulk work assignment to operators or
 * teams (a shift or a site) and organization policy settings.
 *
 * Every route requires `console.access` (administrators only; operators and glasses get 403) and
 * runs inside the caller's tenant transaction, so row-level security keeps it tenant scoped.
 */
import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { MAINTENANCE_PRIORITIES, OPEN_ALARM_STATES } from '@hydris/domain';
import type { Ctx } from '../context';
import { authenticate, tenant } from '../context';
import type { Tx } from '../db/client';
import {
  alarmEvents, assets, auditDocuments, auditEvents, authSessions, authTokens, deviceAssignments, devices, inspectionRoutes, inspections, inspectionTemplates,
  maintenanceActivity, maintenanceTasks, membershipSites, memberships, organizations, sites, users,
} from '../db/schema';
import { badRequest, forbidden, notFound } from '../core/errors';
import { requirePerm, requireSite, siteScope, type Principal } from '../core/principal';
import { audit, notify, sendTemplate } from '../core/services';
import { demoShared } from '../core/demo-shared';
import { randomToken, sha256 } from '../core/crypto';
import { passwordResetMail } from '../core/mail-templates';
import { TTL } from '../config';
import { createInspection } from './inspections';

/** Organization policies. Stored in organizations.settings (jsonb). */
export interface OrgSettings {
  /** New glasses must be approved by an administrator before they can be used (Phase 4 auto-registration). Default off. */
  requireDeviceApproval: boolean;
}
export const DEFAULT_ORG_SETTINGS: OrgSettings = { requireDeviceApproval: false };

/** Effective settings of an organization (defaults applied). Usable from any module / system context. */
export async function orgSettings(tx: Tx, orgId: string): Promise<OrgSettings> {
  const [o] = await tx.select({ settings: organizations.settings }).from(organizations).where(eq(organizations.id, orgId));
  return { ...DEFAULT_ORG_SETTINGS, ...(o?.settings ?? {}) };
}

const OPEN_INSPECTION = ['scheduled', 'in_progress', 'paused', 'rejected'] as const;
const DONE_INSPECTION = ['submitted', 'approved'] as const;
const OPEN_TASK = ['open', 'assigned', 'in_progress', 'on_hold'] as const;
const CONNECTED_MS = 90_000;
const LIVE_FRESH_MS = 10_000;
const ON_SHIFT_MS = 8 * 3600_000;
const SEV_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** Latest glasses snapshot written by POST /device/live (see devices.ts); read-only here, images dropped. */
interface LiveSnap { orgId: string; deviceId: string; screen: string; title: string; updatedAt: string; battery?: number; charging?: boolean; view?: string }

async function liveSnapshots(orgId: string): Promise<Map<string, LiveSnap>> {
  const store = demoShared();
  const ids = (await store.get<string[]>(`live:idx:${orgId}`)) ?? [];
  const snaps = await Promise.all(ids.map((id) => store.get<LiveSnap>(`live:${orgId}:${id}`)));
  return new Map(snaps.filter((s): s is LiveSnap => !!s && s.orgId === orgId).map((s) => [s.deviceId, s]));
}

const maxDate = (...ds: (Date | string | null | undefined)[]) => {
  const t = ds.map((d) => (d ? new Date(d).getTime() : 0)).reduce((a, b) => Math.max(a, b), 0);
  return t ? new Date(t) : null;
};

const startOfDay = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

export async function commandRoutes(app: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: authenticate(ctx) };
  const admin = (p: Principal) => requirePerm(p, 'console.access');

  /** Fleet rows (non-revoked devices) with owner, connectivity and reported battery. */
  async function fleet(tx: Tx, p: Principal, now: Date) {
    const live = await liveSnapshots(p.orgId);
    const rows = await tx.select({
      id: devices.id, name: devices.name, kind: devices.kind, model: devices.model, status: devices.status, firmwareVersion: devices.firmwareVersion, appVersion: devices.appVersion,
      lastSeenAt: devices.lastSeenAt, siteId: devices.siteId, siteName: sites.name, ownerId: deviceAssignments.userId, ownerName: users.name, assignedAt: deviceAssignments.assignedAt, pairedAt: devices.pairedAt,
    }).from(devices).leftJoin(sites, eq(sites.id, devices.siteId))
      .leftJoin(deviceAssignments, and(eq(deviceAssignments.deviceId, devices.id), isNull(deviceAssignments.unassignedAt)))
      .leftJoin(users, eq(users.id, deviceAssignments.userId))
      .where(and(sql`${devices.status} <> 'revoked'`, p.allSites ? undefined : siteScope(p, devices.siteId)))
      .orderBy(asc(devices.name));
    return rows.map((d) => {
      const s = live.get(d.id);
      const streaming = !!s && now.getTime() - Date.parse(s.updatedAt) < LIVE_FRESH_MS;
      const connected = d.status === 'active' && (ctx.liveDevices.has(d.id) || streaming || (!!d.lastSeenAt && now.getTime() - d.lastSeenAt.getTime() < CONNECTED_MS));
      return {
        ...d, owner: d.ownerId ? { id: d.ownerId, name: d.ownerName ?? 'Operator', since: d.assignedAt } : null, connected, streaming,
        battery: s?.battery ?? null, charging: s?.charging ?? null, screen: streaming ? { screen: s!.screen, title: s!.title, updatedAt: s!.updatedAt } : null,
      };
    });
  }

  /** Per-operator statistics (active and suspended members; removed members are history only). */
  async function operatorStats(tx: Tx, p: Principal, now: Date, userIds?: string[]) {
    const weekAgo = new Date(now.getTime() - 7 * 24 * 3600_000);
    const day0 = startOfDay(now);
    const day1 = new Date(day0.getTime() + 24 * 3600_000);
    const members = await tx.select({
      userId: users.id, name: users.name, email: users.email, role: memberships.role, status: memberships.status, shiftLabel: memberships.shiftLabel, employeeId: memberships.employeeId,
      allSites: memberships.allSites, membershipId: memberships.id, lastLoginAt: users.lastLoginAt,
    }).from(memberships).innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.orgId, p.orgId), userIds ? inArray(users.id, userIds.length ? userIds : ['00000000-0000-0000-0000-000000000000']) : sql`${memberships.status} <> 'removed'`));
    const ids = members.map((m) => m.userId);
    const none = ['00000000-0000-0000-0000-000000000000'];
    const idList = ids.length ? ids : none;
    const insp = await tx.select({
      userId: inspections.assignedTo,
      weekAssigned: sql<number>`count(*) filter (where ${inspections.createdAt} >= ${weekAgo} or (${inspections.dueAt} >= ${weekAgo} and ${inspections.dueAt} < ${day1}) or ${inspections.submittedAt} >= ${weekAgo})::int`,
      weekCompleted: sql<number>`count(*) filter (where ${inspections.status} in ('submitted','approved') and ${inspections.submittedAt} >= ${weekAgo})::int`,
      todayAssigned: sql<number>`count(*) filter (where (${inspections.dueAt} >= ${day0} and ${inspections.dueAt} < ${day1}) or ${inspections.submittedAt} >= ${day0} or (${inspections.status} in ('scheduled','in_progress','paused','rejected') and (${inspections.dueAt} is null or ${inspections.dueAt} < ${day1})))::int`,
      todayCompleted: sql<number>`count(*) filter (where ${inspections.status} in ('submitted','approved') and ${inspections.submittedAt} >= ${day0})::int`,
      open: sql<number>`count(*) filter (where ${inspections.status} in ('scheduled','in_progress','paused','rejected'))::int`,
      overdue: sql<number>`count(*) filter (where ${inspections.status} in ('scheduled','in_progress','paused','rejected') and ${inspections.dueAt} < ${now})::int`,
    }).from(inspections).where(and(inArray(inspections.assignedTo, idList), siteScope(p, inspections.siteId))).groupBy(inspections.assignedTo);
    const tasks = await tx.select({ userId: maintenanceTasks.assignedTo, open: sql<number>`count(*)::int` }).from(maintenanceTasks)
      .where(and(inArray(maintenanceTasks.assignedTo, idList), inArray(maintenanceTasks.status, [...OPEN_TASK]), siteScope(p, maintenanceTasks.siteId))).groupBy(maintenanceTasks.assignedTo);
    const alarms = await tx.select({ userId: alarmEvents.assignedTo, open: sql<number>`count(*)::int` }).from(alarmEvents)
      .where(and(inArray(alarmEvents.assignedTo, idList), inArray(alarmEvents.state, [...OPEN_ALARM_STATES]), siteScope(p, alarmEvents.siteId))).groupBy(alarmEvents.assignedTo);
    const scans = await tx.select({ userId: auditDocuments.capturedBy, week: sql<number>`count(*) filter (where ${auditDocuments.createdAt} >= ${weekAgo})::int`, total: sql<number>`count(*)::int` })
      .from(auditDocuments).where(inArray(auditDocuments.capturedBy, idList)).groupBy(auditDocuments.capturedBy);
    const lastAudit = await tx.select({ userId: auditEvents.actorUserId, at: sql<Date>`max(${auditEvents.at})` }).from(auditEvents)
      .where(inArray(auditEvents.actorUserId, idList)).groupBy(auditEvents.actorUserId);
    const siteRows = await tx.select({ membershipId: membershipSites.membershipId, siteId: membershipSites.siteId, name: sites.name }).from(membershipSites)
      .innerJoin(sites, eq(sites.id, membershipSites.siteId)).where(inArray(membershipSites.membershipId, members.length ? members.map((m) => m.membershipId) : none));
    const devs = await fleet(tx, p, now);
    const by = <T extends { userId: string | null }>(xs: T[]) => new Map(xs.filter((x) => x.userId).map((x) => [x.userId!, x]));
    const iMap = by(insp), tMap = by(tasks), aMap = by(alarms), sMap = by(scans), lMap = by(lastAudit);
    return members.map((m) => {
      const own = devs.filter((d) => d.owner?.id === m.userId);
      const i = iMap.get(m.userId);
      const lastActiveAt = maxDate(m.lastLoginAt, lMap.get(m.userId)?.at, ...own.map((d) => d.lastSeenAt), ...own.map((d) => d.screen?.updatedAt));
      return {
        userId: m.userId, name: m.name, email: m.email, role: m.role, status: m.status, shiftLabel: m.shiftLabel, employeeId: m.employeeId, allSites: m.allSites,
        sites: siteRows.filter((s) => s.membershipId === m.membershipId).map((s) => ({ id: s.siteId, name: s.name })),
        devices: own.map((d) => ({ id: d.id, name: d.name, kind: d.kind, connected: d.connected, streaming: d.streaming, battery: d.battery, lastSeenAt: d.lastSeenAt, screen: d.screen })),
        lastActiveAt,
        rounds: { weekAssigned: i?.weekAssigned ?? 0, weekCompleted: i?.weekCompleted ?? 0, todayAssigned: i?.todayAssigned ?? 0, todayCompleted: i?.todayCompleted ?? 0, open: i?.open ?? 0, overdue: i?.overdue ?? 0 },
        openTasks: tMap.get(m.userId)?.open ?? 0,
        openAlarms: aMap.get(m.userId)?.open ?? 0,
        scans: { week: sMap.get(m.userId)?.week ?? 0, total: sMap.get(m.userId)?.total ?? 0 },
      };
    });
  }

  // ================= Dashboard =================
  app.get('/command/dashboard', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    admin(p);
    const now = new Date();
    const stats = (await operatorStats(tx, p, now)).filter((m) => m.status === 'active');
    const operators = stats.filter((m) => m.role === 'operator');
    const ids = operators.map((o) => o.userId);
    const idList = ids.length ? ids : ['00000000-0000-0000-0000-000000000000'];

    // Current work per operator: in-progress inspection, else in-progress task, else the next due inspection.
    const active = await tx.select({ id: inspections.id, title: inspections.title, status: inspections.status, userId: inspections.assignedTo, dueAt: inspections.dueAt, startedAt: inspections.startedAt })
      .from(inspections).where(and(inArray(inspections.assignedTo, idList), inArray(inspections.status, [...OPEN_INSPECTION]), siteScope(p, inspections.siteId)))
      .orderBy(sql`case ${inspections.status} when 'in_progress' then 0 when 'paused' then 1 else 2 end`, asc(inspections.dueAt));
    const work = await tx.select({ id: maintenanceTasks.id, title: maintenanceTasks.title, userId: maintenanceTasks.assignedTo }).from(maintenanceTasks)
      .where(and(inArray(maintenanceTasks.assignedTo, idList), eq(maintenanceTasks.status, 'in_progress'), siteScope(p, maintenanceTasks.siteId)));
    const openAlarmRows = await tx.select({
      id: alarmEvents.id, title: alarmEvents.title, severity: alarmEvents.severity, state: alarmEvents.state, triggeredAt: alarmEvents.triggeredAt, synthetic: alarmEvents.synthetic,
      assignedTo: alarmEvents.assignedTo, acknowledgedBy: alarmEvents.acknowledgedBy, siteName: sites.name, assetTag: assets.tag,
    }).from(alarmEvents).innerJoin(sites, eq(sites.id, alarmEvents.siteId)).leftJoin(assets, eq(assets.id, alarmEvents.assetId))
      .where(and(inArray(alarmEvents.state, [...OPEN_ALARM_STATES]), siteScope(p, alarmEvents.siteId)))
      .orderBy(sql`case ${alarmEvents.severity} when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end`, desc(alarmEvents.triggeredAt)).limit(200);
    const ownerIds = [...new Set(openAlarmRows.flatMap((a) => [a.assignedTo ?? a.acknowledgedBy]).filter((x): x is string => !!x))];
    const owners = new Map(ownerIds.length ? (await tx.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ownerIds))).map((u) => [u.id, u.name]) : []);

    const onShift = operators.map((o) => {
      const connected = o.devices.some((d) => d.connected);
      const cur = active.find((i) => i.userId === o.userId && (i.status === 'in_progress' || i.status === 'paused'));
      const task = work.find((t) => t.userId === o.userId);
      const next = active.find((i) => i.userId === o.userId);
      const alarm = openAlarmRows.filter((a) => a.assignedTo === o.userId).sort((a, b) => SEV_RANK[a.severity]! - SEV_RANK[b.severity]!)[0];
      const recent = !!o.lastActiveAt && now.getTime() - o.lastActiveAt.getTime() < ON_SHIFT_MS;
      const glasses = o.devices.find((d) => d.streaming) ?? o.devices.find((d) => d.connected) ?? o.devices[0] ?? null;
      return {
        ...o, connected, onShift: connected || recent || !!cur || !!task, glasses,
        current: cur ? { kind: 'inspection' as const, id: cur.id, title: cur.title, status: cur.status }
          : task ? { kind: 'maintenance' as const, id: task.id, title: task.title, status: 'in_progress' }
          : next ? { kind: 'inspection' as const, id: next.id, title: next.title, status: next.status, dueAt: next.dueAt } : null,
        alarm: alarm ? { id: alarm.id, title: alarm.title, severity: alarm.severity, state: alarm.state } : null,
      };
    }).sort((a, b) => Number(b.connected) - Number(a.connected) || Number(b.onShift) - Number(a.onShift) || (b.lastActiveAt?.getTime() ?? 0) - (a.lastActiveAt?.getTime() ?? 0));

    const devs = await fleet(tx, p, now);
    const glasses = devs.filter((d) => d.status === 'active');
    const batteries = glasses.map((d) => d.battery).filter((b): b is number => typeof b === 'number');

    const [approvals] = await tx.select({
      inspections: sql<number>`(select count(*)::int from inspections i where i.status = 'submitted')`,
      scans: sql<number>`(select count(*)::int from audit_documents d where d.status in ('in_review','verified'))`,
      scansVerified: sql<number>`(select count(*)::int from audit_documents d where d.status = 'verified')`,
    }).from(organizations).where(eq(organizations.id, p.orgId));
    const approvalItems = [
      ...(await tx.select({ id: inspections.id, title: inspections.title, at: inspections.submittedAt, by: users.name }).from(inspections).leftJoin(users, eq(users.id, inspections.assignedTo))
        .where(and(eq(inspections.status, 'submitted'), siteScope(p, inspections.siteId))).orderBy(asc(inspections.submittedAt)).limit(6)).map((r) => ({ kind: 'inspection' as const, ...r })),
      ...(await tx.select({ id: auditDocuments.id, title: auditDocuments.title, at: auditDocuments.createdAt, by: users.name, status: auditDocuments.status }).from(auditDocuments).leftJoin(users, eq(users.id, auditDocuments.capturedBy))
        .where(inArray(auditDocuments.status, ['in_review', 'verified'])).orderBy(asc(auditDocuments.createdAt)).limit(6)).map((r) => ({ kind: 'scan' as const, ...r })),
    ].sort((a, b) => (a.at ? new Date(a.at).getTime() : 0) - (b.at ? new Date(b.at).getTime() : 0)).slice(0, 6);

    const activity = await tx.select({ id: auditEvents.id, action: auditEvents.action, summary: auditEvents.summary, at: auditEvents.at, actorUserId: auditEvents.actorUserId, actorName: users.name, actorLabel: auditEvents.actorLabel, entityType: auditEvents.entityType, entityId: auditEvents.entityId })
      .from(auditEvents).leftJoin(users, eq(users.id, auditEvents.actorUserId))
      .where(and(sql`${auditEvents.action} not like '%failed%'`, sql`${auditEvents.action} not like 'auth.%'`))
      .orderBy(desc(auditEvents.at)).limit(14);

    const roundsTotal = operators.reduce((a, o) => ({ assigned: a.assigned + o.rounds.todayAssigned, completed: a.completed + o.rounds.todayCompleted }), { assigned: 0, completed: 0 });
    return {
      generatedAt: now.toISOString(),
      kpis: {
        onShift: onShift.filter((o) => o.onShift).length, operators: operators.length,
        openAlarms: openAlarmRows.length, criticalAlarms: openAlarmRows.filter((a) => a.severity === 'critical').length,
        unownedAlarms: openAlarmRows.filter((a) => !a.assignedTo && !a.acknowledgedBy).length,
        roundsAssigned: roundsTotal.assigned, roundsCompleted: roundsTotal.completed,
        approvals: (approvals?.inspections ?? 0) + (approvals?.scans ?? 0),
      },
      onShift,
      alarms: openAlarmRows.slice(0, 8).map((a) => {
        const ownerId = a.assignedTo ?? a.acknowledgedBy;
        return { ...a, owner: ownerId ? { id: ownerId, name: owners.get(ownerId) ?? 'Member', via: a.assignedTo ? 'assigned' : 'acknowledged' } : null };
      }),
      rounds: operators.filter((o) => o.rounds.todayAssigned > 0).map((o) => ({ userId: o.userId, name: o.name, assigned: o.rounds.todayAssigned, completed: o.rounds.todayCompleted, overdue: o.rounds.overdue }))
        .sort((a, b) => b.assigned - a.assigned),
      approvals: { inspections: approvals?.inspections ?? 0, scans: approvals?.scans ?? 0, scansVerified: approvals?.scansVerified ?? 0, items: approvalItems },
      fleet: {
        glasses: { total: glasses.length, connected: glasses.filter((d) => d.connected).length, streaming: glasses.filter((d) => d.streaming).length, unassigned: glasses.filter((d) => !d.owner).length },
        suspended: devs.filter((d) => d.status === 'suspended').length,
        battery: { reported: batteries.length, average: batteries.length ? Math.round(batteries.reduce((a, b) => a + b, 0) / batteries.length) : null, low: batteries.filter((b) => b < 20).length },
      },
      activity,
    };
  }));

  // ================= Operators =================
  app.get('/command/operators', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    admin(p);
    return { operators: await operatorStats(tx, p, new Date()) };
  }));

  app.get('/command/operators/:userId', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    admin(p);
    const { userId } = z.object({ userId: z.uuid() }).parse(req.params);
    const [m] = await tx.select({ id: memberships.id }).from(memberships).where(eq(memberships.userId, userId));
    if (!m) throw notFound('Member');
    const now = new Date();
    const [stats] = await operatorStats(tx, p, now, [userId]);
    // Timeline: what they did, and what was done to their account or their glasses.
    const timeline = await tx.select({ id: auditEvents.id, action: auditEvents.action, summary: auditEvents.summary, at: auditEvents.at, actorUserId: auditEvents.actorUserId, actorName: users.name, actorLabel: auditEvents.actorLabel, entityType: auditEvents.entityType, entityId: auditEvents.entityId })
      .from(auditEvents).leftJoin(users, eq(users.id, auditEvents.actorUserId))
      .where(or(eq(auditEvents.actorUserId, userId), and(eq(auditEvents.entityType, 'membership'), eq(auditEvents.entityId, m.id)), sql`${auditEvents.metadata}->>'userId' = ${userId}`, sql`${auditEvents.metadata}->>'to' = ${userId}`, sql`${auditEvents.metadata}->>'assignedTo' = ${userId}`))
      .orderBy(desc(auditEvents.at)).limit(60);
    const alarmsHandled = await tx.select({ id: alarmEvents.id, title: alarmEvents.title, severity: alarmEvents.severity, state: alarmEvents.state, triggeredAt: alarmEvents.triggeredAt, acknowledgedAt: alarmEvents.acknowledgedAt, resolvedAt: alarmEvents.resolvedAt })
      .from(alarmEvents).where(and(or(eq(alarmEvents.assignedTo, userId), eq(alarmEvents.acknowledgedBy, userId), eq(alarmEvents.resolvedBy, userId), eq(alarmEvents.closedBy, userId)), siteScope(p, alarmEvents.siteId)))
      .orderBy(desc(alarmEvents.triggeredAt)).limit(20);
    const scans = await tx.select({ id: auditDocuments.id, title: auditDocuments.title, status: auditDocuments.status, createdAt: auditDocuments.createdAt, pageCount: auditDocuments.pageCount, capturedVia: auditDocuments.capturedVia })
      .from(auditDocuments).where(eq(auditDocuments.capturedBy, userId)).orderBy(desc(auditDocuments.createdAt)).limit(20);
    const sessions = await tx.select({ id: authSessions.familyId, createdAt: authSessions.createdAt, lastUsedAt: authSessions.lastUsedAt, userAgent: authSessions.userAgent, ip: authSessions.ip })
      .from(authSessions).where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt), isNull(authSessions.rotatedAt), sql`${authSessions.expiresAt} > now()`))
      .orderBy(desc(authSessions.createdAt));
    return { stats, timeline, alarmsHandled, scans, sessions };
  }));

  /** Load a member the administrator may act on (never themselves). */
  async function target(tx: Tx, p: Principal, userId: string) {
    if (userId === p.userId) throw forbidden('Use Account & security for your own account');
    const [m] = await tx.select({ id: memberships.id, status: memberships.status, role: memberships.role, email: users.email, name: users.name, supabaseUserId: users.supabaseUserId })
      .from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(eq(memberships.userId, userId));
    if (!m) throw notFound('Member');
    return m;
  }

  /** "Reset access": email the member a password-reset link (Supabase or built-in auth). */
  app.post('/command/operators/:userId/reset-access', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    admin(p);
    requirePerm(p, 'member.manage');
    const { userId } = z.object({ userId: z.uuid() }).parse(req.params);
    const m = await target(tx, p, userId);
    if (m.status !== 'active') throw badRequest('member_not_active', 'Only active members can reset their password');
    let delivery: 'supabase' | 'outbox';
    if (ctx.supabase) {
      await ctx.supabase.recover(m.email, `${ctx.config.PUBLIC_APP_URL}/auth/callback?flow=recovery`);
      delivery = 'supabase';
    } else {
      const raw = randomToken();
      await tx.insert(authTokens).values({ purpose: 'password_reset', userId, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + TTL.resetMs) });
      await sendTemplate(tx, m.email, passwordResetMail({ url: `${ctx.config.PUBLIC_APP_URL}/reset-password?token=${raw}` }));
      delivery = 'outbox';
    }
    await audit(tx, p, { orgId: p.orgId, action: 'member.access_reset', entityType: 'membership', entityId: m.id, summary: m.email, metadata: { userId, delivery }, ip: req.ip });
    return { ok: true, delivery };
  }));

  /** Sign the member out everywhere (web and app sessions); their glasses stay paired. */
  app.post('/command/operators/:userId/sessions/revoke', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    admin(p);
    requirePerm(p, 'member.manage');
    const { userId } = z.object({ userId: z.uuid() }).parse(req.params);
    const m = await target(tx, p, userId);
    const revoked = (await tx.update(authSessions).set({ revokedAt: new Date() })
      .where(and(eq(authSessions.userId, userId), or(eq(authSessions.orgId, p.orgId), isNull(authSessions.orgId)), isNull(authSessions.revokedAt))).returning({ id: authSessions.id })).length;
    await audit(tx, p, { orgId: p.orgId, action: 'member.sessions_revoked', entityType: 'membership', entityId: m.id, summary: `${m.name}: ${revoked} session(s) ended`, metadata: { userId, revoked }, ip: req.ip });
    ctx.bus.publish({ type: 'session.revoked', orgId: p.orgId, userIds: [userId], payload: { reason: 'admin_revoked' } });
    return { ok: true, revoked };
  }));

  // ================= Work assignment (operators or teams) =================
  const assignSchema = z.object({
    kind: z.enum(['inspection', 'round', 'maintenance']),
    /** Individual operators… */
    userIds: z.array(z.uuid()).max(100).default([]),
    /** …and/or a team: every active operator on this shift and/or with access to this site. */
    team: z.object({ shiftLabel: z.string().trim().min(1).max(60).optional(), siteId: z.uuid().optional() }).optional(),
    dueAt: z.coerce.date().nullable().optional(),
    priority: z.enum(['normal', 'high']).optional(),
    templateId: z.uuid().optional(), assetId: z.uuid().nullable().optional(), siteId: z.uuid().optional(),
    routeId: z.uuid().optional(), fallbackTemplateId: z.uuid().optional(),
    title: z.string().trim().min(3).max(160).optional(), description: z.string().max(4000).nullable().optional(),
    taskPriority: z.enum(MAINTENANCE_PRIORITIES).default('medium'), checklist: z.array(z.string().trim().min(1).max(200)).max(40).default([]),
  });

  async function resolveAssignees(tx: Tx, p: Principal, body: z.infer<typeof assignSchema>) {
    const ids = new Set(body.userIds);
    if (body.team && (body.team.shiftLabel || body.team.siteId)) {
      const ops = await tx.select({ userId: memberships.userId, allSites: memberships.allSites, id: memberships.id, shiftLabel: memberships.shiftLabel }).from(memberships)
        .where(and(eq(memberships.role, 'operator'), eq(memberships.status, 'active')));
      const onSite = body.team.siteId ? new Set((await tx.select({ m: membershipSites.membershipId }).from(membershipSites).where(eq(membershipSites.siteId, body.team.siteId))).map((r) => r.m)) : null;
      for (const o of ops) {
        if (body.team.shiftLabel && (o.shiftLabel ?? '').toLowerCase() !== body.team.shiftLabel.toLowerCase()) continue;
        if (onSite && !o.allSites && !onSite.has(o.id)) continue;
        ids.add(o.userId);
      }
    }
    if (!ids.size) throw badRequest('no_assignees', 'Choose at least one operator or a team with active operators');
    if (ids.size > 100) throw badRequest('too_many_assignees', 'Assign to at most 100 people at once');
    const valid = await tx.select({ userId: memberships.userId }).from(memberships).where(and(inArray(memberships.userId, [...ids]), eq(memberships.status, 'active')));
    if (valid.length !== ids.size) throw badRequest('invalid_assignee', 'Every assignee must be an active member');
    return [...ids];
  }

  app.post('/command/assign', auth, async (req, reply) => tenant(ctx, req, async (tx, p) => {
    admin(p);
    const body = assignSchema.parse(req.body);
    const assignees = await resolveAssignees(tx, p, body);
    const created: { userId: string; kind: string; id: string }[] = [];
    if (body.kind === 'inspection') {
      requirePerm(p, 'inspection.manage');
      if (!body.templateId) throw badRequest('template_required', 'Choose an inspection template');
      for (const userId of assignees) {
        const i = await createInspection(ctx, tx, p, { templateId: body.templateId, assetId: body.assetId ?? null, siteId: body.siteId, assignedTo: userId, dueAt: body.dueAt ?? null, priority: body.priority, title: body.title });
        created.push({ userId, kind: 'inspection', id: i.id });
      }
    } else if (body.kind === 'round') {
      requirePerm(p, 'inspection.manage');
      if (!body.routeId) throw badRequest('route_required', 'Choose a round');
      const [route] = await tx.select().from(inspectionRoutes).where(eq(inspectionRoutes.id, body.routeId));
      if (!route) throw notFound('Route');
      requireSite(p, route.siteId, 'Route');
      const templates = await tx.select().from(inspectionTemplates).where(eq(inspectionTemplates.status, 'published'));
      const stops = await tx.select().from(assets).where(inArray(assets.id, route.assetIds.length ? route.assetIds : ['00000000-0000-0000-0000-000000000000']));
      for (const userId of assignees) {
        for (const assetId of route.assetIds) {
          const a = stops.find((s) => s.id === assetId);
          const tpl = a && (templates.find((t) => t.assetType === a.type) ?? templates.find((t) => t.id === body.fallbackTemplateId));
          if (!a || !tpl) continue;
          const i = await createInspection(ctx, tx, p, { templateId: tpl.id, assetId, assignedTo: userId, dueAt: body.dueAt ?? null, routeId: route.id, priority: body.priority });
          created.push({ userId, kind: 'inspection', id: i.id });
        }
      }
      if (!created.length) throw badRequest('no_stops', 'No stop on this round has a published template; choose a fallback template');
    } else {
      requirePerm(p, 'maintenance.manage');
      if (!body.title) throw badRequest('title_required', 'Give the task a title');
      let siteId = body.siteId;
      if (body.assetId) {
        const [a] = await tx.select({ siteId: assets.siteId }).from(assets).where(eq(assets.id, body.assetId));
        if (!a) throw badRequest('invalid_asset');
        siteId = a.siteId;
      }
      if (!siteId) throw badRequest('site_required', 'Choose an asset or site');
      requireSite(p, siteId, 'Site');
      for (const userId of assignees) {
        const [t] = await tx.insert(maintenanceTasks).values({
          orgId: p.orgId, siteId, assetId: body.assetId ?? null, title: body.title, description: body.description ?? null, kind: 'corrective', priority: body.taskPriority,
          assignedTo: userId, status: 'assigned', requestedBy: p.userId, dueAt: body.dueAt ?? null,
          checklist: body.checklist.map((label) => ({ id: randomUUID().slice(0, 8), label, done: false })),
        }).returning();
        await tx.insert(maintenanceActivity).values({ orgId: p.orgId, taskId: t!.id, action: 'created', actorUserId: p.userId });
        await audit(tx, p, { orgId: p.orgId, action: 'maintenance.created', entityType: 'maintenance', entityId: t!.id, summary: t!.title, metadata: { assignedTo: userId } });
        await notify(tx, ctx.bus, { orgId: p.orgId, userIds: [userId], kind: 'maintenance_assigned', title: `Maintenance assigned: ${t!.title}`, link: `/console/maintenance/${t!.id}`, entityType: 'maintenance', entityId: t!.id, severity: t!.priority === 'urgent' ? 'critical' : 'info' });
        ctx.bus.publish({ type: 'maintenance.updated', orgId: p.orgId, siteId, permission: 'maintenance.read', payload: { id: t!.id, status: t!.status } });
        created.push({ userId, kind: 'maintenance', id: t!.id });
      }
    }
    await audit(tx, p, { orgId: p.orgId, action: 'work.assigned', entityType: body.kind, summary: `${created.length} ${body.kind === 'maintenance' ? 'task' : 'inspection'}(s) for ${assignees.length} operator(s)`, metadata: { kind: body.kind, assignees, team: body.team ?? null } });
    return reply.code(201).send({ created: created.length, assignees: assignees.length, items: created });
  }));

  // ================= Approvals queue =================
  app.get('/command/approvals', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    admin(p);
    const insp = await tx.select({ id: inspections.id, title: inspections.title, submittedAt: inspections.submittedAt, submittedVia: inspections.submittedVia, siteName: sites.name, assetTag: assets.tag, by: users.name, byId: inspections.assignedTo, priority: inspections.priority, synthetic: inspections.synthetic })
      .from(inspections).innerJoin(sites, eq(sites.id, inspections.siteId)).leftJoin(assets, eq(assets.id, inspections.assetId)).leftJoin(users, eq(users.id, inspections.assignedTo))
      .where(and(eq(inspections.status, 'submitted'), siteScope(p, inspections.siteId))).orderBy(asc(inspections.submittedAt)).limit(200);
    const docs = await tx.select({ id: auditDocuments.id, title: auditDocuments.title, status: auditDocuments.status, docType: auditDocuments.docType, createdAt: auditDocuments.createdAt, pageCount: auditDocuments.pageCount, capturedVia: auditDocuments.capturedVia, siteId: auditDocuments.siteId, siteName: sites.name, by: users.name, byId: auditDocuments.capturedBy, verifiedAt: auditDocuments.verifiedAt })
      .from(auditDocuments).leftJoin(sites, eq(sites.id, auditDocuments.siteId)).leftJoin(users, eq(users.id, auditDocuments.capturedBy))
      .where(inArray(auditDocuments.status, ['in_review', 'verified'])).orderBy(asc(auditDocuments.createdAt)).limit(200);
    return { inspections: insp, documents: docs.filter((d) => !d.siteId || p.allSites || p.siteIds.includes(d.siteId)) };
  }));

  // ================= Organization settings (policies) =================
  app.get('/org/settings', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    admin(p);
    return { settings: await orgSettings(tx, p.orgId) };
  }));

  app.patch('/org/settings', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    admin(p);
    requirePerm(p, 'org.manage');
    const body = z.object({ requireDeviceApproval: z.boolean().optional() }).strict().parse(req.body ?? {});
    const next = { ...(await orgSettings(tx, p.orgId)), ...body };
    await tx.update(organizations).set({ settings: next, updatedAt: new Date() }).where(eq(organizations.id, p.orgId));
    await audit(tx, p, { orgId: p.orgId, action: 'organization.settings_updated', entityType: 'organization', entityId: p.orgId, metadata: body });
    return { settings: next };
  }));

  // ================= Fleet ownership =================
  app.get('/command/fleet', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    admin(p);
    const now = new Date();
    return { devices: await fleet(tx, p, now), settings: await orgSettings(tx, p.orgId) };
  }));
}

