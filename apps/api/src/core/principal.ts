import { can, type Permission, type Role } from '@hydris/domain';
import { and, eq, inArray, sql, type SQL, type Column } from 'drizzle-orm';
import { forbidden, notFound } from './errors';

/** Permissions a paired glasses device may exercise on behalf of its assigned operator. */
export const DEVICE_PERMISSIONS: ReadonlySet<Permission> = new Set([
  'site.read',
  'asset.read',
  'telemetry.read',
  'alarm.read',
  'alarm.acknowledge',
  'inspection.read',
  'inspection.execute',
  'maintenance.read',
  'maintenance.request',
  'maintenance.execute',
  'document.read',
]);

export interface Principal {
  kind: 'user' | 'device';
  userId: string;
  orgId: string;
  role: Role;
  allSites: boolean;
  siteIds: string[];
  isDemoOrg: boolean;
  isPlatformAdmin: boolean;
  deviceId?: string;
  sessionId?: string;
}

export function has(p: Principal, perm: Permission): boolean {
  if (!can(p.role, perm)) return false;
  return p.kind === 'device' ? DEVICE_PERMISSIONS.has(perm) : true;
}

export function requirePerm(p: Principal, perm: Permission): void {
  if (!has(p, perm)) throw forbidden();
}

export function siteAllowed(p: Principal, siteId: string | null | undefined): boolean {
  if (!siteId) return p.allSites;
  return p.allSites || p.siteIds.includes(siteId);
}

/** Throw 404 (not 403) for out-of-scope records so existence is not disclosed. */
export function requireSite(p: Principal, siteId: string | null | undefined, what = 'Resource'): void {
  if (!siteAllowed(p, siteId)) throw notFound(what);
}

/** SQL predicate restricting a site_id column to the principal's site scope. */
export function siteScope(p: Principal, column: Column): SQL | undefined {
  if (p.allSites) return undefined;
  if (!p.siteIds.length) return sql`false`;
  return inArray(column, p.siteIds);
}

export function scoped(p: Principal, siteColumn: Column, ...conds: (SQL | undefined)[]): SQL | undefined {
  return and(siteScope(p, siteColumn), ...conds);
}

export { eq };
