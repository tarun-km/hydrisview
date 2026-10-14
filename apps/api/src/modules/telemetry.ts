import type { FastifyInstance } from 'fastify';
import { and, asc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { MEASURAND_DEFS, freshness, normalizeMeasurement, type TelemetrySource } from '@hydris/domain';
import type { Ctx } from '../context.js';
import { authenticate, tenant } from '../context.js';
import { gateways, organizations, sensors, telemetryReadings } from '../db/schema.js';
import { rows, type Tx } from '../db/client.js';
import { withSystem, withTenant } from '../db/tenant.js';
import { badRequest, notFound, unauthorized } from '../core/errors.js';
import { requirePerm } from '../core/principal.js';
import { sha256 } from '../core/crypto.js';
import { audit } from '../core/services.js';
import { evaluateSensor } from './alarms.js';
import { scopedRow } from './plant.js';

export interface IngestItem {
  sensorId: string;
  ts: Date;
  value: number;
  unit?: string;
  quality?: 'good' | 'uncertain' | 'bad';
  messageId?: string;
}

export interface IngestResult {
  accepted: number;
  duplicates: number;
  alarmsRaised: number;
  rejected: { index: number; reason: string }[];
}

const MAX_FUTURE_SKEW_MS = 5 * 60_000;
const MAX_AGE_MS = 30 * 24 * 3600_000;

/**
 * The single ingestion path for every source (edge gateways, manual/lab entry and the
 * demo simulator): validation, unit normalization, idempotent storage, out-of-order
 * handling, alarm evaluation and realtime fan-out.
 */
export async function ingest(ctx: Ctx, tx: Tx, orgId: string, items: IngestItem[], src: { source: TelemetrySource; isDemoOrg: boolean; restrictSiteId?: string }): Promise<IngestResult> {
  const res: IngestResult = { accepted: 0, duplicates: 0, alarmsRaised: 0, rejected: [] };
  const synthetic = src.source === 'simulator';
  if (synthetic && !src.isDemoOrg) {
    // Hard isolation: synthetic data can never enter a customer tenant.
    return { ...res, rejected: items.map((_, index) => ({ index, reason: 'synthetic_not_allowed' })) };
  }
  const ids = [...new Set(items.map((i) => i.sensorId))];
  const sensorRows = ids.length ? await tx.select().from(sensors).where(inArray(sensors.id, ids)) : [];
  const byId = new Map(sensorRows.map((s) => [s.id, s]));
  const now = Date.now();
  // Process in time order so "latest value" and alarm evaluation see a consistent sequence.
  const order = items.map((it, index) => ({ it, index })).sort((a, b) => a.it.ts.getTime() - b.it.ts.getTime());

  for (const { it, index } of order) {
    const s = byId.get(it.sensorId);
    if (!s || s.orgId !== orgId || s.archivedAt) { res.rejected.push({ index, reason: 'unknown_sensor' }); continue; }
    if (!s.enabled) { res.rejected.push({ index, reason: 'sensor_disabled' }); continue; }
    if (src.restrictSiteId && s.siteId !== src.restrictSiteId) { res.rejected.push({ index, reason: 'sensor_not_on_gateway_site' }); continue; }
    const t = it.ts.getTime();
    if (!Number.isFinite(t) || t > now + MAX_FUTURE_SKEW_MS) { res.rejected.push({ index, reason: 'timestamp_in_future' }); continue; }
    if (t < now - MAX_AGE_MS && src.source !== 'lab') { res.rejected.push({ index, reason: 'timestamp_too_old' }); continue; }
    const n = normalizeMeasurement(s.measurand, it.value, it.unit);
    if (!n.ok) { res.rejected.push({ index, reason: n.reason }); continue; }

    const inserted = await tx.insert(telemetryReadings)
      .values({ orgId, sensorId: s.id, ts: it.ts, value: n.value, quality: it.quality ?? 'good', source: src.source, synthetic, messageId: it.messageId })
      .onConflictDoNothing({ target: [telemetryReadings.sensorId, telemetryReadings.ts] })
      .returning({ id: telemetryReadings.id });
    if (!inserted.length) { res.duplicates++; continue; }
    res.accepted++;

    // Out-of-order data is stored for history but does not overwrite a newer "latest" value or re-trigger alarms.
    const isNewest = !s.lastTs || it.ts >= s.lastTs;
    if (isNewest) {
      await tx.update(sensors).set({ lastValue: n.value, lastTs: it.ts, lastQuality: it.quality ?? 'good', lastSource: src.source, lastReceivedAt: new Date() }).where(eq(sensors.id, s.id));
      Object.assign(s, { lastValue: n.value, lastTs: it.ts });
      if ((it.quality ?? 'good') !== 'bad') res.alarmsRaised += await evaluateSensor(ctx, tx, s, n.value, it.ts, synthetic);
      ctx.bus.publish({
        type: 'telemetry.reading', orgId, siteId: s.siteId, permission: 'telemetry.read',
        payload: { sensorId: s.id, assetId: s.assetId, tag: s.tag, value: n.value, unit: n.unit, ts: it.ts.toISOString(), quality: it.quality ?? 'good', source: src.source, synthetic },
      });
    }
  }
  return res;
}

export async function telemetryRoutes(app: FastifyInstance, ctx: Ctx, opts: { relaxedLimits?: boolean }) {
  const auth = { preHandler: authenticate(ctx) };

  // ---------- Edge gateway ingestion (API key, not a user session) ----------
  const readingSchema = z.object({
    sensor: z.string().min(1).max(120).describe('sensor tag or gateway source reference'),
    ts: z.iso.datetime({ offset: true }),
    value: z.number(),
    unit: z.string().max(20).optional(),
    quality: z.enum(['good', 'uncertain', 'bad']).optional(),
    messageId: z.string().max(120).optional(),
  });

  app.post('/ingest/v1/readings', { config: { rateLimit: { max: opts.relaxedLimits ? 100_000 : 1200, timeWindow: '1 minute' } } }, async (req) => {
    const key = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!key?.startsWith('hgw_')) throw unauthorized('invalid_gateway_key', 'Gateway API key required');
    const gw = await withSystem(ctx.db, async (tx) => {
      const [g] = await tx.select({ g: gateways, isDemo: organizations.isDemo }).from(gateways).innerJoin(organizations, eq(organizations.id, gateways.orgId))
        .where(and(eq(gateways.keyHash, sha256(key)), eq(gateways.status, 'active'), eq(organizations.status, 'active')));
      if (g) await tx.update(gateways).set({ lastSeenAt: new Date() }).where(eq(gateways.id, g.g.id));
      return g;
    });
    if (!gw) throw unauthorized('invalid_gateway_key', 'Gateway API key is invalid or revoked');
    const body = z.object({ readings: z.array(readingSchema).min(1).max(500) }).parse(req.body);
    return withTenant(ctx.db, gw.g.orgId, async (tx) => {
      const refs = [...new Set(body.readings.map((r) => r.sensor))];
      const rows = await tx.select({ id: sensors.id, tag: sensors.tag, sourceRef: sensors.sourceRef }).from(sensors)
        .where(and(eq(sensors.siteId, gw.g.siteId), or(inArray(sensors.tag, refs), inArray(sensors.sourceRef, refs))));
      const map = new Map<string, string>();
      for (const r of rows) {
        map.set(r.tag, r.id);
        if (r.sourceRef) map.set(r.sourceRef, r.id);
      }
      const unknown: { index: number; reason: string }[] = [];
      const items: (IngestItem & { originalIndex: number })[] = [];
      body.readings.forEach((r, i) => {
        const id = map.get(r.sensor);
        if (!id) unknown.push({ index: i, reason: 'unknown_sensor' });
        else items.push({ sensorId: id, ts: new Date(r.ts), value: r.value, unit: r.unit, quality: r.quality, messageId: r.messageId, originalIndex: i });
      });
      const result = await ingest(ctx, tx, gw.g.orgId, items, { source: 'gateway', isDemoOrg: gw.isDemo, restrictSiteId: gw.g.siteId });
      return { ...result, rejected: [...unknown, ...result.rejected.map((r) => ({ index: items[r.index]!.originalIndex, reason: r.reason }))] };
    });
  });

  // ---------- Manual / laboratory entry ----------
  app.post('/telemetry/manual', auth, async (req, reply) => tenant(ctx, req, async (tx, p) => {
    const body = z.object({ sensorId: z.uuid(), value: z.number(), unit: z.string().max(20).optional(), ts: z.iso.datetime({ offset: true }).optional(), source: z.enum(['manual', 'lab']).default('manual') }).parse(req.body);
    requirePerm(p, body.source === 'lab' ? 'sensor.manage' : 'inspection.execute');
    const s = await scopedRow(tx, sensors, body.sensorId, p, 'Sensor');
    if (s.method === 'continuous' && body.source === 'lab') throw badRequest('method_mismatch', 'This sensor is an online instrument, not a laboratory parameter');
    const result = await ingest(ctx, tx, p.orgId, [{ sensorId: s.id, ts: body.ts ? new Date(body.ts) : new Date(), value: body.value, unit: body.unit }], { source: body.source, isDemoOrg: p.isDemoOrg });
    if (result.rejected.length) throw badRequest('reading_rejected', `Reading rejected: ${result.rejected[0]!.reason.replace(/_/g, ' ')}`);
    await audit(tx, p, { orgId: p.orgId, action: 'telemetry.manual_entry', entityType: 'sensor', entityId: s.id, summary: `${s.tag} = ${body.value}`, metadata: { source: body.source } });
    return reply.code(201).send(result);
  }));

  // ---------- History (downsampled server-side) ----------
  app.get('/telemetry/sensors/:id/history', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'telemetry.read');
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const q = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional(), points: z.coerce.number().int().min(10).max(2000).default(240) }).parse(req.query);
    const s = await scopedRow(tx, sensors, id, p, 'Sensor');
    const to = q.to ?? new Date();
    const from = q.from ?? new Date(to.getTime() - 24 * 3600_000);
    if (from >= to) throw badRequest('invalid_range');
    const spanS = (to.getTime() - from.getTime()) / 1000;
    const bucketS = Math.max(1, Math.ceil(spanS / q.points));
    const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(telemetryReadings)
      .where(and(eq(telemetryReadings.sensorId, id), gte(telemetryReadings.ts, from), lte(telemetryReadings.ts, to)))) as [{ n: number }];
    let points: { t: string; v: number; min: number; max: number; n: number }[];
    if (n <= q.points) {
      const raw = await tx.select({ ts: telemetryReadings.ts, value: telemetryReadings.value }).from(telemetryReadings)
        .where(and(eq(telemetryReadings.sensorId, id), gte(telemetryReadings.ts, from), lte(telemetryReadings.ts, to))).orderBy(asc(telemetryReadings.ts));
      points = raw.map((r) => ({ t: r.ts.toISOString(), v: r.value, min: r.value, max: r.value, n: 1 }));
    } else {
      const agg = await rows<{ b: string | Date; v: number; mn: number; mx: number; c: number }>(tx, sql`
        select date_bin(${`${bucketS} seconds`}::interval, ts, ${from}::timestamptz) as b, avg(value) as v, min(value) as mn, max(value) as mx, count(*)::int as c
        from telemetry_readings where sensor_id = ${id} and ts >= ${from} and ts <= ${to} group by 1 order by 1`);
      points = agg.map((r) => ({ t: new Date(r.b).toISOString(), v: Number(r.v), min: Number(r.mn), max: Number(r.mx), n: Number(r.c) }));
    }
    const def = MEASURAND_DEFS[s.measurand];
    return {
      sensor: { ...s, freshness: freshness(s.lastTs, s.expectedIntervalS), label: def.label, decimals: def.decimals, typicalRange: def.typicalRange, explanation: def.explanation },
      from: from.toISOString(), to: to.toISOString(), bucketSeconds: n <= q.points ? null : bucketS, totalReadings: n, points,
    };
  }));

  /** CSV export of raw readings (exact data alternative to charts). */
  app.get('/telemetry/sensors/:id/export.csv', auth, async (req, reply) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const q = z.object({ from: z.coerce.date(), to: z.coerce.date() }).parse(req.query);
    if (q.to.getTime() - q.from.getTime() > 93 * 86400_000) throw badRequest('range_too_large', 'Export at most 93 days at a time');
    const csv = await tenant(ctx, req, async (tx, p) => {
      requirePerm(p, 'report.export');
      const s = await scopedRow(tx, sensors, id, p, 'Sensor');
      const rows = await tx.select().from(telemetryReadings).where(and(eq(telemetryReadings.sensorId, id), gte(telemetryReadings.ts, q.from), lte(telemetryReadings.ts, q.to))).orderBy(asc(telemetryReadings.ts));
      await audit(tx, p, { orgId: p.orgId, action: 'report.exported', entityType: 'sensor', entityId: id, summary: `${s.tag} readings`, metadata: { rows: rows.length } });
      return ['timestamp_utc,sensor_tag,value,unit,quality,source,synthetic', ...rows.map((r) => `${r.ts.toISOString()},${s.tag},${r.value},${s.unit},${r.quality},${r.source},${r.synthetic}`)].join('\n');
    });
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="sensor-${id}.csv"`).send(csv);
  });

  void notFound;
}
