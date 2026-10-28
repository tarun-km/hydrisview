/**
 * Account types and permissions. This matrix is the single source of truth: the API
 * enforces it on every request and clients only use it to decide what to show.
 *
 * Hydris has exactly two account types:
 * - `admin`    (Administrator): runs the organization in the web console; may also use glasses.
 * - `operator` (Field Operator): uses the Android app, the glasses and the web glasses app.
 *   Operators never get the console (no `console.access`, no org-level permissions).
 *
 * The database column is still called `role` (enum `role`) for continuity.
 */

export const ROLES = ['admin', 'operator'] as const;
export type Role = (typeof ROLES)[number];
/** Alias used by the identity surface. */
export type AccountType = Role;
export const ACCOUNT_TYPES = ROLES;

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrator',
  operator: 'Field Operator',
};

/** Mapping applied by migration 0009 to the six legacy roles. */
export const LEGACY_ROLE_MAP = {
  org_admin: 'admin',
  factory_manager: 'admin',
  supervisor: 'admin',
  field_operator: 'operator',
  maintenance_engineer: 'operator',
  viewer: 'operator',
} as const satisfies Record<string, Role>;
export type LegacyRole = keyof typeof LEGACY_ROLE_MAP;
export const mapLegacyRole = (r: string): Role => (r in LEGACY_ROLE_MAP ? LEGACY_ROLE_MAP[r as LegacyRole] : r === 'operator' ? 'operator' : r === 'admin' ? 'admin' : 'operator');

export const PERMISSIONS = [
  'org.manage',
  'site.read',
  'site.manage',
  'asset.read',
  'asset.manage',
  'sensor.manage',
  'telemetry.read',
  'gateway.manage',
  'alarm.read',
  'alarm.acknowledge',
  'alarm.assign',
  'alarm.investigate',
  'alarm.resolve',
  'alarm.close',
  'alarm_rule.manage',
  'inspection.read',
  'inspection.manage',
  'inspection.execute',
  'inspection.review',
  'maintenance.read',
  'maintenance.request',
  'maintenance.manage',
  'maintenance.execute',
  'member.read',
  'member.manage',
  'device.read',
  'device.pair',
  'device.manage',
  'document.read',
  'document.manage',
  'report.read',
  'report.export',
  'audit.read',
  'simulation.control',
  'auditdoc.read',
  'auditdoc.capture',
  'auditdoc.verify',
  'auditdoc.approve',
  /** Use the web console (organization management, dashboards, reports). Administrators only. */
  'console.access',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/**
 * Field Operator: the former field-operator set plus what operators need in the field:
 * glasses (pairing), scans (audit-document capture), their own work (execute inspections and
 * maintenance checklists, raise requests), alarm acknowledgement and the assistant (which
 * only needs read access). No org-level management and no console.
 */
const OPERATOR: Permission[] = [
  'site.read',
  'asset.read',
  'telemetry.read',
  'alarm.read',
  'alarm.acknowledge',
  'alarm.investigate',
  'alarm.resolve',
  'inspection.read',
  'inspection.execute',
  'maintenance.read',
  'maintenance.request',
  'maintenance.execute',
  'document.read',
  'device.pair',
  'auditdoc.read',
  'auditdoc.capture',
];

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  admin: new Set(PERMISSIONS),
  operator: new Set<Permission>(OPERATOR),
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

export function permissionsFor(role: Role): Permission[] {
  return [...(ROLE_PERMISSIONS[role] ?? [])];
}

/** Account types a member of type `actor` may invite or assign. Only administrators manage people. */
export function assignableRoles(actor: Role): Role[] {
  return actor === 'admin' ? [...ROLES] : [];
}

/** Account types whose access is limited to the sites listed on their membership by default. */
export const SITE_SCOPED_BY_DEFAULT: ReadonlySet<Role> = new Set(['operator']);

export const isRole = (v: unknown): v is Role => typeof v === 'string' && (ROLES as readonly string[]).includes(v);

/** Membership lifecycle. `removed` memberships are kept for the audit trail but grant nothing. */
export const MEMBER_STATUSES = ['invited', 'active', 'suspended', 'removed'] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

/** Domains allowed to self-register an administrator account (comma-separated env, default hydris.ai). */
export function parseSignupDomains(raw: string | undefined | null): string[] {
  const list = (raw ?? 'hydris.ai').split(',').map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
  return list.length ? list : ['hydris.ai'];
}

export function emailDomain(email: string): string {
  const at = email.lastIndexOf('@');
  return at < 0 ? '' : email.slice(at + 1).trim().toLowerCase();
}

/** Exact domain match only (sub-domains and look-alikes are rejected). */
export function isAllowedSignupEmail(email: string, domains: readonly string[]): boolean {
  const d = emailDomain(email);
  return !!d && domains.includes(d);
}
