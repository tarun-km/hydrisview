import type { AlarmSeverity, Role } from '@hydris/domain';

/** Shapes returned by the command-center API (apps/api/src/modules/command.ts). */
export interface OperatorDevice {
  id: string; name: string; kind: 'hardware' | 'simulator'; connected: boolean; streaming: boolean; battery: number | null; lastSeenAt: string | null;
  screen: { screen: string; title: string; updatedAt: string } | null;
}

export interface OperatorStats {
  userId: string; name: string; email: string; role: Role; status: 'invited' | 'active' | 'suspended' | 'removed';
  shiftLabel: string | null; employeeId: string | null; allSites: boolean; sites: { id: string; name: string }[];
  devices: OperatorDevice[]; lastActiveAt: string | null;
  rounds: { weekAssigned: number; weekCompleted: number; todayAssigned: number; todayCompleted: number; open: number; overdue: number };
  openTasks: number; openAlarms: number; scans: { week: number; total: number };
}

export interface OnShiftCard extends OperatorStats {
  connected: boolean; onShift: boolean; glasses: OperatorDevice | null;
  current: { kind: 'inspection' | 'maintenance'; id: string; title: string; status: string; dueAt?: string | null } | null;
  alarm: { id: string; title: string; severity: AlarmSeverity; state: string } | null;
}

export interface ActivityRow {
  id: string; action: string; summary: string | null; at: string; actorUserId: string | null; actorName: string | null; actorLabel: string | null; entityType: string | null; entityId: string | null;
}

export interface Dashboard {
  generatedAt: string;
  kpis: { onShift: number; operators: number; openAlarms: number; criticalAlarms: number; unownedAlarms: number; roundsAssigned: number; roundsCompleted: number; approvals: number };
  onShift: OnShiftCard[];
  alarms: { id: string; title: string; severity: AlarmSeverity; state: string; triggeredAt: string; synthetic: boolean; siteName: string; assetTag: string | null; owner: { id: string; name: string; via: 'assigned' | 'acknowledged' } | null }[];
  rounds: { userId: string; name: string; assigned: number; completed: number; overdue: number }[];
  approvals: { inspections: number; scans: number; scansVerified: number; items: { kind: 'inspection' | 'scan'; id: string; title: string; at: string | null; by: string | null; status?: string }[] };
  fleet: { glasses: { total: number; connected: number; streaming: number; unassigned: number }; suspended: number; battery: { reported: number; average: number | null; low: number } };
  activity: ActivityRow[];
}

export interface FleetDevice {
  id: string; name: string; kind: 'hardware' | 'simulator'; model: string | null; status: 'active' | 'suspended' | 'revoked'; firmwareVersion: string | null; appVersion: string | null;
  lastSeenAt: string | null; siteId: string | null; siteName: string | null; pairedAt: string;
  owner: { id: string; name: string; since: string | null } | null; connected: boolean; streaming: boolean; battery: number | null; charging: boolean | null;
  screen: { screen: string; title: string; updatedAt: string } | null;
}

export interface OrgSettings { requireDeviceApproval: boolean }

/** "member.suspended" -> "Member suspended"; audit summaries win when present. */
export function describeAction(a: Pick<ActivityRow, 'action' | 'summary'>): string {
  const verb = a.action.replace(/[._]/g, ' ');
  const base = verb.charAt(0).toUpperCase() + verb.slice(1);
  return a.summary ? `${base}: ${a.summary}` : base;
}

export function activityTone(action: string): 'critical' | 'ok' | 'muted' | 'cobalt' | 'lime' {
  if (/alarm\.triggered|suspended|removed|revoked/.test(action)) return 'critical';
  if (/submitted|approved|completed|resolved|reactivated|accepted/.test(action)) return 'ok';
  if (/assigned|invited|paired|created/.test(action)) return 'cobalt';
  return 'muted';
}
