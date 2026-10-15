import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, inArray, isNull, lt, or, sql, gte, lte } from 'drizzle-orm';
import { z } from 'zod';
import {
  ALARM_CONDITIONS, ALARM_SEVERITIES, ALARM_STATES, ALARM_TRANSITIONS, ALARM_ACTIONS, OPEN_ALARM_STATES, CONDITION_LABELS,
  canTransitionAlarm, describeBreach, evaluateThreshold, shouldRaise, staleAfterSeconds, type AlarmAction,
} from '@hydris/domain';
import type { Ctx } from '../context';
import { authenticate, tenant } from '../context';
import { alarmEventHistory, alarmEvents, alarmRules, assets, documents, maintenanceTasks, memberships, sensors, users } from '../db/schema';
import { rows, type Tx } from '../db/client';
import { withSystem } from '../db/tenant';
import { badRequest, conflict, notFound } from '../core/errors';
import { has, requirePerm, requireSite, siteScope, type Principal } from '../core/principal';
import { audit, notify } from '../core/services';
import { changes as diffFields, scopedRow } from './plant';

type SensorRow = typeof sensors.$inferSelect;

/** Members who should hear about alarms on a site: anyone holding alarm permissions with access to the site. */
async function alarmAudience(tx: Tx, orgId: string, siteId: string): Promise<string[]> {
  const members = await tx.select({ userId: memberships.userId, role: memberships.role, allSites: memberships.allSites, id: memberships.id })
    .from(memberships).where(and(eq(memberships.orgId, orgId), eq(memberships.status, 'active'),
      inArray(memberships.role, ['org_admin', 'factory_manager', 'supervisor', 'field_operator', 'maintenance_engineer'])));
  const scoped = await rows<{ membership_id: string }>(tx, sql`select membership_id from membership_sites where site_id = ${siteId}`);
  const allowed = new Set(scoped.map((r) => r.membership_id));
  return members.filter((r) => r.allSites || allowed.has(r.id)).map((r) => r.userId);
}

async function raiseAlarm(ctx: Ctx, tx: Tx, sensor: SensorRow, rule: typeof alarmRules.$inferSelect, value: number | null, at: Date, synthetic: boolean) {
  const [asset] = sensor.assetId ? await tx.select({ tag: assets.tag, name: assets.name }).from(assets).where(eq(assets.id, sensor.assetId)) : [];
  const title = `${CONDITION_LABELS[rule.condition]} ${sensor.name}${asset ? ` · ${asset.tag}` : ''}`;
  const [ev] = await tx.insert(alarmEvents).values({
    orgId: sensor.orgId, siteId: sensor.siteId, assetId: sensor.assetId, sensorId: sensor.id, ruleId: rule.id, severity: rule.severity,
    condition: rule.condition, title, description: describeBreach(rule.condition, value, rule.threshold, sensor.unit),
    recommendedAction: rule.recommendedAction, triggerValue: value, threshold: rule.threshold, unit: sensor.unit, peakValue: value, triggeredAt: at, synthetic,
  }).returning();
  await tx.insert(alarmEventHistory).values({ orgId: sensor.orgId, alarmId: ev!.id, action: 'triggered', toState: 'active', note: ev!.description });
  await audit(tx, { label: 'alarm engine' }, { orgId: sensor.orgId, action: 'alarm.triggered', entityType: 'alarm', entityId: ev!.id, summary: title, metadata: { severity: rule.severity, value, synthetic } });
  ctx.bus.publish({ type: 'alarm.created', orgId: sensor.orgId, siteId: sensor.siteId, permission: 'alarm.read', payload: ev });
  if (rule.severity === 'critical' || rule.severity === 'high') {
    await notify(tx, ctx.bus, {
      orgId: sensor.orgId, userIds: await alarmAudience(tx, sensor.orgId, sensor.siteId), kind: 'alarm', severity: rule.severity === 'critical' ? 'critical' : 'warning',
      title, body: ev!.description ?? undefined, link: `/console/alarms/${ev!.id}`, entityType: 'alarm', entityId: ev!.id,
    });
  }
  return ev!;
}

/**
 * Evaluate all enabled threshold rules of a sensor against its newest value.
 * Alarm events are raised once per breach; when the value returns to normal the event
 * is marked `clearedAt` but stays open until people acknowledge and resolve it.
 */
export async function evaluateSensor(ctx: Ctx, tx: Tx, sensor: SensorRow, value: number, at: Date, synthetic: boolean): Promise<number> {
  const rules = await tx.select().from(alarmRules).where(and(eq(alarmRules.sensorId, sensor.id), eq(alarmRules.enabled, true)));
  let raised = 0;
  for (const rule of rules) {
    if (rule.condition === 'stale' || rule.threshold === null) continue;
    const [open] = await tx.select().from(alarmEvents)
      .where(and(eq(alarmEvents.ruleId, rule.id), inArray(alarmEvents.state, [...OPEN_ALARM_STATES]), isNull(alarmEvents.clearedAt)))
      .orderBy(desc(alarmEvents.triggeredAt)).limit(1);
    const result = evaluateThreshold({ condition: rule.condition, threshold: rule.threshold, deadband: rule.deadband }, value, !!open);
    if (result === 'breach') {
      if (open) {
        const worse = rule.condition.startsWith('high') ? value > (open.peakValue ?? -Infinity) : value < (open.peakValue ?? Infinity);
        if (worse) await tx.update(alarmEvents).set({ peakValue: value, updatedAt: new Date() }).where(eq(alarmEvents.id, open.id));
        continue;
      }
      const since = rule.breachSince ?? at;
      if (!rule.breachSince) await tx.update(alarmRules).set({ breachSince: at }).where(eq(alarmRules.id, rule.id));
      if (shouldRaise(since, at, rule.onDelayS)) {
        await raiseAlarm(ctx, tx, sensor, rule, value, at, synthetic);
        await tx.update(alarmRules).set({ breachSince: null }).where(eq(alarmRules.id, rule.id));
        raised++;
      }
    } else if (result === 'normal') {
      if (rule.breachSince) await tx.update(alarmRules).set({ breachSince: null }).where(eq(alarmRules.id, rule.id));
      if (open) {
        await tx.update(alarmEvents).set({ clearedAt: at, updatedAt: new Date() }).where(eq(alarmEvents.id, open.id));
        await tx.insert(alarmEventHistory).values({ orgId: sensor.orgId, alarmId: open.id, action: 'condition_cleared', note: `Value returned to ${value} ${sensor.unit}` });
        ctx.bus.publish({ type: 'alarm.updated', orgId: sensor.orgId, siteId: sensor.siteId, permission: 'alarm.read', payload: { id: open.id, clearedAt: at } });
      }
    }
  }
  return raised;
}

/** Background check for "no fresh data" rules across all tenants. */
export async function evaluateStaleRules(ctx: Ctx, now = new Date()) {
  await withSystem(ctx.db, async (tx) => {
    const rows = await tx.select({ rule: alarmRules, sensor: sensors }).from(alarmRules).innerJoin(sensors, eq(sensors.id, alarmRules.sensorId))
      .where(and(eq(alarmRules.condition, 'stale'), eq(alarmRules.enabled, true), eq(sensors.enabled, true), isNull(sensors.archivedAt)));
    for (const { rule, sensor } of rows) {
      const limitMs = staleAfterSeconds(sensor.expectedIntervalS) * 1000;
      const isStale = !sensor.lastTs || now.getTime() - sensor.lastTs.getTime() > limitMs;
      const [open] = await tx.select().from(alarmEvents).where(and(eq(alarmEvents.ruleId, rule.id), inArray(alarmEvents.state, [...OPEN_ALARM_STATES]), isNull(alarmEvents.clearedAt))).limit(1);
      if (isStale && !open) await raiseAlarm(ctx, tx, sensor, rule, null, now, false);
      if (!isStale && open) {
        await tx.update(alarmEvents).set({ clearedAt: now, updatedAt: new Date() }).where(eq(alarmEvents.id, open.id));
        await tx.insert(alarmEventHistory).values({ orgId: sensor.orgId, alarmId: open.id, action: 'condition_cleared', note: 'Fresh data received' });
        ctx.bus.publish({ type: 'alarm.updated', orgId: sensor.orgId, siteId: sensor.siteId, permission: 'alarm.read', payload: { id: open.id, clearedAt: now } });
      }
    }
  });
}

export async function transitionAlarm(ctx: Ctx, tx: Tx, p: Principal, id: string, action: AlarmAction, note?: string) {
  const t = ALARM_TRANSITIONS[action];
  requirePerm(p, t.permission);
  const [ev] = await tx.select().from(alarmEvents).where(eq(alarmEvents.id, id));
  if (!ev) throw notFound('Alarm');
  requireSite(p, ev.siteId, 'Alarm');
  if (!canTransitionAlarm(ev.state, action)) throw conflict('invalid_transition', `Cannot ${action} an alarm that is ${ev.state}`, { state: ev.state });
  if (t.requiresNote && !note?.trim()) throw badRequest('note_required', 'Describe what was done to resolve the condition');
  const now = new Date();
  const patch: Partial<typeof alarmEvents.$inferInsert> = { state: t.to, updatedAt: now };
  if (action === 'acknowledge') Object.assign(patch, { acknowledgedBy: p.userId, acknowledgedAt: now });
  if (action === 'investigate' && !ev.assignedTo) patch.assignedTo = p.userId;
  if (action === 'resolve') Object.assign(patch, { resolvedBy: p.userId, resolvedAt: now, resolutionNote: note });
  if (action === 'close') Object.assign(patch, { closedBy: p.userId, closedAt: now });
  // Optimistic concurrency: only apply if the state has not changed underneath us.
  const [updated] = await tx.update(alarmEvents).set(patch).where(and(eq(alarmEvents.id, id), eq(alarmEvents.state, ev.state))).returning();
  if (!updated) throw conflict('stale_state', 'The alarm was updated by someone else. Refresh and try again.');
  await tx.insert(alarmEventHistory).values({ orgId: p.orgId, alarmId: id, action, fromState: ev.state, toState: t.to, actorUserId: p.userId, actorDeviceId: p.deviceId, note });
  await audit(tx, p, { orgId: p.orgId, action: `alarm.${action}`, entityType: 'alarm', entityId: id, summary: ev.title, metadata: { from: ev.state, to: t.to, via: p.kind } });
  ctx.bus.publish({ type: 'alarm.updated', orgId: p.orgId, siteId: ev.siteId, permission: 'alarm.read', payload: updated });
  return updated;
}

export async function alarmRoutes(app: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: authenticate(ctx) };
  const idParam = z.object({ id: z.uuid() });

  app.get('/alarms', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'alarm.read');
    const q = z.object({
      state: z.union([z.enum(ALARM_STATES), z.literal('open')]).optional(), severity: z.enum(ALARM_SEVERITIES).optional(),
      siteId: z.uuid().optional(), assetId: z.uuid().optional(), assignedToMe: z.enum(['true', 'false']).optional(),
      from: z.coerce.date().optional(), to: z.coerce.date().optional(), limit: z.coerce.number().int().min(1).max(500).default(200),
    }).parse(req.query);
    const rows = await tx.select({ e: alarmEvents, assetTag: assets.tag, assetName: assets.name, sensorTag: sensors.tag, assigneeName: users.name })
      .from(alarmEvents).leftJoin(assets, eq(assets.id, alarmEvents.assetId)).leftJoin(sensors, eq(sensors.id, alarmEvents.sensorId)).leftJoin(users, eq(users.id, alarmEvents.assignedTo))
      .where(and(
        siteScope(p, alarmEvents.siteId),
        q.state === 'open' ? inArray(alarmEvents.state, [...OPEN_ALARM_STATES]) : q.state ? eq(alarmEvents.state, q.state) : undefined,
        q.severity ? eq(alarmEvents.severity, q.severity) : undefined, q.siteId ? eq(alarmEvents.siteId, q.siteId) : undefined,
        q.assetId ? eq(alarmEvents.assetId, q.assetId) : undefined, q.assignedToMe === 'true' ? eq(alarmEvents.assignedTo, p.userId) : undefined,
        q.from ? gte(alarmEvents.triggeredAt, q.from) : undefined, q.to ? lte(alarmEvents.triggeredAt, q.to) : undefined,
      ))
      .orderBy(sql`case ${alarmEvents.state} when 'active' then 0 when 'acknowledged' then 1 when 'investigating' then 2 else 3 end`,
        sql`case ${alarmEvents.severity} when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end`, desc(alarmEvents.triggeredAt))
      .limit(q.limit);
    return { alarms: rows.map((r) => ({ ...r.e, assetTag: r.assetTag, assetName: r.assetName, sensorTag: r.sensorTag, assigneeName: r.assigneeName })) };
  }));

  app.get('/alarms/:id', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'alarm.read');
    const { id } = idParam.parse(req.params);
    const [row] = await tx.select({ e: alarmEvents, assetTag: assets.tag, assetName: assets.name, sensorTag: sensors.tag, sensorName: sensors.name, measurand: sensors.measurand })
      .from(alarmEvents).leftJoin(assets, eq(assets.id, alarmEvents.assetId)).leftJoin(sensors, eq(sensors.id, alarmEvents.sensorId)).where(eq(alarmEvents.id, id));
    if (!row) throw notFound('Alarm');
    requireSite(p, row.e.siteId, 'Alarm');
    const history = await tx.select({ h: alarmEventHistory, actorName: users.name }).from(alarmEventHistory).leftJoin(users, eq(users.id, alarmEventHistory.actorUserId))
      .where(eq(alarmEventHistory.alarmId, id)).orderBy(asc(alarmEventHistory.at));
    const [rule] = row.e.ruleId ? await tx.select().from(alarmRules).where(eq(alarmRules.id, row.e.ruleId)) : [];
    const [procedure] = rule?.procedureDocumentId ? await tx.select({ id: documents.id, title: documents.title }).from(documents).where(eq(documents.id, rule.procedureDocumentId)) : [];
    const followUps = await tx.select({ id: maintenanceTasks.id, title: maintenanceTasks.title, status: maintenanceTasks.status }).from(maintenanceTasks).where(eq(maintenanceTasks.sourceAlarmId, id));
    const [assignee] = row.e.assignedTo ? await tx.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, row.e.assignedTo)) : [];
    const allowed = ALARM_ACTIONS.filter((a) => canTransitionAlarm(row.e.state, a) && has(p, ALARM_TRANSITIONS[a].permission));
    return {
      alarm: { ...row.e, assetTag: row.assetTag, assetName: row.assetName, sensorTag: row.sensorTag, sensorName: row.sensorName, measurand: row.measurand },
      history: history.map((h) => ({ ...h.h, actorName: h.actorName ?? (h.h.actorUserId ? null : 'Hydris') })),
      rule: rule ?? null, procedure: procedure ?? null, followUps, assignee: assignee ?? null,
      allowedActions: allowed, canAssign: has(p, 'alarm.assign'),
    };
  }));

  app.post('/alarms/:id/:action', auth, async (req) => {
    const { id, action } = z.object({ id: z.uuid(), action: z.enum(ALARM_ACTIONS) }).parse(req.params);
    const { note } = z.object({ note: z.string().trim().max(2000).optional() }).parse(req.body ?? {});
    return tenant(ctx, req, async (tx, p) => ({ alarm: await transitionAlarm(ctx, tx, p, id, action, note) }));
  });

  app.post('/alarms/:id/assign', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'alarm.assign');
    const { id } = idParam.parse(req.params);
    const { userId, note } = z.object({ userId: z.uuid().nullable(), note: z.string().max(500).optional() }).parse(req.body);
    const [ev] = await tx.select().from(alarmEvents).where(eq(alarmEvents.id, id));
    if (!ev) throw notFound('Alarm');
    requireSite(p, ev.siteId, 'Alarm');
    if (ev.state === 'closed') throw conflict('invalid_transition', 'Closed alarms cannot be reassigned');
    if (userId) {
      const [m] = await tx.select().from(memberships).where(and(eq(memberships.userId, userId), eq(memberships.status, 'active')));
      if (!m) throw badRequest('invalid_assignee', 'Assignee must be an active member');
    }
    const [u] = await tx.update(alarmEvents).set({ assignedTo: userId, updatedAt: new Date() }).where(eq(alarmEvents.id, id)).returning();
    await tx.insert(alarmEventHistory).values({ orgId: p.orgId, alarmId: id, action: 'assigned', actorUserId: p.userId, note: note ?? null });
    await audit(tx, p, { orgId: p.orgId, action: 'alarm.assigned', entityType: 'alarm', entityId: id, metadata: { userId } });
    if (userId) await notify(tx, ctx.bus, { orgId: p.orgId, userIds: [userId], kind: 'alarm_assigned', severity: 'warning', title: `Alarm assigned to you: ${ev.title}`, link: `/console/alarms/${id}`, entityType: 'alarm', entityId: id });
    ctx.bus.publish({ type: 'alarm.updated', orgId: p.orgId, siteId: ev.siteId, permission: 'alarm.read', payload: u });
    return { alarm: u };
  }));

  app.post('/alarms/:id/notes', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'alarm.acknowledge');
    const { id } = idParam.parse(req.params);
    const { note } = z.object({ note: z.string().trim().min(1).max(2000) }).parse(req.body);
    const [ev] = await tx.select({ siteId: alarmEvents.siteId }).from(alarmEvents).where(eq(alarmEvents.id, id));
    if (!ev) throw notFound('Alarm');
    requireSite(p, ev.siteId, 'Alarm');
    await tx.insert(alarmEventHistory).values({ orgId: p.orgId, alarmId: id, action: 'note', actorUserId: p.userId, actorDeviceId: p.deviceId, note });
    return { ok: true };
  }));

  // ---------------- Alarm rules (thresholds) ----------------
  const ruleBody = z.object({
    sensorId: z.uuid(), name: z.string().trim().min(2).max(120), condition: z.enum(ALARM_CONDITIONS), threshold: z.number().finite().nullable().optional(),
    deadband: z.number().min(0).optional(), onDelayS: z.number().int().min(0).max(86400).optional(), severity: z.enum(ALARM_SEVERITIES),
    enabled: z.boolean().optional(), recommendedAction: z.string().trim().max(1000).nullable().optional(), procedureDocumentId: z.uuid().nullable().optional(),
  });

  app.get('/alarm-rules', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'alarm.read');
    const q = z.object({ sensorId: z.uuid().optional(), siteId: z.uuid().optional() }).parse(req.query);
    const rows = await tx.select({ r: alarmRules, sensorTag: sensors.tag, sensorName: sensors.name, unit: sensors.unit, assetTag: assets.tag })
      .from(alarmRules).innerJoin(sensors, eq(sensors.id, alarmRules.sensorId)).leftJoin(assets, eq(assets.id, sensors.assetId))
      .where(and(siteScope(p, alarmRules.siteId), q.sensorId ? eq(alarmRules.sensorId, q.sensorId) : undefined, q.siteId ? eq(alarmRules.siteId, q.siteId) : undefined))
      .orderBy(asc(sensors.tag), asc(alarmRules.condition));
    return { rules: rows.map((r) => ({ ...r.r, sensorTag: r.sensorTag, sensorName: r.sensorName, unit: r.unit, assetTag: r.assetTag })) };
  }));

  app.post('/alarm-rules', auth, async (req, reply) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'alarm_rule.manage');
    const body = ruleBody.parse(req.body);
    if (body.condition !== 'stale' && (body.threshold === null || body.threshold === undefined)) throw badRequest('threshold_required', 'Threshold rules need a threshold value');
    const sensor = await scopedRow(tx, sensors, body.sensorId, p, 'Sensor');
    const [r] = await tx.insert(alarmRules).values({ ...body, orgId: p.orgId, siteId: sensor.siteId, createdBy: p.userId }).returning();
    await audit(tx, p, { orgId: p.orgId, action: 'alarm_rule.created', entityType: 'alarm_rule', entityId: r!.id, summary: `${sensor.tag} ${body.condition} ${body.threshold ?? ''}` });
    await audit(tx, p, { orgId: p.orgId, action: 'sensor.threshold_added', entityType: 'sensor', entityId: sensor.id, summary: `${r!.name}: ${body.condition} ${body.threshold ?? ''}`, metadata: { ruleId: r!.id } });
    return reply.code(201).send({ rule: r });
  }));

  app.patch('/alarm-rules/:id', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'alarm_rule.manage');
    const { id } = idParam.parse(req.params);
    const body = ruleBody.omit({ sensorId: true }).partial().parse(req.body);
    const [cur] = await tx.select().from(alarmRules).where(eq(alarmRules.id, id));
    if (!cur) throw notFound('Rule');
    requireSite(p, cur.siteId, 'Rule');
    const condition = body.condition ?? cur.condition;
    const threshold = body.threshold === undefined ? cur.threshold : body.threshold;
    if (condition !== 'stale' && (threshold === null || threshold === undefined)) {
      throw badRequest('validation_failed', 'Threshold rules need a threshold value', [{ path: 'threshold', message: 'Enter a threshold' }]);
    }
    if (body.procedureDocumentId) {
      const [d] = await tx.select({ id: documents.id }).from(documents).where(eq(documents.id, body.procedureDocumentId));
      if (!d) throw badRequest('validation_failed', 'Procedure document not found', [{ path: 'procedureDocumentId', message: 'Document not found' }]);
    }
    const [r] = await tx.update(alarmRules).set({ ...body, breachSince: null, updatedAt: new Date() }).where(eq(alarmRules.id, id)).returning();
    const diff = diffFields(cur, body);
    await audit(tx, p, {
      orgId: p.orgId, action: body.enabled === false && cur.enabled ? 'alarm_rule.disabled' : body.enabled === true && !cur.enabled ? 'alarm_rule.enabled' : 'alarm_rule.updated',
      entityType: 'alarm_rule', entityId: id, summary: r!.name,
      metadata: { before: { threshold: cur.threshold, severity: cur.severity, enabled: cur.enabled }, after: body, changes: diff },
    });
    // The sensor's own history shows threshold changes too.
    await audit(tx, p, { orgId: p.orgId, action: 'sensor.threshold_changed', entityType: 'sensor', entityId: cur.sensorId, summary: `${r!.name}: ${Object.keys(diff).join(', ') || 'no change'}`, metadata: { ruleId: id, changes: diff } });
    return { rule: r };
  }));

  app.delete('/alarm-rules/:id', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'alarm_rule.manage');
    const { id } = idParam.parse(req.params);
    const [cur] = await tx.select().from(alarmRules).where(eq(alarmRules.id, id));
    if (!cur) throw notFound('Rule');
    requireSite(p, cur.siteId, 'Rule');
    // Rules with history are disabled rather than deleted so past alarm events keep their context.
    const [used] = await tx.select({ id: alarmEvents.id }).from(alarmEvents).where(eq(alarmEvents.ruleId, id)).limit(1);
    if (used) await tx.update(alarmRules).set({ enabled: false, updatedAt: new Date() }).where(eq(alarmRules.id, id));
    else await tx.delete(alarmRules).where(eq(alarmRules.id, id));
    await audit(tx, p, { orgId: p.orgId, action: used ? 'alarm_rule.disabled' : 'alarm_rule.deleted', entityType: 'alarm_rule', entityId: id });
    return { ok: true, disabled: !!used };
  }));

  void or;
  void lt;
}
