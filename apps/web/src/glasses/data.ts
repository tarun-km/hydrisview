'use client';

import {
  MEASURAND_DEFS, SCENARIOS, SIM_PLANT, SIM_STEP_SECONDS, evaluateThreshold, freshness, scenarioFrame, stepOutcome,
  type Freshness, type InspectionStep, type ScenarioKey, type StepValue,
} from '@hydris/domain';
import { DeviceLink } from './link';

export interface GAlarm { id: string; title: string; severity: 'critical' | 'high' | 'medium' | 'low'; state: string; triggeredAt: string; assetTag: string | null; triggerValue: number | null; unit: string | null; recommendedAction: string | null; synthetic: boolean }
export interface GInspectionSummary { id: string; title: string; status: string; priority: string; dueAt: string | null; assetTag: string | null; assetName: string | null; stepCount: number; revision: number }
export interface GTask { id: string; title: string; status: string; priority: string; assetTag: string | null; checklist: { id: string; label: string; done: boolean }[] }
export interface GContext {
  device: { id: string; name: string; kind: string };
  operator: { id: string; name: string };
  organization: { name: string; isDemo: boolean };
  site: { id: string; name: string; code: string } | null;
  role: string;
  inspections: GInspectionSummary[];
  alarms: GAlarm[];
  tasks: GTask[];
  serverTime: string;
}
export interface GInspection {
  id: string; title: string; status: string; revision: number; steps: InspectionStep[]; safetyNotices: string[];
  asset: { id: string; tag: string; name: string; type: string; status: string } | null;
  responses: Record<string, { value: StepValue; outcome: 'ok' | 'abnormal' | 'na'; note: string | null; recordedAt: string }>;
}
export interface GSensor { id: string; tag: string; name: string; measurand: string; unit: string; lastValue: number | null; lastTs: string | null; freshness: Freshness; lastSource: string | null; method: string }
export interface GAsset { id: string; tag: string; name: string; type: string; status: string; manufacturer: string | null; model: string | null; openAlarms: number; sensors: GSensor[] }
export interface GAssist { sources: { id: string; title: string; kind: string; version: number; passage: string }[]; notice: string; telemetry: { tag: string; label: string; value: number | null; unit: string; observedAt: string | null; freshness: Freshness; explanation: string }[] }

export interface GlassesData {
  mode: 'live' | 'demo';
  context(): Promise<GContext>;
  acknowledge(alarmId: string): Promise<void>;
  inspection(id: string): Promise<GInspection>;
  record(inspectionId: string, stepId: string, value: StepValue, note?: string): Promise<'synced' | 'queued'>;
  transition(inspectionId: string, action: 'start' | 'pause' | 'submit', expectedRevision?: number): Promise<{ followUpId?: string | null }>;
  asset(id: string): Promise<GAsset>;
  assist(q: string, assetId?: string): Promise<GAssist>;
  toggleChecklist(taskId: string, itemId: string, done: boolean): Promise<void>;
}

// ---------------- Live (paired device) ----------------
export class LiveData implements GlassesData {
  mode = 'live' as const;
  constructor(public link: DeviceLink) {}
  context() {
    return this.link.call<GContext>('/device/context');
  }
  async acknowledge(id: string) {
    await this.link.call(`/alarms/${id}/acknowledge`, { method: 'POST', json: {} });
  }
  async inspection(id: string) {
    return (await this.link.call<{ inspection: GInspection }>(`/inspections/${id}`)).inspection;
  }
  async record(inspectionId: string, stepId: string, value: StepValue, note?: string) {
    const op = { opId: crypto.randomUUID(), stepId, value, note, recordedAt: new Date().toISOString() };
    // Offline-first: queue locally, then try to flush. Replays are idempotent (client op ids).
    this.link.enqueue({ inspectionId, op });
    if (!this.link.online) return 'queued';
    const r = await this.link.flush().catch(() => ({ sent: 0, conflicts: [] }));
    if (r.conflicts.length) throw new Error(`Not saved: ${r.conflicts[0]!.reason.replace(/_/g, ' ')}`);
    return this.link.queue().length ? 'queued' : 'synced';
  }
  async transition(id: string, action: 'start' | 'pause' | 'submit', expectedRevision?: number) {
    if (action === 'submit') await this.link.flush();
    const r = await this.link.call<{ followUpId?: string | null }>(`/inspections/${id}/${action}`, { method: 'POST', json: { expectedRevision } });
    return r;
  }
  async asset(id: string) {
    const r = await this.link.call<{ asset: GAsset & { openAlarms: number }; sensors: GSensor[] }>(`/assets/${id}`);
    return { ...r.asset, sensors: r.sensors };
  }
  assist(q: string, assetId?: string) {
    return this.link.call<GAssist>(`/assist?q=${encodeURIComponent(q)}${assetId ? `&assetId=${assetId}` : ''}`);
  }
  async toggleChecklist(taskId: string, itemId: string, done: boolean) {
    await this.link.call(`/maintenance/${taskId}/checklist/${itemId}`, { method: 'POST', json: { done } });
  }
}

// ---------------- Demo (public website; fully client-side, synthetic) ----------------
const DEMO_STEPS: InspectionStep[] = [
  { id: 'guard', kind: 'check', title: 'Coupling guard fitted and secure', required: true, caution: 'Never remove guards from running equipment.' },
  { id: 'leak', kind: 'choice', title: 'Mechanical seal condition', required: true, options: ['No leakage', 'Weeping', 'Active leak'], abnormalOptions: ['Active leak'] },
  { id: 'vib', kind: 'reading', title: 'Bearing vibration (handheld)', measurand: 'vibration', unit: 'mm/s', required: true, expectedMax: 4.5 },
  { id: 'noise', kind: 'check', title: 'No abnormal noise', required: true },
];
const DEMO_DOCS: Record<string, { title: string; passage: string }> = {
  vib: { title: 'SOP-PMP-07 Pump vibration response', passage: 'Confirm the reading and its timestamp. Listen for «cavitation». Check suction valve and strainer. Above 7.1 mm/s inform the shift supervisor.' },
  level: { title: 'SOP-EQ-02 Equalization tank high level', passage: 'Verify level on the sight gauge. Confirm transfer pump P-101 is running. Inform the supervisor above «85 %».' },
  ph: { title: 'SOP-DIS-04 Abnormal discharge pH', passage: 'Compare the analyzer with a handheld meter on a «grab sample». Check upstream pH at AIT-101. Inform the supervisor immediately.' },
  do: { title: 'SOP-AER-03 Low dissolved oxygen', passage: 'Check blower BL-102 status and motor current. «Zero current» indicates a trip — report to the supervisor.' },
};

export class DemoData implements GlassesData {
  mode = 'demo' as const;
  private started = Date.now();
  private acked = new Set<string>();
  private responses: GInspection['responses'] = {};
  private status = 'scheduled';
  private checklist = [
    { id: 'iso', label: 'Isolate and lock out the pump', done: false },
    { id: 'diaph', label: 'Inspect diaphragm', done: false },
    { id: 'test', label: 'Verify dosing rate', done: false },
  ];
  constructor(public scenario: ScenarioKey) {}

  private step() {
    return Math.floor((Date.now() - this.started) / (SIM_STEP_SECONDS * 1000)) % SCENARIOS[this.scenario].steps;
  }
  private frame() {
    return scenarioFrame(this.scenario, this.step());
  }
  private alarms(): GAlarm[] {
    const f = this.frame();
    const out: GAlarm[] = [];
    for (const t of SIM_PLANT.thresholds) {
      const v = f.values[t.sensorTag];
      if (v === null || v === undefined) continue;
      if (evaluateThreshold({ condition: t.condition, threshold: t.threshold, deadband: 0 }, v, false) !== 'breach') continue;
      const sensor = SIM_PLANT.sensors.find((s) => s.tag === t.sensorTag)!;
      const id = `${t.sensorTag}-${t.condition}`;
      out.push({
        id, title: `${t.condition.replace('_', '-').replace(/^\w/, (c) => c.toUpperCase())} ${MEASURAND_DEFS[sensor.measurand].label} · ${sensor.assetTag}`, severity: t.severity,
        state: this.acked.has(id) ? 'acknowledged' : 'active', triggeredAt: new Date().toISOString(), assetTag: sensor.assetTag, triggerValue: v,
        unit: MEASURAND_DEFS[sensor.measurand].unit, recommendedAction: 'Follow the linked procedure and inform your supervisor.', synthetic: true,
      });
    }
    return out.sort((a, b) => (a.severity === 'critical' ? -1 : b.severity === 'critical' ? 1 : 0));
  }
  async context(): Promise<GContext> {
    return {
      device: { id: 'demo', name: 'Demo glasses', kind: 'simulator' }, operator: { id: 'demo-op', name: 'Demo Operator' },
      organization: { name: 'Riverbend demo plant', isDemo: true }, site: { id: 'demo-site', name: SIM_PLANT.site.name, code: SIM_PLANT.site.code }, role: 'field_operator',
      inspections: this.status === 'submitted' ? [] : [{ id: 'demo-insp', title: 'Pump routine inspection · P-101', status: this.status, priority: 'normal', dueAt: new Date(this.started + 3 * 3600_000).toISOString(), assetTag: 'P-101', assetName: 'Transfer pump P-101', stepCount: DEMO_STEPS.length, revision: 1 }],
      alarms: this.alarms(),
      tasks: [{ id: 'demo-task', title: 'Dosing pump diaphragm check', status: 'assigned', priority: 'medium', assetTag: 'DP-301', checklist: this.checklist }],
      serverTime: new Date().toISOString(),
    };
  }
  async acknowledge(id: string) {
    this.acked.add(id);
  }
  async inspection(): Promise<GInspection> {
    return {
      id: 'demo-insp', title: 'Pump routine inspection · P-101', status: this.status, revision: 1, steps: DEMO_STEPS,
      safetyNotices: ['Hearing protection required in the pump house.', 'Do not touch rotating parts or remove guards.'],
      asset: { id: 'P-101', tag: 'P-101', name: 'Transfer pump P-101', type: 'pump', status: 'operational' }, responses: this.responses,
    };
  }
  async record(_i: string, stepId: string, value: StepValue, note?: string) {
    const step = DEMO_STEPS.find((s) => s.id === stepId)!;
    this.responses = { ...this.responses, [stepId]: { value, outcome: stepOutcome(step, value), note: note ?? null, recordedAt: new Date().toISOString() } };
    this.status = 'in_progress';
    return 'synced' as const;
  }
  async transition(_i: string, action: 'start' | 'pause' | 'submit') {
    this.status = action === 'start' ? 'in_progress' : action === 'pause' ? 'paused' : 'submitted';
    return { followUpId: action === 'submit' && Object.values(this.responses).some((r) => r.outcome === 'abnormal') ? 'demo-followup' : null };
  }
  async asset(tag: string): Promise<GAsset> {
    const a = SIM_PLANT.assets.find((x) => x.tag === tag) ?? SIM_PLANT.assets[1]!;
    const f = this.frame();
    const now = new Date().toISOString();
    return {
      id: a.tag, tag: a.tag, name: a.name, type: a.type, status: f.values[SIM_PLANT.sensors.find((s) => s.assetTag === a.tag)?.tag ?? ''] === null ? 'down' : 'operational',
      manufacturer: null, model: null, openAlarms: this.alarms().filter((x) => x.assetTag === a.tag).length,
      sensors: SIM_PLANT.sensors.filter((s) => s.assetTag === a.tag).map((s) => ({
        id: s.tag, tag: s.tag, name: MEASURAND_DEFS[s.measurand].label, measurand: s.measurand, unit: MEASURAND_DEFS[s.measurand].unit, method: 'continuous', lastSource: 'simulator',
        lastValue: f.values[s.tag] ?? null, lastTs: f.values[s.tag] === null ? null : now, freshness: f.values[s.tag] === null ? 'stale' : freshness(now, 5),
      })),
    };
  }
  async assist(q: string): Promise<GAssist> {
    const key = /vib|pump|P-101/i.test(q) ? 'vib' : /level|tank/i.test(q) ? 'level' : /ph/i.test(q) ? 'ph' : /oxygen|DO|blower/i.test(q) ? 'do' : null;
    return {
      sources: key ? [{ id: key, title: DEMO_DOCS[key]!.title, kind: 'sop', version: 1, passage: DEMO_DOCS[key]!.passage }] : [],
      notice: 'Demo excerpt. In production, answers are excerpts of your organization’s approved documents.', telemetry: [],
    };
  }
  async toggleChecklist(_t: string, itemId: string, done: boolean) {
    this.checklist = this.checklist.map((c) => (c.id === itemId ? { ...c, done } : c));
  }
}
