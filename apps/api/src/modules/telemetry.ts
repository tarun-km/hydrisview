import type { FastifyInstance } from 'fastify';
import { and, asc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { MEASURAND_DEFS, freshness, normalizeMeasurement, type TelemetrySource } from '@hydris/domain';
import type { Ctx } from '../context';
import { authenticate, tenant } from '../context';
import { auditEvents, gateways, organizations, sensors, telemetryCorrections, telemetryReadings, users } from '../db/schema';
import { rows, type Tx } from '../db/client';
import { withSystem, withTenant } from '../db/tenant';
import { badRequest, conflict, notFound, unauthorized } from '../core/errors';
import { requirePerm } from '../core/principal';
import { sha256 } from '../core/crypto';
import { audit } from '../core/services';
import { evaluateSensor } from './alarms';
import { scopedRow } from './plant';

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
  /** Ids of the stored rows (internal: used to link provenance such as who recorded a manual entry). */
  readingIds?: number[];
}

const MAX_FUTURE_SKEW_MS = 5 * 60_000;
const MAX_AGE_MS = 30 * 24 * 3600_000;

/**
 * The single ingestion path for every source (edge gateways, manual/lab entry and the
 * demo simulator): validation, unit normalization, idempotent storage, out-of-order
 * handling, alarm evaluation and realtime fan-out.
 */
export async function ingest(ctx: Ctx, tx: Tx, orgId: string, items: IngestItem[], src: { source: TelemetrySource; isDemoOrg: boolean; restrictSiteId?: string }): Promise<IngestResult> {
  const res: IngestResult = { accepted: 0, duplicates: 0, alarmsRaised: 0, rejected: [], readingIds: [] };
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
    res.readingIds!.push(Number(inserted[0]!.id));

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
      const { readingIds: _ids, ...result } = await ingest(ctx, tx, gw.g.orgId, items, { source: 'gateway', isDemoOrg: gw.isDemo, restrictSiteId: gw.g.siteId });
      void _ids;
      return { ...result, rejected: [...unknown, ...result.rejected.map((r) => ({ index: items[r.index]!.originalIndex, reason: r.reason }))] };
    });
  });

  // ---------- Manual / laboratory entry ----------
  app.post('/telemetry/manual', auth, async (req, reply) => tenant(ctx, req, async (tx, p) => {
    const body = z.object({ sensorId: z.uuid(), value: z.number(), unit: z.string().max(20).optional(), ts: z.iso.datetime({ offset: true }).optional(), source: z.enum(['manual', 'lab']).default('manual') }).parse(req.body);
    requirePerm(p, body.source === 'lab' ? 'sensor.manage' : 'inspection.execute');
    const s = await scopedRow(tx, sensors, body.sensorId, p, 'Sensor');
    if (s.method === 'continuous' && body.source === 'lab') throw badRequest('method_mismatch', 'This sensor is an online instrument, not a laboratory parameter');
    const { readingIds, ...result } = await ingest(ctx, tx, p.orgId, [{ sensorId: s.id, ts: body.ts ? new Date(body.ts) : new Date(), value: body.value, unit: body.unit }], { source: body.source, isDemoOrg: p.isDemoOrg });
    if (result.rejected.length) throw badRequest('reading_rejected', `Reading rejected: ${result.rejected[0]!.reason.replace(/_/g, ' ')}`, { reason: result.rejected[0]!.reason });
    if (result.duplicates) throw conflict('duplicate_reading', 'A reading already exists for this sensor at that exact time. Correct the existing reading instead.');
    const readingId = readingIds?.[0] ?? null;
    // The audit row is the provenance record of who entered the value (the reading row itself stays immutable).
    await audit(tx, p, { orgId: p.orgId, action: 'telemetry.manual_entry', entityType: 'sensor', entityId: s.id, summary: `${s.tag} = ${body.value}${body.unit ? ` ${body.unit}` : ''} (${body.source})`, metadata: { source: body.source, readingId, value: body.value, unit: body.unit ?? s.unit } });
    return reply.code(201).send({ ...result, readingId, recordedBy: { id: p.userId } });
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
    const eff = effectiveReadings(id, from, to);
    const [{ n }] = await rows<{ n: number }>(tx, sql`select count(*)::int as n from (${eff}) e where not e.invalidated`) as [{ n: number }];
    let points: { t: string; v: number; min: number; max: number; n: number }[];
    if (n <= q.points) {
      const raw = await rows<{ ts: string | Date; v: number }>(tx, sql`select e.ts, e.v from (${eff}) e where not e.invalidated order by e.ts asc`);
      points = raw.map((r) => ({ t: new Date(r.ts).toISOString(), v: Number(r.v), min: Number(r.v), max: Number(r.v), n: 1 }));
    } else {
      const agg = await rows<{ b: string | Date; v: number; mn: number; mx: number; c: number }>(tx, sql`
        select date_bin(${`${bucketS} seconds`}::interval, e.ts, ${from}::timestamptz) as b, avg(e.v) as v, min(e.v) as mn, max(e.v) as mx, count(*)::int as c
        from (${eff}) e where not e.invalidated group by 1 order by 1`);
      points = agg.map((r) => ({ t: new Date(r.b).toISOString(), v: Number(r.v), min: Number(r.mn), max: Number(r.mx), n: Number(r.c) }));
    }
    const [cc] = await rows<{ corrected: number; invalidated: number }>(tx, sql`
      select count(*) filter (where e.c_action = 'correct')::int as corrected, count(*) filter (where e.invalidated)::int as invalidated from (${eff}) e`);
    const def = MEASURAND_DEFS[s.measurand];
    return {
      sensor: { ...s, freshness: freshness(s.lastTs, s.expectedIntervalS), label: def.label, decimals: def.decimals, typicalRange: def.typicalRange, explanation: def.explanation },
      from: from.toISOString(), to: to.toISOString(), bucketSeconds: n <= q.points ? null : bucketS, totalReadings: Number(n), points,
      corrections: { corrected: Number(cc?.corrected ?? 0), invalidated: Number(cc?.invalidated ?? 0) },
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
      const data = await rows<EffRow & { reason: string | null; corrected_at: string | Date | null; corrected_by_name: string | null }>(tx, sql`
        select e.*, c.reason, c.created_at as corrected_at, u.name as corrected_by_name from (${effectiveReadings(id, q.from, q.to)}) e
        left join lateral (select tc.reason, tc.created_at, tc.corrected_by from telemetry_corrections tc where tc.reading_id = e.id order by tc.created_at desc limit 1) c on true
        left join users u on u.id = c.corrected_by
        order by e.ts asc`);
      await audit(tx, p, { orgId: p.orgId, action: 'report.exported', entityType: 'sensor', entityId: id, summary: `${s.tag} readings`, metadata: { rows: data.length } });
      const head = 'timestamp_utc,sensor_tag,original_value,effective_value,unit,quality,source,synthetic,status,correction_reason,corrected_by,corrected_at_utc';
      return [head, ...data.map((r) => [
        new Date(r.ts).toISOString(), s.tag, Number(r.original_value), r.invalidated ? '' : Number(r.v), s.unit, r.quality, r.source, r.synthetic,
        r.invalidated ? 'invalidated' : r.c_action === 'correct' ? 'corrected' : 'original',
        r.reason ?? '', r.corrected_by_name ?? '', r.corrected_at ? new Date(r.corrected_at).toISOString() : '',
      ].map(csvCell).join(','))].join('\n');
    });
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="sensor-${id}.csv"`).send(csv);
  });

  // ---------- Raw readings with provenance and correction trail ----------
  app.get('/telemetry/sensors/:id/readings', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'telemetry.read');
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const q = z.object({
      limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
      from: z.coerce.date().optional(), to: z.coerce.date().optional(),
      source: z.enum(['gateway', 'manual', 'lab', 'simulator']).optional(), status: z.enum(['all', 'corrected', 'invalidated']).default('all'),
    }).parse(req.query);
    const s = await scopedRow(tx, sensors, id, p, 'Sensor');
    const eff = effectiveReadings(id, q.from, q.to);
    const filter = sql`where true ${q.source ? sql`and e.source = ${q.source}` : sql``} ${q.status === 'corrected' ? sql`and e.c_action = 'correct'` : q.status === 'invalidated' ? sql`and e.invalidated` : sql``}`;
    const [tot] = await rows<{ total: number }>(tx, sql`select count(*)::int as total from (${eff}) e ${filter}`);
    const page = await rows<EffRow>(tx, sql`select e.* from (${eff}) e ${filter} order by e.ts desc limit ${q.limit} offset ${q.offset}`);
    const ids = page.map((r) => Number(r.id));
    const corr = ids.length
      ? await tx.select({ c: telemetryCorrections, byName: users.name }).from(telemetryCorrections).leftJoin(users, eq(users.id, telemetryCorrections.correctedBy))
        .where(inArray(telemetryCorrections.readingId, ids)).orderBy(asc(telemetryCorrections.createdAt))
      : [];
    const recorded = ids.length
      ? await tx.select({ readingId: sql<string>`${auditEvents.metadata}->>'readingId'`, userId: auditEvents.actorUserId, name: users.name })
        .from(auditEvents).leftJoin(users, eq(users.id, auditEvents.actorUserId))
        .where(and(eq(auditEvents.action, 'telemetry.manual_entry'), eq(auditEvents.entityId, id), inArray(sql`${auditEvents.metadata}->>'readingId'`, ids.map(String))))
      : [];
    const byReading = new Map(recorded.map((r) => [Number(r.readingId), r]));
    return {
      sensor: { id: s.id, tag: s.tag, name: s.name, unit: s.unit, measurand: s.measurand, method: s.method, decimals: MEASURAND_DEFS[s.measurand].decimals },
      total: Number(tot?.total ?? 0), limit: q.limit, offset: q.offset,
      readings: page.map((r) => {
        const rid = Number(r.id);
        const rec = byReading.get(rid);
        return {
          id: rid, ts: new Date(r.ts).toISOString(), receivedAt: new Date(r.received_at).toISOString(), quality: r.quality, source: r.source, synthetic: !!r.synthetic,
          originalValue: Number(r.original_value), effectiveValue: r.invalidated ? null : Number(r.v),
          status: r.invalidated ? 'invalidated' : r.c_action === 'correct' ? 'corrected' : 'original',
          recordedBy: rec ? { id: rec.userId, name: rec.name } : null,
          corrections: corr.filter((c) => Number(c.c.readingId) === rid).map((c) => ({
            id: c.c.id, action: c.c.action, originalValue: c.c.originalValue, correctedValue: c.c.correctedValue, reason: c.c.reason,
            correctedBy: c.c.correctedBy ? { id: c.c.correctedBy, name: c.byName } : null, createdAt: c.c.createdAt,
          })),
        };
      }),
    };
  }));

  /**
   * Append-only correction or invalidation of a stored reading. The original row in
   * telemetry_readings is never modified; history, exports and the latest value use the
   * most recent correction as the effective value.
   */
  app.post('/telemetry/readings/:readingId/corrections', auth, async (req, reply) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'sensor.manage');
    const { readingId } = z.object({ readingId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).parse(req.params);
    const body = z.object({
      action: z.enum(['correct', 'invalidate']), correctedValue: z.number().finite().optional(), unit: z.string().max(20).optional(),
      reason: z.string().trim().min(5, 'Explain the reason (at least 5 characters)').max(1000),
    }).superRefine((b, c) => {
      if (b.action === 'correct' && b.correctedValue === undefined) c.addIssue({ code: 'custom', path: ['correctedValue'], message: 'Enter the corrected value' });
      if (b.action === 'invalidate' && b.correctedValue !== undefined) c.addIssue({ code: 'custom', path: ['correctedValue'], message: 'Invalidation does not take a value' });
    }).parse(req.body);
    const [reading] = await tx.select().from(telemetryReadings).where(eq(telemetryReadings.id, readingId));
    if (!reading) throw notFound('Reading');
    const s = await scopedRow(tx, sensors, reading.sensorId, p, 'Reading');
    const [current] = await tx.select().from(telemetryCorrections).where(eq(telemetryCorrections.readingId, readingId)).orderBy(sql`${telemetryCorrections.createdAt} desc`).limit(1);
    const currentEffective = current ? (current.action === 'invalidate' ? null : current.correctedValue) : reading.value;
    let correctedValue: number | null = null;
    if (body.action === 'correct') {
      const n = normalizeMeasurement(s.measurand, body.correctedValue!, body.unit);
      if (!n.ok) {
        throw badRequest('validation_failed', `Corrected value rejected: ${n.reason.replace(/_/g, ' ')}`,
          [{ path: 'correctedValue', message: n.reason === 'out_of_range' ? 'Outside the plausible range for this measurand' : n.reason.replace(/_/g, ' ') }]);
      }
      correctedValue = n.value;
      if (currentEffective !== null && Math.abs(currentEffective - n.value) < 1e-12) throw conflict('no_change', 'The corrected value equals the current effective value');
    } else if (currentEffective === null) {
      throw conflict('already_invalidated', 'This reading is already invalidated');
    }
    const [c] = await tx.insert(telemetryCorrections).values({
      orgId: p.orgId, sensorId: s.id, readingId, originalValue: reading.value, correctedValue, action: body.action, reason: body.reason, correctedBy: p.userId,
    }).returning();
    await audit(tx, p, {
      orgId: p.orgId, action: body.action === 'correct' ? 'telemetry.reading_corrected' : 'telemetry.reading_invalidated', entityType: 'sensor', entityId: s.id,
      summary: body.action === 'correct'
        ? `${s.tag} @ ${reading.ts.toISOString()}: ${currentEffective ?? 'invalid'} → ${correctedValue} ${s.unit}`
        : `${s.tag} @ ${reading.ts.toISOString()} invalidated`,
      metadata: { readingId, readingTs: reading.ts.toISOString(), source: reading.source, originalValue: reading.value, previousEffective: currentEffective, correctedValue, reason: body.reason },
    });
    // If this reading is (or was) the sensor's latest, recompute the latest effective value.
    if (!s.lastTs || reading.ts.getTime() >= s.lastTs.getTime()) await recomputeLatest(tx, s.id);
    ctx.bus.publish({ type: 'telemetry.corrected', orgId: p.orgId, siteId: s.siteId, permission: 'telemetry.read', payload: { sensorId: s.id, readingId, action: body.action } });
    return reply.code(201).send({ correction: c, effectiveValue: correctedValue });
  }));
}

interface EffRow {
  id: number | string; ts: string | Date; received_at: string | Date; original_value: number; quality: string; source: string; synthetic: boolean;
  c_action: 'correct' | 'invalidate' | null; corrected_value: number | null; v: number; invalidated: boolean;
}

/** Readings joined with their most recent correction: `v` is the effective value; `invalidated` rows are excluded from aggregates. */
export function effectiveReadings(sensorId: string, from?: Date, to?: Date): SQL {
  return sql`
    select r.id, r.ts, r.received_at, r.value as original_value, r.quality, r.source, r.synthetic,
      c.action as c_action, c.corrected_value,
      case when c.action = 'correct' then c.corrected_value else r.value end as v,
      coalesce(c.action = 'invalidate', false) as invalidated
    from telemetry_readings r
    left join lateral (select tc.action, tc.corrected_value from telemetry_corrections tc where tc.reading_id = r.id order by tc.created_at desc limit 1) c on true
    where r.sensor_id = ${sensorId} ${from ? sql`and r.ts >= ${from}` : sql``} ${to ? sql`and r.ts <= ${to}` : sql``}`;
}

/** Set the sensor's latest value from its newest non-invalidated reading (effective value). */
export async function recomputeLatest(tx: Tx, sensorId: string) {
  const [l] = await rows<EffRow>(tx, sql`select e.* from (${effectiveReadings(sensorId)}) e where not e.invalidated order by e.ts desc limit 1`);
  await tx.update(sensors).set(l
    ? { lastValue: Number(l.v), lastTs: new Date(l.ts), lastQuality: l.quality as 'good', lastSource: l.source as TelemetrySource }
    : { lastValue: null, lastTs: null, lastQuality: null, lastSource: null }).where(eq(sensors.id, sensorId));
}

function csvCell(v: unknown): string {
  let t = String(v ?? '');
  if (/^[=+\-@]/.test(t) && Number.isNaN(Number(t))) t = `'${t}`;
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}
