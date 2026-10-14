import { noise } from './random';
import type { Measurand } from './measurands';

/**
 * Deterministic simulation scenarios for a reference effluent treatment plant.
 *
 * Every value is a pure function of (scenario, tag, step), so a scenario replays
 * identically in tests, in the API's demo-tenant simulator and in the public website
 * demo. All output is synthetic and must be labelled as such wherever it is shown.
 */

export const SIM_STEP_SECONDS = 5;

export interface SimSensorDef {
  tag: string;
  assetTag: string;
  measurand: Measurand;
  base: number;
  /** Relative noise amplitude (fraction of base) and slow oscillation amplitude. */
  jitter: number;
  wave: number;
  min: number;
  max: number;
}

/** Reference plant: tags are shared by demo seed data, scenarios and the website demo. */
export const SIM_PLANT = {
  site: { name: 'Riverbend Industrial Park', code: 'RIP' },
  facility: { name: 'Effluent Treatment Plant 01', code: 'ETP-01', kind: 'etp' as const },
  areas: [
    { code: 'EQ', name: 'Equalization', kind: 'equalization' as const },
    { code: 'AER', name: 'Aeration system', kind: 'aeration' as const },
    { code: 'DOS', name: 'Chemical dosing', kind: 'chemical_dosing' as const },
    { code: 'CLR', name: 'Secondary clarification', kind: 'clarification' as const },
    { code: 'DIS', name: 'Final discharge', kind: 'discharge' as const },
  ],
  assets: [
    { tag: 'T-101', name: 'Equalization tank', type: 'tank' as const, area: 'EQ', x: 18, y: 22, criticality: 'high' as const },
    { tag: 'P-101', name: 'Transfer pump P-101', type: 'pump' as const, area: 'EQ', x: 34, y: 30, criticality: 'high' as const },
    { tag: 'BL-102', name: 'Aeration blower BL-102', type: 'blower' as const, area: 'AER', x: 52, y: 14, criticality: 'high' as const },
    { tag: 'AB-201', name: 'Aeration basin 1', type: 'tank' as const, area: 'AER', x: 62, y: 32, criticality: 'high' as const },
    { tag: 'DP-301', name: 'Coagulant dosing pump', type: 'dosing_pump' as const, area: 'DOS', x: 44, y: 52, criticality: 'medium' as const },
    { tag: 'CL-401', name: 'Secondary clarifier', type: 'clarifier' as const, area: 'CLR', x: 78, y: 48, criticality: 'medium' as const },
    { tag: 'AN-501', name: 'Effluent analyzer panel', type: 'analyzer' as const, area: 'DIS', x: 90, y: 70, criticality: 'high' as const },
  ],
  sensors: [
    { tag: 'LT-101', assetTag: 'T-101', measurand: 'tank_level', base: 58, jitter: 0.01, wave: 6, min: 0, max: 100 },
    { tag: 'AIT-101', assetTag: 'T-101', measurand: 'ph', base: 7.3, jitter: 0.004, wave: 0.15, min: 0, max: 14 },
    { tag: 'CT-101', assetTag: 'P-101', measurand: 'motor_current', base: 18.5, jitter: 0.02, wave: 0.6, min: 0, max: 60 },
    { tag: 'VT-101', assetTag: 'P-101', measurand: 'vibration', base: 2.6, jitter: 0.05, wave: 0.2, min: 0, max: 30 },
    { tag: 'PT-101', assetTag: 'P-101', measurand: 'pressure', base: 2.4, jitter: 0.02, wave: 0.08, min: 0, max: 10 },
    { tag: 'CT-102', assetTag: 'BL-102', measurand: 'motor_current', base: 42, jitter: 0.015, wave: 1.2, min: 0, max: 120 },
    { tag: 'VT-102', assetTag: 'BL-102', measurand: 'vibration', base: 3.1, jitter: 0.05, wave: 0.25, min: 0, max: 30 },
    { tag: 'DO-201', assetTag: 'AB-201', measurand: 'dissolved_oxygen', base: 2.2, jitter: 0.03, wave: 0.25, min: 0, max: 12 },
    { tag: 'TT-201', assetTag: 'AB-201', measurand: 'temperature', base: 27.5, jitter: 0.004, wave: 0.4, min: 0, max: 60 },
    { tag: 'FT-301', assetTag: 'DP-301', measurand: 'flow_rate', base: 0.42, jitter: 0.03, wave: 0.03, min: 0, max: 5 },
    { tag: 'AIT-401', assetTag: 'CL-401', measurand: 'turbidity', base: 4.2, jitter: 0.06, wave: 0.6, min: 0, max: 200 },
    { tag: 'AIT-501', assetTag: 'AN-501', measurand: 'ph', base: 7.4, jitter: 0.003, wave: 0.1, min: 0, max: 14 },
    { tag: 'AIT-502', assetTag: 'AN-501', measurand: 'turbidity', base: 2.1, jitter: 0.06, wave: 0.3, min: 0, max: 200 },
    { tag: 'AIT-503', assetTag: 'AN-501', measurand: 'conductivity', base: 1450, jitter: 0.01, wave: 60, min: 0, max: 20000 },
    { tag: 'FT-501', assetTag: 'AN-501', measurand: 'flow_rate', base: 118, jitter: 0.02, wave: 9, min: 0, max: 400 },
  ] satisfies SimSensorDef[],
  /** Alarm thresholds used by demo seed data (and shown on the website demo). */
  thresholds: [
    { sensorTag: 'VT-101', condition: 'high' as const, threshold: 4.5, severity: 'high' as const },
    { sensorTag: 'VT-101', condition: 'high_high' as const, threshold: 7.1, severity: 'critical' as const },
    { sensorTag: 'VT-102', condition: 'high' as const, threshold: 4.5, severity: 'high' as const },
    { sensorTag: 'LT-101', condition: 'high' as const, threshold: 85, severity: 'high' as const },
    { sensorTag: 'LT-101', condition: 'high_high' as const, threshold: 92, severity: 'critical' as const },
    { sensorTag: 'LT-101', condition: 'low' as const, threshold: 15, severity: 'medium' as const },
    { sensorTag: 'AIT-501', condition: 'low' as const, threshold: 6.5, severity: 'high' as const },
    { sensorTag: 'AIT-501', condition: 'high' as const, threshold: 8.5, severity: 'high' as const },
    { sensorTag: 'DO-201', condition: 'low' as const, threshold: 1.2, severity: 'high' as const },
    { sensorTag: 'DO-201', condition: 'low_low' as const, threshold: 0.6, severity: 'critical' as const },
    { sensorTag: 'AIT-502', condition: 'high' as const, threshold: 10, severity: 'medium' as const },
  ],
} as const;

export const SCENARIO_KEYS = [
  'normal_operations',
  'pump_vibration',
  'tank_high_level',
  'abnormal_ph',
  'scheduled_inspection',
  'equipment_offline',
  'glasses_network_loss',
  'high_priority_alert',
  'maintenance_checklist',
  'device_reassignment',
] as const;
export type ScenarioKey = (typeof SCENARIO_KEYS)[number];

/** Side effects a scenario requests at a given step. Consumers decide how to apply them. */
export type ScenarioEvent =
  | { type: 'assign_inspection'; assetTag: string; templateKey: string }
  | { type: 'assign_maintenance'; assetTag: string; title: string; priority: 'medium' | 'high' }
  | { type: 'glasses_network'; online: boolean }
  | { type: 'asset_offline'; assetTag: string; offline: boolean }
  | { type: 'reassign_device' }
  | { type: 'note'; message: string };

export interface ScenarioDef {
  key: ScenarioKey;
  title: string;
  summary: string;
  /** What an operator/trainer should observe. */
  expected: string[];
  /** Steps per run; consumers loop or stop at the end. */
  steps: number;
  override?: (tag: string, step: number, base: number) => number | null | undefined;
  events?: (step: number) => ScenarioEvent[];
}

const ramp = (step: number, from: number, to: number, a: number, b: number) =>
  step <= from ? a : step >= to ? b : a + ((b - a) * (step - from)) / (to - from);

export const SCENARIOS: Record<ScenarioKey, ScenarioDef> = {
  normal_operations: {
    key: 'normal_operations',
    title: 'Normal operations',
    summary: 'All stages within operating limits. Baseline for training and comparison.',
    expected: ['No alarms are raised', 'All sensors report live data'],
    steps: 120,
  },
  pump_vibration: {
    key: 'pump_vibration',
    title: 'Pump vibration above threshold',
    summary: 'Transfer pump P-101 vibration climbs steadily, crossing the high and then high-high limits.',
    expected: ['High alarm on VT-101 around step 30', 'Critical alarm on VT-101 around step 55', 'Motor current rises slightly'],
    steps: 120,
    override: (tag, step, base) => {
      if (tag === 'VT-101') return base + ramp(step, 10, 70, 0, 6.4);
      if (tag === 'CT-101') return base + ramp(step, 10, 70, 0, 2.2);
      return undefined;
    },
  },
  tank_high_level: {
    key: 'tank_high_level',
    title: 'Tank level approaching limit',
    summary: 'Equalization tank T-101 fills faster than the transfer pump can empty it.',
    expected: ['High alarm on LT-101 near 85 %', 'Critical alarm near 92 %'],
    steps: 120,
    override: (tag, step, base) => (tag === 'LT-101' ? Math.min(99, base + ramp(step, 5, 90, 0, 38)) : undefined),
  },
  abnormal_ph: {
    key: 'abnormal_ph',
    title: 'Abnormal pH at discharge',
    summary: 'An acidic slug reaches the effluent analyzer; pH drops below the discharge limit, then recovers.',
    expected: ['High alarm on AIT-501 (low pH)', 'Upstream AIT-101 shows the slug first'],
    steps: 120,
    override: (tag, step, base) => {
      if (tag === 'AIT-101') return base - ramp(step, 8, 20, 0, 1.6) + ramp(step, 50, 70, 0, 1.6);
      if (tag === 'AIT-501') return base - ramp(step, 20, 35, 0, 2.3) + ramp(step, 75, 100, 0, 2.3);
      return undefined;
    },
  },
  scheduled_inspection: {
    key: 'scheduled_inspection',
    title: 'Scheduled inspection',
    summary: 'A routine pump inspection is assigned to the demo field operator.',
    expected: ['Inspection appears in the glasses task list', 'Completing it syncs back to the console'],
    steps: 120,
    events: (step) => (step === 1 ? [{ type: 'assign_inspection', assetTag: 'P-101', templateKey: 'pump_routine' }] : []),
  },
  equipment_offline: {
    key: 'equipment_offline',
    title: 'Equipment temporarily offline',
    summary: 'Blower BL-102 stops reporting; its readings become stale and then return.',
    expected: ['BL-102 sensors marked stale', 'Freshness recovers when data returns'],
    steps: 140,
    override: (tag, step) => ((tag === 'CT-102' || tag === 'VT-102') && step >= 20 && step < 100 ? null : undefined),
    events: (step) =>
      step === 20
        ? [{ type: 'asset_offline', assetTag: 'BL-102', offline: true }]
        : step === 100
          ? [{ type: 'asset_offline', assetTag: 'BL-102', offline: false }]
          : [],
  },
  glasses_network_loss: {
    key: 'glasses_network_loss',
    title: 'Glasses lose connectivity',
    summary: 'The simulated glasses lose their network for about two and a half minutes, then reconnect.',
    expected: ['Viewport shows degraded mode', 'Inspection steps queue locally', 'Queue syncs on reconnect'],
    steps: 120,
    events: (step) =>
      step === 10 ? [{ type: 'glasses_network', online: false }] : step === 40 ? [{ type: 'glasses_network', online: true }] : [],
  },
  high_priority_alert: {
    key: 'high_priority_alert',
    title: 'High-priority alert',
    summary: 'Blower BL-102 trips; dissolved oxygen in the aeration basin collapses.',
    expected: ['Critical low-low DO alarm', 'Alert interrupts the glasses view'],
    steps: 120,
    override: (tag, step, base) => {
      if (tag === 'CT-102') return step >= 12 ? 0 : undefined;
      if (tag === 'VT-102') return step >= 12 ? 0.1 : undefined;
      if (tag === 'DO-201') return Math.max(0.2, base - ramp(step, 12, 30, 0, 2.0));
      return undefined;
    },
  },
  maintenance_checklist: {
    key: 'maintenance_checklist',
    title: 'Maintenance checklist',
    summary: 'A preventive maintenance task with a checklist is assigned for the dosing pump.',
    expected: ['Task appears for the operator', 'Checklist completion recorded with timestamps'],
    steps: 120,
    events: (step) =>
      step === 1
        ? [
            { type: 'assign_maintenance', assetTag: 'DP-301', title: 'Dosing pump diaphragm check', priority: 'medium' },
            { type: 'assign_inspection', assetTag: 'DP-301', templateKey: 'dosing_pm' },
          ]
        : [],
  },
  device_reassignment: {
    key: 'device_reassignment',
    title: 'Device reassignment',
    summary: 'The demo glasses are handed over from one authorized operator to another mid-shift.',
    expected: ['Glasses show the handover', 'Previous operator context is cleared', 'Audit event recorded'],
    steps: 120,
    events: (step) => (step === 15 ? [{ type: 'reassign_device' }] : []),
  },
};

/** Value for one sensor at one step, or null when the scenario says the sensor is silent. */
export function scenarioValue(key: ScenarioKey, tag: string, step: number): number | null {
  const sensor = SIM_PLANT.sensors.find((s) => s.tag === tag);
  if (!sensor) return null;
  const wave = Math.sin((step / 24) * Math.PI * 2 + sensor.base) * sensor.wave;
  const base = sensor.base + wave + noise(tag, step) * sensor.base * sensor.jitter;
  const o = SCENARIOS[key].override?.(tag, step, base);
  if (o === null) return null;
  const v = o === undefined ? base : o;
  return Math.min(sensor.max, Math.max(sensor.min, Math.round(v * 1000) / 1000));
}

export function scenarioFrame(key: ScenarioKey, step: number): { values: Record<string, number | null>; events: ScenarioEvent[] } {
  const values: Record<string, number | null> = {};
  for (const s of SIM_PLANT.sensors) values[s.tag] = scenarioValue(key, s.tag, step);
  return { values, events: SCENARIOS[key].events?.(step) ?? [] };
}

export const isScenarioKey = (v: unknown): v is ScenarioKey =>
  typeof v === 'string' && (SCENARIO_KEYS as readonly string[]).includes(v);
