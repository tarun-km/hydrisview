import type { FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import type { Config } from './config.js';
import type { Db, Tx } from './db/client.js';
import { authSessions, deviceAssignments, devices, membershipSites, memberships, organizations, users } from './db/schema.js';
import { withSystem, withTenant } from './db/tenant.js';
import { unauthorized } from './core/errors.js';
import type { Principal } from './core/principal.js';
import type { EventBus } from './core/events.js';
import type { Storage } from './core/services.js';
import type { Role } from '@hydris/domain';

export interface Ctx {
  db: Db;
  bus: EventBus;
  config: Config;
  storage: Storage;
  /** Device ids with an open realtime stream (connectivity state). */
  liveDevices: Map<string, number>;
}

export type UserJwt = { typ: 'user'; sub: string; org: string | null; sid: string };
export type DeviceJwt = { typ: 'device'; sub: string; org: string; sv: number };
export type MfaJwt = { typ: 'mfa'; sub: string };

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: UserJwt | DeviceJwt | MfaJwt;
    user: UserJwt | DeviceJwt | MfaJwt;
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
  let tok: UserJwt | DeviceJwt | MfaJwt;
  try {
    tok = await req.jwtVerify();
  } catch {
    return null;
  }
  if (tok.typ === 'user') {
    return withSystem(ctx.db, async (tx) => {
      const [u] = await tx.select({ status: users.status, isPlatformAdmin: users.isPlatformAdmin }).from(users).where(eq(users.id, tok.sub));
      if (!u || u.status !== 'active') return null;
      // sid is the refresh-token family; logout/reuse-detection revoke the whole family,
      // which immediately invalidates outstanding access tokens too.
      const [live] = await tx.select({ id: authSessions.id }).from(authSessions).where(and(eq(authSessions.familyId, tok.sid), isNull(authSessions.revokedAt))).limit(1);
      if (!live) return null;
      req.platformUserId = u.isPlatformAdmin ? tok.sub : null;
      if (!tok.org) return null;
      const m = await loadMembership(tx, tok.sub, tok.org);
      if (!m) return null;
      return { kind: 'user', userId: tok.sub, orgId: tok.org, role: m.role, allSites: m.allSites, siteIds: m.siteIds, isDemoOrg: m.isDemo, isPlatformAdmin: u.isPlatformAdmin, sessionId: tok.sid };
    });
  }
  if (tok.typ === 'device') {
    return withSystem(ctx.db, async (tx) => {
      const [d] = await tx.select().from(devices).where(eq(devices.id, tok.sub));
      if (!d || d.status !== 'active' || d.sessionVersion !== tok.sv || d.orgId !== tok.org) return null;
      const [a] = await tx.select({ userId: deviceAssignments.userId }).from(deviceAssignments).where(and(eq(deviceAssignments.deviceId, d.id), isNull(deviceAssignments.unassignedAt)));
      if (!a) return null;
      const m = await loadMembership(tx, a.userId, d.orgId);
      if (!m) return null;
      await tx.update(devices).set({ lastSeenAt: new Date(), lastIp: req.ip }).where(eq(devices.id, d.id));
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
