import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  ASSET_STATUSES, ASSET_TYPES, CRITICALITIES, DOCUMENT_KINDS, FACILITY_KINDS, MEASURANDS, MEASURAND_DEFS, OPEN_ALARM_STATES,
  PROCESS_AREA_KINDS, freshness, type Permission,
} from '@hydris/domain';
import type { Ctx } from '../context';
import { authenticate, tenant } from '../context';
import {
  alarmEvents, alarmRules, assets, attachments, auditEvents, documents, facilities, gateways, inspectionTemplates, inspections, maintenanceTasks, processAreas, sensors, sites, users,
} from '../db/schema';
import { badRequest, conflict, notFound } from '../core/errors';
import { has, requirePerm, requireSite, siteScope } from '../core/principal';
import { randomToken, sha256 } from '../core/crypto';
import { audit } from '../core/services';
import type { Tx } from '../db/client';

const idParam = z.object({ id: z.uuid() });
const code = z.string().trim().min(1).max(24).regex(/^[A-Za-z0-9._-]+$/, 'Use letters, digits, dot, dash or underscore');
const optText = (max: number) => z.string().trim().max(max).nullable().optional();

/** Thrown when a delete would orphan operational history; callers should archive instead. */
const inUse = (what: string) => conflict('in_use', `${what} still has dependent records. Archive it instead.`);

export async function plantRoutes(app: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: authenticate(ctx) };

  // ---------------- Sites ----------------
  const siteBody = z.object({
    name: z.string().trim().min(2).max(120), code, address: optText(200), city: optText(80), country: optText(80),
    lat: z.number().min(-90).max(90).nullable().optional(), lng: z.number().min(-180).max(180).nullable().optional(),
    timezone: z.string().max(60).optional(), layoutWidthM: z.number().min(10).max(5000).optional(), layoutHeightM: z.number().min(10).max(5000).optional(),
  });

  app.get('/sites', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    const q = z.object({ archived: z.enum(['true', 'false']).default('false') }).parse(req.query);
    const rows = await tx.select({
      site: sites,
      facilities: sql<number>`(select count(*)::int from facilities f where f.site_id = ${sites.id} and f.archived_at is null)`,
      assets: sql<number>`(select count(*)::int from assets a where a.site_id = ${sites.id} and a.archived_at is null)`,
      openAlarms: sql<number>`(select count(*)::int from alarm_events e where e.site_id = ${sites.id} and e.state in ('active','acknowledged','investigating'))`,
      criticalAlarms: sql<number>`(select count(*)::int from alarm_events e where e.site_id = ${sites.id} and e.state = 'active' and e.severity = 'critical')`,
    }).from(sites).where(and(siteScope(p, sites.id), q.archived === 'true' ? undefined : isNull(sites.archivedAt))).orderBy(asc(sites.name));
    return { sites: rows.map((r) => ({ ...r.site, facilities: r.facilities, assets: r.assets, openAlarms: r.openAlarms, criticalAlarms: r.criticalAlarms })) };
  }));

  app.post('/sites', auth, async (req, reply) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'site.manage');
    if (!p.allSites) throw badRequest('forbidden_scope', 'Only organization-wide managers can create sites');
    const body = siteBody.parse(req.body);
    const [dupe] = await tx.select({ id: sites.id }).from(sites).where(eq(sites.code, body.code));
    if (dupe) throw conflict('code_taken', 'A site with that code already exists');
    const [s] = await tx.insert(sites).values({ ...body, orgId: p.orgId }).returning();
    await audit(tx, p, { orgId: p.orgId, action: 'site.created', entityType: 'site', entityId: s!.id, summary: s!.name });
    return reply.code(201).send({ site: s });
  }));

  app.get('/sites/:id', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    const { id } = idParam.parse(req.params);
    requireSite(p, id, 'Site');
    const [s] = await tx.select().from(sites).where(eq(sites.id, id));
    if (!s) throw notFound('Site');
    const facs = await tx.select().from(facilities).where(and(eq(facilities.siteId, id), isNull(facilities.archivedAt))).orderBy(asc(facilities.code));
    const areas = await tx.select().from(processAreas).where(and(eq(processAreas.siteId, id), isNull(processAreas.archivedAt))).orderBy(asc(processAreas.sortOrder), asc(processAreas.code));
    const assetRows = await assetSummaries(tx, eq(assets.siteId, id));
    const gws = await tx.select({ id: gateways.id, name: gateways.name, protocol: gateways.protocol, keyPrefix: gateways.keyPrefix, status: gateways.status, lastSeenAt: gateways.lastSeenAt, createdAt: gateways.createdAt })
      .from(gateways).where(eq(gateways.siteId, id)).orderBy(desc(gateways.createdAt));
    return { site: s, facilities: facs, processAreas: areas, assets: assetRows, gateways: gws };
  }));

  app.patch('/sites/:id', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'site.manage');
    const { id } = idParam.parse(req.params);
    requireSite(p, id, 'Site');
    const body = siteBody.partial().parse(req.body);
    const [s] = await tx.update(sites).set({ ...body, updatedAt: new Date() }).where(eq(sites.id, id)).returning();
    if (!s) throw notFound('Site');
    await audit(tx, p, { orgId: p.orgId, action: 'site.updated', entityType: 'site', entityId: id, metadata: body });
    return { site: s };
  }));

  app.post('/sites/:id/archive', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'site.manage');
    const { id } = idParam.parse(req.params);
    requireSite(p, id, 'Site');
    const { archived } = z.object({ archived: z.boolean() }).parse(req.body);
    const [s] = await tx.update(sites).set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() }).where(eq(sites.id, id)).returning();
    if (!s) throw notFound('Site');
    await audit(tx, p, { orgId: p.orgId, action: archived ? 'site.archived' : 'site.restored', entityType: 'site', entityId: id, summary: s.name });
    return { site: s };
  }));

  // ---------------- Facilities & process areas ----------------
  const facilityBody = z.object({ siteId: z.uuid(), name: z.string().trim().min(2).max(120), code, kind: z.enum(FACILITY_KINDS), capacityM3PerDay: z.number().positive().nullable().optional(), description: optText(500) });

  app.post('/facilities', auth, async (req, reply) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'site.manage');
    const body = facilityBody.parse(req.body);
    requireSite(p, body.siteId, 'Site');
    await mustExist(tx, sites, body.siteId, 'Site');
    const [f] = await tx.insert(facilities).values({ ...body, orgId: p.orgId }).returning().catch(dupe('code_taken', 'Facility code already used on this site'));
    await audit(tx, p, { orgId: p.orgId, action: 'facility.created', entityType: 'facility', entityId: f!.id, summary: f!.name });
    return reply.code(201).send({ facility: f });
  }));

  app.patch('/facilities/:id', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'site.manage');
    const { id } = idParam.parse(req.params);
    const cur = await scopedRow(tx, facilities, id, p, 'Facility');
    const body = facilityBody.omit({ siteId: true }).partial().extend({ archived: z.boolean().optional() }).parse(req.body);
    const { archived, ...rest } = body;
    const [f] = await tx.update(facilities).set({ ...rest, archivedAt: archived === undefined ? undefined : archived ? new Date() : null, updatedAt: new Date() }).where(eq(facilities.id, cur.id)).returning();
    await audit(tx, p, { orgId: p.orgId, action: 'facility.updated', entityType: 'facility', entityId: id, metadata: body });
    return { facility: f };
  }));

  const areaBody = z.object({
    facilityId: z.uuid(), name: z.string().trim().min(2).max(120), code, kind: z.enum(PROCESS_AREA_KINDS), sortOrder: z.number().int().optional(),
    polygon: z.array(z.tuple([z.number(), z.number()])).min(3).max(64).nullable().optional(),
  });

  app.post('/process-areas', auth, async (req, reply) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'site.manage');
    const body = areaBody.parse(req.body);
    const fac = await scopedRow(tx, facilities, body.facilityId, p, 'Facility');
    const [a] = await tx.insert(processAreas).values({ ...body, orgId: p.orgId, siteId: fac.siteId }).returning().catch(dupe('code_taken', 'Process area code already used in this facility'));
    await audit(tx, p, { orgId: p.orgId, action: 'process_area.created', entityType: 'process_area', entityId: a!.id, summary: a!.name });
    return reply.code(201).send({ processArea: a });
  }));

  app.patch('/process-areas/:id', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'site.manage');
    const { id } = idParam.parse(req.params);
    await scopedRow(tx, processAreas, id, p, 'Process area');
    const body = areaBody.omit({ facilityId: true }).partial().extend({ archived: z.boolean().optional() }).parse(req.body);
    const { archived, ...rest } = body;
    const [a] = await tx.update(processAreas).set({ ...rest, archivedAt: archived === undefined ? undefined : archived ? new Date() : null, updatedAt: new Date() }).where(eq(processAreas.id, id)).returning();
    await audit(tx, p, { orgId: p.orgId, action: 'process_area.updated', entityType: 'process_area', entityId: id, metadata: body });
    return { processArea: a };
  }));

  // ---------------- Assets ----------------
  async function assetSummaries(tx: Tx, where: ReturnType<typeof and>) {
    const rows = await tx.select({
      asset: assets, areaName: processAreas.name, facilityName: facilities.name, siteName: sites.name,
      openAlarms: sql<number>`(select count(*)::int from alarm_events e where e.asset_id = ${assets.id} and e.state in ('active','acknowledged','investigating'))`,
      worstSeverity: sql<string | null>`(select e.severity from alarm_events e where e.asset_id = ${assets.id} and e.state in ('active','acknowledged','investigating') order by case e.severity when 'critical' then 4 when 'high' then 3 when 'medium' then 2 else 1 end desc limit 1)`,
      sensorCount: sql<number>`(select count(*)::int from sensors s where s.asset_id = ${assets.id} and s.archived_at is null)`,
      openTasks: sql<number>`(select count(*)::int from maintenance_tasks t where t.asset_id = ${assets.id} and t.status in ('open','assigned','in_progress','on_hold'))`,
    }).from(assets)
      .innerJoin(facilities, eq(facilities.id, assets.facilityId))
      .innerJoin(sites, eq(sites.id, assets.siteId))
      .leftJoin(processAreas, eq(processAreas.id, assets.processAreaId))
      .where(where).orderBy(asc(assets.tag));
    return rows.map((r) => ({ ...r.asset, areaName: r.areaName, facilityName: r.facilityName, siteName: r.siteName, openAlarms: r.openAlarms, worstSeverity: r.worstSeverity, sensorCount: r.sensorCount, openTasks: r.openTasks }));
  }

  app.get('/assets', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    const q = z.object({
      siteId: z.uuid().optional(), facilityId: z.uuid().optional(), processAreaId: z.uuid().optional(), type: z.enum(ASSET_TYPES).optional(),
      status: z.enum(ASSET_STATUSES).optional(), q: z.string().max(80).optional(), archived: z.enum(['true', 'false']).default('false'),
    }).parse(req.query);
    return {
      assets: await assetSummaries(tx, and(
        siteScope(p, assets.siteId),
        q.siteId ? eq(assets.siteId, q.siteId) : undefined,
        q.facilityId ? eq(assets.facilityId, q.facilityId) : undefined,
        q.processAreaId ? eq(assets.processAreaId, q.processAreaId) : undefined,
        q.type ? eq(assets.type, q.type) : undefined,
        q.status ? eq(assets.status, q.status) : undefined,
        q.q ? or(ilike(assets.tag, `%${q.q}%`), ilike(assets.name, `%${q.q}%`), ilike(assets.manufacturer, `%${q.q}%`)) : undefined,
        q.archived === 'true' ? undefined : isNull(assets.archivedAt),
      )),
    };
  }));

  const assetBody = z.object({
    facilityId: z.uuid(), processAreaId: z.uuid().nullable().optional(), tag: code, name: z.string().trim().min(2).max(120), type: z.enum(ASSET_TYPES),
    manufacturer: optText(80), model: optText(80), serialNumber: optText(80), installedOn: optText(20), criticality: z.enum(CRITICALITIES).optional(),
    status: z.enum(ASSET_STATUSES).optional(), specs: z.record(z.string().max(60), z.union([z.string().max(200), z.number()])).optional(),
    notes: optText(4000), positionX: z.number().min(0).nullable().optional(), positionY: z.number().min(0).nullable().optional(),
  });

  app.post('/assets', auth, async (req, reply) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'asset.manage');
    const body = assetBody.parse(req.body);
    const fac = await scopedRow(tx, facilities, body.facilityId, p, 'Facility');
    if (body.processAreaId) {
      const [a] = await tx.select().from(processAreas).where(and(eq(processAreas.id, body.processAreaId), eq(processAreas.facilityId, fac.id)));
      if (!a) throw badRequest('invalid_process_area', 'Process area does not belong to that facility');
    }
    const [a] = await tx.insert(assets).values({ ...body, orgId: p.orgId, siteId: fac.siteId }).returning().catch(dupe('tag_taken', 'An asset with that tag already exists'));
    await audit(tx, p, { orgId: p.orgId, action: 'asset.created', entityType: 'asset', entityId: a!.id, summary: `${a!.tag} ${a!.name}` });
    return reply.code(201).send({ asset: a });
  }));

  app.get('/assets/:id', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    const { id } = idParam.parse(req.params);
    const [summary] = await assetSummaries(tx, and(eq(assets.id, id), siteScope(p, assets.siteId)));
    if (!summary) throw notFound('Asset');
    const sensorRows = await tx.select().from(sensors).where(and(eq(sensors.assetId, id), isNull(sensors.archivedAt))).orderBy(asc(sensors.tag));
    const now = new Date();
    const alarms = await tx.select().from(alarmEvents).where(eq(alarmEvents.assetId, id)).orderBy(desc(alarmEvents.triggeredAt)).limit(20);
    const tasks = await tx.select().from(maintenanceTasks).where(eq(maintenanceTasks.assetId, id)).orderBy(desc(maintenanceTasks.createdAt)).limit(20);
    const insp = await tx.select({ id: inspections.id, title: inspections.title, status: inspections.status, dueAt: inspections.dueAt, submittedAt: inspections.submittedAt, assignedTo: inspections.assignedTo })
      .from(inspections).where(eq(inspections.assetId, id)).orderBy(desc(inspections.createdAt)).limit(20);
    const docs = await tx.select({ id: documents.id, title: documents.title, kind: documents.kind, status: documents.status, version: documents.version }).from(documents)
      .where(and(or(eq(documents.assetId, id), and(isNull(documents.assetId), eq(documents.assetType, summary.type))), eq(documents.status, 'approved')));
    const files = await tx.select().from(attachments).where(and(eq(attachments.ownerType, 'asset'), eq(attachments.ownerId, id)));
    return {
      asset: summary,
      sensors: sensorRows.map((s) => ({ ...s, freshness: freshness(s.lastTs, s.expectedIntervalS, now) })),
      alarms, maintenance: tasks, inspections: insp, documents: docs, attachments: files,
    };
  }));

  app.patch('/assets/:id', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    const { id } = idParam.parse(req.params);
    const cur = await scopedRow(tx, assets, id, p, 'Asset');
    const body = assetBody.omit({ facilityId: true }).partial().extend({ archived: z.boolean().optional() }).parse(req.body);
    // Field operators may only record notes and operational status; everything else needs asset.manage.
    const onlyStatusOrNotes = Object.keys(body).every((k) => k === 'status' || k === 'notes');
    requirePerm(p, onlyStatusOrNotes ? 'inspection.execute' : 'asset.manage');
    const { archived, ...rest } = body;
    if (rest.processAreaId) {
      const [area] = await tx.select({ id: processAreas.id }).from(processAreas).where(and(eq(processAreas.id, rest.processAreaId), eq(processAreas.facilityId, cur.facilityId)));
      if (!area) throw badRequest('validation_failed', 'Process area does not belong to this asset\'s facility', [{ path: 'processAreaId', message: 'Choose a process area in the same facility' }]);
    }
    const [a] = await tx.update(assets).set({ ...rest, archivedAt: archived === undefined ? undefined : archived ? new Date() : null, updatedAt: new Date() }).where(eq(assets.id, cur.id)).returning()
      .catch(dupe('tag_taken', 'An asset with that tag already exists'));
    const action = archived === true && !cur.archivedAt ? 'asset.archived' : archived === false && cur.archivedAt ? 'asset.restored' : 'asset.updated';
    await audit(tx, p, { orgId: p.orgId, action, entityType: 'asset', entityId: id, summary: a!.tag, metadata: { changes: changes(cur, rest) } });
    ctx.bus.publish({ type: 'asset.updated', orgId: p.orgId, siteId: a!.siteId, permission: 'asset.read', payload: { id, status: a!.status } });
    return { asset: a };
  }));

  app.delete('/assets/:id', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'asset.manage');
    const { id } = idParam.parse(req.params);
    await scopedRow(tx, assets, id, p, 'Asset');
    const [deps] = await tx.select({
      n: sql<number>`(select count(*)::int from sensors where asset_id = ${id}) + (select count(*)::int from alarm_events where asset_id = ${id}) + (select count(*)::int from inspections where asset_id = ${id}) + (select count(*)::int from maintenance_tasks where asset_id = ${id})`,
    }).from(sql`(select 1) x`);
    if ((deps?.n ?? 0) > 0) throw inUse('This asset');
    await tx.delete(assets).where(eq(assets.id, id));
    await audit(tx, p, { orgId: p.orgId, action: 'asset.deleted', entityType: 'asset', entityId: id });
    return { ok: true };
  }));

  // ---------------- Sensors ----------------
  const sensorBody = z.object({
    assetId: z.uuid(), tag: code, name: z.string().trim().min(2).max(120), measurand: z.enum(MEASURANDS),
    method: z.enum(['continuous', 'lab', 'manual']).optional(), expectedIntervalS: z.number().int().min(1).max(30 * 86400).optional(),
    gatewayId: z.uuid().nullable().optional(), sourceRef: optText(120), enabled: z.boolean().optional(),
  });

  app.get('/sensors', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    const q = z.object({ siteId: z.uuid().optional(), assetId: z.uuid().optional(), measurand: z.enum(MEASURANDS).optional(), q: z.string().max(80).optional(), archived: z.enum(['true', 'false', 'only']).default('false') }).parse(req.query);
    const now = new Date();
    const rows = await tx.select({
      sensor: sensors, assetTag: assets.tag, assetName: assets.name,
      openAlarms: sql<number>`(select count(*)::int from alarm_events e where e.sensor_id = ${sensors.id} and e.state in ('active','acknowledged','investigating'))`,
      rules: sql<number>`(select count(*)::int from alarm_rules r where r.sensor_id = ${sensors.id} and r.enabled)`,
    }).from(sensors).leftJoin(assets, eq(assets.id, sensors.assetId))
      .where(and(siteScope(p, sensors.siteId), q.archived === 'true' ? undefined : q.archived === 'only' ? sql`${sensors.archivedAt} is not null` : isNull(sensors.archivedAt), q.siteId ? eq(sensors.siteId, q.siteId) : undefined, q.assetId ? eq(sensors.assetId, q.assetId) : undefined,
        q.measurand ? eq(sensors.measurand, q.measurand) : undefined, q.q ? or(ilike(sensors.tag, `%${q.q}%`), ilike(sensors.name, `%${q.q}%`)) : undefined))
      .orderBy(asc(sensors.tag));
    return { sensors: rows.map((r) => ({ ...r.sensor, assetTag: r.assetTag, assetName: r.assetName, openAlarms: r.openAlarms, rules: r.rules, freshness: freshness(r.sensor.lastTs, r.sensor.expectedIntervalS, now) })) };
  }));

  app.post('/sensors', auth, async (req, reply) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'sensor.manage');
    const body = sensorBody.parse(req.body);
    const asset = await scopedRow(tx, assets, body.assetId, p, 'Asset');
    const def = MEASURAND_DEFS[body.measurand];
    const [s] = await tx.insert(sensors).values({
      ...body, orgId: p.orgId, siteId: asset.siteId, processAreaId: asset.processAreaId, unit: def.unit,
      method: body.method ?? def.defaultMethod, expectedIntervalS: body.expectedIntervalS ?? (def.defaultMethod === 'continuous' ? 60 : 86400),
    }).returning().catch(dupe('tag_taken', 'A sensor with that tag already exists'));
    await audit(tx, p, { orgId: p.orgId, action: 'sensor.created', entityType: 'sensor', entityId: s!.id, summary: s!.tag });
    return reply.code(201).send({ sensor: s });
  }));

  /** Single sensor including archived ones, with its asset and the site's gateways it may be bound to. */
  app.get('/sensors/:id', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'telemetry.read');
    const { id } = idParam.parse(req.params);
    const s = await scopedRow(tx, sensors, id, p, 'Sensor');
    const [asset] = s.assetId ? await tx.select({ id: assets.id, tag: assets.tag, name: assets.name }).from(assets).where(eq(assets.id, s.assetId)) : [];
    const gws = await tx.select({ id: gateways.id, name: gateways.name, status: gateways.status, protocol: gateways.protocol }).from(gateways).where(eq(gateways.siteId, s.siteId)).orderBy(asc(gateways.name));
    const [counts] = await tx.select({
      rules: sql<number>`(select count(*)::int from alarm_rules r where r.sensor_id = ${id})`,
      readings: sql<number>`(select count(*)::int from telemetry_readings t where t.sensor_id = ${id})`,
      corrections: sql<number>`(select count(*)::int from telemetry_corrections c where c.sensor_id = ${id})`,
    }).from(sql`(select 1) x`);
    return {
      sensor: { ...s, freshness: freshness(s.lastTs, s.expectedIntervalS), label: MEASURAND_DEFS[s.measurand].label, decimals: MEASURAND_DEFS[s.measurand].decimals },
      asset: asset ?? null, gateway: gws.find((g) => g.id === s.gatewayId) ?? null, gateways: gws.filter((g) => g.status === 'active' || g.id === s.gatewayId), counts,
    };
  }));

  app.patch('/sensors/:id', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'sensor.manage');
    const { id } = idParam.parse(req.params);
    const cur = await scopedRow(tx, sensors, id, p, 'Sensor');
    const body = sensorBody.omit({ assetId: true, measurand: true }).partial().extend({ archived: z.boolean().optional() }).parse(req.body);
    const { archived, ...rest } = body;
    if (rest.gatewayId) {
      const [g] = await tx.select().from(gateways).where(eq(gateways.id, rest.gatewayId));
      if (!g || g.siteId !== cur.siteId) throw badRequest('validation_failed', 'Gateway must be on the same site as the sensor', [{ path: 'gatewayId', message: 'Choose a gateway on this site' }]);
      if (g.status !== 'active' && g.id !== cur.gatewayId) throw badRequest('validation_failed', 'That gateway is revoked', [{ path: 'gatewayId', message: 'Gateway is revoked' }]);
    }
    if (rest.sourceRef) {
      const [clash] = await tx.select({ id: sensors.id }).from(sensors)
        .where(and(eq(sensors.siteId, cur.siteId), or(eq(sensors.sourceRef, rest.sourceRef), eq(sensors.tag, rest.sourceRef)), sql`${sensors.id} <> ${id}`));
      if (clash) throw conflict('source_ref_taken', 'Another sensor on this site already uses that gateway reference', [{ path: 'sourceRef', message: 'Already used on this site' }]);
    }
    const [s] = await tx.update(sensors).set({ ...rest, archivedAt: archived === undefined ? undefined : archived ? new Date() : null, updatedAt: new Date() }).where(eq(sensors.id, id)).returning()
      .catch(dupe('tag_taken', 'A sensor with that tag already exists'));
    const action = archived === true && !cur.archivedAt ? 'sensor.archived' : archived === false && cur.archivedAt ? 'sensor.restored' : 'sensor.updated';
    await audit(tx, p, { orgId: p.orgId, action, entityType: 'sensor', entityId: id, summary: s!.tag, metadata: { changes: changes(cur, rest) } });
    ctx.bus.publish({ type: 'sensor.updated', orgId: p.orgId, siteId: s!.siteId, permission: 'telemetry.read', payload: { id } });
    return { sensor: s };
  }));

  // ---------------- Gateways (edge ingestion credentials) ----------------
  app.post('/gateways', auth, async (req, reply) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'gateway.manage');
    const body = z.object({ siteId: z.uuid(), name: z.string().trim().min(2).max(80), protocol: z.enum(['https', 'mqtt', 'opcua']).default('https') }).parse(req.body);
    requireSite(p, body.siteId, 'Site');
    await mustExist(tx, sites, body.siteId, 'Site');
    const secret = `hgw_${randomToken(32)}`;
    const [g] = await tx.insert(gateways).values({ ...body, orgId: p.orgId, keyPrefix: secret.slice(0, 10), keyHash: sha256(secret), createdBy: p.userId }).returning();
    await audit(tx, p, { orgId: p.orgId, action: 'gateway.created', entityType: 'gateway', entityId: g!.id, summary: g!.name });
    // The key is shown exactly once.
    return reply.code(201).send({ gateway: { id: g!.id, name: g!.name, keyPrefix: g!.keyPrefix }, apiKey: secret });
  }));

  app.post('/gateways/:id/revoke', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'gateway.manage');
    const { id } = idParam.parse(req.params);
    await scopedRow(tx, gateways, id, p, 'Gateway');
    await tx.update(gateways).set({ status: 'revoked', revokedAt: new Date() }).where(eq(gateways.id, id));
    await audit(tx, p, { orgId: p.orgId, action: 'gateway.revoked', entityType: 'gateway', entityId: id });
    return { ok: true };
  }));

  // ---------------- Documents / SOPs ----------------
  const docBody = z.object({
    title: z.string().trim().min(3).max(160), kind: z.enum(DOCUMENT_KINDS), body: z.string().min(1).max(100_000),
    siteId: z.uuid().nullable().optional(), assetId: z.uuid().nullable().optional(), assetType: z.enum(ASSET_TYPES).nullable().optional(), tags: z.array(z.string().max(40)).max(20).optional(),
  });

  app.get('/documents', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'document.read');
    const q = z.object({ q: z.string().max(100).optional(), kind: z.enum(DOCUMENT_KINDS).optional(), assetId: z.uuid().optional(), status: z.enum(['draft', 'approved', 'archived']).optional() }).parse(req.query);
    const rows = await tx.select({ id: documents.id, title: documents.title, kind: documents.kind, status: documents.status, version: documents.version, assetId: documents.assetId, assetType: documents.assetType, siteId: documents.siteId, tags: documents.tags, updatedAt: documents.updatedAt, approvedAt: documents.approvedAt })
      .from(documents)
      .where(and(
        or(isNull(documents.siteId), siteScope(p, documents.siteId) ?? sql`true`),
        q.kind ? eq(documents.kind, q.kind) : undefined, q.assetId ? eq(documents.assetId, q.assetId) : undefined,
        q.status ? eq(documents.status, q.status) : p.role === 'operator' || p.kind === 'device' ? eq(documents.status, 'approved') : undefined,
        q.q ? or(ilike(documents.title, `%${q.q}%`), sql`to_tsvector('english', ${documents.body}) @@ websearch_to_tsquery('english', ${q.q})`) : undefined,
      )).orderBy(desc(documents.updatedAt));
    return { documents: rows };
  }));

  app.get('/documents/:id', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'document.read');
    const { id } = idParam.parse(req.params);
    const [d] = await tx.select().from(documents).where(eq(documents.id, id));
    if (!d || (d.siteId && !p.allSites && !p.siteIds.includes(d.siteId))) throw notFound('Document');
    if (d.status !== 'approved' && (p.role === 'operator' || p.kind === 'device')) throw notFound('Document');
    return { document: d };
  }));

  app.post('/documents', auth, async (req, reply) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'document.manage');
    const body = docBody.parse(req.body);
    if (body.siteId) requireSite(p, body.siteId, 'Site');
    if (body.assetId) await scopedRow(tx, assets, body.assetId, p, 'Asset');
    const [d] = await tx.insert(documents).values({ ...body, orgId: p.orgId, createdBy: p.userId }).returning();
    await audit(tx, p, { orgId: p.orgId, action: 'document.created', entityType: 'document', entityId: d!.id, summary: d!.title });
    return reply.code(201).send({ document: d });
  }));

  app.patch('/documents/:id', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'document.manage');
    const { id } = idParam.parse(req.params);
    const body = docBody.partial().extend({ status: z.enum(['draft', 'approved', 'archived']).optional() }).parse(req.body);
    const [cur] = await tx.select().from(documents).where(eq(documents.id, id));
    if (!cur || (cur.siteId && !p.allSites && !p.siteIds.includes(cur.siteId))) throw notFound('Document');
    if (body.siteId) requireSite(p, body.siteId, 'Site');
    if (body.siteId === null && !p.allSites) throw badRequest('forbidden_scope', 'Only organization-wide managers can make a document organization-wide');
    if (body.assetId) {
      const a = await scopedRow(tx, assets, body.assetId, p, 'Asset');
      const site = body.siteId === undefined ? cur.siteId : body.siteId;
      if (site && a.siteId !== site) throw badRequest('validation_failed', 'Asset is on a different site', [{ path: 'assetId', message: 'Asset is on a different site' }]);
    }
    const contentChanged = body.body !== undefined && body.body !== cur.body;
    const [d] = await tx.update(documents).set({
      ...body,
      // Editing approved content creates a new draft version that must be approved again.
      version: contentChanged ? cur.version + 1 : undefined,
      status: contentChanged && cur.status === 'approved' && body.status !== 'approved' ? 'draft' : body.status,
      approvedBy: body.status === 'approved' ? p.userId : undefined, approvedAt: body.status === 'approved' ? new Date() : undefined, updatedAt: new Date(),
    }).where(eq(documents.id, id)).returning();
    const { body: _content, ...meta } = body;
    void _content;
    await audit(tx, p, {
      orgId: p.orgId,
      action: body.status === 'approved' ? 'document.approved' : body.status === 'archived' ? 'document.archived' : body.status === 'draft' && cur.status === 'archived' ? 'document.restored' : 'document.updated',
      entityType: 'document', entityId: id, summary: `${d!.title} v${d!.version}`, metadata: { changes: changes(cur, meta), contentChanged, version: d!.version },
    });
    return { document: d };
  }));

  // ---------------- Attachments (evidence, asset files) ----------------
  const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain']);
  const MAGIC: [string, number[]][] = [['image/jpeg', [0xff, 0xd8, 0xff]], ['image/png', [0x89, 0x50, 0x4e, 0x47]], ['application/pdf', [0x25, 0x50, 0x44, 0x46]], ['image/webp', [0x52, 0x49, 0x46, 0x46]]];

  app.post('/attachments', auth, async (req, reply) => {
    const file = await req.file();
    if (!file) throw badRequest('file_required');
    const fields = z.object({ ownerType: z.enum(['inspection', 'maintenance', 'asset', 'alarm']), ownerId: z.uuid() })
      .parse(Object.fromEntries(Object.entries(file.fields).map(([k, v]) => [k, (v as { value?: string }).value])));
    const buf = await file.toBuffer();
    if (!ALLOWED_MIME.has(file.mimetype)) throw badRequest('unsupported_type', 'Allowed: JPEG, PNG, WebP, PDF, plain text');
    const magic = MAGIC.find(([m]) => m === file.mimetype);
    if (magic && !magic[1].every((b, i) => buf[i] === b)) throw badRequest('content_mismatch', 'File content does not match its type');
    return tenant(ctx, req, async (tx, p) => {
      const ownerTable = { inspection: inspections, maintenance: maintenanceTasks, asset: assets, alarm: alarmEvents }[fields.ownerType];
      const owner = await scopedRow(tx, ownerTable as typeof assets, fields.ownerId, p, 'Record');
      requirePerm(p, fields.ownerType === 'asset' ? 'asset.manage' : fields.ownerType === 'inspection' ? 'inspection.execute' : fields.ownerType === 'alarm' ? 'alarm.acknowledge' : 'maintenance.request');
      const key = await ctx.storage.put(p.orgId, buf, file.mimetype);
      const [a] = await tx.insert(attachments).values({
        orgId: p.orgId, ownerType: fields.ownerType, ownerId: owner.id, filename: file.filename.replace(/[^\w.\- ]/g, '_').slice(0, 120), mime: file.mimetype,
        sizeBytes: buf.length, sha256: sha256(buf.toString('binary')), storageKey: key, uploadedBy: p.userId, deviceId: p.deviceId,
      }).returning();
      await audit(tx, p, { orgId: p.orgId, action: 'attachment.uploaded', entityType: fields.ownerType, entityId: owner.id, summary: a!.filename });
      return reply.code(201).send({ attachment: a });
    });
  });

  app.get('/attachments/:id', auth, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const a = await tenant(ctx, req, async (tx) => {
      const [row] = await tx.select().from(attachments).where(eq(attachments.id, id));
      if (!row) throw notFound('Attachment');
      return row;
    });
    const data = await ctx.storage.get(a.storageKey);
    return reply.header('content-type', a.mime).header('content-disposition', `inline; filename="${a.filename}"`).header('x-content-type-options', 'nosniff').send(data);
  });

  // ---------------- Entity change history (audit trail per record) ----------------
  type Locate = (tx: Tx, id: string) => Promise<{ found: boolean; siteId: string | null }>;
  const HISTORY: Record<string, { perm: Permission; locate: Locate }> = {
    asset: { perm: 'asset.read', locate: async (tx, id) => one(await tx.select({ siteId: assets.siteId }).from(assets).where(eq(assets.id, id))) },
    sensor: { perm: 'telemetry.read', locate: async (tx, id) => one(await tx.select({ siteId: sensors.siteId }).from(sensors).where(eq(sensors.id, id))) },
    alarm_rule: { perm: 'alarm.read', locate: async (tx, id) => one(await tx.select({ siteId: alarmRules.siteId }).from(alarmRules).where(eq(alarmRules.id, id))) },
    maintenance: { perm: 'maintenance.read', locate: async (tx, id) => one(await tx.select({ siteId: maintenanceTasks.siteId }).from(maintenanceTasks).where(eq(maintenanceTasks.id, id))) },
    document: { perm: 'document.read', locate: async (tx, id) => one(await tx.select({ siteId: documents.siteId }).from(documents).where(eq(documents.id, id))) },
    inspection_template: { perm: 'inspection.read', locate: async (tx, id) => one((await tx.select({ id: inspectionTemplates.id }).from(inspectionTemplates).where(eq(inspectionTemplates.id, id))).map(() => ({ siteId: null }))) },
  };
  app.get('/history/:entityType/:entityId', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    const { entityType, entityId } = z.object({ entityType: z.enum(Object.keys(HISTORY) as [string, ...string[]]), entityId: z.uuid() }).parse(req.params);
    const q = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(req.query);
    const def = HISTORY[entityType]!;
    requirePerm(p, def.perm);
    const ent = await def.locate(tx, entityId);
    // RLS already limits rows to this tenant; site scope is enforced here (404 so existence is not disclosed).
    if (!ent.found || (ent.siteId && !p.allSites && !p.siteIds.includes(ent.siteId))) throw notFound('Record');
    if (entityType === 'document' && !has(p, 'document.manage')) {
      const [d] = await tx.select({ status: documents.status }).from(documents).where(eq(documents.id, entityId));
      if (d?.status !== 'approved') throw notFound('Record');
    }
    const evs = await tx.select({ e: auditEvents, actorName: users.name }).from(auditEvents).leftJoin(users, eq(users.id, auditEvents.actorUserId))
      .where(and(eq(auditEvents.entityType, entityType), eq(auditEvents.entityId, entityId))).orderBy(desc(auditEvents.at)).limit(q.limit);
    return {
      events: evs.map(({ e, actorName }) => ({
        id: e.id, action: e.action, summary: e.summary, metadata: e.metadata, at: e.at,
        actor: e.actorUserId ? { id: e.actorUserId, name: actorName } : e.actorDeviceId ? { id: e.actorDeviceId, name: e.actorLabel ?? 'Device' } : { id: null, name: e.actorLabel ?? 'System' },
      })),
    };
  }));

  // ---------------- Hierarchy tree (site navigator) ----------------
  app.get('/hierarchy', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    const siteRows = await tx.select({ id: sites.id, name: sites.name, code: sites.code }).from(sites).where(and(siteScope(p, sites.id), isNull(sites.archivedAt)));
    const ids = siteRows.map((s) => s.id);
    if (!ids.length) return { sites: [] };
    const facs = await tx.select({ id: facilities.id, siteId: facilities.siteId, name: facilities.name, code: facilities.code, kind: facilities.kind }).from(facilities).where(and(inArray(facilities.siteId, ids), isNull(facilities.archivedAt)));
    const areas = await tx.select({ id: processAreas.id, facilityId: processAreas.facilityId, name: processAreas.name, code: processAreas.code, kind: processAreas.kind }).from(processAreas).where(and(inArray(processAreas.siteId, ids), isNull(processAreas.archivedAt))).orderBy(asc(processAreas.sortOrder));
    const as = await assetSummaries(tx, and(inArray(assets.siteId, ids), isNull(assets.archivedAt)));
    const ss = await tx.select({ id: sensors.id, assetId: sensors.assetId, tag: sensors.tag, measurand: sensors.measurand, lastValue: sensors.lastValue, lastTs: sensors.lastTs, unit: sensors.unit, expectedIntervalS: sensors.expectedIntervalS })
      .from(sensors).where(and(inArray(sensors.siteId, ids), isNull(sensors.archivedAt)));
    const now = new Date();
    return {
      sites: siteRows.map((s) => ({
        ...s,
        facilities: facs.filter((f) => f.siteId === s.id).map((f) => ({
          ...f,
          processAreas: areas.filter((a) => a.facilityId === f.id).map((a) => ({
            ...a,
            assets: as.filter((x) => x.processAreaId === a.id).map((x) => ({
              id: x.id, tag: x.tag, name: x.name, type: x.type, status: x.status, openAlarms: x.openAlarms, worstSeverity: x.worstSeverity,
              sensors: ss.filter((z) => z.assetId === x.id).map((z) => ({ ...z, freshness: freshness(z.lastTs, z.expectedIntervalS, now) })),
            })),
          })),
          unassignedAssets: as.filter((x) => x.facilityId === f.id && !x.processAreaId).map((x) => ({ id: x.id, tag: x.tag, name: x.name, type: x.type, status: x.status })),
        })),
      })),
    };
  }));

  void OPEN_ALARM_STATES;
}

// ---------------- helpers ----------------
const one = (r: { siteId: string | null }[]) => (r[0] ? { found: true, siteId: r[0].siteId } : { found: false, siteId: null });

/** Field-level before/after for audit metadata (only fields that actually changed). */
export function changes(cur: object, next: object): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  const c = cur as Record<string, unknown>;
  for (const [k, v] of Object.entries(next)) {
    if (v === undefined) continue;
    const before = c[k] instanceof Date ? (c[k] as Date).toISOString() : c[k];
    const after = v instanceof Date ? v.toISOString() : v;
    if (JSON.stringify(before ?? null) !== JSON.stringify(after ?? null)) out[k] = { from: before ?? null, to: after ?? null };
  }
  return out;
}
type ScopedTable = typeof facilities | typeof processAreas | typeof assets | typeof sensors | typeof gateways;

export async function scopedRow<T extends ScopedTable>(tx: Tx, table: T, id: string, p: { allSites: boolean; siteIds: string[] }, what: string): Promise<T['$inferSelect']> {
  const [row] = await tx.select().from(table as typeof assets).where(eq((table as typeof assets).id, id));
  if (!row || (!p.allSites && !p.siteIds.includes(row.siteId))) throw notFound(what);
  return row as T['$inferSelect'];
}

async function mustExist(tx: Tx, table: typeof sites, id: string, what: string) {
  const [r] = await tx.select({ id: table.id }).from(table).where(eq(table.id, id));
  if (!r) throw notFound(what);
}

function dupe(code: string, message: string) {
  return (e: unknown): never => {
    const err = e as { code?: string; cause?: { code?: string } };
    if (err.code === '23505' || err.cause?.code === '23505') throw conflict(code, message);
    throw e;
  };
}
export { dupe };
