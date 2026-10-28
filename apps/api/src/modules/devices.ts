import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, asc, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  INSPECTION_EDITABLE, MEASURAND_DEFS, OPEN_ALARM_STATES, actionAllowed, applyMeasurementProfile, freshness, screenEnabled, type Role, PAIRING_POLL_INTERVAL_S, PAIRING_TTL_S, deriveDeviceState, formatPairingCode, isValidPairingCode, normalizePairingCode,
} from '@hydris/domain';
import { TTL, accessTokenTtl } from '../config';
import { decodeDemoDeviceRefresh, demoDeviceClaims, encodeDemoDeviceRefresh, ensureDemoDevice, isDemoDeviceRefresh } from '../core/demo-auth';
import type { Ctx } from '../context';
import { authenticate, tenant } from '../context';
import {
  alarmEvents, assets, auditEvents, processAreas, deviceAssignments, deviceSessions, devices, inspections, maintenanceTasks, membershipSites, sensors, memberships, organizations, pairingChallenges, sites, users,
} from '../db/schema';
import type { Tx } from '../db/client';
import { withSystem, withTenant } from '../db/tenant';
import { badRequest, conflict, forbidden, HttpError, notFound, unauthorized } from '../core/errors';
import { has, requirePerm, requireSite, siteScope, type Principal } from '../core/principal';
import { pairingCode, randomToken, safeEqual, sha256 } from '../core/crypto';
import { audit } from '../core/services';
import { effectiveProfile } from './ui-profiles';
import { ensureGuest } from '../core/demo-guests';
import { demoShared } from '../core/demo-shared';

/** Upper bound for each live-view JPEG (screen mirror, camera frame). */
const MAX_LIVE_IMAGE_BYTES = 120 * 1024;

const deviceInfoSchema = z.object({
  kind: z.enum(['hardware', 'simulator']), model: z.string().max(80).optional(), appVersion: z.string().max(40).optional(), firmwareVersion: z.string().max(40).optional(),
  display: z.object({ width: z.number().int().min(100).max(4000), height: z.number().int().min(100).max(4000) }).optional(), name: z.string().max(60).optional(),
});

/** Bump the session version so outstanding device access tokens stop working immediately. */
async function invalidateDeviceTokens(tx: Tx, deviceId: string) {
  await tx.update(devices).set({ sessionVersion: sql`${devices.sessionVersion} + 1`, updatedAt: new Date() }).where(eq(devices.id, deviceId));
}

export async function deviceRoutes(app: FastifyInstance, ctx: Ctx, opts: { relaxedLimits?: boolean }) {
  const auth = { preHandler: authenticate(ctx) };
  const limit = (max: number) => ({ config: { rateLimit: { max: opts.relaxedLimits ? 10_000 : max, timeWindow: '1 minute' } } });

  async function issueDeviceTokens(tx: Tx, device: typeof devices.$inferSelect, familyId: string = randomUUID()) {
    if (ctx.config.demoMode) {
      // Demo mode: self-contained tokens so any instance can serve (and rebuild) this device.
      const claims = await demoDeviceClaims(tx, device);
      const accessToken = app.jwt.sign({ typ: 'device', sub: device.id, org: device.orgId, sv: device.sessionVersion, ...claims }, { expiresIn: accessTokenTtl(ctx.config) });
      const refreshToken = claims.uid
        ? encodeDemoDeviceRefresh(ctx.config.JWT_SECRET, { org: device.orgId, sub: device.id, uid: claims.uid, site: device.siteId, sv: device.sessionVersion })
        : `hgd_${randomToken(40)}`;
      return { accessToken, refreshToken };
    }
    const refresh = `hgd_${randomToken(40)}`;
    await tx.insert(deviceSessions).values({ orgId: device.orgId, deviceId: device.id, familyId, tokenHash: sha256(refresh), sessionVersion: device.sessionVersion, expiresAt: new Date(Date.now() + TTL.deviceRefreshMs) });
    const accessToken = app.jwt.sign({ typ: 'device', sub: device.id, org: device.orgId, sv: device.sessionVersion }, { expiresIn: TTL.accessToken });
    return { accessToken, refreshToken: refresh };
  }

  // ---- Demo mode: pairing state shared across serverless instances (each has its own in-memory DB).
  type Challenge = typeof pairingChallenges.$inferSelect;
  const SHARE_TTL_S = PAIRING_TTL_S + 600;
  const piKey = (id: string) => `pair:id:${id}`;
  const pcKey = (codeHash: string) => `pair:code:${codeHash}`;
  const DATE_FIELDS = ['expiresAt', 'lastPolledAt', 'approvedAt', 'completedAt', 'createdAt'] as const;
  async function shareChallenge(c: Challenge) {
    if (!ctx.config.demoMode) return;
    await demoShared().set(piKey(c.id), c, SHARE_TTL_S);
    await demoShared().set(pcKey(c.codeHash), c.id, SHARE_TTL_S);
  }
  /** Bring this instance's copy of a challenge up to date with the shared one. */
  async function hydrateChallenge(tx: Tx, id: string) {
    if (!ctx.config.demoMode) return;
    const raw = await demoShared().get<Record<string, unknown>>(piKey(id));
    if (!raw) return;
    const s = { ...raw } as Record<string, unknown>;
    for (const f of DATE_FIELDS) if (typeof s[f] === 'string') s[f] = new Date(s[f] as string);
    const row = s as unknown as Challenge;
    for (const u of [row.approvedBy, row.assigneeUserId]) if (u) await ensureGuest(tx, u);
    const [local] = await tx.select().from(pairingChallenges).where(eq(pairingChallenges.id, id));
    if (!local) {
      // deviceId may reference a device this instance has never seen; completion sets it again.
      await tx.insert(pairingChallenges).values({ ...row, deviceId: null }).onConflictDoNothing();
      return;
    }
    const open = (st: string) => st === 'pending' || st === 'approved';
    if (local.status === 'pending' && row.status === 'approved') {
      await tx.update(pairingChallenges).set({
        status: 'approved', approvedBy: row.approvedBy, approvedAt: row.approvedAt, orgId: row.orgId, siteId: row.siteId, assigneeUserId: row.assigneeUserId, deviceInfo: row.deviceInfo,
      }).where(eq(pairingChallenges.id, id));
    } else if (open(local.status) && !open(row.status)) {
      await tx.update(pairingChallenges).set({ status: row.status, completedAt: row.completedAt }).where(eq(pairingChallenges.id, id));
    }
  }
  async function hydrateByCode(tx: Tx, rawCode: string) {
    if (!ctx.config.demoMode || !isValidPairingCode(rawCode)) return;
    const id = await demoShared().get<string>(pcKey(sha256(normalizePairingCode(rawCode))));
    if (id) await hydrateChallenge(tx, id);
  }
  async function shareById(tx: Tx, id: string) {
    if (!ctx.config.demoMode) return;
    const [c] = await tx.select().from(pairingChallenges).where(eq(pairingChallenges.id, id));
    if (c) await shareChallenge(c);
  }

  // =================== Pairing: device side (unauthenticated, rate limited) ===================
  app.post('/pairing/challenges', limit(10), async (req, reply) => {
    const body = z.object({ hardwareId: z.string().min(16).max(80).regex(/^[A-Za-z0-9_-]+$/), device: deviceInfoSchema }).parse(req.body);
    const pollSecret = randomToken(32);
    const out = await withSystem(ctx.db, async (tx) => {
      // Any open challenge from the same install is superseded (regeneration).
      await tx.update(pairingChallenges).set({ status: 'cancelled' }).where(and(eq(pairingChallenges.hardwareId, body.hardwareId), inArray(pairingChallenges.status, ['pending', 'approved'])));
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = pairingCode();
        try {
          const [c] = await tx.insert(pairingChallenges).values({
            codeHash: sha256(code), pollSecretHash: sha256(pollSecret), hardwareId: body.hardwareId, deviceInfo: body.device,
            expiresAt: new Date(Date.now() + PAIRING_TTL_S * 1000), requesterIp: req.ip,
          }).returning();
          return { c: c!, code };
        } catch (e) {
          if ((e as { code?: string; cause?: { code?: string } }).code !== '23505' && (e as { cause?: { code?: string } }).cause?.code !== '23505') throw e;
        }
      }
      throw new HttpError(503, 'pairing_unavailable', 'Could not allocate a pairing code. Try again.');
    });
    await shareChallenge(out.c);
    const display = formatPairingCode(out.code);
    return reply.code(201).send({
      challengeId: out.c.id, userCode: display, pollSecret, expiresAt: out.c.expiresAt, pollIntervalS: PAIRING_POLL_INTERVAL_S,
      verificationUri: `${ctx.config.PUBLIC_APP_URL}/pair`,
      // The QR encodes only this URL: a short-lived, single-use code - never a credential.
      verificationUriComplete: `${ctx.config.PUBLIC_APP_URL}/pair?code=${display}`,
    });
  });

  app.post('/pairing/challenges/:id/poll', limit(40), async (req) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const { pollSecret } = z.object({ pollSecret: z.string().min(20).max(100) }).parse(req.body);
    return withSystem(ctx.db, async (tx) => {
      await hydrateChallenge(tx, id);
      const [c] = await tx.select().from(pairingChallenges).where(eq(pairingChallenges.id, id));
      if (!c || !safeEqual(c.pollSecretHash, sha256(pollSecret))) throw notFound('Pairing request');
      const now = new Date();
      if ((c.status === 'pending' || c.status === 'approved') && c.expiresAt < now) {
        await tx.update(pairingChallenges).set({ status: 'expired' }).where(eq(pairingChallenges.id, id));
        return { status: 'expired' as const };
      }
      if (c.status !== 'pending' && c.status !== 'approved') return { status: c.status };
      if (c.lastPolledAt && now.getTime() - c.lastPolledAt.getTime() < (PAIRING_POLL_INTERVAL_S - 1) * 1000) return { status: 'slow_down' as const, pollIntervalS: PAIRING_POLL_INTERVAL_S };
      await tx.update(pairingChallenges).set({ lastPolledAt: now }).where(eq(pairingChallenges.id, id));
      if (c.status === 'pending') return { status: 'pending' as const, expiresAt: c.expiresAt };

      // Approved: consume the challenge exactly once.
      const [claimed] = await tx.update(pairingChallenges).set({ status: 'completed', completedAt: now })
        .where(and(eq(pairingChallenges.id, id), eq(pairingChallenges.status, 'approved'))).returning();
      if (!claimed) return { status: 'completed' as const, error: 'already_claimed' };
      await shareChallenge(claimed);
      const orgId = claimed.orgId!;
      return withTenantInside(tx, orgId, async () => {
        // Re-pairing the same install within the same org reuses the device record (handover/recovery).
        let device: typeof devices.$inferSelect | undefined = (await tx.select().from(devices).where(and(eq(devices.hardwareId, claimed.hardwareId), eq(devices.orgId, orgId))))[0];
        const info = claimed.deviceInfo;
        if (device && device.status === 'revoked') device = undefined;
        if (device) {
          [device] = await tx.update(devices).set({
            status: 'active', siteId: claimed.siteId, sessionVersion: device.sessionVersion + 1, pairedAt: now, pairedBy: claimed.approvedBy,
            appVersion: info.appVersion ?? device.appVersion, firmwareVersion: info.firmwareVersion ?? device.firmwareVersion, suspendedAt: null, updatedAt: now,
          }).where(eq(devices.id, device.id)).returning();
          await tx.update(deviceSessions).set({ revokedAt: now }).where(and(eq(deviceSessions.deviceId, device!.id), isNull(deviceSessions.revokedAt)));
        } else {
          [device] = await tx.insert(devices).values({
            orgId, siteId: claimed.siteId, name: info.name || (info.kind === 'simulator' ? 'Browser simulator' : info.model ?? 'Field glasses'), kind: info.kind,
            model: info.model ?? (info.kind === 'simulator' ? 'Hydris browser simulator' : null), hardwareId: claimed.hardwareId, appVersion: info.appVersion,
            firmwareVersion: info.firmwareVersion, displayInfo: info.display ?? null, pairedBy: claimed.approvedBy,
          }).returning();
        }
        const d = device!;
        await tx.update(deviceAssignments).set({ unassignedAt: now, reason: 're-paired' }).where(and(eq(deviceAssignments.deviceId, d.id), isNull(deviceAssignments.unassignedAt)));
        await tx.insert(deviceAssignments).values({ orgId, deviceId: d.id, userId: claimed.assigneeUserId!, assignedBy: claimed.approvedBy });
        await tx.update(pairingChallenges).set({ deviceId: d.id }).where(eq(pairingChallenges.id, id));
        await audit(tx, { userId: claimed.approvedBy, deviceId: d.id }, { orgId, action: 'device.paired', entityType: 'device', entityId: d.id, summary: d.name, metadata: { challengeId: id, assignee: claimed.assigneeUserId, ip: req.ip } });
        ctx.bus.publish({ type: 'device.paired', orgId, siteId: d.siteId, permission: 'device.read', payload: { id: d.id, name: d.name } });
        ctx.bus.publish({ type: 'pairing.completed', orgId, userIds: [claimed.approvedBy!], payload: { challengeId: id, deviceId: d.id } });
        return { status: 'completed' as const, device: { id: d.id, name: d.name }, ...(await issueDeviceTokens(tx, d)) };
      });
    });
  });

  /** Switch an existing system transaction into the tenant context (RLS) for tenant writes. */
  async function withTenantInside<T>(tx: Tx, orgId: string, fn: () => Promise<T>): Promise<T> {
    await tx.execute(sql`select set_config('app.bypass', 'off', true)`);
    await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`);
    return fn();
  }

  app.post('/pairing/challenges/:id/cancel', limit(20), async (req) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const { pollSecret } = z.object({ pollSecret: z.string() }).parse(req.body);
    await withSystem(ctx.db, async (tx) => {
      await hydrateChallenge(tx, id);
      const [c] = await tx.select().from(pairingChallenges).where(eq(pairingChallenges.id, id));
      if (!c || !safeEqual(c.pollSecretHash, sha256(pollSecret))) throw notFound('Pairing request');
      await tx.update(pairingChallenges).set({ status: 'cancelled' }).where(and(eq(pairingChallenges.id, id), inArray(pairingChallenges.status, ['pending', 'approved'])));
      await shareById(tx, id);
    });
    return { ok: true };
  });

  // =================== Pairing: companion (authenticated person) ===================
  async function findPending(tx: Tx, rawCode: string) {
    if (!isValidPairingCode(rawCode)) throw badRequest('invalid_code', 'Enter the 8-character code shown on the glasses');
    const [c] = await tx.select().from(pairingChallenges).where(and(eq(pairingChallenges.codeHash, sha256(normalizePairingCode(rawCode))), eq(pairingChallenges.status, 'pending'), gt(pairingChallenges.expiresAt, new Date())));
    if (!c) throw notFound('Pairing code (it may have expired - generate a new one on the glasses)');
    return c;
  }

  app.get('/pairing/lookup', { ...auth, ...limit(10) }, async (req) => {
    const { code } = z.object({ code: z.string().max(20) }).parse(req.query);
    const p = req.principal!;
    requirePerm(p, 'device.pair');
    const c = await withSystem(ctx.db, async (tx) => {
      await hydrateByCode(tx, code);
      return findPending(tx, code);
    });
    return tenant(ctx, req, async (tx) => {
      const siteRows = await tx.select({ id: sites.id, name: sites.name, code: sites.code }).from(sites).where(and(siteScope(p, sites.id), isNull(sites.archivedAt))).orderBy(asc(sites.name));
      const assignees = has(p, 'device.manage')
        ? await tx.select({ id: users.id, name: users.name, role: memberships.role }).from(memberships).innerJoin(users, eq(users.id, memberships.userId))
            .where(and(eq(memberships.status, 'active'), inArray(memberships.role, ['operator', 'admin']))).orderBy(asc(users.name))
        : await tx.select({ id: users.id, name: users.name, role: memberships.role }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(eq(memberships.userId, p.userId));
      const [org] = await tx.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, p.orgId));
      const [existing] = await tx.select({ id: devices.id, name: devices.name, status: devices.status }).from(devices).where(eq(devices.hardwareId, c.hardwareId));
      return {
        challenge: { code: formatPairingCode(code), device: c.deviceInfo, requestedAt: c.createdAt, expiresAt: c.expiresAt },
        organization: org?.name, sites: siteRows, assignees, canAssignOthers: has(p, 'device.manage'), existingDevice: existing ?? null,
      };
    });
  });

  app.post('/pairing/approve', { ...auth, ...limit(10) }, async (req) => {
    const body = z.object({ code: z.string().max(20), siteId: z.uuid(), assigneeUserId: z.uuid().optional(), deviceName: z.string().trim().min(2).max(60).optional() }).parse(req.body);
    const p = req.principal!;
    requirePerm(p, 'device.pair');
    requireSite(p, body.siteId, 'Site');
    const assignee = body.assigneeUserId ?? p.userId;
    if (assignee !== p.userId && !has(p, 'device.manage')) throw forbidden('You can only pair glasses to yourself');
    return withTenant(ctx.db, p.orgId, async (tx) => {
      const [site] = await tx.select({ id: sites.id }).from(sites).where(eq(sites.id, body.siteId));
      if (!site) throw notFound('Site');
      const [m] = await tx.select({ id: memberships.id, allSites: memberships.allSites, status: memberships.status }).from(memberships).where(eq(memberships.userId, assignee));
      if (!m || m.status !== 'active') throw badRequest('invalid_assignee', 'Assignee must be an active member');
      if (!m.allSites) {
        const [ok] = await tx.select().from(membershipSites).where(and(eq(membershipSites.membershipId, m.id), eq(membershipSites.siteId, body.siteId)));
        if (!ok) throw badRequest('assignee_no_site_access', 'The assignee has no access to that site');
      }
      await tx.execute(sql`select set_config('app.bypass', 'on', true)`);
      await hydrateByCode(tx, body.code);
      const c = await findPending(tx, body.code);
      const [existing] = await tx.select().from(devices).where(eq(devices.hardwareId, c.hardwareId));
      if (existing && existing.orgId !== p.orgId && existing.status !== 'revoked') {
        throw conflict('device_owned_elsewhere', 'These glasses are registered to another organization. They must be revoked there first.');
      }
      const [ok] = await tx.update(pairingChallenges).set({
        status: 'approved', approvedBy: p.userId, approvedAt: new Date(), orgId: p.orgId, siteId: body.siteId, assigneeUserId: assignee,
        deviceInfo: body.deviceName ? { ...c.deviceInfo, name: body.deviceName } : c.deviceInfo,
      }).where(and(eq(pairingChallenges.id, c.id), eq(pairingChallenges.status, 'pending'))).returning();
      await tx.execute(sql`select set_config('app.bypass', 'off', true)`);
      if (!ok) throw conflict('already_used', 'This pairing code was already used');
      await shareChallenge(ok);
      await audit(tx, p, { orgId: p.orgId, action: 'device.pairing_approved', entityType: 'pairing', entityId: c.id, metadata: { siteId: body.siteId, assignee, device: c.deviceInfo }, ip: req.ip });
      return { ok: true, challengeId: c.id };
    });
  });

  app.post('/pairing/deny', { ...auth, ...limit(10) }, async (req) => {
    const { code } = z.object({ code: z.string().max(20) }).parse(req.body);
    const p = req.principal!;
    requirePerm(p, 'device.pair');
    await withSystem(ctx.db, async (tx) => {
      await hydrateByCode(tx, code);
      const c = await findPending(tx, code);
      await tx.update(pairingChallenges).set({ status: 'denied', approvedBy: p.userId }).where(eq(pairingChallenges.id, c.id));
      await shareById(tx, c.id);
      await audit(tx, p, { orgId: p.orgId, action: 'device.pairing_denied', entityType: 'pairing', entityId: c.id, ip: req.ip });
    });
    return { ok: true };
  });

  // =================== Device session (glasses) ===================
  app.post('/device/refresh', limit(30), async (req) => {
    const { refreshToken } = z.object({ refreshToken: z.string().startsWith('hgd_').max(120) }).parse(req.body);
    if (ctx.config.demoMode && isDemoDeviceRefresh(refreshToken)) {
      const c = decodeDemoDeviceRefresh(ctx.config.JWT_SECRET, refreshToken);
      if (!c) throw unauthorized('device_session_invalid', 'This device must be paired again');
      return withSystem(ctx.db, async (tx) => {
        await ensureGuest(tx, c.uid);
        await ensureDemoDevice(tx, c);
        const [d] = await tx.select().from(devices).where(eq(devices.id, c.sub));
        if (!d || d.status === 'revoked') throw unauthorized('device_revoked', 'This device has been revoked by an administrator');
        if (d.status === 'suspended') throw new HttpError(403, 'device_suspended', 'This device is suspended. Contact your administrator.');
        if (d.sessionVersion > c.sv) throw unauthorized('device_session_invalid', 'This device must be paired again');
        const [a] = await tx.select().from(deviceAssignments).where(and(eq(deviceAssignments.deviceId, d.id), isNull(deviceAssignments.unassignedAt)));
        if (!a) throw new HttpError(403, 'device_unassigned', 'No operator is assigned to this device');
        await tx.update(devices).set({ lastSeenAt: new Date(), lastIp: req.ip }).where(eq(devices.id, d.id));
        return issueDeviceTokens(tx, d);
      });
    }
    const verdict = await withSystem(ctx.db, async (tx) => {
      const [s] = await tx.select().from(deviceSessions).where(eq(deviceSessions.tokenHash, sha256(refreshToken)));
      if (!s) return 'invalid';
      const [d] = await tx.select({ status: devices.status }).from(devices).where(eq(devices.id, s.deviceId));
      if (d?.status === 'revoked') return 'revoked';
      if (s.revokedAt) return 'invalid';
      if (s.rotatedAt) {
        // Committed before rejecting so the family stays revoked.
        await tx.update(deviceSessions).set({ revokedAt: new Date() }).where(eq(deviceSessions.familyId, s.familyId));
        await audit(tx, { deviceId: s.deviceId }, { orgId: s.orgId, action: 'device.refresh_reuse_detected', entityType: 'device', entityId: s.deviceId, ip: req.ip });
        return 'invalid';
      }
      return 'ok';
    });
    if (verdict === 'revoked') throw unauthorized('device_revoked', 'This device has been revoked by an administrator');
    if (verdict === 'invalid') throw unauthorized('device_session_invalid', 'This device must be paired again');
    return withSystem(ctx.db, async (tx) => {
      const [s] = await tx.select().from(deviceSessions).where(eq(deviceSessions.tokenHash, sha256(refreshToken)));
      if (!s || s.revokedAt || s.rotatedAt) throw unauthorized('device_session_invalid', 'This device must be paired again');
      if (s.expiresAt < new Date()) throw unauthorized('device_session_expired', 'Device session expired. Pair again.');
      const [d] = await tx.select().from(devices).where(eq(devices.id, s.deviceId));
      if (!d || d.status === 'revoked') throw unauthorized('device_revoked', 'This device has been revoked by an administrator');
      if (d.status === 'suspended') throw new HttpError(403, 'device_suspended', 'This device is suspended. Contact your administrator.');
      const [a] = await tx.select().from(deviceAssignments).where(and(eq(deviceAssignments.deviceId, d.id), isNull(deviceAssignments.unassignedAt)));
      if (!a) throw new HttpError(403, 'device_unassigned', 'No operator is assigned to this device');
      await tx.update(deviceSessions).set({ rotatedAt: new Date(), lastUsedAt: new Date() }).where(eq(deviceSessions.id, s.id));
      await tx.update(devices).set({ lastSeenAt: new Date(), lastIp: req.ip }).where(eq(devices.id, d.id));
      return issueDeviceTokens(tx, d, s.familyId);
    });
  });

  /** Glasses-initiated logout: ends this device's sessions so it can be paired again (by anyone). */
  app.post('/device/logout', auth, async (req, reply) => {
    await tenant(ctx, req, async (tx, p) => {
      if (p.kind !== 'device') throw forbidden('Device session required');
      await tx.update(deviceSessions).set({ revokedAt: new Date() }).where(and(eq(deviceSessions.deviceId, p.deviceId!), isNull(deviceSessions.revokedAt)));
      await invalidateDeviceTokens(tx, p.deviceId!);
    });
    return reply.code(204).send();
  });

  /** Everything the glasses need for the home screen, scoped to the assigned operator. */
  app.get('/device/context', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    if (p.kind !== 'device') throw forbidden('Device session required');
    const [d] = await tx.select().from(devices).where(eq(devices.id, p.deviceId!));
    const [op] = await tx.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, p.userId));
    const [org] = await tx.select({ name: organizations.name, isDemo: organizations.isDemo }).from(organizations).where(eq(organizations.id, p.orgId));
    const [site] = d!.siteId ? await tx.select({ id: sites.id, name: sites.name, code: sites.code }).from(sites).where(eq(sites.id, d!.siteId)) : [];
    const profile = await effectiveProfile(tx, { deviceId: p.deviceId, userId: p.userId, role: p.role as Role });
    const cfg = profile.config;
    const on = (s: Parameters<typeof screenEnabled>[1]) => screenEnabled(cfg, s);
    const siteCond = d!.siteId ? eq(inspections.siteId, d!.siteId) : siteScope(p, inspections.siteId);
    // Sections disabled by the UI profile are omitted entirely (server-side enforcement, not just hidden).
    const work = !on('inspections') ? [] : await tx.select({ id: inspections.id, title: inspections.title, status: inspections.status, priority: inspections.priority, dueAt: inspections.dueAt, assetTag: assets.tag, assetName: assets.name, steps: inspections.steps, revision: inspections.revision })
      .from(inspections).leftJoin(assets, eq(assets.id, inspections.assetId))
      .where(and(eq(inspections.assignedTo, p.userId), inArray(inspections.status, [...INSPECTION_EDITABLE]), siteCond)).orderBy(asc(inspections.dueAt)).limit(20);
    const alarms = !on('alerts') ? [] : await tx.select({ id: alarmEvents.id, title: alarmEvents.title, severity: alarmEvents.severity, state: alarmEvents.state, triggeredAt: alarmEvents.triggeredAt, assetTag: assets.tag, triggerValue: alarmEvents.triggerValue, unit: alarmEvents.unit, recommendedAction: alarmEvents.recommendedAction, synthetic: alarmEvents.synthetic })
      .from(alarmEvents).leftJoin(assets, eq(assets.id, alarmEvents.assetId))
      .where(and(inArray(alarmEvents.state, [...OPEN_ALARM_STATES]), d!.siteId ? eq(alarmEvents.siteId, d!.siteId) : siteScope(p, alarmEvents.siteId)))
      .orderBy(sql`case ${alarmEvents.severity} when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end`, desc(alarmEvents.triggeredAt)).limit(20);
    const tasks = !on('tasks') ? [] : await tx.select({ id: maintenanceTasks.id, title: maintenanceTasks.title, status: maintenanceTasks.status, priority: maintenanceTasks.priority, assetTag: assets.tag, checklist: maintenanceTasks.checklist })
      .from(maintenanceTasks).leftJoin(assets, eq(assets.id, maintenanceTasks.assetId))
      .where(and(eq(maintenanceTasks.assignedTo, p.userId), inArray(maintenanceTasks.status, ['open', 'assigned', 'in_progress', 'on_hold']))).limit(20);
    // Plant map for the glasses: site layout, process areas and asset positions (metres).
    let map = null;
    let assetList: { id: string; tag: string; name: string; type: string; status: string; openAlarms: number }[] = [];
    let measurements: unknown[] = [];
    if (site) {
      const pins = await tx.select({ id: assets.id, tag: assets.tag, name: assets.name, type: assets.type, status: assets.status, x: assets.positionX, y: assets.positionY,
        openAlarms: sql<number>`(select count(*)::int from alarm_events e where e.asset_id = ${assets.id} and e.state in ('active','acknowledged','investigating'))` })
        .from(assets).where(and(eq(assets.siteId, site.id), isNull(assets.archivedAt))).orderBy(asc(assets.tag));
      if (on('map') && actionAllowed(cfg, 'view_map')) {
        const [lay] = await tx.select({ w: sites.layoutWidthM, h: sites.layoutHeightM }).from(sites).where(eq(sites.id, site.id));
        const areas = await tx.select({ id: processAreas.id, name: processAreas.name, code: processAreas.code, polygon: processAreas.polygon }).from(processAreas).where(and(eq(processAreas.siteId, site.id), isNull(processAreas.archivedAt)));
        map = { widthM: lay!.w, heightM: lay!.h, areas: areas.filter((a) => a.polygon), assets: pins.filter((x) => x.x !== null && x.y !== null).map(({ type: _t, ...x }) => x) };
      }
      if (on('assets') || on('measurements')) assetList = pins.map(({ x: _x, y: _y, ...a }) => a);
      if (on('measurements') || on('home')) {
        const rows = await tx.select({ id: sensors.id, tag: sensors.tag, name: sensors.name, measurand: sensors.measurand, unit: sensors.unit, lastValue: sensors.lastValue, lastTs: sensors.lastTs, lastSource: sensors.lastSource,
          expectedIntervalS: sensors.expectedIntervalS, assetId: sensors.assetId, assetTag: assets.tag, assetType: assets.type,
          openAlarms: sql<number>`(select count(*)::int from alarm_events e where e.sensor_id = ${sensors.id} and e.state in ('active','acknowledged','investigating'))` })
          .from(sensors).leftJoin(assets, eq(assets.id, sensors.assetId))
          .where(and(eq(sensors.siteId, site.id), eq(sensors.enabled, true), isNull(sensors.archivedAt))).orderBy(asc(sensors.tag));
        measurements = applyMeasurementProfile(cfg, rows).map((r) => {
          const def = MEASURAND_DEFS[r.measurand];
          const tr = def.typicalRange; const out = r.lastValue !== null && !!tr && (r.lastValue < tr[0] || r.lastValue > tr[1]);
          return { ...r, label: def.label, decimals: def.decimals, typicalRange: def.typicalRange, freshness: freshness(r.lastTs, r.expectedIntervalS), threshold: r.openAlarms > 0 ? 'alarm' : out ? 'out_of_range' : 'normal' };
        });
      }
    }
    return {
      map, assets: assetList, measurements,
      device: { id: d!.id, name: d!.name, kind: d!.kind, status: d!.status, sessionVersion: d!.sessionVersion, appVersion: d!.appVersion, pairedAt: d!.pairedAt },
      operator: op, organization: org, site: site ?? null, role: p.role,
      profile: { id: profile.profileId, name: profile.name, version: profile.version, source: profile.source, config: cfg },
      inspections: work.map(({ steps, ...w }) => ({ ...w, stepCount: steps.length })), alarms, tasks,
      serverTime: new Date().toISOString(),
    };
  }));

  // =================== Live view (glasses -> control room) ===================
  // Only the latest snapshot per device is kept, ephemerally, in the shared store so every
  // serverless instance (demo mode) and every API process sees the same picture.
  const LIVE_TTL_S = 60;
  const LIVE_FRESH_MS = 10_000;
  const liveKey = (orgId: string, deviceId: string) => `live:${orgId}:${deviceId}`;
  const liveIdxKey = (orgId: string) => `live:idx:${orgId}`;
  const jpegDataUrl = z.string().max(170_000).refine((v) => {
    const m = /^data:image\/jpe?g;base64,([A-Za-z0-9+/=]+)$/.exec(v);
    if (!m) return false;
    const b = Buffer.from(m[1]!, 'base64');
    return b.length > 3 && b.length <= MAX_LIVE_IMAGE_BYTES && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  }, { message: `Must be a JPEG data URL of at most ${MAX_LIVE_IMAGE_BYTES / 1024} KB` });
  const liveSchema = z.object({
    screen: z.string().trim().min(1).max(40), title: z.string().trim().max(120),
    summary: z.array(z.string().max(160)).max(12).optional(),
    view: jpegDataUrl.optional(), camera: jpegDataUrl.optional(), cameraActive: z.boolean().default(false),
    /** Optional device metadata reported by the glasses (percent, 0-100) for the console fleet view. */
    battery: z.number().min(0).max(100).optional(), charging: z.boolean().optional(),
  });
  interface LiveSnapshot extends Omit<z.infer<typeof liveSchema>, 'summary'> {
    orgId: string; deviceId: string; deviceName: string; operator: { id: string; name: string } | null; summary: string[]; updatedAt: string;
  }

  app.post('/device/live', {
    ...auth,
    // ~1 call per second per device (keyed by the device's bearer token, not the shared IP).
    config: { rateLimit: { max: opts.relaxedLimits ? 10_000 : 75, timeWindow: '1 minute', keyGenerator: (r: FastifyRequest) => `live:${sha256(String(r.headers.authorization ?? r.ip))}` } },
  }, async (req, reply) => {
    const body = liveSchema.parse(req.body);
    const snap = await tenant(ctx, req, async (tx, p) => {
      if (p.kind !== 'device') throw forbidden('Device session required');
      const [d] = await tx.select({ name: devices.name, siteId: devices.siteId }).from(devices).where(eq(devices.id, p.deviceId!));
      const [op] = await tx.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, p.userId));
      const s: LiveSnapshot = {
        ...body, summary: body.summary ?? [], orgId: p.orgId, deviceId: p.deviceId!, deviceName: d?.name ?? 'Field glasses',
        operator: op ? { id: op.id, name: op.name } : null, updatedAt: new Date().toISOString(),
      };
      return { s, siteId: d?.siteId ?? null };
    });
    const store = demoShared();
    const prev = await store.get<LiveSnapshot>(liveKey(snap.s.orgId, snap.s.deviceId));
    await store.set(liveKey(snap.s.orgId, snap.s.deviceId), snap.s, LIVE_TTL_S);
    const idx = (await store.get<string[]>(liveIdxKey(snap.s.orgId))) ?? [];
    if (!idx.includes(snap.s.deviceId)) await store.set(liveIdxKey(snap.s.orgId), [snap.s.deviceId, ...idx].slice(0, 100), 24 * 3600);
    // Metadata only: images are fetched on demand by authorised viewers.
    if (!prev || prev.screen !== snap.s.screen || Date.parse(snap.s.updatedAt) - Date.parse(prev.updatedAt) > 5_000) {
      ctx.bus.publish({ type: 'device.live', orgId: snap.s.orgId, siteId: snap.siteId, permission: 'device.read', payload: { deviceId: snap.s.deviceId, screen: snap.s.screen, updatedAt: snap.s.updatedAt } });
    }
    return reply.code(202).send({ ok: true });
  });

  const liveView = (s: LiveSnapshot | null, deviceId: string, deviceName: string, operator: { id: string; name: string } | null) => ({
    deviceId, deviceName, operator: operator ?? s?.operator ?? null,
    screen: s?.screen ?? null, title: s?.title ?? null, summary: s?.summary ?? [], view: s?.view ?? null, camera: s?.cameraActive ? (s.camera ?? null) : null,
    cameraActive: s?.cameraActive ?? false, battery: s?.battery ?? null, charging: s?.charging ?? null, updatedAt: s?.updatedAt ?? null, live: !!s && Date.now() - Date.parse(s.updatedAt) < LIVE_FRESH_MS,
  });

  /** Latest live snapshot of one device (images included). */
  app.get('/devices/:id/live', auth, async (req) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const p = req.principal!;
    requirePerm(p, 'device.read');
    const s = await demoShared().get<LiveSnapshot>(liveKey(p.orgId, id));
    return tenant(ctx, req, async (tx) => {
      const [d] = await deviceRows(tx, p, eq(devices.id, id));
      // Demo mode: the device may have been paired on another instance; the org-scoped snapshot is authoritative.
      if (!d && !(ctx.config.demoMode && s && s.orgId === p.orgId)) throw notFound('Device');
      if (s?.operator && ctx.config.demoMode) await ensureGuest(tx, s.operator.id);
      const operator = d?.assignee ? { id: d.assignee.id, name: d.assignee.name ?? s?.operator?.name ?? 'Operator' } : null;
      return liveView(s && s.orgId === p.orgId ? s : null, id, d?.name ?? s!.deviceName, operator);
    });
  });

  /** Live state of every streaming device in the org (no camera frames; small screen thumbnail only). */
  app.get('/devices/live', auth, async (req) => {
    const p = req.principal!;
    requirePerm(p, 'device.read');
    const store = demoShared();
    const ids = (await store.get<string[]>(liveIdxKey(p.orgId))) ?? [];
    const snaps = (await Promise.all(ids.map((id) => store.get<LiveSnapshot>(liveKey(p.orgId, id))))).filter((s): s is LiveSnapshot => !!s && s.orgId === p.orgId);
    return tenant(ctx, req, async (tx) => {
      const visible = snaps.length ? await deviceRows(tx, p, inArray(devices.id, snaps.map((s) => s.deviceId)) as ReturnType<typeof eq>) : [];
      const byId = new Map(visible.map((d) => [d.id, d]));
      return {
        live: snaps.filter((s) => byId.has(s.deviceId) || ctx.config.demoMode).map((s) => {
          const d = byId.get(s.deviceId);
          const v = liveView(s, s.deviceId, d?.name ?? s.deviceName, d?.assignee ? { id: d.assignee.id, name: d.assignee.name ?? s.operator?.name ?? 'Operator' } : null);
          return { ...v, camera: undefined };
        }),
      };
    });
  });

  // =================== Fleet management (console) ===================
  async function deviceRows(tx: Tx, p: Principal, where?: ReturnType<typeof eq>) {
    const rows = await tx.select({ d: devices, siteName: sites.name, assigneeId: deviceAssignments.userId, assigneeName: users.name, assignedAt: deviceAssignments.assignedAt })
      .from(devices).leftJoin(sites, eq(sites.id, devices.siteId))
      .leftJoin(deviceAssignments, and(eq(deviceAssignments.deviceId, devices.id), isNull(deviceAssignments.unassignedAt)))
      .leftJoin(users, eq(users.id, deviceAssignments.userId))
      .where(and(where, p.allSites ? undefined : siteScope(p, devices.siteId)))
      .orderBy(asc(devices.name));
    const now = new Date();
    return rows.map((r) => ({
      ...r.d, hardwareId: undefined, siteName: r.siteName, assignee: r.assigneeId ? { id: r.assigneeId, name: r.assigneeName, since: r.assignedAt } : null,
      streamOpen: ctx.liveDevices.has(r.d.id),
      state: deriveDeviceState({ status: r.d.status, assignedUserId: r.assigneeId, lastSeenAt: r.d.lastSeenAt, streamOpen: ctx.liveDevices.has(r.d.id), now }),
    }));
  }

  app.get('/devices', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'device.read');
    return { devices: await deviceRows(tx, p) };
  }));

  app.get('/devices/:id', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'device.read');
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const [d] = await deviceRows(tx, p, eq(devices.id, id));
    if (!d) throw notFound('Device');
    const history = await tx.select({ a: deviceAssignments, name: users.name }).from(deviceAssignments).innerJoin(users, eq(users.id, deviceAssignments.userId))
      .where(eq(deviceAssignments.deviceId, id)).orderBy(desc(deviceAssignments.assignedAt)).limit(30);
    const sessions = await tx.select({ id: deviceSessions.familyId, createdAt: deviceSessions.createdAt, lastUsedAt: deviceSessions.lastUsedAt, expiresAt: deviceSessions.expiresAt })
      .from(deviceSessions).where(and(eq(deviceSessions.deviceId, id), isNull(deviceSessions.revokedAt), isNull(deviceSessions.rotatedAt)));
    const events = await tx.select({ action: auditEvents.action, at: auditEvents.at, summary: auditEvents.summary, actorUserId: auditEvents.actorUserId, actorName: users.name })
      .from(auditEvents).leftJoin(users, eq(users.id, auditEvents.actorUserId))
      .where(and(eq(auditEvents.entityType, 'device'), eq(auditEvents.entityId, id))).orderBy(desc(auditEvents.at)).limit(40);
    return {
      device: d, assignments: history.map((h) => ({ ...h.a, name: h.name })), activeSessions: sessions, events,
      diagnostics: {
        lastSeenAt: d.lastSeenAt, lastIp: d.lastIp, streamOpen: d.streamOpen, appVersion: d.appVersion, firmwareVersion: d.firmwareVersion, display: d.displayInfo,
        battery: null, batteryNote: 'Battery and hardware sensors are not exposed by the current device integration.',
      },
      canManage: has(p, 'device.manage'),
      effectiveProfile: await (async () => {
        const role = d.assignee ? ((await tx.select({ role: memberships.role }).from(memberships).where(eq(memberships.userId, d.assignee.id)))[0]?.role as Role | undefined) : undefined;
        const e = await effectiveProfile(tx, { deviceId: id, userId: d.assignee?.id, role });
        return { id: e.profileId, name: e.name, version: e.version, source: e.source };
      })(),
    };
  }));

  app.patch('/devices/:id', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'device.manage');
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const body = z.object({ name: z.string().trim().min(2).max(60).optional(), siteId: z.uuid().optional() }).parse(req.body);
    if (body.siteId) requireSite(p, body.siteId, 'Site');
    const [d] = await tx.update(devices).set({ ...body, updatedAt: new Date() }).where(eq(devices.id, id)).returning();
    if (!d) throw notFound('Device');
    await audit(tx, p, { orgId: p.orgId, action: 'device.updated', entityType: 'device', entityId: id, metadata: body });
    if (body.siteId) ctx.bus.publish({ type: 'device.context_changed', orgId: p.orgId, deviceIds: [id], payload: { reason: 'site_changed' } });
    return { device: d };
  }));

  app.post('/devices/:id/assign', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'device.manage');
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const { userId, reason } = z.object({ userId: z.uuid(), reason: z.string().max(200).optional() }).parse(req.body);
    const [d] = await tx.select().from(devices).where(eq(devices.id, id));
    if (!d) throw notFound('Device');
    requireSite(p, d.siteId, 'Device');
    if (d.status !== 'active') throw conflict('device_not_active', 'Only active devices can be reassigned');
    const [m] = await tx.select().from(memberships).where(and(eq(memberships.userId, userId), eq(memberships.status, 'active')));
    if (!m) throw badRequest('invalid_assignee', 'Assignee must be an active member');
    const [cur] = await tx.select().from(deviceAssignments).where(and(eq(deviceAssignments.deviceId, id), isNull(deviceAssignments.unassignedAt)));
    if (cur?.userId === userId) return { ok: true, unchanged: true };
    if (cur) await tx.update(deviceAssignments).set({ unassignedAt: new Date(), reason: reason ?? 'reassigned' }).where(eq(deviceAssignments.id, cur.id));
    await tx.insert(deviceAssignments).values({ orgId: p.orgId, deviceId: id, userId, assignedBy: p.userId, reason });
    await invalidateDeviceTokens(tx, id);
    await audit(tx, p, { orgId: p.orgId, action: 'device.reassigned', entityType: 'device', entityId: id, summary: d.name, metadata: { from: cur?.userId ?? null, to: userId, reason } });
    ctx.bus.publish({ type: 'device.context_changed', orgId: p.orgId, deviceIds: [id], payload: { reason: 'reassigned' } });
    ctx.bus.publish({ type: 'device.updated', orgId: p.orgId, siteId: d.siteId, permission: 'device.read', payload: { id } });
    return { ok: true };
  }));

  for (const action of ['suspend', 'reactivate', 'revoke'] as const) {
    app.post(`/devices/:id/${action}`, auth, async (req) => tenant(ctx, req, async (tx, p) => {
      requirePerm(p, 'device.manage');
      const { id } = z.object({ id: z.uuid() }).parse(req.params);
      const { reason } = z.object({ reason: z.string().trim().max(300).optional() }).parse(req.body ?? {});
      const [d] = await tx.select().from(devices).where(eq(devices.id, id));
      if (!d) throw notFound('Device');
      requireSite(p, d.siteId, 'Device');
      if (d.status === 'revoked') throw conflict('device_revoked', 'Revoked devices must be paired again');
      if (action === 'revoke' && !reason) throw badRequest('reason_required', 'Give a reason for revocation');
      const now = new Date();
      const status = action === 'suspend' ? 'suspended' : action === 'reactivate' ? 'active' : 'revoked';
      if (action === 'reactivate' && d.status !== 'suspended') throw conflict('invalid_transition', 'Only suspended devices can be reactivated');
      await tx.update(devices).set({
        status, suspendedAt: action === 'suspend' ? now : null, revokedAt: action === 'revoke' ? now : undefined, revokedBy: action === 'revoke' ? p.userId : undefined,
        revokeReason: action === 'revoke' ? reason : undefined, updatedAt: now,
      }).where(eq(devices.id, id));
      await invalidateDeviceTokens(tx, id);
      if (action === 'revoke') {
        // Revocation is final: end every device session and release the operator assignment.
        await tx.update(deviceSessions).set({ revokedAt: now }).where(and(eq(deviceSessions.deviceId, id), isNull(deviceSessions.revokedAt)));
        await tx.update(deviceAssignments).set({ unassignedAt: now, reason: 'device revoked' }).where(and(eq(deviceAssignments.deviceId, id), isNull(deviceAssignments.unassignedAt)));
      }
      await audit(tx, p, { orgId: p.orgId, action: `device.${action === 'reactivate' ? 'reactivated' : action === 'suspend' ? 'suspended' : 'revoked'}`, entityType: 'device', entityId: id, summary: d.name, metadata: { reason }, ip: req.ip });
      ctx.bus.publish({ type: action === 'revoke' ? 'device.revoked' : 'device.context_changed', orgId: p.orgId, deviceIds: [id], payload: { reason: action } });
      ctx.bus.publish({ type: 'device.updated', orgId: p.orgId, siteId: d.siteId, permission: 'device.read', payload: { id, status } });
      return { ok: true, status };
    }));
  }
}

export type { FastifyRequest };
