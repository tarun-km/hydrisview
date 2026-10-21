/**
 * Role-based access control. This matrix is the single source of truth: the API
 * enforces it on every request and clients only use it to decide what to show.
 */

export const ROLES = [
  'org_admin',
  'factory_manager',
  'supervisor',
  'field_operator',
  'maintenance_engineer',
  'viewer',
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  org_admin: 'Organization administrator',
  factory_manager: 'Factory manager',
  supervisor: 'Supervisor',
  field_operator: 'Field operator',
  maintenance_engineer: 'Maintenance engineer',
  viewer: 'Read-only viewer',
};

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
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const READ_BASE: Permission[] = [
  'site.read',
  'asset.read',
  'telemetry.read',
  'alarm.read',
  'inspection.read',
  'maintenance.read',
  'document.read',
  'auditdoc.read',
];

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  org_admin: new Set(PERMISSIONS),
  factory_manager: new Set<Permission>([
    ...READ_BASE,
    'site.manage',
    'asset.manage',
    'sensor.manage',
    'gateway.manage',
    'alarm.acknowledge',
    'alarm.assign',
    'alarm.investigate',
    'alarm.resolve',
    'alarm.close',
    'alarm_rule.manage',
    'inspection.manage',
    'inspection.review',
    'maintenance.request',
    'maintenance.manage',
    'member.read',
    'member.manage',
    'device.read',
    'device.pair',
    'device.manage',
    'document.manage',
    'report.read',
    'report.export',
    'audit.read',
    'simulation.control',
    'auditdoc.capture',
    'auditdoc.verify',
    'auditdoc.approve',
  ]),
  supervisor: new Set<Permission>([
    ...READ_BASE,
    'alarm.acknowledge',
    'alarm.assign',
    'alarm.investigate',
    'alarm.resolve',
    'alarm.close',
    'inspection.manage',
    'inspection.review',
    'inspection.execute',
    'maintenance.request',
    'maintenance.manage',
    'member.read',
    'device.read',
    'device.pair',
    'report.read',
    'report.export',
    'auditdoc.capture',
    'auditdoc.verify',
  ]),
  field_operator: new Set<Permission>([
    ...READ_BASE,
    'alarm.acknowledge',
    'inspection.execute',
    'maintenance.request',
    'device.pair',
    'auditdoc.capture',
  ]),
  maintenance_engineer: new Set<Permission>([
    ...READ_BASE,
    'alarm.acknowledge',
    'alarm.investigate',
    'alarm.resolve',
    'inspection.execute',
    'maintenance.request',
    'maintenance.execute',
    'device.pair',
    'auditdoc.capture',
  ]),
  viewer: new Set<Permission>([...READ_BASE, 'report.read']),
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

export function permissionsFor(role: Role): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}

/** Roles a member holding `actor` may invite or assign. Never allows escalation above self. */
export function assignableRoles(actor: Role): Role[] {
  switch (actor) {
    case 'org_admin':
      return [...ROLES];
    case 'factory_manager':
      return ['supervisor', 'field_operator', 'maintenance_engineer', 'viewer'];
    default:
      return [];
  }
}

/** Roles whose permissions are always limited to the sites listed on their membership. */
export const SITE_SCOPED_BY_DEFAULT: ReadonlySet<Role> = new Set([
  'factory_manager',
  'supervisor',
  'field_operator',
  'maintenance_engineer',
  'viewer',
]);

export const isRole = (v: unknown): v is Role => typeof v === 'string' && (ROLES as readonly string[]).includes(v);
