import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  ASSET_TYPES, INSPECTION_EDITABLE, INSPECTION_STATUSES, INSPECTION_TRANSITIONS, STEP_KINDS, canTransitionInspection, inspectionProgress, stepOutcome,
  type InspectionAction, type InspectionStep, type StepValue,
} from '@hydris/domain';
import type { Ctx } from '../context';
import { authenticate, tenant } from '../context';
import { assets, attachments, inspectionResponses, inspectionRoutes, inspectionTemplates, inspections, maintenanceTasks, memberships, sites, users } from '../db/schema';
import type { Tx } from '../db/client';
import { badRequest, conflict, forbidden, notFound } from '../core/errors';
import { has, requirePerm, requireSite, siteScope, type Principal } from '../core/principal';
import { audit, notify } from '../core/services';
import { changes as diffFields, scopedRow } from './plant';

const stepSchema = z.object({
  id: z.string().min(1).max(40), kind: z.enum(STEP_KINDS), title: z.string().trim().min(2).max(200), instruction: z.string().max(1000).optional(),
  caution: z.string().max(500).optional(), required: z.boolean(), measurand: z.string().max(40).optional(), unit: z.string().max(20).optional(),
  expectedMin: z.number().optional(), expectedMax: z.number().optional(), options: z.array(z.string().max(80)).max(12).optional(), abnormalOptions: z.array(z.string().max(80)).max(12).optional(),
});
const valueSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('check'), checked: z.boolean(), abnormal: z.boolean().optional() }),
  z.object({ kind: z.literal('reading'), value: z.number().finite() }),
  z.object({ kind: z.literal('choice'), option: z.string().max(80) }),
  z.object({ kind: z.literal('text'), text: z.string().max(4000) }),
  z.object({ kind: z.literal('photo'), attachmentId: z.uuid() }),
]);

/** Latest response per step (by client recording time). */
async function latestResponses(tx: Tx, inspectionId: string) {
  const rows = await tx.select().from(inspectionResponses).where(eq(inspectionResponses.inspectionId, inspectionId)).orderBy(asc(inspectionResponses.recordedAt));
  const m = new Map<string, typeof rows[number]>();
  for (const r of rows) m.set(r.stepId, r);
  return m;
}

async function loadInspection(tx: Tx, p: Principal, id: string) {
  const [i] = await tx.select().from(inspections).where(eq(inspections.id, id));
  if (!i) throw notFound('Inspection');
  requireSite(p, i.siteId, 'Inspection');
  // Executors only see work assigned to them unless they can manage inspections.
  if (!has(p, 'inspection.manage') && !has(p, 'inspection.review') && i.assignedTo !== p.userId) throw notFound('Inspection');
  return i;
}

export async function inspectionView(tx: Tx, i: typeof inspections.$inferSelect) {
  const latest = await latestResponses(tx, i.id);
  const progress = inspectionProgress(i.steps, new Map([...latest].map(([k, v]) => [k, { outcome: v.outcome }])));
  const [asset] = i.assetId ? await tx.select({ id: assets.id, tag: assets.tag, name: assets.name, type: assets.type, status: assets.status, positionX: assets.positionX, positionY: assets.positionY }).from(assets).where(eq(assets.id, i.assetId)) : [];
  const [assignee] = i.assignedTo ? await tx.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, i.assignedTo)) : [];
  const files = await tx.select({ id: attachments.id, filename: attachments.filename, mime: attachments.mime }).from(attachments).where(and(eq(attachments.ownerType, 'inspection'), eq(attachments.ownerId, i.id)));
  return {
    ...i, asset: asset ?? null, assignee: assignee ?? null, progress, attachments: files,
    responses: Object.fromEntries([...latest].map(([k, v]) => [k, { value: v.value, outcome: v.outcome, note: v.note, recordedAt: v.recordedAt, deviceId: v.deviceId }])),
  };
}

export async function createInspection(ctx: Ctx, tx: Tx, p: Principal | { orgId: string; userId: string | null; system: true }, input: {
  templateId: string; assetId?: string | null; siteId?: string; assignedTo?: string | null; dueAt?: Date | null; priority?: 'normal' | 'high'; routeId?: string | null; title?: string; synthetic?: boolean;
}) {
  const [tpl] = await tx.select().from(inspectionTemplates).where(eq(inspectionTemplates.id, input.templateId));
  if (!tpl || tpl.status !== 'published') throw badRequest('invalid_template', 'Template not found or not published');
  let siteId = input.siteId;
  let assetLabel = '';
  if (input.assetId) {
    const [a] = await tx.select().from(assets).where(eq(assets.id, input.assetId));
    if (!a) throw badRequest('invalid_asset');
    siteId = a.siteId;
    assetLabel = ` · ${a.tag}`;
  }
  if (!siteId) throw badRequest('site_required', 'Choose an asset or site');
  if ('kind' in p) requireSite(p, siteId, 'Site');
  if (input.assignedTo) {
    const [m] = await tx.select().from(memberships).where(and(eq(memberships.userId, input.assignedTo), eq(memberships.status, 'active')));
    if (!m || !['field_operator', 'maintenance_engineer', 'supervisor', 'factory_manager', 'org_admin'].includes(m.role)) throw badRequest('invalid_assignee', 'Assignee cannot execute inspections');
  }
  const [row] = await tx.insert(inspections).values({
    orgId: p.orgId, siteId, assetId: input.assetId ?? null, templateId: tpl.id, templateVersion: tpl.version, routeId: input.routeId ?? null,
    title: input.title ?? `${tpl.name}${assetLabel}`, steps: tpl.steps, safetyNotices: tpl.safetyNotices, priority: input.priority ?? 'normal',
    assignedTo: input.assignedTo ?? null, assignedBy: p.userId, dueAt: input.dueAt ?? null, synthetic: input.synthetic ?? false,
  }).returning();
  await audit(tx, 'kind' in p ? p : { label: 'simulator' }, { orgId: p.orgId, action: 'inspection.created', entityType: 'inspection', entityId: row!.id, summary: row!.title, metadata: { assignedTo: input.assignedTo } });
  if (row!.assignedTo) {
    await notify(tx, ctx.bus, { orgId: p.orgId, userIds: [row!.assignedTo], kind: 'inspection_assigned', title: `New inspection: ${row!.title}`, link: `/console/inspections/${row!.id}`, entityType: 'inspection', entityId: row!.id, severity: row!.priority === 'high' ? 'warning' : 'info' });
  }
  ctx.bus.publish({ type: 'inspection.updated', orgId: p.orgId, siteId, permission: 'inspection.read', payload: { id: row!.id, status: row!.status, assignedTo: row!.assignedTo } });
  return row!;
}

export async function inspectionModule(app: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: authenticate(ctx) };
  const idParam = z.object({ id: z.uuid() });

  // ---------------- Templates ----------------
  const templateBody = z.object({
    name: z.string().trim().min(3).max(120), description: z.string().max(1000).nullable().optional(), assetType: z.enum(ASSET_TYPES).nullable().optional(),
    steps: z.array(stepSchema).min(1).max(60), safetyNotices: z.array(z.string().max(500)).max(10).default([]), estimatedMinutes: z.number().int().min(1).max(600).nullable().optional(),
    status: z.enum(['draft', 'published', 'archived']).optional(),
  }).refine((t) => new Set(t.steps.map((s) => s.id)).size === t.steps.length, 'Step ids must be unique');

  app.get('/inspection-templates', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'inspection.read');
    return { templates: await tx.select().from(inspectionTemplates).orderBy(asc(inspectionTemplates.name)) };
  }));

  app.post('/inspection-templates', auth, async (req, reply) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'inspection.manage');
    const body = templateBody.parse(req.body);
    const [t] = await tx.insert(inspectionTemplates).values({ ...body, orgId: p.orgId, createdBy: p.userId }).returning();
    await audit(tx, p, { orgId: p.orgId, action: 'inspection_template.created', entityType: 'inspection_template', entityId: t!.id, summary: t!.name });
    return reply.code(201).send({ template: t });
  }));

  app.put('/inspection-templates/:id', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'inspection.manage');
    const { id } = idParam.parse(req.params);
    const body = templateBody.parse(req.body);
    const [cur] = await tx.select().from(inspectionTemplates).where(eq(inspectionTemplates.id, id));
    if (!cur) throw notFound('Template');
    // Existing inspections keep their step snapshot; the template version is bumped for traceability.
    if (cur.status === 'archived' && body.status !== 'draft' && body.status !== 'published') throw conflict('archived', 'Restore this template before editing it');
    const contentChanged = JSON.stringify(cur.steps) !== JSON.stringify(body.steps) || JSON.stringify(cur.safetyNotices) !== JSON.stringify(body.safetyNotices);
    const [t] = await tx.update(inspectionTemplates).set({ ...body, version: contentChanged ? cur.version + 1 : cur.version, updatedAt: new Date() }).where(eq(inspectionTemplates.id, id)).returning();
    const { steps: _s, safetyNotices: _n, ...meta } = body;
    void _s; void _n;
    await audit(tx, p, {
      orgId: p.orgId, action: 'inspection_template.updated', entityType: 'inspection_template', entityId: id, summary: `${t!.name} v${t!.version}`,
      metadata: { changes: diffFields(cur, meta), stepsChanged: contentChanged, stepCount: { from: cur.steps.length, to: body.steps.length }, version: t!.version },
    });
    return { template: t };
  }));

  app.get('/inspection-templates/:id', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'inspection.read');
    const { id } = idParam.parse(req.params);
    const [t] = await tx.select().from(inspectionTemplates).where(eq(inspectionTemplates.id, id));
    if (!t) throw notFound('Template');
    const [usage] = await tx.select({
      total: sql<number>`count(*)::int`, open: sql<number>`count(*) filter (where ${inspections.status} in ('scheduled','in_progress','paused','submitted'))::int`,
    }).from(inspections).where(eq(inspections.templateId, id));
    return { template: t, usage: { total: Number(usage?.total ?? 0), open: Number(usage?.open ?? 0) } };
  }));

  /** Publish, unpublish (draft), archive or restore a template without bumping its content version. */
  app.post('/inspection-templates/:id/status', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'inspection.manage');
    const { id } = idParam.parse(req.params);
    const { status } = z.object({ status: z.enum(['draft', 'published', 'archived']) }).parse(req.body);
    const [cur] = await tx.select().from(inspectionTemplates).where(eq(inspectionTemplates.id, id));
    if (!cur) throw notFound('Template');
    if (cur.status === status) throw conflict('no_change', `Template is already ${status}`);
    const [t] = await tx.update(inspectionTemplates).set({ status, updatedAt: new Date() }).where(eq(inspectionTemplates.id, id)).returning();
    const action = status === 'published' ? 'inspection_template.published' : status === 'archived' ? 'inspection_template.archived' : cur.status === 'archived' ? 'inspection_template.restored' : 'inspection_template.unpublished';
    await audit(tx, p, { orgId: p.orgId, action, entityType: 'inspection_template', entityId: id, summary: `${t!.name} v${t!.version}`, metadata: { changes: { status: { from: cur.status, to: status } } } });
    return { template: t };
  }));

  // ---------------- Routes (inspection rounds over the site map) ----------------
  app.get('/inspection-routes', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'inspection.read');
    const q = z.object({ siteId: z.uuid().optional() }).parse(req.query);
    return { routes: await tx.select().from(inspectionRoutes).where(and(siteScope(p, inspectionRoutes.siteId), q.siteId ? eq(inspectionRoutes.siteId, q.siteId) : undefined)).orderBy(asc(inspectionRoutes.name)) };
  }));

  const routeBody = z.object({ siteId: z.uuid(), name: z.string().trim().min(2).max(120), description: z.string().max(500).nullable().optional(), assetIds: z.array(z.uuid()).min(1).max(100) });
  async function checkRouteAssets(tx: Tx, siteId: string, ids: string[]) {
    const found = await tx.select({ id: assets.id }).from(assets).where(and(inArray(assets.id, ids), eq(assets.siteId, siteId)));
    if (new Set(found.map((f) => f.id)).size !== new Set(ids).size) throw badRequest('invalid_assets', 'All route stops must be assets on this site');
  }

  app.post('/inspection-routes', auth, async (req, reply) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'inspection.manage');
    const body = routeBody.parse(req.body);
    requireSite(p, body.siteId, 'Site');
    await checkRouteAssets(tx, body.siteId, body.assetIds);
    const [r] = await tx.insert(inspectionRoutes).values({ ...body, orgId: p.orgId, createdBy: p.userId }).returning();
    await audit(tx, p, { orgId: p.orgId, action: 'inspection_route.created', entityType: 'inspection_route', entityId: r!.id, summary: r!.name });
    return reply.code(201).send({ route: r });
  }));

  app.put('/inspection-routes/:id', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'inspection.manage');
    const { id } = idParam.parse(req.params);
    const body = routeBody.omit({ siteId: true }).parse(req.body);
    const [cur] = await tx.select().from(inspectionRoutes).where(eq(inspectionRoutes.id, id));
    if (!cur) throw notFound('Route');
    requireSite(p, cur.siteId, 'Route');
    await checkRouteAssets(tx, cur.siteId, body.assetIds);
    const [r] = await tx.update(inspectionRoutes).set({ ...body, updatedAt: new Date() }).where(eq(inspectionRoutes.id, id)).returning();
    await audit(tx, p, { orgId: p.orgId, action: 'inspection_route.updated', entityType: 'inspection_route', entityId: id });
    return { route: r };
  }));

  /** Dispatch a round: one inspection per stop using the template matching each asset's type. */
  app.post('/inspection-routes/:id/dispatch', auth, async (req, reply) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'inspection.manage');
    const { id } = idParam.parse(req.params);
    const body = z.object({ assignedTo: z.uuid(), dueAt: z.coerce.date().optional(), fallbackTemplateId: z.uuid() }).parse(req.body);
    const [route] = await tx.select().from(inspectionRoutes).where(eq(inspectionRoutes.id, id));
    if (!route) throw notFound('Route');
    requireSite(p, route.siteId, 'Route');
    const templates = await tx.select().from(inspectionTemplates).where(eq(inspectionTemplates.status, 'published'));
    const stops = await tx.select().from(assets).where(inArray(assets.id, route.assetIds));
    const created = [];
    for (const assetId of route.assetIds) {
      const a = stops.find((s) => s.id === assetId);
      if (!a) continue;
      const tpl = templates.find((t) => t.assetType === a.type) ?? templates.find((t) => t.id === body.fallbackTemplateId);
      if (!tpl) continue;
      created.push(await createInspection(ctx, tx, p, { templateId: tpl.id, assetId, assignedTo: body.assignedTo, dueAt: body.dueAt ?? null, routeId: route.id }));
    }
    return reply.code(201).send({ created: created.length, inspectionIds: created.map((c) => c.id) });
  }));

  // ---------------- Inspections ----------------
  app.get('/inspections', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'inspection.read');
    const q = z.object({
      status: z.union([z.enum(INSPECTION_STATUSES), z.literal('open'), z.literal('review')]).optional(), mine: z.enum(['true', 'false']).optional(),
      siteId: z.uuid().optional(), assetId: z.uuid().optional(), overdue: z.enum(['true', 'false']).optional(),
    }).parse(req.query);
    const mineOnly = q.mine === 'true' || (!has(p, 'inspection.manage') && !has(p, 'inspection.review'));
    const rows = await tx.select({ i: inspections, assetTag: assets.tag, assetName: assets.name, assigneeName: users.name, siteName: sites.name })
      .from(inspections).leftJoin(assets, eq(assets.id, inspections.assetId)).leftJoin(users, eq(users.id, inspections.assignedTo)).innerJoin(sites, eq(sites.id, inspections.siteId))
      .where(and(
        siteScope(p, inspections.siteId),
        mineOnly ? eq(inspections.assignedTo, p.userId) : undefined,
        q.status === 'open' ? inArray(inspections.status, [...INSPECTION_EDITABLE]) : q.status === 'review' ? eq(inspections.status, 'submitted') : q.status ? eq(inspections.status, q.status) : undefined,
        q.siteId ? eq(inspections.siteId, q.siteId) : undefined, q.assetId ? eq(inspections.assetId, q.assetId) : undefined,
        q.overdue === 'true' ? and(lte(inspections.dueAt, new Date()), inArray(inspections.status, [...INSPECTION_EDITABLE])) : undefined,
      ))
      .orderBy(sql`case when ${inspections.status} in ('in_progress','paused') then 0 when ${inspections.status} in ('scheduled','rejected') then 1 when ${inspections.status} = 'submitted' then 2 else 3 end`, asc(inspections.dueAt), desc(inspections.createdAt))
      .limit(300);
    const counts = await tx.select({ id: inspectionResponses.inspectionId, n: sql<number>`count(distinct ${inspectionResponses.stepId})::int` }).from(inspectionResponses)
      .where(inArray(inspectionResponses.inspectionId, rows.length ? rows.map((r) => r.i.id) : ['00000000-0000-0000-0000-000000000000'])).groupBy(inspectionResponses.inspectionId);
    const answered = new Map(counts.map((c) => [c.id, c.n]));
    return {
      inspections: rows.map(({ i, ...r }) => ({
        id: i.id, title: i.title, status: i.status, priority: i.priority, dueAt: i.dueAt, siteId: i.siteId, assetId: i.assetId, assignedTo: i.assignedTo,
        startedAt: i.startedAt, submittedAt: i.submittedAt, submittedVia: i.submittedVia, routeId: i.routeId, synthetic: i.synthetic, revision: i.revision,
        stepCount: i.steps.length, answered: answered.get(i.id) ?? 0, ...r,
      })),
    };
  }));

  app.post('/inspections', auth, async (req, reply) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'inspection.manage');
    const body = z.object({
      templateId: z.uuid(), assetId: z.uuid().nullable().optional(), siteId: z.uuid().optional(), assignedTo: z.uuid().nullable().optional(),
      dueAt: z.coerce.date().nullable().optional(), priority: z.enum(['normal', 'high']).optional(), title: z.string().trim().min(3).max(160).optional(),
    }).parse(req.body);
    if (body.assetId) await scopedRow(tx, assets, body.assetId, p, 'Asset');
    return reply.code(201).send({ inspection: await createInspection(ctx, tx, p, body) });
  }));

  app.get('/inspections/:id', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'inspection.read');
    const { id } = idParam.parse(req.params);
    const i = await loadInspection(tx, p, id);
    const followUps = await tx.select({ id: maintenanceTasks.id, title: maintenanceTasks.title, status: maintenanceTasks.status, priority: maintenanceTasks.priority }).from(maintenanceTasks).where(eq(maintenanceTasks.sourceInspectionId, id));
    const canExecute = has(p, 'inspection.execute') && i.assignedTo === p.userId;
    return {
      inspection: await inspectionView(tx, i), followUps,
      permissions: { execute: canExecute, manage: has(p, 'inspection.manage'), review: has(p, 'inspection.review') && i.assignedTo !== p.userId },
    };
  }));

  app.patch('/inspections/:id', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'inspection.manage');
    const { id } = idParam.parse(req.params);
    const body = z.object({ assignedTo: z.uuid().nullable().optional(), dueAt: z.coerce.date().nullable().optional(), priority: z.enum(['normal', 'high']).optional() }).parse(req.body);
    const i = await loadInspection(tx, p, id);
    if (!INSPECTION_EDITABLE.includes(i.status)) throw conflict('not_editable', 'Only open inspections can be reassigned');
    const [u] = await tx.update(inspections).set({ ...body, revision: i.revision + 1, updatedAt: new Date() }).where(eq(inspections.id, id)).returning();
    await audit(tx, p, { orgId: p.orgId, action: 'inspection.updated', entityType: 'inspection', entityId: id, metadata: body });
    if (body.assignedTo && body.assignedTo !== i.assignedTo) {
      await notify(tx, ctx.bus, { orgId: p.orgId, userIds: [body.assignedTo], kind: 'inspection_assigned', title: `Inspection assigned: ${i.title}`, link: `/console/inspections/${id}`, entityType: 'inspection', entityId: id });
    }
    ctx.bus.publish({ type: 'inspection.updated', orgId: p.orgId, siteId: i.siteId, permission: 'inspection.read', payload: { id, status: u!.status, assignedTo: u!.assignedTo } });
    return { inspection: u };
  }));

  /**
   * Batch sync of step responses. Designed for intermittently connected glasses:
   * each op carries a client-generated id (idempotent replay) and the client time it
   * was recorded. Ops for inspections that were closed meanwhile are reported as conflicts.
   */
  app.post('/inspections/:id/responses', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'inspection.execute');
    const { id } = idParam.parse(req.params);
    const body = z.object({
      ops: z.array(z.object({ opId: z.string().min(8).max(80), stepId: z.string().max(40), value: valueSchema, note: z.string().max(2000).optional(), recordedAt: z.iso.datetime({ offset: true }) })).min(1).max(200),
    }).parse(req.body);
    const i = await loadInspection(tx, p, id);
    if (i.assignedTo !== p.userId) throw forbidden('Only the assigned person can record this inspection');
    if (!INSPECTION_EDITABLE.includes(i.status)) {
      return { applied: 0, duplicates: 0, conflicts: body.ops.map((o) => ({ opId: o.opId, reason: `inspection_${i.status}` })), inspection: await inspectionView(tx, i) };
    }
    let applied = 0, duplicates = 0;
    const conflicts: { opId: string; reason: string }[] = [];
    for (const op of body.ops) {
      const step = i.steps.find((s: InspectionStep) => s.id === op.stepId);
      if (!step) { conflicts.push({ opId: op.opId, reason: 'unknown_step' }); continue; }
      if (step.kind !== op.value.kind) { conflicts.push({ opId: op.opId, reason: 'kind_mismatch' }); continue; }
      const recordedAt = new Date(op.recordedAt);
      if (recordedAt.getTime() > Date.now() + 5 * 60_000) { conflicts.push({ opId: op.opId, reason: 'timestamp_in_future' }); continue; }
      const ins = await tx.insert(inspectionResponses).values({
        orgId: p.orgId, inspectionId: id, stepId: op.stepId, value: op.value as StepValue, outcome: stepOutcome(step, op.value as StepValue), note: op.note,
        recordedAt, recordedBy: p.userId, deviceId: p.deviceId, clientOpId: op.opId,
      }).onConflictDoNothing({ target: [inspectionResponses.inspectionId, inspectionResponses.clientOpId] }).returning({ id: inspectionResponses.id });
      if (ins.length) applied++; else duplicates++;
    }
    let cur = i;
    if (applied && i.status !== 'in_progress') {
      [cur] = (await tx.update(inspections).set({ status: 'in_progress', startedAt: i.startedAt ?? new Date(), pausedAt: null, revision: i.revision + 1, updatedAt: new Date() }).where(eq(inspections.id, id)).returning()) as [typeof i];
    }
    if (applied) ctx.bus.publish({ type: 'inspection.updated', orgId: p.orgId, siteId: i.siteId, permission: 'inspection.read', payload: { id, status: cur.status, progressChanged: true } });
    return { applied, duplicates, conflicts, inspection: await inspectionView(tx, cur) };
  }));

  app.post('/inspections/:id/:action', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    const { id, action } = z.object({ id: z.uuid(), action: z.enum(Object.keys(INSPECTION_TRANSITIONS) as [InspectionAction, ...InspectionAction[]]) }).parse(req.params);
    const body = z.object({ note: z.string().trim().max(2000).optional(), expectedRevision: z.number().int().optional(), createFollowUp: z.boolean().optional() }).parse(req.body ?? {});
    const i = await loadInspection(tx, p, id);
    const isAssignee = i.assignedTo === p.userId;
    if (['start', 'pause', 'submit'].includes(action)) {
      requirePerm(p, 'inspection.execute');
      if (!isAssignee) throw forbidden('Only the assigned person can do this');
    } else if (action === 'approve' || action === 'reject') {
      requirePerm(p, 'inspection.review');
      if (isAssignee) throw forbidden('Inspections must be reviewed by someone other than the person who performed them');
    } else requirePerm(p, 'inspection.manage');
    if (body.expectedRevision !== undefined && body.expectedRevision !== i.revision) throw conflict('revision_conflict', 'This inspection changed since you loaded it', { revision: i.revision, status: i.status });
    if (!canTransitionInspection(i.status, action)) throw conflict('invalid_transition', `Cannot ${action} an inspection that is ${i.status}`, { status: i.status });
    if (action === 'reject' && !body.note) throw badRequest('note_required', 'Explain what needs to be corrected');
    const latest = await latestResponses(tx, id);
    if (action === 'submit') {
      const progress = inspectionProgress(i.steps, new Map([...latest].map(([k, v]) => [k, { outcome: v.outcome }])));
      if (!progress.complete) throw badRequest('incomplete', `${progress.required - progress.requiredAnswered} required step(s) still open`, progress);
    }
    const now = new Date();
    const to = INSPECTION_TRANSITIONS[action].to;
    const patch: Partial<typeof inspections.$inferInsert> = { status: to, revision: i.revision + 1, updatedAt: now };
    if (action === 'start') Object.assign(patch, { startedAt: i.startedAt ?? now, pausedAt: null });
    if (action === 'pause') patch.pausedAt = now;
    if (action === 'submit') Object.assign(patch, { submittedAt: now, submittedVia: p.kind === 'device' ? 'glasses' : 'console', submittedDeviceId: p.deviceId ?? null });
    if (action === 'approve' || action === 'reject') Object.assign(patch, { reviewedBy: p.userId, reviewedAt: now, reviewNote: body.note ?? null });
    const [u] = await tx.update(inspections).set(patch).where(and(eq(inspections.id, id), eq(inspections.revision, i.revision))).returning();
    if (!u) throw conflict('revision_conflict', 'This inspection changed while you were working. Refresh and try again.');
    await audit(tx, p, { orgId: p.orgId, action: `inspection.${action === 'approve' ? 'approved' : action === 'reject' ? 'returned' : action === 'submit' ? 'submitted' : action}`, entityType: 'inspection', entityId: id, summary: i.title, metadata: { via: p.kind, note: body.note } });

    // Abnormal findings on submit automatically open a follow-up maintenance request.
    let followUpId: string | null = null;
    if (action === 'submit') {
      const abnormal = i.steps.filter((s) => latest.get(s.id)?.outcome === 'abnormal');
      if (abnormal.length && (body.createFollowUp ?? true)) {
        const [t] = await tx.insert(maintenanceTasks).values({
          orgId: p.orgId, siteId: i.siteId, assetId: i.assetId, title: `Follow up: ${abnormal.length} abnormal finding(s) on ${i.title}`,
          description: abnormal.map((s) => `• ${s.title}${latest.get(s.id)?.note ? ` — ${latest.get(s.id)!.note}` : ''}`).join('\n'),
          kind: 'inspection_followup', priority: abnormal.length > 1 ? 'high' : 'medium', requestedBy: p.userId, sourceInspectionId: id, synthetic: i.synthetic,
        }).returning();
        followUpId = t!.id;
        await audit(tx, p, { orgId: p.orgId, action: 'maintenance.created', entityType: 'maintenance', entityId: t!.id, summary: t!.title });
        ctx.bus.publish({ type: 'maintenance.updated', orgId: p.orgId, siteId: i.siteId, permission: 'maintenance.read', payload: { id: t!.id, status: 'open' } });
      }
      if (i.assignedBy && i.assignedBy !== p.userId) {
        await notify(tx, ctx.bus, { orgId: p.orgId, userIds: [i.assignedBy], kind: 'inspection_submitted', title: `Inspection submitted: ${i.title}`, link: `/console/inspections/${id}`, entityType: 'inspection', entityId: id, severity: abnormal.length ? 'warning' : 'success' });
      }
    }
    if ((action === 'reject' || action === 'approve') && i.assignedTo) {
      await notify(tx, ctx.bus, { orgId: p.orgId, userIds: [i.assignedTo], kind: `inspection_${action}`, title: `${action === 'approve' ? 'Approved' : 'Returned for correction'}: ${i.title}`, body: body.note, link: `/console/inspections/${id}`, entityType: 'inspection', entityId: id, severity: action === 'approve' ? 'success' : 'warning' });
    }
    ctx.bus.publish({ type: 'inspection.updated', orgId: p.orgId, siteId: i.siteId, permission: 'inspection.read', payload: { id, status: u.status, assignedTo: u.assignedTo } });
    return { inspection: await inspectionView(tx, u), followUpId };
  }));

  void isNull;
}
