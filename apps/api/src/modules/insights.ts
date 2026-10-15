import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { MEASURAND_DEFS, OPEN_ALARM_STATES, freshness } from '@hydris/domain';
import type { Ctx } from '../context';
import { authenticate, tenant } from '../context';
import { rows } from '../db/client';
import {
  alarmEvents, assets, auditEvents, deviceAssignments, devices, documents, inspections, maintenanceTasks, memberships, sensors, sites, users,
} from '../db/schema';
import { requirePerm, siteScope } from '../core/principal';
import { audit } from '../core/services';
import { badRequest } from '../core/errors';

const rangeQuery = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional(), siteId: z.uuid().optional() });

export async function insightRoutes(app: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: authenticate(ctx) };

  /** Overview dashboard. Every figure links to a detail view in the console. */
  app.get('/overview', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    const { siteId } = z.object({ siteId: z.uuid().optional() }).parse(req.query);
    const sc = (col: Parameters<typeof siteScope>[1]) => and(siteScope(p, col), siteId ? eq(col, siteId) : undefined);
    const now = new Date();
    const [alarmCounts] = await tx.select({
      active: sql<number>`count(*) filter (where ${alarmEvents.state} = 'active')::int`,
      critical: sql<number>`count(*) filter (where ${alarmEvents.state} in ('active','acknowledged','investigating') and ${alarmEvents.severity} = 'critical')::int`,
      open: sql<number>`count(*) filter (where ${alarmEvents.state} in ('active','acknowledged','investigating'))::int`,
      last24h: sql<number>`count(*) filter (where ${alarmEvents.triggeredAt} > now() - interval '24 hours')::int`,
    }).from(alarmEvents).where(sc(alarmEvents.siteId));
    const [insp] = await tx.select({
      due: sql<number>`count(*) filter (where ${inspections.status} in ('scheduled','in_progress','paused','rejected'))::int`,
      overdue: sql<number>`count(*) filter (where ${inspections.status} in ('scheduled','in_progress','paused','rejected') and ${inspections.dueAt} < now())::int`,
      review: sql<number>`count(*) filter (where ${inspections.status} = 'submitted')::int`,
      done7d: sql<number>`count(*) filter (where ${inspections.status} in ('submitted','approved') and ${inspections.submittedAt} > now() - interval '7 days')::int`,
    }).from(inspections).where(sc(inspections.siteId));
    const [maint] = await tx.select({
      open: sql<number>`count(*) filter (where ${maintenanceTasks.status} in ('open','assigned','in_progress','on_hold'))::int`,
      urgent: sql<number>`count(*) filter (where ${maintenanceTasks.status} in ('open','assigned','in_progress','on_hold') and ${maintenanceTasks.priority} in ('urgent','high'))::int`,
    }).from(maintenanceTasks).where(sc(maintenanceTasks.siteId));
    const deviceRows = await tx.select({ id: devices.id, status: devices.status, lastSeenAt: devices.lastSeenAt }).from(devices).where(p.allSites ? undefined : siteScope(p, devices.siteId));
    const connected = deviceRows.filter((d) => d.status === 'active' && (ctx.liveDevices.has(d.id) || (d.lastSeenAt && now.getTime() - d.lastSeenAt.getTime() < 90_000))).length;
    const activeOperators = (await tx.select({ userId: deviceAssignments.userId }).from(deviceAssignments).innerJoin(devices, eq(devices.id, deviceAssignments.deviceId))
      .where(and(isNull(deviceAssignments.unassignedAt), eq(devices.status, 'active')))).filter((r, i, a) => a.findIndex((x) => x.userId === r.userId) === i).length;

    const siteRows = await tx.select({
      id: sites.id, name: sites.name, code: sites.code,
      assets: sql<number>`(select count(*)::int from assets a where a.site_id = ${sites.id} and a.archived_at is null)`,
      degraded: sql<number>`(select count(*)::int from assets a where a.site_id = ${sites.id} and a.archived_at is null and a.status in ('degraded','down'))`,
      openAlarms: sql<number>`(select count(*)::int from alarm_events e where e.site_id = ${sites.id} and e.state in ('active','acknowledged','investigating'))`,
      criticalAlarms: sql<number>`(select count(*)::int from alarm_events e where e.site_id = ${sites.id} and e.state in ('active','acknowledged','investigating') and e.severity = 'critical')`,
    }).from(sites).where(and(siteScope(p, sites.id), isNull(sites.archivedAt), siteId ? eq(sites.id, siteId) : undefined));

    // Key process metrics: latest values of the most relevant online instruments.
    const keyMeasurands = ['ph', 'dissolved_oxygen', 'turbidity', 'flow_rate', 'tank_level', 'vibration'] as const;
    const metricSensors = await tx.select({ s: sensors, assetTag: assets.tag }).from(sensors).leftJoin(assets, eq(assets.id, sensors.assetId))
      .where(and(sc(sensors.siteId), isNull(sensors.archivedAt), inArray(sensors.measurand, [...keyMeasurands]), eq(sensors.method, 'continuous'))).orderBy(sensors.tag).limit(12);
    const assetHealth = await tx.select({ status: assets.status, n: sql<number>`count(*)::int` }).from(assets).where(and(sc(assets.siteId), isNull(assets.archivedAt))).groupBy(assets.status);
    const recentAlarms = await tx.select({ id: alarmEvents.id, title: alarmEvents.title, severity: alarmEvents.severity, state: alarmEvents.state, triggeredAt: alarmEvents.triggeredAt, assetTag: assets.tag, synthetic: alarmEvents.synthetic })
      .from(alarmEvents).leftJoin(assets, eq(assets.id, alarmEvents.assetId)).where(and(sc(alarmEvents.siteId), inArray(alarmEvents.state, [...OPEN_ALARM_STATES])))
      .orderBy(sql`case ${alarmEvents.severity} when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end`, desc(alarmEvents.triggeredAt)).limit(6);
    const activity = await tx.select({ id: auditEvents.id, action: auditEvents.action, summary: auditEvents.summary, at: auditEvents.at, actorName: users.name, actorLabel: auditEvents.actorLabel })
      .from(auditEvents).leftJoin(users, eq(users.id, auditEvents.actorUserId))
      .where(and(inArray(sql`split_part(${auditEvents.action}, '.', 1)`, ['alarm', 'inspection', 'maintenance', 'device', 'asset']), sql`${auditEvents.action} not like '%failed%'`))
      .orderBy(desc(auditEvents.at)).limit(10);
    const trend = await rows<{ day: string; n: number }>(tx, sql`
      select to_char(d, 'YYYY-MM-DD') as day, coalesce((select count(*)::int from alarm_events e where e.triggered_at >= d and e.triggered_at < d + interval '1 day'
        ${siteId ? sql`and e.site_id = ${siteId}` : sql``}), 0) as n
      from generate_series(date_trunc('day', now()) - interval '13 days', date_trunc('day', now()), interval '1 day') d order by d`);
    return {
      generatedAt: now.toISOString(),
      alarms: alarmCounts, inspections: insp, maintenance: maint,
      devices: { registered: deviceRows.filter((d) => d.status !== 'revoked').length, connected }, activeOperators,
      sites: siteRows, assetHealth,
      metrics: metricSensors.map(({ s, assetTag }) => ({
        id: s.id, tag: s.tag, name: s.name, assetTag, measurand: s.measurand, label: MEASURAND_DEFS[s.measurand].label, unit: s.unit, decimals: MEASURAND_DEFS[s.measurand].decimals,
        value: s.lastValue, ts: s.lastTs, source: s.lastSource, freshness: freshness(s.lastTs, s.expectedIntervalS, now),
      })),
      recentAlarms, activity, alarmTrend: trend,
    };
  }));

  /** Reports with filters; `format=csv` returns an export. */
  app.get('/reports/:kind', auth, async (req, reply) => {
    const { kind } = z.object({ kind: z.enum(['inspections', 'alarms', 'maintenance', 'devices', 'operators']) }).parse(req.params);
    const q = rangeQuery.extend({ format: z.enum(['json', 'csv']).default('json'), severity: z.string().optional(), assetId: z.uuid().optional(), userId: z.uuid().optional() }).parse(req.query);
    const to = q.to ?? new Date();
    const from = q.from ?? new Date(to.getTime() - 30 * 86400_000);
    if (from >= to) throw badRequest('invalid_range');
    const result = await tenant(ctx, req, async (tx, p) => {
      requirePerm(p, q.format === 'csv' ? 'report.export' : 'report.read');
      let rows: Record<string, unknown>[] = [];
      let summary: Record<string, unknown> = {};
      if (kind === 'alarms') {
        rows = await tx.select({ triggeredAt: alarmEvents.triggeredAt, title: alarmEvents.title, severity: alarmEvents.severity, state: alarmEvents.state, asset: assets.tag, acknowledgedAt: alarmEvents.acknowledgedAt, resolvedAt: alarmEvents.resolvedAt, synthetic: alarmEvents.synthetic })
          .from(alarmEvents).leftJoin(assets, eq(assets.id, alarmEvents.assetId))
          .where(and(siteScope(p, alarmEvents.siteId), gte(alarmEvents.triggeredAt, from), lte(alarmEvents.triggeredAt, to), q.siteId ? eq(alarmEvents.siteId, q.siteId) : undefined,
            q.assetId ? eq(alarmEvents.assetId, q.assetId) : undefined, q.severity ? eq(alarmEvents.severity, q.severity as 'critical') : undefined)).orderBy(desc(alarmEvents.triggeredAt)).limit(5000);
        const ackMins = rows.filter((r) => r.acknowledgedAt).map((r) => ((r.acknowledgedAt as Date).getTime() - (r.triggeredAt as Date).getTime()) / 60000);
        summary = {
          total: rows.length, bySeverity: countBy(rows, 'severity'), byAsset: countBy(rows, 'asset'),
          medianMinutesToAcknowledge: ackMins.length ? median(ackMins) : null,
        };
      } else if (kind === 'inspections') {
        rows = await tx.select({ title: inspections.title, status: inspections.status, dueAt: inspections.dueAt, submittedAt: inspections.submittedAt, submittedVia: inspections.submittedVia, assignee: users.name, asset: assets.tag, createdAt: inspections.createdAt })
          .from(inspections).leftJoin(users, eq(users.id, inspections.assignedTo)).leftJoin(assets, eq(assets.id, inspections.assetId))
          .where(and(siteScope(p, inspections.siteId), gte(inspections.createdAt, from), lte(inspections.createdAt, to), q.siteId ? eq(inspections.siteId, q.siteId) : undefined,
            q.userId ? eq(inspections.assignedTo, q.userId) : undefined, q.assetId ? eq(inspections.assetId, q.assetId) : undefined)).orderBy(desc(inspections.createdAt)).limit(5000);
        const closed = rows.filter((r) => r.status === 'submitted' || r.status === 'approved');
        summary = {
          total: rows.length, byStatus: countBy(rows, 'status'),
          completionRate: rows.length ? Math.round((closed.length / rows.length) * 1000) / 10 : null,
          onTimeRate: closed.length ? Math.round((closed.filter((r) => !r.dueAt || (r.submittedAt as Date) <= (r.dueAt as Date)).length / closed.length) * 1000) / 10 : null,
          viaGlasses: closed.filter((r) => r.submittedVia === 'glasses').length, byAssignee: countBy(rows, 'assignee'),
        };
      } else if (kind === 'maintenance') {
        rows = await tx.select({ title: maintenanceTasks.title, kind: maintenanceTasks.kind, priority: maintenanceTasks.priority, status: maintenanceTasks.status, asset: assets.tag, assignee: users.name, createdAt: maintenanceTasks.createdAt, completedAt: maintenanceTasks.completedAt })
          .from(maintenanceTasks).leftJoin(users, eq(users.id, maintenanceTasks.assignedTo)).leftJoin(assets, eq(assets.id, maintenanceTasks.assetId))
          .where(and(siteScope(p, maintenanceTasks.siteId), gte(maintenanceTasks.createdAt, from), lte(maintenanceTasks.createdAt, to), q.siteId ? eq(maintenanceTasks.siteId, q.siteId) : undefined,
            q.assetId ? eq(maintenanceTasks.assetId, q.assetId) : undefined)).orderBy(desc(maintenanceTasks.createdAt)).limit(5000);
        const hrs = rows.filter((r) => r.completedAt).map((r) => ((r.completedAt as Date).getTime() - (r.createdAt as Date).getTime()) / 3600000);
        summary = { total: rows.length, byStatus: countBy(rows, 'status'), byKind: countBy(rows, 'kind'), medianHoursToComplete: hrs.length ? Math.round(median(hrs) * 10) / 10 : null };
      } else if (kind === 'devices') {
        rows = await tx.select({ name: devices.name, kind: devices.kind, status: devices.status, site: sites.name, pairedAt: devices.pairedAt, lastSeenAt: devices.lastSeenAt })
          .from(devices).leftJoin(sites, eq(sites.id, devices.siteId)).where(p.allSites ? undefined : siteScope(p, devices.siteId)).orderBy(devices.name);
        const seenInRange = rows.filter((r) => r.lastSeenAt && (r.lastSeenAt as Date) >= from).length;
        summary = { total: rows.length, byStatus: countBy(rows, 'status'), usedInPeriod: seenInRange };
      } else {
        rows = await tx.select({ name: users.name, role: memberships.role, status: memberships.status,
          inspectionsDone: sql<number>`(select count(*)::int from inspections i where i.assigned_to = ${users.id} and i.submitted_at between ${from} and ${to})`,
          tasksDone: sql<number>`(select count(*)::int from maintenance_tasks t where t.assigned_to = ${users.id} and t.completed_at between ${from} and ${to})`,
          alarmsAcknowledged: sql<number>`(select count(*)::int from alarm_events e where e.acknowledged_by = ${users.id} and e.acknowledged_at between ${from} and ${to})`,
        }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).orderBy(users.name);
        summary = { total: rows.length };
      }
      if (q.format === 'csv') await audit(tx, p, { orgId: p.orgId, action: 'report.exported', entityType: 'report', entityId: kind, metadata: { from, to, rows: rows.length } });
      return { rows, summary };
    });
    if (q.format === 'csv') {
      const cols = result.rows.length ? Object.keys(result.rows[0]!) : [];
      const esc = (v: unknown) => {
        const s = v instanceof Date ? v.toISOString() : v === null || v === undefined ? '' : String(v);
        return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : s;
      };
      const csv = [cols.join(','), ...result.rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
      return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="hydris-${kind}-${from.toISOString().slice(0, 10)}.csv"`).send(csv);
    }
    return { kind, from: from.toISOString(), to: to.toISOString(), ...result };
  });

  /**
   * Operator assistance: grounded retrieval only. Returns matching approved documents
   * (with passages), the asset record and current telemetry with timestamps. It never
   * generates procedures and never issues control commands.
   */
  app.get('/assist', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'document.read');
    const q = z.object({ q: z.string().trim().min(2).max(200), assetId: z.uuid().optional() }).parse(req.query);
    const [asset] = q.assetId ? await tx.select().from(assets).where(and(eq(assets.id, q.assetId), siteScope(p, assets.siteId))) : [];
    const docs = await tx.select({
      id: documents.id, title: documents.title, kind: documents.kind, version: documents.version, approvedAt: documents.approvedAt, assetId: documents.assetId,
      rank: sql<number>`ts_rank(to_tsvector('english', ${documents.title} || ' ' || ${documents.body}), websearch_to_tsquery('english', ${q.q}))`,
      passage: sql<string>`ts_headline('english', ${documents.body}, websearch_to_tsquery('english', ${q.q}), 'MaxWords=45, MinWords=15, StartSel=«, StopSel=»')`,
    }).from(documents)
      .where(and(eq(documents.status, 'approved'), or(isNull(documents.siteId), siteScope(p, documents.siteId) ?? sql`true`),
        or(sql`to_tsvector('english', ${documents.title} || ' ' || ${documents.body}) @@ websearch_to_tsquery('english', ${q.q})`, ilike(documents.title, `%${q.q}%`)),
        asset ? or(eq(documents.assetId, asset.id), eq(documents.assetType, asset.type), and(isNull(documents.assetId), isNull(documents.assetType))) : undefined))
      .orderBy(sql`5 desc`).limit(5);
    const telemetry = asset ? (await tx.select().from(sensors).where(and(eq(sensors.assetId, asset.id), isNull(sensors.archivedAt)))).map((s) => ({
      tag: s.tag, label: MEASURAND_DEFS[s.measurand].label, value: s.lastValue, unit: s.unit, observedAt: s.lastTs, freshness: freshness(s.lastTs, s.expectedIntervalS), source: s.lastSource,
      explanation: MEASURAND_DEFS[s.measurand].explanation,
    })) : [];
    const glossary = Object.values(MEASURAND_DEFS).filter((d) => q.q.toLowerCase().includes(d.label.toLowerCase()) || q.q.toLowerCase().includes(d.key.replace('_', ' '))).map((d) => ({ term: d.label, unit: d.unit, explanation: d.explanation }));
    return {
      query: q.q,
      sources: docs.map((d) => ({ ...d, rank: Number(d.rank) })),
      asset: asset ? { id: asset.id, tag: asset.tag, name: asset.name, status: asset.status, manufacturer: asset.manufacturer, model: asset.model } : null,
      telemetry, glossary,
      notice: docs.length
        ? 'Excerpts from approved documents. Follow the full procedure and site permit-to-work rules. Hydris does not control equipment.'
        : 'No approved document matches this question. Ask your supervisor; do not improvise safety-critical steps.',
    };
  }));

  /** Global search for the command palette. */
  app.get('/search', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    const { q } = z.object({ q: z.string().trim().min(1).max(80) }).parse(req.query);
    const like = `%${q}%`;
    const [a, s, d, u] = await Promise.all([
      tx.select({ id: assets.id, label: assets.tag, sub: assets.name }).from(assets).where(and(siteScope(p, assets.siteId), isNull(assets.archivedAt), or(ilike(assets.tag, like), ilike(assets.name, like)))).limit(6),
      tx.select({ id: sensors.id, label: sensors.tag, sub: sensors.name }).from(sensors).where(and(siteScope(p, sensors.siteId), isNull(sensors.archivedAt), or(ilike(sensors.tag, like), ilike(sensors.name, like)))).limit(6),
      tx.select({ id: documents.id, label: documents.title, sub: documents.kind }).from(documents).where(and(ilike(documents.title, like), eq(documents.status, 'approved'))).limit(5),
      tx.select({ id: users.id, label: users.name, sub: memberships.role }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(or(ilike(users.name, like), ilike(users.email, like))).limit(5),
    ]);
    return { assets: a, sensors: s, documents: d, people: u };
  }));
}

function countBy(rows: Record<string, unknown>[], key: string) {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = String(r[key] ?? '—');
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}
function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
