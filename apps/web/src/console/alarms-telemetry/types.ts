import type { AlarmAction, AlarmCondition, AlarmSeverity, AlarmState, Freshness, Measurand, MeasurementMethod, TelemetrySource } from '@hydris/domain';

/** Wire shapes of apps/api/src/modules/alarms.ts, telemetry.ts and plant.ts (dates arrive as ISO strings). */

export interface AlarmEvent {
  id: string;
  siteId: string;
  assetId: string | null;
  sensorId: string | null;
  ruleId: string | null;
  severity: AlarmSeverity;
  condition: AlarmCondition;
  state: AlarmState;
  title: string;
  description: string | null;
  recommendedAction: string | null;
  triggerValue: number | null;
  threshold: number | null;
  unit: string | null;
  peakValue: number | null;
  triggeredAt: string;
  clearedAt: string | null;
  assignedTo: string | null;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  closedBy: string | null;
  closedAt: string | null;
  synthetic: boolean;
  updatedAt: string;
}

export interface AlarmListRow extends AlarmEvent {
  assetTag: string | null;
  assetName: string | null;
  sensorTag: string | null;
  assigneeName: string | null;
}

export interface AlarmRule {
  id: string;
  siteId: string;
  sensorId: string;
  name: string;
  condition: AlarmCondition;
  threshold: number | null;
  deadband: number;
  onDelayS: number;
  severity: AlarmSeverity;
  enabled: boolean;
  recommendedAction: string | null;
  procedureDocumentId: string | null;
  sensorTag?: string;
  sensorName?: string;
  unit?: string;
  assetTag?: string | null;
}

export interface AlarmHistoryEntry {
  id: string;
  action: string;
  fromState: AlarmState | null;
  toState: AlarmState | null;
  actorUserId: string | null;
  actorName: string | null;
  note: string | null;
  at: string;
}

export interface AlarmDetailResponse {
  alarm: AlarmEvent & { assetTag: string | null; assetName: string | null; sensorTag: string | null; sensorName: string | null; measurand: Measurand | null };
  history: AlarmHistoryEntry[];
  rule: AlarmRule | null;
  procedure: { id: string; title: string } | null;
  followUps: { id: string; title: string; status: string }[];
  assignee: { id: string; name: string } | null;
  allowedActions: AlarmAction[];
  canAssign: boolean;
}

export interface SensorRow {
  id: string;
  siteId: string;
  assetId: string | null;
  tag: string;
  name: string;
  measurand: Measurand;
  unit: string;
  method: MeasurementMethod;
  expectedIntervalS: number;
  lastValue: number | null;
  lastTs: string | null;
  lastQuality: 'good' | 'uncertain' | 'bad' | null;
  lastSource: TelemetrySource | null;
  enabled: boolean;
  assetTag: string | null;
  assetName: string | null;
  openAlarms: number;
  rules: number;
  freshness: Freshness;
}

export interface HistoryResponse {
  sensor: Omit<SensorRow, 'assetTag' | 'assetName' | 'openAlarms' | 'rules'> & {
    label: string;
    decimals: number;
    typicalRange: [number, number] | null;
    explanation: string;
  };
  from: string;
  to: string;
  bucketSeconds: number | null;
  totalReadings: number;
  points: { t: string; v: number; min: number; max: number; n: number }[];
}

export interface Member { userId: string; name: string; email: string; role: string; status: string; title: string | null }
