import type { Permission } from './roles';

/**
 * Alarm model. Acknowledging an alarm records that a person has seen it; it does not
 * change the physical process. Resolution records that the underlying condition was
 * dealt with, and closing archives the event after review.
 */

export const ALARM_SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
export type AlarmSeverity = (typeof ALARM_SEVERITIES)[number];

export const SEVERITY_RANK: Record<AlarmSeverity, number> = { critical: 4, high: 3, medium: 2, low: 1 };

export const ALARM_CONDITIONS = ['high_high', 'high', 'low', 'low_low', 'stale'] as const;
export type AlarmCondition = (typeof ALARM_CONDITIONS)[number];

export const CONDITION_LABELS: Record<AlarmCondition, string> = {
  high_high: 'High-high',
  high: 'High',
  low: 'Low',
  low_low: 'Low-low',
  stale: 'No fresh data',
};

export const ALARM_STATES = ['active', 'acknowledged', 'investigating', 'resolved', 'closed'] as const;
export type AlarmState = (typeof ALARM_STATES)[number];

export const ALARM_STATE_LABELS: Record<AlarmState, string> = {
  active: 'Active',
  acknowledged: 'Acknowledged',
  investigating: 'Investigating',
  resolved: 'Resolved',
  closed: 'Closed',
};

export const ALARM_ACTIONS = ['acknowledge', 'investigate', 'resolve', 'close'] as const;
export type AlarmAction = (typeof ALARM_ACTIONS)[number];

export const ALARM_TRANSITIONS: Record<AlarmAction, { from: readonly AlarmState[]; to: AlarmState; permission: Permission; requiresNote: boolean }> = {
  acknowledge: { from: ['active'], to: 'acknowledged', permission: 'alarm.acknowledge', requiresNote: false },
  investigate: { from: ['active', 'acknowledged'], to: 'investigating', permission: 'alarm.investigate', requiresNote: false },
  resolve: { from: ['acknowledged', 'investigating'], to: 'resolved', permission: 'alarm.resolve', requiresNote: true },
  close: { from: ['resolved'], to: 'closed', permission: 'alarm.close', requiresNote: false },
};

export function canTransitionAlarm(state: AlarmState, action: AlarmAction): boolean {
  return ALARM_TRANSITIONS[action].from.includes(state);
}

/** States in which an alarm still needs human attention. */
export const OPEN_ALARM_STATES: readonly AlarmState[] = ['active', 'acknowledged', 'investigating'];

export interface ThresholdRule {
  condition: Exclude<AlarmCondition, 'stale'>;
  threshold: number;
  /** Hysteresis band: once in alarm, the value must return past threshold∓deadband to count as normal. */
  deadband: number;
}

export type RuleEvaluation = 'breach' | 'normal' | 'holding';

/**
 * Evaluate a threshold rule for one value.
 * - `breach`: value is beyond the threshold
 * - `holding`: rule is currently in alarm and value is inside the deadband (no change)
 * - `normal`: value is clearly back in range
 */
export function evaluateThreshold(rule: ThresholdRule, value: number, currentlyInAlarm: boolean): RuleEvaluation {
  const isHigh = rule.condition === 'high' || rule.condition === 'high_high';
  const db = Math.max(0, rule.deadband);
  if (isHigh) {
    if (value > rule.threshold) return 'breach';
    if (currentlyInAlarm && value > rule.threshold - db) return 'holding';
    return 'normal';
  }
  if (value < rule.threshold) return 'breach';
  if (currentlyInAlarm && value < rule.threshold + db) return 'holding';
  return 'normal';
}

/** On-delay filter: a breach must persist for `onDelayS` before an alarm is raised. */
export function shouldRaise(breachSince: Date | null, now: Date, onDelayS: number): boolean {
  if (!breachSince) return onDelayS <= 0;
  return (now.getTime() - breachSince.getTime()) / 1000 >= onDelayS;
}

export function describeBreach(condition: AlarmCondition, value: number | null, threshold: number | null, unit: string): string {
  if (condition === 'stale') return 'No fresh measurement received within the expected interval';
  const dir = condition === 'high' || condition === 'high_high' ? 'above' : 'below';
  return `${value ?? '—'} ${unit} ${dir} ${CONDITION_LABELS[condition].toLowerCase()} limit ${threshold ?? '—'} ${unit}`;
}
