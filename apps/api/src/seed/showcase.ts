/**
 * Demo-mode showcase data: a complete, realistic, clearly-synthetic tenant so every console
 * view (overview, alarms, inspections, maintenance, reports, map, UI profiles, devices,
 * notifications, audit) and the glasses have meaningful content with zero configuration.
 *
 * Everything lives in the demo organization (`is_demo = true`), which the UI labels as demo
 * everywhere. Every row has a deterministic id (`demoId`) so separate serverless instances,
 * each seeding its own in-memory database, agree on all identifiers. Times are relative to
 * the seeding instant.
 */
import { eq, sql } from 'drizzle-orm';
import {
  CONDITION_LABELS, DEFAULT_UI_PROFILE_CONFIG, MEASURAND_DEFS, SIM_PLANT, describeBreach, noise, normalizeUiProfileConfig, stepOutcome,
  type AlarmCondition, type InspectionStep, type Measurand, type StepValue,
} from '@hydris/domain';
import type { Db, Tx } from '../db/client';
import {
  alarmEventHistory, alarmEvents, alarmRules, assets, auditEvents, deviceAssignments, devices, documents, facilities, inspectionResponses, inspectionRoutes,
  inspections, maintenanceActivity, maintenanceTasks, memberships, notifications, processAreas, sensors, sites, telemetryReadings, uiProfileAssignments,
  uiProfileVersions, uiProfiles, users,
} from '../db/schema';
import { withSystem, withTenant } from '../db/tenant';
import { hashPassword } from '../core/crypto';
import { demoId } from './ids';
import { steps as STEP_SETS, seedDemo } from './demo';

export const DEMO_OWNER = { email: 'tarun@hydris.ai', name: 'Tarun KM', password: 'demo@123', title: 'Founder, Hydris AI' } as const;
/** Password of every demo account in demo mode (the role accounts @demo.hydris.local too). */
export const DEMO_PASSWORD = 'demo@123';

export const DEMO_ORG_ID = demoId('org', 'riverbend');
export const DEMO_OWNER_ID = demoId('user', 'tarun');
const SITE1 = demoId('site', SIM_PLANT.site.code);
const SITE2 = demoId('site', 'RTS');
const U = (key: string) => (key === 'tarun' ? DEMO_OWNER_ID : demoId('user', key));
const H = 3600_000;
const D = 24 * H;

// ---------------------------------------------------------------- second site (STP)
const STP = {
  site: { code: 'RTS', name: 'Riverbend Township STP', city: 'Chennai', lat: 13.0418, lng: 80.2337, w: 100, h: 70 },
  facility: { code: 'STP-02', name: 'Sewage Treatment Plant 02', kind: 'stp' as const, capacity: 5000, description: 'Sequencing-batch-reactor sewage treatment for the township (25,000 PE), UV + hypochlorite disinfection.' },
  areas: [
    { code: 'INL', name: 'Inlet works', kind: 'screening' as const, polygon: [[4, 6], [30, 6], [30, 30], [4, 30]] as [number, number][] },
    { code: 'SBR', name: 'SBR basins', kind: 'aeration' as const, polygon: [[36, 6], [72, 6], [72, 38], [36, 38]] as [number, number][] },
    { code: 'DIS', name: 'Disinfection & outfall', kind: 'disinfection' as const, polygon: [[60, 44], [96, 44], [96, 66], [60, 66]] as [number, number][] },
    { code: 'SLD', name: 'Sludge handling', kind: 'sludge_handling' as const, polygon: [[6, 40], [40, 40], [40, 64], [6, 64]] as [number, number][] },
  ],
  assets: [
    { tag: 'SC-601', name: 'Mechanical bar screen', type: 'screen' as const, area: 'INL', x: 10, y: 14, criticality: 'medium' as const, status: 'operational' as const, mfg: ['Huber', 'RakeMax'] },
    { tag: 'P-602', name: 'Raw sewage pump P-602', type: 'pump' as const, area: 'INL', x: 24, y: 24, criticality: 'high' as const, status: 'degraded' as const, mfg: ['Grundfos', 'SE1.110'] },
    { tag: 'SBR-701', name: 'SBR basin A', type: 'tank' as const, area: 'SBR', x: 48, y: 22, criticality: 'high' as const, status: 'operational' as const, mfg: ['In-house', '1,800 m³'] },
    { tag: 'BL-702', name: 'SBR air blower BL-702', type: 'blower' as const, area: 'SBR', x: 66, y: 12, criticality: 'high' as const, status: 'operational' as const, mfg: ['Kaeser', 'BB 89C'] },
    { tag: 'UV-801', name: 'UV disinfection unit', type: 'uv_unit' as const, area: 'DIS', x: 70, y: 52, criticality: 'high' as const, status: 'operational' as const, mfg: ['Trojan', 'UV3000Plus'] },
    { tag: 'DP-802', name: 'Hypochlorite dosing pump', type: 'dosing_pump' as const, area: 'DIS', x: 80, y: 60, criticality: 'medium' as const, status: 'standby' as const, mfg: ['Grundfos', 'DDA 30'] },
    { tag: 'AN-803', name: 'Outlet analyzer panel', type: 'analyzer' as const, area: 'DIS', x: 90, y: 50, criticality: 'high' as const, status: 'operational' as const, mfg: ['Hach', 'SC4500'] },
    { tag: 'P-901', name: 'Sludge transfer pump P-901', type: 'pump' as const, area: 'SLD', x: 20, y: 54, criticality: 'medium' as const, status: 'maintenance' as const, mfg: ['Netzsch', 'NEMO NM063'] },
  ],
};

/** Signal generator for one sensor: diurnal load pattern + slow drift + deterministic noise. */
export interface SignalDef { tag: string; assetTag: string; measurand: Measurand; base: number; wave: number; jitter: number; min: number; max: number; phaseH: number }

const STP_SENSORS: SignalDef[] = [
  { tag: 'FT-601', assetTag: 'P-602', measurand: 'flow_rate', base: 210, wave: 70, jitter: 0.03, min: 0, max: 600, phaseH: 4 },
  { tag: 'LT-601', assetTag: 'P-602', measurand: 'tank_level', base: 46, wave: 12, jitter: 0.02, min: 0, max: 100, phaseH: 5 },
  { tag: 'CT-602', assetTag: 'P-602', measurand: 'motor_current', base: 22, wave: 3, jitter: 0.02, min: 0, max: 60, phaseH: 4 },
  { tag: 'VT-602', assetTag: 'P-602', measurand: 'vibration', base: 2.2, wave: 0.15, jitter: 0.04, min: 0, max: 30, phaseH: 4 },
  { tag: 'DO-701', assetTag: 'SBR-701', measurand: 'dissolved_oxygen', base: 2.0, wave: 0.35, jitter: 0.04, min: 0, max: 12, phaseH: 16 },
  { tag: 'NH-701', assetTag: 'SBR-701', measurand: 'ammonia', base: 1.8, wave: 0.6, jitter: 0.05, min: 0, max: 60, phaseH: 8 },
  { tag: 'TT-701', assetTag: 'SBR-701', measurand: 'temperature', base: 29, wave: 0.8, jitter: 0.004, min: 0, max: 60, phaseH: 9 },
  { tag: 'CT-702', assetTag: 'BL-702', measurand: 'motor_current', base: 48, wave: 4, jitter: 0.015, min: 0, max: 120, phaseH: 4 },
  { tag: 'CL-802', assetTag: 'AN-803', measurand: 'residual_chlorine', base: 0.6, wave: 0.08, jitter: 0.04, min: 0, max: 5, phaseH: 10 },
  { tag: 'AIT-803', assetTag: 'AN-803', measurand: 'ph', base: 7.2, wave: 0.12, jitter: 0.003, min: 0, max: 14, phaseH: 6 },
  { tag: 'AIT-804', assetTag: 'AN-803', measurand: 'turbidity', base: 3.0, wave: 0.6, jitter: 0.06, min: 0, max: 200, phaseH: 7 },
  { tag: 'VT-901', assetTag: 'P-901', measurand: 'vibration', base: 3.4, wave: 0.2, jitter: 0.05, min: 0, max: 30, phaseH: 0 },
];
export const STP_SENSOR_TAGS = STP_SENSORS.map((s) => s.tag);

const PHASE: Partial<Record<Measurand, number>> = { flow_rate: 4, tank_level: 5, dissolved_oxygen: 16, temperature: 9, motor_current: 4, turbidity: 7, conductivity: 6 };
/** Generators for the reference ETP (same tags/bases as the deterministic simulator). */
const ETP_SENSORS: SignalDef[] = SIM_PLANT.sensors.map((s) => ({ ...s, wave: s.wave, phaseH: PHASE[s.measurand] ?? 0 }));
export const ALL_SIGNALS: SignalDef[] = [...ETP_SENSORS, ...STP_SENSORS];

const STP_THRESHOLDS: { sensorTag: string; condition: AlarmCondition; threshold: number; severity: 'critical' | 'high' | 'medium' | 'low'; deadband: number; action: string; doc?: string }[] = [
  { sensorTag: 'VT-602', condition: 'high', threshold: 4.5, severity: 'high', deadband: 0.3, action: 'Check for rags/blockage at the impeller and verify suction level; inform supervisor.', doc: 'vib' },
  { sensorTag: 'LT-601', condition: 'high', threshold: 85, severity: 'high', deadband: 2, action: 'Confirm duty/standby pump operation and screen condition.', doc: 'screen' },
  { sensorTag: 'DO-701', condition: 'low', threshold: 1.0, severity: 'high', deadband: 0.1, action: 'Check BL-702 status and SBR aeration phase timing.', doc: 'sbr' },
  { sensorTag: 'NH-701', condition: 'high', threshold: 5, severity: 'medium', deadband: 0.3, action: 'Review SBR cycle (aeration time) and DO set-point.', doc: 'sbr' },
  { sensorTag: 'CL-802', condition: 'low', threshold: 0.2, severity: 'high', deadband: 0.05, action: 'Check DP-802 dosing and hypochlorite day-tank level.', doc: 'chlorine' },
  { sensorTag: 'AIT-804', condition: 'high', threshold: 10, severity: 'medium', deadband: 0.5, action: 'Check SBR decant for solids carry-over; UV transmittance will drop.', doc: 'uv' },
  { sensorTag: 'VT-901', condition: 'high', threshold: 4.5, severity: 'high', deadband: 0.3, action: 'Check stator wear and dry-running protection.', doc: 'vib' },
];

// ---------------------------------------------------------------- incidents (excursions + alarms)
type Life = 'active' | 'acknowledged' | 'investigating' | 'resolved' | 'closed';
interface Incident { key: string; tag: string; startH: number; durH: number; delta: number; conds: AlarmCondition[]; state: Life; ack?: string; assignee?: string; notes?: string[]; resolution?: string }

/** Hours are "hours before seeding". A negative end (startH < durH) means the excursion is still ongoing. */
const INCIDENTS: Incident[] = [
  { key: 'i01', tag: 'VT-101', startH: 330, durH: 3, delta: 3.0, conds: ['high'], state: 'closed', ack: 'operator', resolution: 'Suction strainer partially blocked with fibre. Cleaned; vibration back to 2.4 mm/s.' },
  { key: 'i02', tag: 'LT-101', startH: 300, durH: 5, delta: 31, conds: ['high'], state: 'closed', ack: 'supervisor', resolution: 'Upstream dyeing batch dump. Influent restricted for 2 h by supervisor; level normal.' },
  { key: 'i03', tag: 'DO-201', startH: 270, durH: 3, delta: -1.3, conds: ['low'], state: 'closed', ack: 'operator2', resolution: 'BL-102 inlet filter differential high. Filter cleaned, DO recovered to 2.1 mg/L.' },
  { key: 'i04', tag: 'AIT-501', startH: 250, durH: 2, delta: -1.2, conds: ['low'], state: 'closed', ack: 'supervisor', resolution: 'Acidic slug confirmed by grab sample (pH 6.3). Lab informed; discharge within consent after 90 min.' },
  { key: 'i05', tag: 'VT-102', startH: 220, durH: 4, delta: 1.8, conds: ['high'], state: 'closed', ack: 'engineer', resolution: 'Belt tension re-adjusted under permit-to-work.' },
  { key: 'i06', tag: 'NH-701', startH: 200, durH: 6, delta: 4.2, conds: ['high'], state: 'closed', ack: 'supervisor', resolution: 'Aeration phase extended by 20 min per cycle; ammonia back below 2 mg/L.' },
  { key: 'i07', tag: 'LT-101', startH: 170, durH: 4, delta: 36, conds: ['high', 'high_high'], state: 'closed', ack: 'supervisor', resolution: 'P-101 tripped on overload; reset by electrician after insulation check. Level recovered.' },
  { key: 'i08', tag: 'CL-802', startH: 150, durH: 2, delta: -0.5, conds: ['low'], state: 'closed', ack: 'operator', resolution: 'Hypochlorite day tank empty. Refilled and dosing verified.' },
  { key: 'i09', tag: 'VT-901', startH: 122, durH: 5, delta: 1.6, conds: ['high'], state: 'resolved', ack: 'engineer', resolution: 'Stator worn; pump taken out for stator replacement (see maintenance).' },
  { key: 'i10', tag: 'AIT-502', startH: 100, durH: 2, delta: 9, conds: ['high'], state: 'resolved', ack: 'operator2', resolution: 'Sludge blanket high in CL-401; RAS rate increased.' },
  { key: 'i11', tag: 'VT-101', startH: 74, durH: 3, delta: 3.2, conds: ['high'], state: 'resolved', ack: 'operator', resolution: 'Air entrainment at low tank level. Level set-point raised.' },
  { key: 'i12', tag: 'DO-701', startH: 60, durH: 2, delta: -1.3, conds: ['low'], state: 'closed', ack: 'supervisor', resolution: 'Blower BL-702 VFD fault cleared; root cause logged.' },
  { key: 'i13', tag: 'AIT-501', startH: 52, durH: 1.5, delta: -1.25, conds: ['low'], state: 'resolved', ack: 'operator', resolution: 'Analyzer verified with handheld meter (±0.05). Upstream neutralisation corrected.' },
  { key: 'i14', tag: 'VT-101', startH: 30, durH: 2.5, delta: 5.0, conds: ['high', 'high_high'], state: 'investigating', ack: 'supervisor', assignee: 'engineer', notes: ['Changed over to standby pump under PTW-2291.', 'Handheld reading at DE bearing 7.4 mm/s. Suspect bearing wear or misalignment.'] },
  { key: 'i15', tag: 'DO-201', startH: 20, durH: 2, delta: -1.4, conds: ['low'], state: 'acknowledged', ack: 'operator', notes: ['BL-102 running, current normal. Watching diffuser grid.'] },
  { key: 'i16', tag: 'NH-701', startH: 9, durH: 4, delta: 3.8, conds: ['high'], state: 'acknowledged', ack: 'supervisor' },
  { key: 'i17', tag: 'AIT-502', startH: 6, durH: 1, delta: 9.5, conds: ['high'], state: 'active' },
  { key: 'i18', tag: 'VT-602', startH: 5, durH: 11, delta: 2.6, conds: ['high'], state: 'active' },
  { key: 'i19', tag: 'CL-802', startH: 2, durH: 1, delta: -0.5, conds: ['low'], state: 'active' },
];

let anchorMs = Date.now();
/** Seeding instant (all relative times hang off it; live generators use it for ongoing excursions). */
export const demoAnchor = () => anchorMs;

function excursion(tag: string, t: number): number {
  let d = 0;
  for (const i of INCIDENTS) {
    if (i.tag !== tag) continue;
    const s = anchorMs - i.startH * H;
    const e = s + i.durH * H;
    if (t < s || t > e) continue;
    const f = (t - s) / (e - s);
    const shape = f < 0.15 ? f / 0.15 : f > 0.85 ? (1 - f) / 0.15 : 1;
    d += i.delta * Math.max(0, Math.min(1, shape));
  }
  return d;
}

/** Synthetic value of a signal at time t (ms). Pure function of (tag, t, anchor). */
export function signalValue(g: SignalDef, t: number): number {
  const hourIst = ((t / H + 5.5) % 24 + 24) % 24;
  const diurnal = Math.sin(((hourIst - g.phaseH) / 24) * Math.PI * 2) * g.wave;
  const drift = Math.sin((t / (3.5 * D)) * Math.PI * 2 + g.base) * g.wave * 0.25;
  const n = noise(g.tag, Math.floor(t / 5000)) * g.base * g.jitter;
  const v = g.base + diurnal + drift + n + excursion(g.tag, t);
  return Math.min(g.max, Math.max(g.min, Math.round(v * 1000) / 1000));
}

// ---------------------------------------------------------------- documents
const MORE_DOCS = [
  { key: 'screen', title: 'SOP-INL-01 Bar screen blinding and wet-well high level', kind: 'sop' as const, assetType: 'screen' as const, site: 'RTS',
    body: 'Purpose: keep the inlet screen clear and prevent wet-well overflow.\n\n1. Check the screen differential level and rake drive status at the local panel.\n2. If the rake has tripped, inform the supervisor; resets are done only by authorised personnel.\n3. Remove screenings manually only with the screen isolated and locked out (SAFE-01).\n4. Confirm raw sewage pump P-602 is running and its discharge pressure is normal.\n5. Record screenings volume in the shift log.' },
  { key: 'sbr', title: 'SOP-SBR-01 SBR cycle, DO and ammonia breakthrough', kind: 'troubleshooting' as const, assetType: 'blower' as const, site: 'RTS',
    body: 'Purpose: restore nitrification when outlet ammonia exceeds 5 mg/L or DO stays below 1.0 mg/L.\n\n1. Confirm the current SBR phase (fill, react, settle, decant) on the HMI.\n2. Check blower BL-702 running status, motor current and inlet filter.\n3. Compare DO in the react phase with the 2.0 mg/L set-point.\n4. Low temperature, short aeration or high influent load all reduce nitrification. Report trends to the supervisor; cycle changes are supervisor decisions.\n5. Take a grab sample for laboratory NH4-N confirmation.' },
  { key: 'chlorine', title: 'SOP-DIS-02 Residual chlorine out of range', kind: 'sop' as const, assetType: 'dosing_pump' as const, site: 'RTS',
    body: 'Purpose: keep final effluent residual chlorine between 0.2 and 1.0 mg/L.\n\n1. Check the hypochlorite day-tank level and DP-802 stroke rate.\n2. Verify the analyzer with a DPD test kit on a grab sample.\n3. Hypochlorite is corrosive: face shield and chemical gloves are mandatory (SAFE-03).\n4. Inform the supervisor before changing the dosing set-point.' },
  { key: 'uv', title: 'SOP-UV-02 UV intensity low / lamp failure', kind: 'troubleshooting' as const, assetType: 'uv_unit' as const, site: 'RTS',
    body: '1. Check the UV intensity reading and lamp status on the UV controller.\n2. High turbidity (above 10 NTU) reduces UV transmittance; check SBR decant quality.\n3. Lamps and sleeves are cleaned only with the bank isolated. Never look at energised lamps.\n4. Replace failed lamps per the manufacturer manual and record lamp hours.' },
  { key: 'confined', title: 'SAFE-02 Confined space entry (wet wells, tanks)', kind: 'safety' as const, assetType: null, site: null,
    body: 'Confined space entry requires a permit, a trained attendant and continuous gas monitoring (O2, H2S, LEL, CO).\n\n1. Isolate and lock out all inflows and mechanical equipment.\n2. Ventilate and test the atmosphere before and during entry.\n3. Use harness and tripod rescue equipment.\n4. Never enter to rescue a collapsed person without breathing apparatus. Raise the alarm.' },
  { key: 'chem', title: 'SAFE-03 Chemical handling: PAC and sodium hypochlorite', kind: 'safety' as const, assetType: null, site: null,
    body: 'PAC (poly-aluminium chloride) and sodium hypochlorite are corrosive.\n\n1. Wear face shield, chemical gloves and apron when handling.\n2. Never mix hypochlorite with acids: chlorine gas is released.\n3. Eyewash and safety shower must be checked weekly.\n4. Spills: contain with sand, neutralise as per the SDS, report to the supervisor.' },
  { key: 'p101-manual', title: 'MAN-P101 Transfer pump O&M manual (extract)', kind: 'manual' as const, assetType: 'pump' as const, site: 'RIP',
    body: 'Kirloskar KPD 100/26 end-suction pump.\n\nBearing lubrication: grease every 2,000 running hours (lithium complex NLGI 2).\nAlignment tolerance: 0.05 mm parallel, 0.05 mm/100 mm angular.\nVibration acceptance: up to 4.5 mm/s RMS (ISO 10816-3, group 2). Above 7.1 mm/s stop and investigate.\nMechanical seal: weeping of a few drops per minute is acceptable at start-up; continuous leakage requires replacement.' },
  { key: 'an501-ds', title: 'DS-AN501 Liquiline CM44 analyzer datasheet', kind: 'datasheet' as const, assetType: 'analyzer' as const, site: 'RIP',
    body: 'Endress+Hauser Liquiline CM44 multi-parameter transmitter.\n\npH sensor: Orbisint CPS11E, range 0-14, accuracy ±0.02 pH.\nTurbidity: Turbimax CUS51D, 0-4000 NTU.\nConductivity: Indumax CLS50D.\nCalibration interval: pH weekly two-point (pH 4 / 7), turbidity monthly.' },
  { key: 'bearing', title: 'SOP-MNT-04 Pump bearing replacement', kind: 'sop' as const, assetType: 'pump' as const, site: null,
    body: '1. Obtain permit to work and apply lockout/tagout (SAFE-01).\n2. Drain and isolate the pump casing; relieve pressure.\n3. Remove coupling guard and spacer; mark coupling halves.\n4. Withdraw the bearing housing; replace bearings using an induction heater (never a flame).\n5. Re-align to 0.05 mm with a laser alignment tool, refit guard, and record baseline vibration after restart.' },
  { key: 'draft-odour', title: 'SOP-ODR-01 Odour complaint response (draft)', kind: 'sop' as const, assetType: null, site: 'RTS', status: 'draft' as const,
    body: 'Draft under review by the plant manager.\n\n1. Log the complaint time, wind direction and location.\n2. Check inlet works covers and sludge storage.\n3. Measure H2S at the inlet channel.' },
];

// ---------------------------------------------------------------- helpers
type TelemetryRow = typeof telemetryReadings.$inferInsert;
const at = (hoursAgo: number) => new Date(anchorMs - hoursAgo * H);
const minutes = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);

async function insertChunked<T>(tx: Tx, table: Parameters<Tx['insert']>[0], rows: T[], size = 1000) {
  for (let i = 0; i < rows.length; i += size) await tx.insert(table).values(rows.slice(i, i + size) as never);
}

export interface ShowcaseOptions {
  /** Days of telemetry history (default 7). */
  historyDays?: number;
  /** Resolution of the history in minutes (default 10). */
  resolutionMin?: number;
}

/** True once the showcase has been seeded into this database. */
export async function showcaseSeeded(db: Db): Promise<boolean> {
  return withSystem(db, async (tx) => (await tx.select({ id: users.id }).from(users).where(eq(users.id, DEMO_OWNER_ID))).length > 0);
}

/**
 * Seed the full demo tenant (base demo + showcase). Idempotent per database; deterministic ids.
 */
export async function seedDemoShowcase(db: Db, opts: ShowcaseOptions = {}): Promise<{ orgId: string; ownerId: string }> {
  if (await showcaseSeeded(db)) return { orgId: DEMO_ORG_ID, ownerId: DEMO_OWNER_ID };
  anchorMs = Date.now();
  const pwHash = await hashPassword(DEMO_PASSWORD);
  await seedDemo(db, DEMO_PASSWORD, { historyHours: 0 });

  // Owner account: platform admin + org admin of the demo org.
  await withSystem(db, async (tx) => {
    await tx.insert(users).values({ id: DEMO_OWNER_ID, email: DEMO_OWNER.email, name: DEMO_OWNER.name, passwordHash: pwHash, isPlatformAdmin: true, emailVerifiedAt: at(24 * 30), defaultOrgId: DEMO_ORG_ID, lastLoginAt: at(20) });
    await tx.insert(memberships).values({ id: demoId('membership', 'tarun'), orgId: DEMO_ORG_ID, userId: DEMO_OWNER_ID, role: 'admin', title: DEMO_OWNER.title });
    await tx.update(users).set({ lastLoginAt: at(3) }).where(sql`${users.email} like '%@demo.hydris.local'`);
  });

  await withTenant(db, DEMO_ORG_ID, async (tx) => {
    await seedSecondSite(tx);
    await seedDocuments(tx);
    await seedRules(tx);
    await seedTelemetry(tx, opts.historyDays ?? 7, opts.resolutionMin ?? 10);
    await seedLab(tx);
    await seedAlarms(tx);
    await seedDevices(tx);
    await seedRoutes(tx);
    await seedInspections(tx);
    await seedMaintenance(tx);
    await seedUiProfiles(tx);
    await seedNotifications(tx);
    await seedAudit(tx);
  });
  return { orgId: DEMO_ORG_ID, ownerId: DEMO_OWNER_ID };
}

async function seedSecondSite(tx: Tx) {
  const s = STP.site;
  await tx.insert(sites).values({ id: SITE2, orgId: DEMO_ORG_ID, name: s.name, code: s.code, city: s.city, country: 'India', address: 'Plot 14, Township Ring Road', lat: s.lat, lng: s.lng, timezone: 'Asia/Kolkata', layoutWidthM: s.w, layoutHeightM: s.h });
  await tx.update(sites).set({ address: 'SIPCOT Industrial Park, Phase II' }).where(eq(sites.id, SITE1));
  const fac = demoId('facility', STP.facility.code);
  await tx.insert(facilities).values({ id: fac, orgId: DEMO_ORG_ID, siteId: SITE2, name: STP.facility.name, code: STP.facility.code, kind: STP.facility.kind, capacityM3PerDay: STP.facility.capacity, description: STP.facility.description });
  for (const [i, a] of STP.areas.entries()) {
    await tx.insert(processAreas).values({ id: demoId('area', 'RTS', a.code), orgId: DEMO_ORG_ID, siteId: SITE2, facilityId: fac, name: a.name, code: a.code, kind: a.kind, sortOrder: i, polygon: a.polygon });
  }
  for (const a of STP.assets) {
    await tx.insert(assets).values({
      id: demoId('asset', a.tag), orgId: DEMO_ORG_ID, siteId: SITE2, facilityId: fac, processAreaId: demoId('area', 'RTS', a.area), tag: a.tag, name: a.name, type: a.type,
      criticality: a.criticality, status: a.status, manufacturer: a.mfg[0], model: a.mfg[1], installedOn: '2022-08-01', serialNumber: `SN-${a.tag.replace('-', '')}-22`,
      positionX: (a.x / 100) * s.w, positionY: (a.y / 100) * s.h, specs: {},
      notes: a.status === 'maintenance' ? 'Out for stator replacement (see maintenance task).' : a.status === 'degraded' ? 'Elevated vibration since this morning; under observation.' : null,
    });
  }
  for (const g of STP_SENSORS) {
    const asset = STP.assets.find((a) => a.tag === g.assetTag)!;
    await tx.insert(sensors).values({
      id: demoId('sensor', g.tag), orgId: DEMO_ORG_ID, siteId: SITE2, assetId: demoId('asset', g.assetTag), processAreaId: demoId('area', 'RTS', asset.area),
      tag: g.tag, name: `${MEASURAND_DEFS[g.measurand].label} ${g.assetTag}`, measurand: g.measurand, unit: MEASURAND_DEFS[g.measurand].unit, method: 'continuous', expectedIntervalS: 5, sourceRef: `STP02.${g.tag}`,
    });
  }
  // A few more realistic notes/serials on the ETP assets.
  await tx.update(assets).set({ serialNumber: 'KPD-21-08841', notes: 'Bearing housing replaced 2025-11. Standby pump P-101B available.' }).where(eq(assets.id, demoId('asset', 'P-101')));
  await tx.update(assets).set({ status: 'degraded', notes: 'High vibration under investigation (alarm assigned to maintenance).' }).where(eq(assets.id, demoId('asset', 'P-101')));
}

async function seedDocuments(tx: Tx) {
  for (const d of MORE_DOCS) {
    const draft = 'status' in d && d.status === 'draft';
    await tx.insert(documents).values({
      id: demoId('document', d.key), orgId: DEMO_ORG_ID, siteId: d.site ? demoId('site', d.site) : null, assetId: d.key === 'p101-manual' ? demoId('asset', 'P-101') : d.key === 'an501-ds' ? demoId('asset', 'AN-501') : null,
      assetType: d.assetType, title: d.title, kind: d.kind, body: d.body, status: draft ? 'draft' : 'approved', version: draft ? 1 : 2, tags: [d.key],
      approvedBy: draft ? null : U('manager'), approvedAt: draft ? null : at(24 * 40), createdBy: U('manager'), createdAt: at(24 * 60),
    });
  }
}

async function seedRules(tx: Tx) {
  for (const t of STP_THRESHOLDS) {
    await tx.insert(alarmRules).values({
      id: demoId('rule', t.sensorTag, t.condition), orgId: DEMO_ORG_ID, siteId: SITE2, sensorId: demoId('sensor', t.sensorTag), name: `${t.sensorTag} ${t.condition.replace('_', '-')}`,
      condition: t.condition, threshold: t.threshold, deadband: t.deadband, severity: t.severity, recommendedAction: t.action,
      procedureDocumentId: t.doc ? demoId('document', t.doc) : null, createdBy: U('manager'),
    });
  }
}

async function seedTelemetry(tx: Tx, days: number, resMin: number) {
  if (days <= 0) return;
  const step = resMin * 60_000;
  const end = Math.floor(anchorMs / step) * step;
  const n = Math.floor((days * D) / step);
  const rows: TelemetryRow[] = [];
  for (const g of ALL_SIGNALS) {
    for (let i = n; i >= 1; i--) {
      const t = end - i * step;
      rows.push({ orgId: DEMO_ORG_ID, sensorId: demoId('sensor', g.tag), ts: new Date(t), value: signalValue(g, t), source: 'simulator', synthetic: true, messageId: `demo:${g.tag}:${t}` });
    }
  }
  await insertChunked(tx, telemetryReadings, rows, 2000);
  for (const g of ALL_SIGNALS) {
    const t = end - step;
    await tx.update(sensors).set({ lastValue: signalValue(g, t), lastTs: new Date(t), lastQuality: 'good', lastSource: 'simulator', lastReceivedAt: new Date(t) }).where(eq(sensors.id, demoId('sensor', g.tag)));
  }
}

/** Laboratory composite samples (source 'lab', not simulator) every ~36 h over 14 days. */
async function seedLab(tx: Tx) {
  const lab = { cod: { base: 185, spread: 35, limit: 250 }, bod: { base: 22, spread: 6, limit: 30 }, tss: { base: 38, spread: 10, limit: 100 } } as const;
  for (const [m, p] of Object.entries(lab)) {
    const sensorId = demoId('sensor', `LAB-${m.toUpperCase()}`);
    const rows: TelemetryRow[] = [];
    let last: { v: number; t: Date } | null = null;
    for (let k = 0; k < 10; k++) {
      const t = new Date(Math.floor((anchorMs - 14 * D + k * 36 * H) / H) * H);
      let v = Math.round(p.base + noise(`lab-${m}`, k) * p.spread);
      if (m === 'cod' && k === 6) v = 262; // one exceedance, matched by an abnormal lab note in the audit trail
      rows.push({ orgId: DEMO_ORG_ID, sensorId, ts: t, value: v, source: 'lab', synthetic: false, messageId: `demo-lab:${m}:${k}` });
      last = { v, t };
    }
    await tx.insert(telemetryReadings).values(rows);
    if (last) await tx.update(sensors).set({ lastValue: last.v, lastTs: last.t, lastQuality: 'good', lastSource: 'lab', lastReceivedAt: last.t }).where(eq(sensors.id, sensorId));
  }
}

const SIM_THRESHOLDS = [...SIM_PLANT.thresholds.map((t) => ({ ...t, deadband: 0 })), ...STP_THRESHOLDS];

async function seedAlarms(tx: Tx) {
  const sensorRows = await tx.select().from(sensors);
  const byTag = new Map(sensorRows.map((s) => [s.tag, s]));
  const assetTag = new Map([...SIM_PLANT.assets, ...STP.assets].map((a) => [demoId('asset', a.tag), a.tag]));
  for (const inc of INCIDENTS) {
    const sensor = byTag.get(inc.tag)!;
    const g = ALL_SIGNALS.find((x) => x.tag === inc.tag)!;
    const start = anchorMs - inc.startH * H;
    const end = start + inc.durH * H;
    const ongoing = end > anchorMs;
    for (const [ci, cond] of inc.conds.entries()) {
      const rule = SIM_THRESHOLDS.find((t) => t.sensorTag === inc.tag && t.condition === cond)!;
      const id = demoId('alarm', inc.key, cond);
      const trig = new Date(start + inc.durH * H * (0.08 + ci * 0.05));
      const value = Math.round((rule.threshold + (cond.startsWith('high') ? 1 : -1) * Math.abs(g.base) * 0.02) * 100) / 100;
      const peak = Math.round((g.base + inc.delta) * 100) / 100;
      const tag = sensor.assetId ? assetTag.get(sensor.assetId) : undefined;
      const title = `${CONDITION_LABELS[cond]} ${sensor.name}${tag ? ` · ${tag}` : ''}`;
      const description = describeBreach(cond, value, rule.threshold, sensor.unit);
      const ackAt = minutes(trig, 6 + (inc.startH % 17));
      const invAt = minutes(ackAt, 12);
      const resAt = new Date(Math.max(end, invAt.getTime()) + 35 * 60_000);
      const closeAt = minutes(resAt, 240);
      const s = inc.state;
      const reached = (x: Life) => ['active', 'acknowledged', 'investigating', 'resolved', 'closed'].indexOf(s) >= ['active', 'acknowledged', 'investigating', 'resolved', 'closed'].indexOf(x);
      const acker = inc.ack ?? 'supervisor';
      const assignee = inc.assignee ?? (reached('investigating') ? 'engineer' : null);
      await tx.insert(alarmEvents).values({
        id, orgId: DEMO_ORG_ID, siteId: sensor.siteId, assetId: sensor.assetId, sensorId: sensor.id, ruleId: demoId('rule', inc.tag, cond), severity: rule.severity, condition: cond, state: s,
        title, description, recommendedAction: (rule as { action?: string }).action ?? null, triggerValue: value, threshold: rule.threshold, unit: sensor.unit, peakValue: peak, triggeredAt: trig,
        clearedAt: ongoing ? null : new Date(end - inc.durH * H * 0.1), synthetic: true,
        assignedTo: assignee ? U(assignee) : null,
        acknowledgedBy: reached('acknowledged') ? U(acker) : null, acknowledgedAt: reached('acknowledged') ? ackAt : null,
        resolvedBy: reached('resolved') ? U(assignee ?? acker) : null, resolvedAt: reached('resolved') ? resAt : null, resolutionNote: reached('resolved') ? (inc.resolution ?? 'Condition investigated and corrected.') : null,
        closedBy: reached('closed') ? U('manager') : null, closedAt: reached('closed') ? closeAt : null, updatedAt: new Date(),
      });
      const hist: (typeof alarmEventHistory.$inferInsert)[] = [{ id: demoId('alarm-h', id, 'trig'), orgId: DEMO_ORG_ID, alarmId: id, action: 'triggered', toState: 'active', note: description, at: trig }];
      const audits: (typeof auditEvents.$inferInsert)[] = [{ id: demoId('audit', id, 'trig'), orgId: DEMO_ORG_ID, actorLabel: 'alarm engine', action: 'alarm.triggered', entityType: 'alarm', entityId: id, summary: title, metadata: { severity: rule.severity, value, synthetic: true }, at: trig }];
      if (!ongoing) hist.push({ id: demoId('alarm-h', id, 'clr'), orgId: DEMO_ORG_ID, alarmId: id, action: 'condition_cleared', note: `Value returned to ${signalValue(g, end + 60_000)} ${sensor.unit}`, at: new Date(end - inc.durH * H * 0.1) });
      const step = (k: string, action: string, from: Life, to: Life, who: string, when: Date, note?: string | null) => {
        hist.push({ id: demoId('alarm-h', id, k), orgId: DEMO_ORG_ID, alarmId: id, action, fromState: from, toState: to, actorUserId: U(who), note: note ?? null, at: when });
        audits.push({ id: demoId('audit', id, k), orgId: DEMO_ORG_ID, actorUserId: U(who), action: `alarm.${action}`, entityType: 'alarm', entityId: id, summary: title, metadata: { from, to, via: who === 'operator' ? 'device' : 'user' }, at: when });
      };
      if (reached('acknowledged')) step('ack', 'acknowledge', 'active', 'acknowledged', acker, ackAt, acker.startsWith('operator') ? 'Acknowledged on glasses. Going to check locally.' : 'Seen. Operator dispatched.');
      if (reached('investigating')) {
        step('inv', 'investigate', 'acknowledged', 'investigating', acker, invAt);
        hist.push({ id: demoId('alarm-h', id, 'asg'), orgId: DEMO_ORG_ID, alarmId: id, action: 'assigned', actorUserId: U('supervisor'), note: 'Maintenance to inspect', at: minutes(invAt, 2) });
      }
      for (const [ni, note] of (inc.notes ?? []).entries()) {
        hist.push({ id: demoId('alarm-h', id, `note${ni}`), orgId: DEMO_ORG_ID, alarmId: id, action: 'note', actorUserId: U(ni === 0 ? acker : (assignee ?? acker)), note, at: minutes(ackAt, 20 + ni * 35) });
      }
      if (reached('resolved')) step('res', 'resolve', 'investigating', 'resolved', assignee ?? acker, resAt, inc.resolution);
      if (reached('closed')) step('cls', 'close', 'resolved', 'closed', 'manager', closeAt, 'Reviewed at morning meeting.');
      await tx.insert(alarmEventHistory).values(hist);
      await tx.insert(auditEvents).values(audits);
    }
  }
  // A historical stale-data alarm (gateway outage) for the "no data" rule type.
  const ct = byTag.get('CT-102')!;
  const sid = demoId('alarm', 'stale-ct102');
  const t0 = at(40);
  await tx.insert(alarmEvents).values({
    id: sid, orgId: DEMO_ORG_ID, siteId: ct.siteId, assetId: ct.assetId, sensorId: ct.id, ruleId: demoId('rule', 'CT-102', 'stale'), severity: 'medium', condition: 'stale', state: 'closed',
    title: `No data ${ct.name} · BL-102`, description: describeBreach('stale', null, null, ct.unit), recommendedAction: 'Check instrument power and gateway connectivity.', unit: ct.unit, triggeredAt: t0,
    clearedAt: minutes(t0, 18), acknowledgedBy: U('operator2'), acknowledgedAt: minutes(t0, 5), resolvedBy: U('engineer'), resolvedAt: minutes(t0, 30), resolutionNote: 'Gateway switch port flapping; patch cable replaced.',
    closedBy: U('manager'), closedAt: minutes(t0, 300), synthetic: true,
  });
  await tx.insert(alarmEventHistory).values([
    { id: demoId('alarm-h', sid, 'trig'), orgId: DEMO_ORG_ID, alarmId: sid, action: 'triggered', toState: 'active', note: 'No fresh measurement received within the expected interval', at: t0 },
    { id: demoId('alarm-h', sid, 'ack'), orgId: DEMO_ORG_ID, alarmId: sid, action: 'acknowledge', fromState: 'active', toState: 'acknowledged', actorUserId: U('operator2'), at: minutes(t0, 5) },
    { id: demoId('alarm-h', sid, 'clr'), orgId: DEMO_ORG_ID, alarmId: sid, action: 'condition_cleared', note: 'Fresh data received', at: minutes(t0, 18) },
    { id: demoId('alarm-h', sid, 'res'), orgId: DEMO_ORG_ID, alarmId: sid, action: 'resolve', fromState: 'acknowledged', toState: 'resolved', actorUserId: U('engineer'), note: 'Gateway switch port flapping; patch cable replaced.', at: minutes(t0, 30) },
    { id: demoId('alarm-h', sid, 'cls'), orgId: DEMO_ORG_ID, alarmId: sid, action: 'close', fromState: 'resolved', toState: 'closed', actorUserId: U('manager'), at: minutes(t0, 300) },
  ]);
}

export const DEMO_DEVICES = [
  { key: 'karthik', name: 'Glasses · Karthik (Vuzix M400)', kind: 'hardware' as const, model: 'Vuzix M400', user: 'operator', site: SITE1, status: 'active' as const, seenH: 0, app: '2.3.1', fw: '1.9.4' },
  { key: 'divya', name: 'Glasses · Divya (RealWear Navigator 520)', kind: 'hardware' as const, model: 'RealWear Navigator 520', user: 'operator2', site: SITE1, status: 'active' as const, seenH: 3.2, app: '2.3.1', fw: '13.2' },
  { key: 'trainer', name: 'Browser simulator · Training room', kind: 'simulator' as const, model: 'Hydris browser simulator', user: 'engineer', site: SITE2, status: 'active' as const, seenH: 50, app: '2.3.0', fw: null },
  { key: 'spare', name: 'Glasses · Spare unit 04', kind: 'hardware' as const, model: 'Vuzix M400', user: 'supervisor', site: SITE2, status: 'suspended' as const, seenH: 120, app: '2.2.7', fw: '1.9.2' },
  { key: 'lost', name: 'Glasses · Unit 02 (reported lost)', kind: 'hardware' as const, model: 'Vuzix M400', user: null, site: SITE1, status: 'revoked' as const, seenH: 400, app: '2.1.0', fw: '1.8.0' },
];
/** The pre-paired device that the live ticker keeps "connected". */
export const DEMO_CONNECTED_DEVICE_ID = demoId('device', 'karthik');

async function seedDevices(tx: Tx) {
  for (const d of DEMO_DEVICES) {
    const id = demoId('device', d.key);
    const pairedAt = at(24 * 21 + d.seenH);
    await tx.insert(devices).values({
      id, orgId: DEMO_ORG_ID, siteId: d.site, name: d.name, kind: d.kind, model: d.model, hardwareId: `demo-hw-${d.key}-0000000000`, appVersion: d.app, firmwareVersion: d.fw,
      displayInfo: d.kind === 'simulator' ? { width: 1280, height: 720 } : { width: 640, height: 360 }, status: d.status, pairedAt, pairedBy: U('admin'), lastSeenAt: at(d.seenH), lastIp: '10.20.4.17',
      suspendedAt: d.status === 'suspended' ? at(30) : null, revokedAt: d.status === 'revoked' ? at(24 * 12) : null, revokedBy: d.status === 'revoked' ? U('admin') : null,
      revokeReason: d.status === 'revoked' ? 'Reported lost on site; credentials revoked.' : null,
    });
    if (d.user) await tx.insert(deviceAssignments).values({ id: demoId('device-assign', d.key), orgId: DEMO_ORG_ID, deviceId: id, userId: U(d.user), assignedBy: U('admin'), assignedAt: pairedAt, reason: 'initial pairing' });
    await tx.insert(auditEvents).values({ id: demoId('audit', 'device', d.key), orgId: DEMO_ORG_ID, actorUserId: U('admin'), actorDeviceId: id, action: 'device.paired', entityType: 'device', entityId: id, summary: d.name, at: pairedAt });
    if (d.status === 'suspended') await tx.insert(auditEvents).values({ id: demoId('audit', 'device-susp', d.key), orgId: DEMO_ORG_ID, actorUserId: U('admin'), action: 'device.suspend', entityType: 'device', entityId: id, summary: d.name, at: at(30) });
    if (d.status === 'revoked') await tx.insert(auditEvents).values({ id: demoId('audit', 'device-rev', d.key), orgId: DEMO_ORG_ID, actorUserId: U('admin'), action: 'device.revoke', entityType: 'device', entityId: id, summary: d.name, metadata: { reason: 'Reported lost' }, at: at(24 * 12) });
  }
}

// ---------------------------------------------------------------- inspections
type TplKey = keyof typeof STEP_SETS;
const TPL: Record<TplKey, { key: string; name: string; safety: string[] }> = {
  pump: { key: 'pump_routine', name: 'Pump routine inspection', safety: ['Hearing protection required in the pump house.', 'Do not touch rotating parts or remove guards.'] },
  blower: { key: 'blower_routine', name: 'Blower routine inspection', safety: ['Blower casing can exceed 80 °C.'] },
  dosing: { key: 'dosing_pm', name: 'Dosing pump preventive check', safety: ['Corrosive chemical: face shield and gloves.', 'Lockout/tagout required (SAFE-01).'] },
  tank: { key: 'tank_check', name: 'Tank walk-down', safety: ['Stay behind handrails at tank edges.'] },
  analyzer: { key: 'analyzer_verification', name: 'Analyzer verification', safety: ['Buffer solutions are mild irritants.'] },
};

type Answer = Record<string, StepValue | undefined>;
interface InspSpec {
  key: string; tpl: TplKey; asset: string; site: string; status: 'scheduled' | 'in_progress' | 'paused' | 'submitted' | 'approved' | 'rejected' | 'cancelled'; user: string;
  dueH: number; startedH?: number; submittedH?: number; via?: 'glasses' | 'console'; reviewer?: string; reviewNote?: string; priority?: 'normal' | 'high'; answers?: Answer; notes?: Record<string, string>; route?: string;
}

const okAnswers = (tpl: TplKey, seed: number): Answer => {
  const r = (a: number, b: number, k: string) => Math.round((a + (b - a) * (0.5 + noise(`insp-${k}`, seed) * 0.35)) * 100) / 100;
  switch (tpl) {
    case 'pump': return { guard: { kind: 'check', checked: true }, leak: { kind: 'choice', option: 'No leakage' }, vib: { kind: 'reading', value: r(1.8, 3.6, 'vib') }, noise: { kind: 'check', checked: true }, press: { kind: 'reading', value: r(2.0, 2.9, 'press') }, notes: { kind: 'text', text: 'All normal.' } };
    case 'blower': return { filter: { kind: 'choice', option: 'Green' }, belt: { kind: 'check', checked: true }, temp: { kind: 'reading', value: r(68, 86, 'temp') } };
    case 'dosing': return { loto: { kind: 'check', checked: true }, diaph: { kind: 'choice', option: 'Good' }, valves: { kind: 'check', checked: true }, rate: { kind: 'reading', value: r(0.36, 0.5, 'rate') } };
    case 'tank': return { level: { kind: 'reading', value: r(48, 72, 'lvl') }, foam: { kind: 'choice', option: 'Normal' }, overflow: { kind: 'check', checked: true } };
    case 'analyzer': return { clean: { kind: 'check', checked: true }, buffer: { kind: 'reading', value: r(6.96, 7.04, 'buf') }, drift: { kind: 'choice', option: 'Within ±0.1' } };
  }
};

const INSPECTIONS: InspSpec[] = [
  // Open work (shows on glasses for the assignee).
  { key: 'tk-p602', tpl: 'pump', asset: 'P-602', site: 'RTS', status: 'scheduled', user: 'tarun', dueH: -2, priority: 'high', route: 'evening-stp' },
  { key: 'tk-uv801', tpl: 'analyzer', asset: 'AN-803', site: 'RTS', status: 'scheduled', user: 'tarun', dueH: -6, route: 'evening-stp' },
  { key: 'tk-t101', tpl: 'tank', asset: 'T-101', site: 'RIP', status: 'scheduled', user: 'tarun', dueH: -4 },
  { key: 'op-bl702', tpl: 'blower', asset: 'BL-702', site: 'RTS', status: 'scheduled', user: 'operator', dueH: -8, route: 'evening-stp' },
  { key: 'op-sbr701', tpl: 'tank', asset: 'SBR-701', site: 'RTS', status: 'scheduled', user: 'operator2', dueH: 3, route: 'evening-stp' },
  { key: 'ip-p101', tpl: 'pump', asset: 'P-101', site: 'RIP', status: 'in_progress', user: 'operator', dueH: -1, startedH: 0.6, priority: 'high',
    answers: { guard: { kind: 'check', checked: true }, leak: { kind: 'choice', option: 'Weeping' }, vib: { kind: 'reading', value: 5.1 } }, notes: { vib: 'Higher than last week (3.2). Standby pump in service.' } },
  { key: 'pa-bl102', tpl: 'blower', asset: 'BL-102', site: 'RIP', status: 'paused', user: 'operator2', dueH: -3, startedH: 2.5, answers: { filter: { kind: 'choice', option: 'Amber' } }, notes: { filter: 'Paused: called to the clarifier.' } },
  // Awaiting review.
  { key: 'sb-t101', tpl: 'tank', asset: 'T-101', site: 'RIP', status: 'submitted', user: 'operator', dueH: 5, startedH: 5.5, submittedH: 5.2, via: 'glasses',
    answers: { level: { kind: 'reading', value: 81.5 }, foam: { kind: 'choice', option: 'Foaming' }, overflow: { kind: 'check', checked: true } }, notes: { foam: 'White foam on 30 % of surface after dyeing batch.' } },
  { key: 'sb-an803', tpl: 'analyzer', asset: 'AN-803', site: 'RTS', status: 'submitted', user: 'operator2', dueH: 8, startedH: 9, submittedH: 8.7, via: 'console' },
  // Reviewed.
  { key: 'rj-dp301', tpl: 'dosing', asset: 'DP-301', site: 'RIP', status: 'rejected', user: 'operator2', dueH: 26, startedH: 28, submittedH: 27.5, via: 'glasses', reviewer: 'supervisor',
    reviewNote: 'Draw-down rate looks too low for the current set-point. Please re-check with the calibration column and attach a diaphragm photo.',
    answers: { loto: { kind: 'check', checked: true }, diaph: { kind: 'choice', option: 'Swollen' }, valves: { kind: 'check', checked: true }, rate: { kind: 'reading', value: 0.24 } } },
  { key: 'ap-p101-a', tpl: 'pump', asset: 'P-101', site: 'RIP', status: 'approved', user: 'operator', dueH: 30, startedH: 31, submittedH: 30.6, via: 'glasses', reviewer: 'supervisor',
    answers: { ...okAnswers('pump', 1), vib: { kind: 'reading', value: 6.8 }, notes: { kind: 'text', text: 'Vibration high at DE bearing; reported to supervisor.' } } },
  { key: 'ap-an501', tpl: 'analyzer', asset: 'AN-501', site: 'RIP', status: 'approved', user: 'operator2', dueH: 50, startedH: 52, submittedH: 51.6, via: 'glasses', reviewer: 'supervisor' },
  { key: 'ap-bl102', tpl: 'blower', asset: 'BL-102', site: 'RIP', status: 'approved', user: 'operator', dueH: 74, startedH: 76, submittedH: 75.7, via: 'glasses', reviewer: 'manager' },
  { key: 'ap-t101', tpl: 'tank', asset: 'T-101', site: 'RIP', status: 'approved', user: 'operator', dueH: 98, startedH: 100, submittedH: 99.8, via: 'console', reviewer: 'supervisor' },
  { key: 'ap-p901', tpl: 'pump', asset: 'P-901', site: 'RTS', status: 'approved', user: 'operator2', dueH: 120, startedH: 123, submittedH: 122.5, via: 'glasses', reviewer: 'supervisor',
    answers: { ...okAnswers('pump', 5), vib: { kind: 'reading', value: 5.3 }, noise: { kind: 'check', checked: false, abnormal: true } }, notes: { noise: 'Knocking noise, suspected stator wear.' } },
  { key: 'ap-dp802', tpl: 'dosing', asset: 'DP-802', site: 'RTS', status: 'approved', user: 'engineer', dueH: 140, startedH: 146, submittedH: 145.5, via: 'console', reviewer: 'manager' },
  { key: 'ap-p602', tpl: 'pump', asset: 'P-602', site: 'RTS', status: 'approved', user: 'operator', dueH: 150, startedH: 152, submittedH: 151.6, via: 'glasses', reviewer: 'supervisor' },
  { key: 'ap-sbr701', tpl: 'tank', asset: 'SBR-701', site: 'RTS', status: 'approved', user: 'operator2', dueH: 170, startedH: 171, submittedH: 170.8, via: 'glasses', reviewer: 'supervisor' },
  { key: 'ap-an501-b', tpl: 'analyzer', asset: 'AN-501', site: 'RIP', status: 'approved', user: 'operator', dueH: 220, startedH: 220, submittedH: 219.6, via: 'glasses', reviewer: 'supervisor' },
  { key: 'ap-p101-b', tpl: 'pump', asset: 'P-101', site: 'RIP', status: 'approved', user: 'operator', dueH: 250, startedH: 247, submittedH: 246.8, via: 'glasses', reviewer: 'supervisor' },
  { key: 'cx-bl702', tpl: 'blower', asset: 'BL-702', site: 'RTS', status: 'cancelled', user: 'operator', dueH: 60 },
];

async function seedInspections(tx: Tx) {
  const routeMap: Record<string, string> = { 'evening-stp': demoId('route', 'evening-stp') };
  for (const [idx, s] of INSPECTIONS.entries()) {
    const id = demoId('inspection', s.key);
    const steps: InspectionStep[] = STEP_SETS[s.tpl];
    const t = TPL[s.tpl];
    const created = at(Math.max(s.startedH ?? 0, s.dueH) + 10);
    const answers: Answer = s.answers ?? (['submitted', 'approved'].includes(s.status) ? okAnswers(s.tpl, idx) : {});
    const reviewedAt = s.reviewer && s.submittedH !== undefined ? at(s.submittedH - 1.5) : null;
    const device = s.via === 'glasses' ? (s.user === 'operator' ? demoId('device', 'karthik') : s.user === 'operator2' ? demoId('device', 'divya') : null) : null;
    await tx.insert(inspections).values({
      id, orgId: DEMO_ORG_ID, siteId: demoId('site', s.site), assetId: demoId('asset', s.asset), templateId: demoId('template', t.key), templateVersion: 1, routeId: s.route ? routeMap[s.route] : null,
      title: `${t.name} · ${s.asset}`, steps, safetyNotices: t.safety, status: s.status, priority: s.priority ?? 'normal', assignedTo: U(s.user), assignedBy: U('supervisor'),
      dueAt: at(s.dueH), startedAt: s.startedH !== undefined ? at(s.startedH) : null, pausedAt: s.status === 'paused' ? at((s.startedH ?? 1) - 0.4) : null,
      submittedAt: s.submittedH !== undefined ? at(s.submittedH) : null, submittedVia: s.via ?? null, submittedDeviceId: device,
      reviewedBy: s.reviewer ? U(s.reviewer) : null, reviewedAt, reviewNote: s.reviewNote ?? (s.status === 'approved' ? 'OK' : null),
      revision: { scheduled: 1, cancelled: 2, in_progress: 2, paused: 3, submitted: 3, approved: 4, rejected: 4 }[s.status], synthetic: true, createdAt: created, updatedAt: reviewedAt ?? created,
    });
    const recBase = s.startedH !== undefined ? at(s.startedH) : created;
    const resp: (typeof inspectionResponses.$inferInsert)[] = [];
    for (const [k, step] of steps.entries()) {
      const v = answers[step.id];
      if (!v) continue;
      resp.push({
        id: demoId('insp-resp', s.key, step.id), orgId: DEMO_ORG_ID, inspectionId: id, stepId: step.id, value: v, outcome: stepOutcome(step, v), note: s.notes?.[step.id] ?? null,
        recordedAt: minutes(recBase, 2 + k * 2), recordedBy: U(s.user), deviceId: device, clientOpId: `demo-${s.key}-${step.id}`,
      });
    }
    if (resp.length) await tx.insert(inspectionResponses).values(resp);
    const audit: (typeof auditEvents.$inferInsert)[] = [{ id: demoId('audit', 'insp-c', s.key), orgId: DEMO_ORG_ID, actorUserId: U('supervisor'), action: 'inspection.created', entityType: 'inspection', entityId: id, summary: `${t.name} · ${s.asset}`, at: created }];
    if (s.submittedH !== undefined) audit.push({ id: demoId('audit', 'insp-s', s.key), orgId: DEMO_ORG_ID, actorUserId: U(s.user), actorDeviceId: device, actorLabel: device ? 'glasses' : null, action: 'inspection.submitted', entityType: 'inspection', entityId: id, summary: `${t.name} · ${s.asset}`, metadata: { via: device ? 'device' : 'user' }, at: at(s.submittedH) });
    if (s.reviewer && reviewedAt) audit.push({ id: demoId('audit', 'insp-r', s.key), orgId: DEMO_ORG_ID, actorUserId: U(s.reviewer), action: s.status === 'rejected' ? 'inspection.returned' : 'inspection.approved', entityType: 'inspection', entityId: id, summary: `${t.name} · ${s.asset}`, at: reviewedAt });
    await tx.insert(auditEvents).values(audit);
  }
}

// ---------------------------------------------------------------- maintenance
type Check = { id: string; label: string; done: boolean; doneAt?: string | null; doneBy?: string | null };
const cl = (labels: string[], done: number, who: string, when: Date): Check[] =>
  labels.map((label, i) => ({ id: String.fromCharCode(97 + i), label, done: i < done, doneAt: i < done ? minutes(when, 15 * (i + 1)).toISOString() : null, doneBy: i < done ? U(who) : null }));

async function seedMaintenance(tx: Tx) {
  const tasks: { key: string; site: string; asset: string; title: string; description: string; kind: 'corrective' | 'preventive' | 'inspection_followup' | 'alarm_followup'; priority: 'low' | 'medium' | 'high' | 'urgent';
    status: 'open' | 'assigned' | 'in_progress' | 'on_hold' | 'completed' | 'cancelled'; user?: string; createdH: number; dueH?: number; startedH?: number; completedH?: number; note?: string; checklist: Check[];
    alarm?: string; insp?: string; log: [string, string | null, string, number][] }[] = [
    { key: 'p101-bearing', site: 'RIP', asset: 'P-101', title: 'P-101 high vibration: check bearings and alignment', description: 'Raised from critical vibration alarm VT-101 (7.6 mm/s peak). Standby pump in service under PTW-2291.',
      kind: 'alarm_followup', priority: 'urgent', status: 'in_progress', user: 'engineer', createdH: 29, dueH: -6, startedH: 26, alarm: 'i14',
      checklist: cl(['Permit to work and LOTO (SAFE-01)', 'Laser alignment check', 'Inspect DE/NDE bearings', 'Replace bearings if worn (SOP-MNT-04)', 'Restart and record baseline vibration'], 2, 'engineer', at(26)),
      log: [['created', null, 'supervisor', 29], ['assigned', 'Rahul to inspect today', 'supervisor', 28.8], ['start', null, 'engineer', 26], ['note', 'Misalignment 0.18 mm parallel found. Bearing DE shows pitting; replacement bearing requested from stores.', 'engineer', 24]] },
    { key: 'tk-p602-imp', site: 'RTS', asset: 'P-602', title: 'Clear rags from P-602 impeller', description: 'Vibration rising since this morning; likely rag accumulation.', kind: 'corrective', priority: 'high', status: 'assigned', user: 'tarun', createdH: 3, dueH: -5,
      checklist: cl(['Isolate pump and wet-well inflow', 'Open hand-hole and remove rags', 'Check impeller wear ring', 'Restart and verify vibration < 3 mm/s'], 0, 'tarun', at(3)), log: [['created', null, 'supervisor', 3], ['assigned', null, 'supervisor', 2.9]] },
    { key: 't101-foam', site: 'RIP', asset: 'T-101', title: 'Follow up: 1 abnormal finding(s) on Tank walk-down · T-101', description: '• Surface condition — White foam on 30 % of surface after dyeing batch.', kind: 'inspection_followup', priority: 'medium', status: 'open', createdH: 5.2, insp: 'sb-t101',
      checklist: [], log: [['created', 'Auto-created from abnormal inspection finding', 'operator', 5.2]] },
    { key: 'bl102-filter', site: 'RIP', asset: 'BL-102', title: 'Quarterly blower belt and filter service', description: 'Preventive maintenance per OEM schedule.', kind: 'preventive', priority: 'medium', status: 'on_hold', user: 'engineer', createdH: 72, dueH: 24, startedH: 50,
      checklist: cl(['Isolate blower (SAFE-01)', 'Replace inlet filter element', 'Check belt tension', 'Record differential after restart'], 1, 'engineer', at(50)),
      log: [['created', null, 'manager', 72], ['start', null, 'engineer', 50], ['hold', 'Waiting for filter elements (PO 4471).', 'engineer', 48]] },
    { key: 'p901-stator', site: 'RTS', asset: 'P-901', title: 'Replace P-901 stator', description: 'Stator worn (knocking, 5.3 mm/s). Pump removed to workshop.', kind: 'corrective', priority: 'high', status: 'in_progress', user: 'engineer', createdH: 120, dueH: -24, startedH: 100, alarm: 'i09',
      checklist: cl(['Remove pump from line', 'Replace stator and rotor inspection', 'Pressure test', 'Re-install and commission'], 2, 'engineer', at(100)),
      log: [['created', null, 'supervisor', 120], ['start', null, 'engineer', 100], ['note', 'Rotor OK, stator replaced. Awaiting crane for re-installation.', 'engineer', 30]] },
    { key: 'dp301-diaph', site: 'RIP', asset: 'DP-301', title: 'Dosing pump diaphragm replacement', description: 'Diaphragm found swollen during preventive check.', kind: 'inspection_followup', priority: 'medium', status: 'completed', user: 'engineer', createdH: 27, startedH: 22, completedH: 20, insp: 'rj-dp301',
      note: 'Diaphragm and check-valve balls replaced. Draw-down 0.44 m³/h verified.', checklist: cl(['LOTO and flush pump head', 'Replace diaphragm', 'Replace check-valve balls', 'Verify dosing rate'], 4, 'engineer', at(22)),
      log: [['created', null, 'supervisor', 27], ['start', null, 'engineer', 22], ['complete', 'Diaphragm and check-valve balls replaced. Draw-down 0.44 m³/h verified.', 'engineer', 20]] },
    { key: 'uv-lamps', site: 'RTS', asset: 'UV-801', title: 'UV lamp bank B — replace 2 lamps (9,000 h)', description: 'Lamp hours reached replacement limit.', kind: 'preventive', priority: 'medium', status: 'completed', user: 'engineer', createdH: 200, startedH: 180, completedH: 178,
      note: 'Lamps B3 and B7 replaced; sleeves cleaned. Intensity 98 %.', checklist: cl(['Isolate bank B', 'Replace lamps B3, B7', 'Clean quartz sleeves', 'Verify intensity'], 4, 'engineer', at(180)),
      log: [['created', null, 'manager', 200], ['start', null, 'engineer', 180], ['complete', 'Lamps B3 and B7 replaced; sleeves cleaned. Intensity 98 %.', 'engineer', 178]] },
    { key: 'cl401-oil2', site: 'RIP', asset: 'CL-401', title: 'Clarifier drive torque calibration', description: 'Annual torque-switch calibration.', kind: 'preventive', priority: 'low', status: 'completed', user: 'engineer', createdH: 300, startedH: 280, completedH: 277,
      note: 'Torque switch recalibrated at 110 % rated.', checklist: cl(['LOTO', 'Calibrate torque switch', 'Function test'], 3, 'engineer', at(280)), log: [['created', null, 'manager', 300], ['complete', 'Torque switch recalibrated at 110 % rated.', 'engineer', 277]] },
    { key: 'sc601-rake', site: 'RTS', asset: 'SC-601', title: 'Bar screen rake chain lubrication', description: 'Monthly lubrication.', kind: 'preventive', priority: 'low', status: 'assigned', user: 'operator', createdH: 10, dueH: -30,
      checklist: cl(['Isolate screen', 'Lubricate rake chain', 'Check shear pin'], 0, 'operator', at(10)), log: [['created', null, 'supervisor', 10]] },
    { key: 'an803-cal', site: 'RTS', asset: 'AN-803', title: 'Chlorine analyzer reagent change', description: 'Reagent bottles near expiry.', kind: 'preventive', priority: 'medium', status: 'assigned', user: 'tarun', createdH: 6, dueH: -20,
      checklist: cl(['Replace buffer and indicator reagents', 'Prime reagent lines', 'Verify with DPD kit'], 0, 'tarun', at(6)), log: [['created', null, 'supervisor', 6]] },
    { key: 'p602-seal', site: 'RTS', asset: 'P-602', title: 'Mechanical seal replacement (duplicate request)', description: 'Duplicate of an earlier request.', kind: 'corrective', priority: 'low', status: 'cancelled', createdH: 90,
      checklist: [], log: [['created', null, 'operator', 90], ['cancel', 'Duplicate of the seal work completed last month.', 'supervisor', 88]] },
  ];
  for (const t of tasks) {
    const id = demoId('task', t.key);
    await tx.insert(maintenanceTasks).values({
      id, orgId: DEMO_ORG_ID, siteId: demoId('site', t.site), assetId: demoId('asset', t.asset), title: t.title, description: t.description, kind: t.kind, priority: t.priority, status: t.status,
      assignedTo: t.user ? U(t.user) : null, requestedBy: U('supervisor'), sourceInspectionId: t.insp ? demoId('inspection', t.insp) : null,
      sourceAlarmId: t.alarm ? demoId('alarm', t.alarm, t.alarm === 'i14' ? 'high_high' : 'high') : null, checklist: t.checklist, dueAt: t.dueH !== undefined ? at(t.dueH) : null,
      startedAt: t.startedH !== undefined ? at(t.startedH) : null, completedAt: t.completedH !== undefined ? at(t.completedH) : null, completionNote: t.note ?? null, synthetic: true,
      createdAt: at(t.createdH), updatedAt: at(Math.min(t.createdH, t.completedH ?? t.startedH ?? t.createdH)),
    });
    await tx.insert(maintenanceActivity).values(t.log.map(([action, note, who, h], i) => ({ id: demoId('task-act', t.key, i), orgId: DEMO_ORG_ID, taskId: id, action, note, actorUserId: U(who), at: at(h) })));
    await tx.insert(auditEvents).values(t.log.filter(([a]) => a !== 'note' && a !== 'assigned').map(([action, , who, h], i) => ({
      id: demoId('audit', 'task', t.key, i), orgId: DEMO_ORG_ID, actorUserId: U(who), action: `maintenance.${action === 'created' ? 'created' : action}`, entityType: 'maintenance', entityId: id, summary: t.title, at: at(h),
    })));
  }
}

async function seedRoutes(tx: Tx) {
  await tx.insert(inspectionRoutes).values([
    { id: demoId('route', 'evening-stp'), orgId: DEMO_ORG_ID, siteId: SITE2, name: 'Evening round · STP-02', description: 'Inlet works → SBR → disinfection → sludge.', assetIds: ['SC-601', 'P-602', 'SBR-701', 'BL-702', 'UV-801', 'AN-803', 'P-901'].map((t) => demoId('asset', t)), createdBy: U('supervisor') },
    { id: demoId('route', 'analyzers'), orgId: DEMO_ORG_ID, siteId: SITE1, name: 'Weekly analyzer verification', description: 'Online analyzers at the ETP final discharge.', assetIds: [demoId('asset', 'AN-501')], createdBy: U('supervisor') },
    { id: demoId('route', 'rotating-etp'), orgId: DEMO_ORG_ID, siteId: SITE1, name: 'Rotating equipment round · ETP-01', description: 'Pumps and blowers: vibration, noise, temperature.', assetIds: ['P-101', 'BL-102', 'DP-301'].map((t) => demoId('asset', t)), createdBy: U('engineer') },
  ]);
}

async function seedUiProfiles(tx: Tx) {
  const base = normalizeUiProfileConfig(DEFAULT_UI_PROFILE_CONFIG);
  const operator = normalizeUiProfileConfig({
    ...base, layout: { density: 'compact', textScale: 1.1, handedness: 'right' },
    measurements: { allow: null, orderByAssetType: { pump: ['vibration', 'motor_current', 'pressure'], blower: ['motor_current', 'vibration'], tank: ['tank_level', 'ph', 'dissolved_oxygen'] } },
  });
  const operatorV1 = normalizeUiProfileConfig({ ...operator, layout: { density: 'comfortable', textScale: 1, handedness: 'right' } });
  const viewer = normalizeUiProfileConfig({
    ...base, screens: base.screens.map((s) => ({ ...s, enabled: !['inspections', 'tasks', 'ai'].includes(s.id) })),
    actions: { ...base.actions, acknowledge_alarm: false, record_inspection: false, submit_inspection: false, toggle_checklist: false, ask_ai: false },
  });
  const profiles = [
    { key: 'plant', name: 'Plant standard', description: 'Default glasses layout for all staff.', versions: [{ v: 1, cfg: base, status: 'published' as const, h: 24 * 20 }] },
    { key: 'operator', name: 'Field operator focus', description: 'Compact layout, rotating-equipment measurements first.', versions: [{ v: 1, cfg: operatorV1, status: 'superseded' as const, h: 24 * 18 }, { v: 2, cfg: operator, status: 'published' as const, h: 24 * 6 }, { v: 3, cfg: { ...operator, layout: { ...operator.layout, textScale: 1.2 } }, status: 'draft' as const, h: 20 }] },
    { key: 'viewer', name: 'Read-only visitor', description: 'Observers and auditors: alerts and measurements only, no actions.', versions: [{ v: 1, cfg: viewer, status: 'published' as const, h: 24 * 9 }] },
  ];
  for (const p of profiles) {
    const pid = demoId('ui-profile', p.key);
    await tx.insert(uiProfiles).values({ id: pid, orgId: DEMO_ORG_ID, name: p.name, description: p.description, createdBy: U('admin'), createdAt: at(24 * 21) });
    for (const v of p.versions) {
      await tx.insert(uiProfileVersions).values({
        id: demoId('ui-profile-v', p.key, v.v), orgId: DEMO_ORG_ID, profileId: pid, version: v.v, config: v.cfg as unknown as Record<string, unknown>, status: v.status,
        notes: v.status === 'draft' ? 'Larger text for night shift (draft)' : `Version ${v.v}`, createdBy: U('admin'), createdAt: at(v.h),
        publishedBy: v.status !== 'draft' ? U('admin') : null, publishedAt: v.status !== 'draft' ? at(v.h - 1) : null,
      });
      if (v.status !== 'draft') await tx.insert(auditEvents).values({ id: demoId('audit', 'uip', p.key, v.v), orgId: DEMO_ORG_ID, actorUserId: U('admin'), action: 'ui_profile.published', entityType: 'ui_profile', entityId: pid, summary: `${p.name} v${v.v}`, at: at(v.h - 1) });
    }
  }
  await tx.insert(uiProfileAssignments).values([
    { id: demoId('ui-assign', 'org'), orgId: DEMO_ORG_ID, profileId: demoId('ui-profile', 'plant'), scope: 'org', createdBy: U('admin') },
    { id: demoId('ui-assign', 'role-op'), orgId: DEMO_ORG_ID, profileId: demoId('ui-profile', 'operator'), scope: 'role', role: 'operator', createdBy: U('admin') },
    { id: demoId('ui-assign', 'user-viewer'), orgId: DEMO_ORG_ID, profileId: demoId('ui-profile', 'viewer'), scope: 'user', userId: U('viewer'), createdBy: U('admin') },
  ]);
}

async function seedNotifications(tx: Tx) {
  const rows: (typeof notifications.$inferInsert)[] = [];
  const add = (who: string, k: string, n: Omit<typeof notifications.$inferInsert, 'orgId' | 'userId' | 'id'>, read = false) =>
    rows.push({ id: demoId('notification', who, k), orgId: DEMO_ORG_ID, userId: U(who), readAt: read ? new Date(anchorMs - 3600_000) : null, ...n });
  const critical = demoId('alarm', 'i14', 'high_high');
  for (const who of ['tarun', 'manager', 'supervisor', 'operator', 'engineer']) {
    add(who, 'vt602', { kind: 'alarm', severity: 'warning', title: 'High Vibration P-602 · P-602', body: 'Raw sewage pump vibration above 4.5 mm/s', link: `/console/alarms/${demoId('alarm', 'i18', 'high')}`, entityType: 'alarm', entityId: demoId('alarm', 'i18', 'high'), createdAt: at(4.6) });
    add(who, 'cl802', { kind: 'alarm', severity: 'warning', title: 'Low Residual chlorine AN-803 · AN-803', body: 'Residual chlorine below 0.2 mg/L', link: `/console/alarms/${demoId('alarm', 'i19', 'low')}`, entityType: 'alarm', entityId: demoId('alarm', 'i19', 'low'), createdAt: at(1.8) });
    add(who, 'vt101', { kind: 'alarm', severity: 'critical', title: 'High-high Vibration P-101 · P-101', body: 'Vibration above 7.1 mm/s high-high limit', link: `/console/alarms/${critical}`, entityType: 'alarm', entityId: critical, createdAt: at(29.8) }, who !== 'tarun');
  }
  add('tarun', 'insp-sub', { kind: 'inspection_submitted', severity: 'warning', title: 'Inspection submitted: Tank walk-down · T-101', body: '1 abnormal finding (foaming)', link: `/console/inspections/${demoId('inspection', 'sb-t101')}`, entityType: 'inspection', entityId: demoId('inspection', 'sb-t101'), createdAt: at(5.2) });
  add('tarun', 'task', { kind: 'maintenance_assigned', severity: 'info', title: 'Task assigned to you: Clear rags from P-602 impeller', link: `/console/maintenance/${demoId('task', 'tk-p602-imp')}`, entityType: 'maintenance', entityId: demoId('task', 'tk-p602-imp'), createdAt: at(2.9) });
  add('tarun', 'uip', { kind: 'ui_profile', severity: 'info', title: 'Draft saved: Field operator focus v3', body: 'Review and publish when ready.', link: '/console/ui-profiles', createdAt: at(20) }, true);
  add('tarun', 'dp301', { kind: 'maintenance_completed', severity: 'success', title: 'Completed: Dosing pump diaphragm replacement', link: `/console/maintenance/${demoId('task', 'dp301-diaph')}`, entityType: 'maintenance', entityId: demoId('task', 'dp301-diaph'), createdAt: at(20) }, true);
  add('supervisor', 'insp-sub', { kind: 'inspection_submitted', severity: 'warning', title: 'Inspection submitted: Tank walk-down · T-101', link: `/console/inspections/${demoId('inspection', 'sb-t101')}`, entityType: 'inspection', entityId: demoId('inspection', 'sb-t101'), createdAt: at(5.2) });
  add('operator2', 'rejected', { kind: 'inspection_reject', severity: 'warning', title: 'Returned for correction: Dosing pump preventive check · DP-301', body: 'Draw-down rate looks too low for the current set-point.', link: `/console/inspections/${demoId('inspection', 'rj-dp301')}`, entityType: 'inspection', entityId: demoId('inspection', 'rj-dp301'), createdAt: at(26) });
  add('operator', 'insp-new', { kind: 'inspection_assigned', severity: 'info', title: 'New inspection: Blower routine inspection · BL-702', link: `/console/inspections/${demoId('inspection', 'op-bl702')}`, entityType: 'inspection', entityId: demoId('inspection', 'op-bl702'), createdAt: at(18) });
  add('engineer', 'task', { kind: 'alarm_assigned', severity: 'warning', title: 'Alarm assigned to you: High-high Vibration P-101 · P-101', link: `/console/alarms/${critical}`, entityType: 'alarm', entityId: critical, createdAt: at(29.5) });
  await tx.insert(notifications).values(rows);
}

async function seedAudit(tx: Tx) {
  const ev = (k: string, h: number, who: string | null, action: string, summary: string, entityType?: string, entityId?: string, metadata?: Record<string, unknown>) =>
    ({ id: demoId('audit', 'misc', k), orgId: DEMO_ORG_ID, actorUserId: who ? U(who) : null, actorLabel: who ? null : 'system', action, entityType, entityId, summary, metadata, ip: who ? '10.20.4.11' : null, at: at(h) });
  await tx.insert(auditEvents).values([
    ev('login-t', 20, 'tarun', 'auth.login', 'Signed in', 'user', DEMO_OWNER_ID),
    ev('login-m', 9, 'manager', 'auth.login', 'Signed in', 'user', U('manager')),
    ev('login-s', 7, 'supervisor', 'auth.login', 'Signed in', 'user', U('supervisor')),
    ev('asset-p602', 4.5, 'supervisor', 'asset.updated', 'P-602 status → degraded', 'asset', demoId('asset', 'P-602'), { changes: { status: { from: 'operational', to: 'degraded' } } }),
    ev('asset-p901', 100, 'engineer', 'asset.updated', 'P-901 status → maintenance', 'asset', demoId('asset', 'P-901'), { changes: { status: { from: 'operational', to: 'maintenance' } } }),
    ev('doc-ap', 24 * 40, 'manager', 'document.approved', 'SOP-SBR-01 SBR cycle, DO and ammonia breakthrough', 'document', demoId('document', 'sbr')),
    ev('member-inv', 24 * 25, 'admin', 'member.invited', 'Invitation sent to a new contractor', 'invitation'),
    ev('lab-cod', 24 * 5, 'supervisor', 'telemetry.manual_entry', 'Lab COD 262 mg/L above 250 mg/L consent limit — resample requested', 'sensor', demoId('sensor', 'LAB-COD')),
    ev('sim', 24 * 2, 'manager', 'simulation.started', 'Normal operations', 'simulation', demoId('simulation', 'baseline')),
  ]);
}

export type { Tx };
