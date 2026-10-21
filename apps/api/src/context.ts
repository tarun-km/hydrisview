import type { FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import type { Config } from './config';
import type { Db, Tx } from './db/client';
import { authSessions, deviceAssignments, devices, membershipSites, memberships, organizations, users } from './db/schema';
import { withSystem, withTenant } from './db/tenant';
import { unauthorized } from './core/errors';
import type { Principal } from './core/principal';
import type { EventBus } from './core/events';
import type { Storage } from './core/services';
import type { Role } from '@hydris/domain';
import { ensureDemoDevice } from './core/demo-auth';
import { ensureGuest } from './core/demo-guests';

export interface Ctx {
  db: Db;
  bus: EventBus;
  config: Config;
  storage: Storage;
  /** Device ids with an open realtime stream (connectivity state). */
  liveDevices: Map<string, number>;
  /** Called on API activity (requests, realtime polls). Demo mode uses it to advance live data lazily. */
  onActivity?: () => void;
}

export type UserJwt = { typ: 'user'; sub: string; org: string | null; sid: string };
/** `uid`/`site` are only set in demo mode (lets any instance rebuild the device record). */
export type DeviceJwt = { typ: 'device'; sub: string; org: string; sv: number; uid?: string | undefined; site?: string | null | undefined };
export type MfaJwt = { typ: 'mfa'; sub: string };
/** Demo mode only: signed fallback for the refresh cookie when the session row lives on another instance. */
export type DemoSessionJwt = { typ: 'demo_session'; sub: string; org: string | null; sid: string };

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: UserJwt | DeviceJwt | MfaJwt | DemoSessionJwt;
    user: UserJwt | DeviceJwt | MfaJwt | DemoSessionJwt;
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    principal: Principal | null;
    platformUserId: string | null;
  }
}

async function loadMembership(tx: Tx, userId: string, orgId: string) {
  const [m] = await tx
    .select({ id: memberships.id, role: memberships.role, status: memberships.status, allSites: memberships.allSites, isDemo: organizations.isDemo, orgStatus: organizations.status })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .where(and(eq(memberships.userId, userId), eq(memberships.orgId, orgId)));
  if (!m || m.status !== 'active' || m.orgStatus !== 'active') return null;
  const sites = m.allSites ? [] : (await tx.select({ siteId: membershipSites.siteId }).from(membershipSites).where(eq(membershipSites.membershipId, m.id))).map((r) => r.siteId);
  return { role: m.role as Role, allSites: m.allSites, siteIds: sites, isDemo: m.isDemo };
}

/** Resolve the bearer token into a Principal, re-checking revocation state on every request. */
export async function resolvePrincipal(ctx: Ctx, req: FastifyRequest): Promise<Principal | null> {
  let tok: UserJwt | DeviceJwt | MfaJwt | DemoSessionJwt;
  try {
    tok = await req.jwtVerify();
  } catch {
    return null;
  }
  return resolveTokenPrincipal(ctx, tok, { ip: req.ip, onPlatformUser: (id) => (req.platformUserId = id) });
}

/**
 * Resolve an already-verified token into a Principal (shared by Fastify routes and
 * the serverless SSE route handler, which verifies the bearer token itself).
 */
export async function resolveTokenPrincipal(
  ctx: Ctx,
  tok: UserJwt | DeviceJwt | MfaJwt | DemoSessionJwt,
  opts: { ip?: string; onPlatformUser?: (userId: string | null) => void } = {},
): Promise<Principal | null> {
  if (tok.typ === 'user') {
    return withSystem(ctx.db, async (tx) => {
      if (ctx.config.demoMode) await ensureGuest(tx, tok.sub);
      const [u] = await tx.select({ status: users.status, isPlatformAdmin: users.isPlatformAdmin }).from(users).where(eq(users.id, tok.sub));
      if (!u || u.status !== 'active') return null;
      // sid is the refresh-token family; logout/reuse-detection revoke the whole family,
      // which immediately invalidates outstanding access tokens too.
      const [live] = await tx.select({ id: authSessions.id }).from(authSessions).where(and(eq(authSessions.familyId, tok.sid), isNull(authSessions.revokedAt))).limit(1);
      if (!live) {
        // Demo mode: sessions live per instance. Accept a valid token whose family is unknown
        // here; a family that exists here but was revoked (logout, reuse) is still rejected.
        if (!ctx.config.demoMode) return null;
        const [known] = await tx.select({ id: authSessions.id }).from(authSessions).where(eq(authSessions.familyId, tok.sid)).limit(1);
        if (known) return null;
      }
      opts.onPlatformUser?.(u.isPlatformAdmin ? tok.sub : null);
      if (!tok.org) return null;
      const m = await loadMembership(tx, tok.sub, tok.org);
      if (!m) return null;
      return { kind: 'user', userId: tok.sub, orgId: tok.org, role: m.role, allSites: m.allSites, siteIds: m.siteIds, isDemoOrg: m.isDemo, isPlatformAdmin: u.isPlatformAdmin, sessionId: tok.sid };
    });
  }
  if (tok.typ === 'device') {
    return withSystem(ctx.db, async (tx) => {
      if (ctx.config.demoMode) {
        if (tok.uid) await ensureGuest(tx, tok.uid);
        await ensureDemoDevice(tx, tok);
      }
      const [d] = await tx.select().from(devices).where(eq(devices.id, tok.sub));
      if (!d || d.status !== 'active' || d.sessionVersion !== tok.sv || d.orgId !== tok.org) return null;
      const [a] = await tx.select({ userId: deviceAssignments.userId }).from(deviceAssignments).where(and(eq(deviceAssignments.deviceId, d.id), isNull(deviceAssignments.unassignedAt)));
      if (!a) return null;
      const m = await loadMembership(tx, a.userId, d.orgId);
      if (!m) return null;
      await tx.update(devices).set({ lastSeenAt: new Date(), ...(opts.ip ? { lastIp: opts.ip } : {}) }).where(eq(devices.id, d.id));
      return { kind: 'device', userId: a.userId, orgId: d.orgId, role: m.role, allSites: m.allSites, siteIds: m.siteIds, isDemoOrg: m.isDemo, isPlatformAdmin: false, deviceId: d.id };
    });
  }
  return null;
}

export function authenticate(ctx: Ctx) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    req.principal = await resolvePrincipal(ctx, req);
    if (!req.principal) throw unauthorized();
  };
}

export function principal(req: FastifyRequest): Principal {
  if (!req.principal) throw unauthorized();
  return req.principal;
}

/** Run a request's data access inside the caller's tenant transaction (RLS enforced). */
export function tenant<T>(ctx: Ctx, req: FastifyRequest, fn: (tx: Tx, p: Principal) => Promise<T>): Promise<T> {
  const p = principal(req);
  return withTenant(ctx.db, p.orgId, (tx) => fn(tx, p));
}
