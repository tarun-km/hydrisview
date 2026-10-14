/** Inspection and maintenance state machines. */

// ---------------- Inspections ----------------

export const INSPECTION_STATUSES = ['scheduled', 'in_progress', 'paused', 'submitted', 'approved', 'rejected', 'cancelled'] as const;
export type InspectionStatus = (typeof INSPECTION_STATUSES)[number];

export const INSPECTION_STATUS_LABELS: Record<InspectionStatus, string> = {
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  paused: 'Paused',
  submitted: 'Submitted',
  approved: 'Approved',
  rejected: 'Returned',
  cancelled: 'Cancelled',
};

export const INSPECTION_TRANSITIONS = {
  start: { from: ['scheduled', 'paused', 'rejected'], to: 'in_progress' },
  pause: { from: ['in_progress'], to: 'paused' },
  submit: { from: ['in_progress', 'paused'], to: 'submitted' },
  approve: { from: ['submitted'], to: 'approved' },
  reject: { from: ['submitted'], to: 'rejected' },
  cancel: { from: ['scheduled', 'in_progress', 'paused', 'rejected'], to: 'cancelled' },
} as const satisfies Record<string, { from: readonly InspectionStatus[]; to: InspectionStatus }>;
export type InspectionAction = keyof typeof INSPECTION_TRANSITIONS;

export function canTransitionInspection(status: InspectionStatus, action: InspectionAction): boolean {
  return (INSPECTION_TRANSITIONS[action].from as readonly InspectionStatus[]).includes(status);
}

/** Statuses in which the assigned operator may record step responses. */
export const INSPECTION_EDITABLE: readonly InspectionStatus[] = ['scheduled', 'in_progress', 'paused', 'rejected'];

export const STEP_KINDS = ['check', 'reading', 'choice', 'text', 'photo'] as const;
export type StepKind = (typeof STEP_KINDS)[number];

export interface InspectionStep {
  id: string;
  kind: StepKind;
  title: string;
  instruction?: string;
  /** Safety-relevant note shown before the step. */
  caution?: string;
  required: boolean;
  /** For `reading` steps. */
  measurand?: string;
  unit?: string;
  expectedMin?: number;
  expectedMax?: number;
  /** For `choice` steps. */
  options?: string[];
  abnormalOptions?: string[];
}

export type StepValue =
  | { kind: 'check'; checked: boolean; abnormal?: boolean }
  | { kind: 'reading'; value: number }
  | { kind: 'choice'; option: string }
  | { kind: 'text'; text: string }
  | { kind: 'photo'; attachmentId: string };

export type StepOutcome = 'ok' | 'abnormal' | 'na';

/** Derive whether a step response represents an abnormal condition. */
export function stepOutcome(step: InspectionStep, value: StepValue): StepOutcome {
  switch (value.kind) {
    case 'check':
      return value.abnormal ? 'abnormal' : value.checked ? 'ok' : 'abnormal';
    case 'reading': {
      if (step.expectedMin !== undefined && value.value < step.expectedMin) return 'abnormal';
      if (step.expectedMax !== undefined && value.value > step.expectedMax) return 'abnormal';
      return 'ok';
    }
    case 'choice':
      return step.abnormalOptions?.includes(value.option) ? 'abnormal' : 'ok';
    default:
      return 'ok';
  }
}

export interface InspectionProgress {
  total: number;
  required: number;
  answered: number;
  requiredAnswered: number;
  abnormal: number;
  complete: boolean;
  percent: number;
}

export function inspectionProgress(
  steps: readonly InspectionStep[],
  responses: ReadonlyMap<string, { outcome: StepOutcome }>,
): InspectionProgress {
  let answered = 0;
  let requiredAnswered = 0;
  let abnormal = 0;
  let required = 0;
  for (const s of steps) {
    if (s.required) required++;
    const r = responses.get(s.id);
    if (!r) continue;
    answered++;
    if (s.required) requiredAnswered++;
    if (r.outcome === 'abnormal') abnormal++;
  }
  return {
    total: steps.length,
    required,
    answered,
    requiredAnswered,
    abnormal,
    complete: requiredAnswered === required,
    percent: steps.length ? Math.round((answered / steps.length) * 100) : 0,
  };
}

// ---------------- Maintenance ----------------

export const MAINTENANCE_STATUSES = ['open', 'assigned', 'in_progress', 'on_hold', 'completed', 'cancelled'] as const;
export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];

export const MAINTENANCE_STATUS_LABELS: Record<MaintenanceStatus, string> = {
  open: 'Open',
  assigned: 'Assigned',
  in_progress: 'In progress',
  on_hold: 'On hold',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const MAINTENANCE_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type MaintenancePriority = (typeof MAINTENANCE_PRIORITIES)[number];

export const MAINTENANCE_KINDS = ['corrective', 'preventive', 'inspection_followup', 'alarm_followup'] as const;
export type MaintenanceKind = (typeof MAINTENANCE_KINDS)[number];

export const MAINTENANCE_TRANSITIONS = {
  start: { from: ['open', 'assigned', 'on_hold'], to: 'in_progress' },
  hold: { from: ['assigned', 'in_progress'], to: 'on_hold' },
  complete: { from: ['in_progress'], to: 'completed' },
  cancel: { from: ['open', 'assigned', 'in_progress', 'on_hold'], to: 'cancelled' },
  reopen: { from: ['completed', 'cancelled'], to: 'open' },
} as const satisfies Record<string, { from: readonly MaintenanceStatus[]; to: MaintenanceStatus }>;
export type MaintenanceAction = keyof typeof MAINTENANCE_TRANSITIONS;

export function canTransitionMaintenance(status: MaintenanceStatus, action: MaintenanceAction): boolean {
  return (MAINTENANCE_TRANSITIONS[action].from as readonly MaintenanceStatus[]).includes(status);
}
