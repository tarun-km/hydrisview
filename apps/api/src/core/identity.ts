/**
 * Identity helpers shared by the auth and organization modules: account-state checks,
 * immediate access revocation (suspend / remove), self-service organization creation and
 * post-login routing by account type.
 */
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { emailDomain, type Role } from '@hydris/domain';
import type { Tx } from '../db/client';
import type { Ctx } from '../context';
import { authSessions, deviceAssignments, devices, deviceSessions, memberships, organizations } from '../db/schema';
import { HttpError } from './errors';

export type AccountBlock = 'account_suspended' | 'account_removed';

export const blockError = (b: AccountBlock) =>
  b === 'account_suspended'
    ? new HttpError(403, 'account_suspended', 'Your account is suspended. Contact your administrator.')
    : new HttpError(403, 'account_removed', 'Your access to Hydris has been removed. Contact your administrator.');

/**
 * A user with memberships but none active cannot sign in. Suspension wins over removal when
 * both exist. Users without any membership (platform administrators) are not blocked here.
 */
export async function accountBlock(tx: Tx, userId: string): Promise<AccountBlock | null> {
  const ms = await tx.select({ status: memberships.status, orgStatus: organizations.status }).from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.orgId)).where(eq(memberships.userId, userId));
  if (!ms.length || ms.some((m) => m.status === 'active' && m.orgStatus === 'active')) return null;
  if (ms.some((m) => m.status === 'suspended')) return 'account_suspended';
  if (ms.some((m) => m.status === 'removed')) return 'account_removed';
  return null;
}

/**
 * End a member's access to one organization immediately: revoke their user sessions (refresh
 * families, which also kills outstanding access tokens), unassign their glasses and invalidate
 * the device tokens, then tell their open app / glasses streams to sign out.
 */
export async function revokeMemberAccess(tx: Tx, ctx: Ctx, orgId: string, userId: string, reason: 'suspended' | 'removed' | 'deactivated') {
  const now = new Date();
  await tx.update(authSessions).set({ revokedAt: now })
    .where(and(eq(authSessions.userId, userId), or(eq(authSessions.orgId, orgId), isNull(authSessions.orgId)), isNull(authSessions.revokedAt)));
  const active = await tx.select().from(deviceAssignments).where(and(eq(deviceAssignments.userId, userId), eq(deviceAssignments.orgId, orgId), isNull(deviceAssignments.unassignedAt)));
  const deviceIds: string[] = [];
  for (const a of active) {
    deviceIds.push(a.deviceId);
    await tx.update(deviceAssignments).set({ unassignedAt: now, reason: `member ${reason}` }).where(eq(deviceAssignments.id, a.id));
    await tx.update(devices).set({ sessionVersion: sql`${devices.sessionVersion} + 1`, updatedAt: now }).where(eq(devices.id, a.deviceId));
    await tx.update(deviceSessions).set({ revokedAt: now }).where(and(eq(deviceSessions.deviceId, a.deviceId), isNull(deviceSessions.revokedAt)));
  }
  // The person's app / web session streams (userIds) and their glasses (deviceIds) sign out on these.
  ctx.bus.publish({ type: 'account.ended', orgId, userIds: [userId], payload: { reason, code: reason === 'removed' ? 'account_removed' : 'account_suspended' } });
  if (deviceIds.length) {
    ctx.bus.publish({ type: 'session.revoked', orgId, deviceIds, payload: { reason: `operator_${reason}` } });
    ctx.bus.publish({ type: 'device.context_changed', orgId, deviceIds, payload: { reason: `operator_${reason}` } });
  }
  return { devices: deviceIds.length };
}

/** Slug from an organization name, made unique with a short suffix when taken. */
export async function uniqueOrgSlug(tx: Tx, name: string): Promise<string> {
  const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'org';
  for (let i = 0; i < 20; i++) {
    const slug = i === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
    const [dupe] = await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, slug));
    if (!dupe) return slug;
  }
  throw new HttpError(409, 'slug_taken', 'Could not allocate an organization identifier');
}

/**
 * Administrator self sign-up creates a NEW organization (setup wizard pending) with the user as
 * its administrator. Joining an existing organization always goes through an invitation.
 */
export async function createSignupOrg(tx: Tx, userId: string, email: string, orgName: string) {
  const [org] = await tx.insert(organizations).values({ name: orgName, slug: await uniqueOrgSlug(tx, orgName), emailDomain: emailDomain(email), timezone: 'Asia/Kolkata' }).returning();
  const [m] = await tx.insert(memberships).values({ orgId: org!.id, userId, role: 'admin', allSites: true, status: 'active', title: 'Administrator' }).returning();
  return { org: org!, membership: m! };
}

export interface SessionLike {
  role: Role | null;
  org: { id: string; setupCompleted: boolean } | null;
  user: { isPlatformAdmin: boolean };
}

/** Where a client should go after signing in. Operators never land in the console. */
export function homeRoute(s: SessionLike): string {
  if (s.role === 'operator') return '/operator';
  if (s.role === 'admin') return s.org && !s.org.setupCompleted ? '/console/setup' : '/console';
  return s.user.isPlatformAdmin ? '/console/platform' : '/login';
}
