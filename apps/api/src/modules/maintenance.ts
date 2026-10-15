import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  MAINTENANCE_KINDS, MAINTENANCE_PRIORITIES, MAINTENANCE_STATUSES, MAINTENANCE_TRANSITIONS, canTransitionMaintenance, type MaintenanceAction,
} from '@hydris/domain';
import type { Ctx } from '../context';
import { authenticate, tenant } from '../context';
import { alarmEvents, assets, attachments, maintenanceActivity, maintenanceTasks, memberships, sites, users } from '../db/schema';
import type { Tx } from '../db/client';
import { badRequest, conflict, forbidden, notFound } from '../core/errors';
import { has, requirePerm, requireSite, siteScope, type Principal } from '../core/principal';
import { audit, notify } from '../core/services';
import { changes as diffFields, scopedRow } from './plant';

const OPEN = ['open', 'assigned', 'in_progress', 'on_hold'] as const;

async function load(tx: Tx, p: Principal, id: string) {
  const [t] = await tx.select().from(maintenanceTasks).where(eq(maintenanceTasks.id, id));
  if (!t) throw notFound('Task');
  requireSite(p, t.siteId, 'Task');
  return t;
}

async function log(tx: Tx, p: Principal, taskId: string, action: string, note?: string | null) {
  await tx.insert(maintenanceActivity).values({ orgId: p.orgId, taskId, action, note: note ?? null, actorUserId: p.userId });
}

export async function maintenanceRoutes(app: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: authenticate(ctx) };
  const idParam = z.object({ id: z.uuid() });

  app.get('/maintenance', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'maintenance.read');
    const q = z.object({
      status: z.union([z.enum(MAINTENANCE_STATUSES), z.literal('open_all')]).optional(), priority: z.enum(MAINTENANCE_PRIORITIES).optional(),
      siteId: z.uuid().optional(), assetId: z.uuid().optional(), mine: z.enum(['true', 'false']).optional(),
    }).parse(req.query);
    const rows = await tx.select({ t: maintenanceTasks, assetTag: assets.tag, assetName: assets.name, assigneeName: users.name, siteName: sites.name })
      .from(maintenanceTasks).leftJoin(assets, eq(assets.id, maintenanceTasks.assetId)).leftJoin(users, eq(users.id, maintenanceTasks.assignedTo)).innerJoin(sites, eq(sites.id, maintenanceTasks.siteId))
      .where(and(
        siteScope(p, maintenanceTasks.siteId),
        q.status === 'open_all' ? inArray(maintenanceTasks.status, [...OPEN]) : q.status ? eq(maintenanceTasks.status, q.status) : undefined,
        q.priority ? eq(maintenanceTasks.priority, q.priority) : undefined, q.siteId ? eq(maintenanceTasks.siteId, q.siteId) : undefined,
        q.assetId ? eq(maintenanceTasks.assetId, q.assetId) : undefined, q.mine === 'true' ? eq(maintenanceTasks.assignedTo, p.userId) : undefined,
      ))
      .orderBy(sql`case ${maintenanceTasks.status} when 'in_progress' then 0 when 'assigned' then 1 when 'open' then 2 when 'on_hold' then 3 else 4 end`,
        sql`case ${maintenanceTasks.priority} when 'urgent' then 0 when 'high' then 1 when 'medium' then 2 else 3 end`, desc(maintenanceTasks.createdAt))
      .limit(300);
    return { tasks: rows.map(({ t, ...r }) => ({ ...t, ...r })) };
  }));

  app.post('/maintenance', auth, async (req, reply) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'maintenance.request');
    const body = z.object({
      title: z.string().trim().min(3).max(160), description: z.string().max(4000).nullable().optional(), assetId: z.uuid().nullable().optional(), siteId: z.uuid().optional(),
      kind: z.enum(MAINTENANCE_KINDS).default('corrective'), priority: z.enum(MAINTENANCE_PRIORITIES).default('medium'), assignedTo: z.uuid().nullable().optional(),
      dueAt: z.coerce.date().nullable().optional(), sourceAlarmId: z.uuid().nullable().optional(), checklist: z.array(z.string().trim().min(1).max(200)).max(40).default([]),
    }).parse(req.body);
    let siteId = body.siteId;
    if (body.assetId) siteId = (await scopedRow(tx, assets, body.assetId, p, 'Asset')).siteId;
    if (!siteId) throw badRequest('site_required', 'Choose an asset or site');
    requireSite(p, siteId, 'Site');
    if (body.assignedTo && !has(p, 'maintenance.manage')) throw forbidden('Only planners can assign maintenance');
    if (body.assignedTo) {
      const [m] = await tx.select().from(memberships).where(and(eq(memberships.userId, body.assignedTo), eq(memberships.status, 'active')));
      if (!m) throw badRequest('invalid_assignee');
    }
    if (body.sourceAlarmId) {
      const [a] = await tx.select({ id: alarmEvents.id }).from(alarmEvents).where(eq(alarmEvents.id, body.sourceAlarmId));
      if (!a) throw badRequest('invalid_alarm');
    }
    const [t] = await tx.insert(maintenanceTasks).values({
      orgId: p.orgId, siteId, assetId: body.assetId ?? null, title: body.title, description: body.description, kind: body.sourceAlarmId ? 'alarm_followup' : body.kind,
      priority: body.priority, assignedTo: body.assignedTo ?? null, status: body.assignedTo ? 'assigned' : 'open', requestedBy: p.userId, dueAt: body.dueAt ?? null,
      sourceAlarmId: body.sourceAlarmId ?? null, checklist: body.checklist.map((label) => ({ id: randomUUID().slice(0, 8), label, done: false })),
    }).returning();
    await log(tx, p, t!.id, 'created');
    await audit(tx, p, { orgId: p.orgId, action: 'maintenance.created', entityType: 'maintenance', entityId: t!.id, summary: t!.title });
    if (t!.assignedTo) await notify(tx, ctx.bus, { orgId: p.orgId, userIds: [t!.assignedTo], kind: 'maintenance_assigned', title: `Maintenance assigned: ${t!.title}`, link: `/console/maintenance/${t!.id}`, entityType: 'maintenance', entityId: t!.id, severity: t!.priority === 'urgent' ? 'critical' : 'info' });
    ctx.bus.publish({ type: 'maintenance.updated', orgId: p.orgId, siteId, permission: 'maintenance.read', payload: { id: t!.id, status: t!.status } });
    return reply.code(201).send({ task: t });
  }));

  app.get('/maintenance/:id', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'maintenance.read');
    const { id } = idParam.parse(req.params);
    const t = await load(tx, p, id);
    const activity = await tx.select({ a: maintenanceActivity, actorName: users.name }).from(maintenanceActivity).leftJoin(users, eq(users.id, maintenanceActivity.actorUserId))
      .where(eq(maintenanceActivity.taskId, id)).orderBy(asc(maintenanceActivity.at));
    const [asset] = t.assetId ? await tx.select({ id: assets.id, tag: assets.tag, name: assets.name, status: assets.status }).from(assets).where(eq(assets.id, t.assetId)) : [];
    const [assignee] = t.assignedTo ? await tx.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, t.assignedTo)) : [];
    const files = await tx.select({ id: attachments.id, filename: attachments.filename, mime: attachments.mime }).from(attachments).where(and(eq(attachments.ownerType, 'maintenance'), eq(attachments.ownerId, id)));
    const isAssignee = t.assignedTo === p.userId;
    return {
      task: { ...t, asset: asset ?? null, assignee: assignee ?? null, attachments: files },
      activity: activity.map((a) => ({ ...a.a, actorName: a.actorName })),
      permissions: { manage: has(p, 'maintenance.manage'), execute: has(p, 'maintenance.execute') && isAssignee || has(p, 'maintenance.manage') },
    };
  }));

  app.patch('/maintenance/:id', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'maintenance.manage');
    const { id } = idParam.parse(req.params);
    const body = z.object({
      title: z.string().trim().min(3).max(160).optional(), description: z.string().max(4000).nullable().optional(), priority: z.enum(MAINTENANCE_PRIORITIES).optional(),
      assignedTo: z.uuid().nullable().optional(), dueAt: z.coerce.date().nullable().optional(), kind: z.enum(MAINTENANCE_KINDS).optional(),
      assetId: z.uuid().nullable().optional(),
      /** Full checklist: existing items keep their id (and completion state); items without id are added; missing ids are removed. */
      checklist: z.array(z.object({ id: z.string().max(20).optional(), label: z.string().trim().min(1, 'Item cannot be empty').max(200) })).max(40).optional(),
    }).parse(req.body);
    const t = await load(tx, p, id);
    if (!OPEN.includes(t.status as (typeof OPEN)[number])) throw conflict('not_editable', 'Closed tasks cannot be edited');
    if (body.assignedTo) {
      const [m] = await tx.select().from(memberships).where(and(eq(memberships.userId, body.assignedTo), eq(memberships.status, 'active')));
      if (!m) throw badRequest('validation_failed', 'Assignee is not an active member', [{ path: 'assignedTo', message: 'Not an active member' }]);
    }
    if (body.assetId) {
      const a = await scopedRow(tx, assets, body.assetId, p, 'Asset');
      if (a.siteId !== t.siteId) throw badRequest('validation_failed', 'Asset is on a different site', [{ path: 'assetId', message: 'Choose an asset on the task\'s site' }]);
    }
    let checklist: typeof t.checklist | undefined;
    if (body.checklist) {
      const byId = new Map(t.checklist.map((c) => [c.id, c]));
      for (const c of body.checklist) if (c.id && !byId.has(c.id)) throw badRequest('validation_failed', 'Unknown checklist item', [{ path: 'checklist', message: `Unknown item ${c.id}` }]);
      checklist = body.checklist.map((c) => {
        const prev = c.id ? byId.get(c.id) : undefined;
        return prev ? { ...prev, label: c.label } : { id: randomUUID().slice(0, 8), label: c.label, done: false };
      });
    }
    const { checklist: _c, ...fields } = body;
    void _c;
    const status = body.assignedTo !== undefined && t.status === 'open' && body.assignedTo ? 'assigned' : body.assignedTo === null && t.status === 'assigned' ? 'open' : undefined;
    const [u] = await tx.update(maintenanceTasks).set({ ...fields, checklist, kind: body.kind, status, updatedAt: new Date() }).where(eq(maintenanceTasks.id, id)).returning();
    const diff = diffFields(t, fields);
    if (checklist) {
      const before = t.checklist.map((c) => c.label);
      const after = checklist.map((c) => c.label);
      const added = after.filter((l, i) => !t.checklist.some((c) => c.id === checklist![i]!.id));
      const removed = t.checklist.filter((c) => !checklist!.some((n) => n.id === c.id)).map((c) => c.label);
      if (JSON.stringify(before) !== JSON.stringify(after)) diff.checklist = { from: before, to: after };
      if (added.length || removed.length) await log(tx, p, id, 'checklist_edited', [added.length ? `Added: ${added.join(', ')}` : '', removed.length ? `Removed: ${removed.join(', ')}` : ''].filter(Boolean).join(' · '));
    }
    await log(tx, p, id, body.assignedTo !== undefined && body.assignedTo !== t.assignedTo ? 'assigned' : 'updated', body.assignedTo ? `Assigned` : undefined);
    await audit(tx, p, { orgId: p.orgId, action: 'maintenance.updated', entityType: 'maintenance', entityId: id, summary: u!.title, metadata: { changes: diff } });
    if (body.assignedTo && body.assignedTo !== t.assignedTo) await notify(tx, ctx.bus, { orgId: p.orgId, userIds: [body.assignedTo], kind: 'maintenance_assigned', title: `Maintenance assigned: ${t.title}`, link: `/console/maintenance/${id}`, entityType: 'maintenance', entityId: id });
    ctx.bus.publish({ type: 'maintenance.updated', orgId: p.orgId, siteId: t.siteId, permission: 'maintenance.read', payload: { id, status: u!.status } });
    return { task: u };
  }));

  app.post('/maintenance/:id/checklist/:itemId', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    const { id, itemId } = z.object({ id: z.uuid(), itemId: z.string().max(20) }).parse(req.params);
    const { done } = z.object({ done: z.boolean() }).parse(req.body);
    const t = await load(tx, p, id);
    if (!(has(p, 'maintenance.manage') || (has(p, 'maintenance.execute') && t.assignedTo === p.userId) || (t.assignedTo === p.userId && has(p, 'inspection.execute')))) throw forbidden();
    if (!OPEN.includes(t.status as (typeof OPEN)[number])) throw conflict('not_editable', 'Task is closed');
    if (!t.checklist.some((c) => c.id === itemId)) throw notFound('Checklist item');
    const checklist = t.checklist.map((c) => (c.id === itemId ? { ...c, done, doneAt: done ? new Date().toISOString() : null, doneBy: done ? p.userId : null } : c));
    const [u] = await tx.update(maintenanceTasks).set({ checklist, status: t.status === 'assigned' || t.status === 'open' ? 'in_progress' : undefined, startedAt: t.startedAt ?? new Date(), updatedAt: new Date() }).where(eq(maintenanceTasks.id, id)).returning();
    await log(tx, p, id, done ? 'checklist_done' : 'checklist_undone', t.checklist.find((c) => c.id === itemId)!.label);
    ctx.bus.publish({ type: 'maintenance.updated', orgId: p.orgId, siteId: t.siteId, permission: 'maintenance.read', payload: { id, status: u!.status } });
    return { task: u };
  }));

  app.post('/maintenance/:id/notes', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'maintenance.read');
    const { id } = idParam.parse(req.params);
    const { note } = z.object({ note: z.string().trim().min(1).max(2000) }).parse(req.body);
    const t = await load(tx, p, id);
    if (!(has(p, 'maintenance.manage') || t.assignedTo === p.userId || t.requestedBy === p.userId)) throw forbidden();
    await log(tx, p, id, 'note', note);
    return { ok: true };
  }));

  app.post('/maintenance/:id/:action', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    const { id, action } = z.object({ id: z.uuid(), action: z.enum(Object.keys(MAINTENANCE_TRANSITIONS) as [MaintenanceAction, ...MaintenanceAction[]]) }).parse(req.params);
    const { note } = z.object({ note: z.string().trim().max(2000).optional() }).parse(req.body ?? {});
    const t = await load(tx, p, id);
    const executor = has(p, 'maintenance.execute') && t.assignedTo === p.userId;
    if (!(has(p, 'maintenance.manage') || (executor && ['start', 'hold', 'complete'].includes(action)))) throw forbidden();
    if (!canTransitionMaintenance(t.status, action)) throw conflict('invalid_transition', `Cannot ${action} a task that is ${t.status}`);
    if (action === 'complete' && t.checklist.some((c) => !c.done)) throw badRequest('checklist_incomplete', 'Complete every checklist item first');
    if (action === 'complete' && !note) throw badRequest('note_required', 'Record what was done');
    const now = new Date();
    const to = MAINTENANCE_TRANSITIONS[action].to;
    const [u] = await tx.update(maintenanceTasks).set({
      status: action === 'reopen' && t.assignedTo ? 'assigned' : to, updatedAt: now,
      startedAt: action === 'start' ? (t.startedAt ?? now) : undefined, completedAt: action === 'complete' ? now : action === 'reopen' ? null : undefined,
      completionNote: action === 'complete' ? note : undefined,
    }).where(and(eq(maintenanceTasks.id, id), eq(maintenanceTasks.status, t.status))).returning();
    if (!u) throw conflict('stale_state', 'Task changed meanwhile. Refresh and try again.');
    await log(tx, p, id, action, note);
    await audit(tx, p, { orgId: p.orgId, action: `maintenance.${action}`, entityType: 'maintenance', entityId: id, summary: t.title });
    if (action === 'complete' && t.requestedBy && t.requestedBy !== p.userId) await notify(tx, ctx.bus, { orgId: p.orgId, userIds: [t.requestedBy], kind: 'maintenance_completed', severity: 'success', title: `Completed: ${t.title}`, link: `/console/maintenance/${id}`, entityType: 'maintenance', entityId: id });
    ctx.bus.publish({ type: 'maintenance.updated', orgId: p.orgId, siteId: t.siteId, permission: 'maintenance.read', payload: { id, status: u.status } });
    return { task: u };
  }));
}
