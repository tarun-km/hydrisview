import { and, eq, sql } from 'drizzle-orm';
import { MEASURAND_DEFS, SIM_PLANT, scenarioValue, type InspectionStep, type Role } from '@hydris/domain';
import type { Db, Tx } from '../db/client';
import {
  alarmRules, assets, documents, facilities, inspectionRoutes, inspectionTemplates, inspections, maintenanceTasks, memberships, organizations, processAreas, sensors,
  simulationRuns, sites, telemetryReadings, users,
} from '../db/schema';
import { withSystem, withTenant } from '../db/tenant';
import { hashPassword } from '../core/crypto';

export const DEMO_DOMAIN = 'demo.hydris.local';
export const DEMO_USERS: { key: string; name: string; role: Role; title: string }[] = [
  { key: 'admin', name: 'Asha Raman', role: 'org_admin', title: 'Head of Operations' },
  { key: 'manager', name: 'Vikram Iyer', role: 'factory_manager', title: 'Plant Manager' },
  { key: 'supervisor', name: 'Meera Pillai', role: 'supervisor', title: 'Shift Supervisor' },
  { key: 'operator', name: 'Karthik Selvam', role: 'field_operator', title: 'Field Operator' },
  { key: 'operator2', name: 'Divya Nair', role: 'field_operator', title: 'Field Operator' },
  { key: 'engineer', name: 'Rahul Menon', role: 'maintenance_engineer', title: 'Maintenance Engineer' },
  { key: 'viewer', name: 'Sanjay Kapoor', role: 'viewer', title: 'Compliance Analyst' },
];
export const demoEmail = (key: string) => `${key}@${DEMO_DOMAIN}`;

export async function seedPlatformAdmin(db: Db, email: string, password: string) {
  return withSystem(db, async (tx) => {
    const [existing] = await tx.select().from(users).where(sql`lower(${users.email}) = ${email.toLowerCase()}`);
    if (existing) return { created: false, id: existing.id };
    const [u] = await tx.insert(users).values({ email, name: 'Platform Administrator', passwordHash: await hashPassword(password), isPlatformAdmin: true, emailVerifiedAt: new Date() }).returning();
    return { created: true, id: u!.id };
  });
}

const steps = {
  pump: [
    { id: 'guard', kind: 'check', title: 'Coupling guard fitted and secure', required: true, caution: 'Never remove guards from running equipment.' },
    { id: 'leak', kind: 'choice', title: 'Mechanical seal condition', required: true, options: ['No leakage', 'Weeping', 'Active leak'], abnormalOptions: ['Active leak'] },
    { id: 'vib', kind: 'reading', title: 'Bearing vibration (handheld)', measurand: 'vibration', unit: 'mm/s', required: true, expectedMax: 4.5, instruction: 'Measure at the drive-end bearing, horizontal direction.' },
    { id: 'noise', kind: 'check', title: 'No abnormal noise (cavitation, knocking)', required: true },
    { id: 'press', kind: 'reading', title: 'Discharge pressure gauge', measurand: 'pressure', unit: 'bar', required: true, expectedMin: 1.8, expectedMax: 3.2 },
    { id: 'notes', kind: 'text', title: 'Observations', required: false },
  ],
  blower: [
    { id: 'filter', kind: 'choice', title: 'Inlet filter differential indicator', required: true, options: ['Green', 'Amber', 'Red'], abnormalOptions: ['Red'] },
    { id: 'belt', kind: 'check', title: 'Belt tension and alignment acceptable', required: true, caution: 'Check only with the blower isolated and locked out.' },
    { id: 'temp', kind: 'reading', title: 'Discharge temperature', measurand: 'temperature', unit: '°C', required: true, expectedMax: 95 },
    { id: 'notes', kind: 'text', title: 'Observations', required: false },
  ],
  dosing: [
    { id: 'loto', kind: 'check', title: 'Pump isolated, locked and tagged out', required: true, caution: 'Coagulant is corrosive. Wear face shield and chemical gloves.' },
    { id: 'diaph', kind: 'choice', title: 'Diaphragm condition', required: true, options: ['Good', 'Swollen', 'Cracked'], abnormalOptions: ['Swollen', 'Cracked'] },
    { id: 'valves', kind: 'check', title: 'Suction and discharge check valves seat correctly', required: true },
    { id: 'rate', kind: 'reading', title: 'Calibration column draw-down rate', measurand: 'flow_rate', unit: 'm³/h', required: true, expectedMin: 0.3, expectedMax: 0.55 },
    { id: 'photo', kind: 'photo', title: 'Photo of diaphragm', required: false },
  ],
  tank: [
    { id: 'level', kind: 'reading', title: 'Sight-gauge level', measurand: 'tank_level', unit: '%', required: true, expectedMax: 85 },
    { id: 'foam', kind: 'choice', title: 'Surface condition', required: true, options: ['Normal', 'Foaming', 'Oil film', 'Scum'], abnormalOptions: ['Foaming', 'Oil film'] },
    { id: 'overflow', kind: 'check', title: 'Overflow channel clear', required: true },
  ],
  analyzer: [
    { id: 'clean', kind: 'check', title: 'Probe cleaned per SOP', required: true },
    { id: 'buffer', kind: 'reading', title: 'pH 7.00 buffer check reading', measurand: 'ph', unit: 'pH', required: true, expectedMin: 6.9, expectedMax: 7.1 },
    { id: 'drift', kind: 'choice', title: 'Online vs handheld comparison', required: true, options: ['Within ±0.1', 'Within ±0.3', 'Outside ±0.3'], abnormalOptions: ['Outside ±0.3'] },
  ],
} satisfies Record<string, InspectionStep[]>;

const SOPS = [
  { key: 'vib', title: 'SOP-PMP-07 Pump vibration response', kind: 'troubleshooting' as const, assetType: 'pump' as const, body: `Purpose: respond to high vibration on centrifugal transfer pumps.\n\n1. Confirm the reading on the online vibration transmitter and its timestamp. If the data is stale, verify with a handheld meter at the drive-end bearing.\n2. Listen for cavitation (gravel-like noise). Check suction valve is fully open and suction strainer differential is normal.\n3. Check discharge pressure against the duty point. Operation far left or right of the curve increases vibration.\n4. Inspect coupling guard area for visible misalignment or loose base bolts. Do not remove guards while running.\n5. If vibration exceeds the high-high limit (7.1 mm/s RMS), inform the shift supervisor. The supervisor decides on changeover to the standby pump under the site permit-to-work procedure.\n6. Record findings in the inspection and raise a maintenance request for bearing or alignment checks.` },
  { key: 'level', title: 'SOP-EQ-02 Equalization tank high level', kind: 'sop' as const, assetType: 'tank' as const, body: `Purpose: prevent overflow of the equalization tank.\n\n1. Verify level on the sight gauge and compare with LT-101.\n2. Confirm transfer pump P-101 is running and discharge pressure is normal.\n3. Check whether influent flow has increased (upstream production change, rain ingress).\n4. Inform the supervisor if level exceeds 85 %. Overflow diversion and influent restriction are supervisor decisions.\n5. Inspect overflow channel is clear.` },
  { key: 'ph', title: 'SOP-DIS-04 Abnormal discharge pH', kind: 'sop' as const, assetType: 'analyzer' as const, body: `Purpose: respond to discharge pH outside 6.5 - 8.5.\n\n1. Check the analyzer status and last calibration. Compare with a handheld pH meter on a grab sample.\n2. Check upstream pH at the equalization tank (AIT-101) to locate the source.\n3. Inform the supervisor immediately; discharge diversion is a supervisor decision under the consent conditions.\n4. Take and label a grab sample for the laboratory.` },
  { key: 'do', title: 'SOP-AER-03 Low dissolved oxygen in aeration', kind: 'troubleshooting' as const, assetType: 'blower' as const, body: `Purpose: restore aeration when dissolved oxygen falls below 1.2 mg/L.\n\n1. Check blower BL-102 running status and motor current. Zero current indicates a trip.\n2. Check inlet filter differential indicator.\n3. Inspect diffuser grid surface for uneven bubbling.\n4. Report a blower trip to the supervisor; restart only by authorised personnel after the trip cause is identified.` },
  { key: 'loto', title: 'SAFE-01 Lockout / tagout essentials', kind: 'safety' as const, assetType: null, body: `Before any hands-on work on rotating equipment or chemical pumps:\n\n1. Obtain a permit to work.\n2. Isolate electrical supply at the local isolator and apply your personal lock and tag.\n3. Isolate and drain process lines; relieve stored pressure.\n4. Verify zero energy by attempting a start from the local panel.\n5. Remove locks only when work is complete and the area is clear.` },
  { key: 'dosing', title: 'SOP-DOS-05 Dosing pump diaphragm inspection', kind: 'sop' as const, assetType: 'dosing_pump' as const, body: `1. Apply lockout/tagout (SAFE-01). Wear face shield and chemical-resistant gloves.\n2. Flush the pump head with water before opening.\n3. Inspect the diaphragm for cracks, swelling or chemical attack. Replace if any damage is found.\n4. Check suction and discharge check valve balls and seats.\n5. Reassemble, restore, and verify dosing rate with the calibration column.` },
];

export interface DemoSeedResult { orgId: string; siteId: string; users: Record<string, string> }

export async function seedDemo(db: Db, password: string, opts: { historyHours?: number } = {}): Promise<DemoSeedResult> {
  const hash = await hashPassword(password);
  const historyHours = opts.historyHours ?? 24;
  const existing = await withSystem(db, async (tx) => (await tx.select().from(organizations).where(eq(organizations.slug, 'riverbend-demo')))[0]);
  if (existing) {
    const s = await withTenant(db, existing.id, async (tx) => (await tx.select().from(sites).limit(1))[0]!);
    const us = await withSystem(db, (tx) => tx.select({ id: users.id, email: users.email }).from(users).where(sql`${users.email} like ${'%@' + DEMO_DOMAIN}`));
    return { orgId: existing.id, siteId: s.id, users: Object.fromEntries(us.map((u) => [u.email.split('@')[0]!, u.id])) };
  }

  const userIds: Record<string, string> = {};
  const orgId = await withSystem(db, async (tx) => {
    const [org] = await tx.insert(organizations).values({ name: 'Riverbend Process Industries (Demo)', slug: 'riverbend-demo', isDemo: true, region: 'Tamil Nadu, IN', timezone: 'Asia/Kolkata' }).returning();
    for (const u of DEMO_USERS) {
      const [row] = await tx.insert(users).values({ email: demoEmail(u.key), name: u.name, passwordHash: hash, emailVerifiedAt: new Date(), defaultOrgId: org!.id }).returning();
      userIds[u.key] = row!.id;
      await tx.insert(memberships).values({ orgId: org!.id, userId: row!.id, role: u.role, title: u.title });
    }
    return org!.id;
  });

  const siteId = await withTenant(db, orgId, async (tx) => {
    const W = 120, H = 80;
    const [site] = await tx.insert(sites).values({ orgId, name: SIM_PLANT.site.name, code: SIM_PLANT.site.code, city: 'Chennai', country: 'India', lat: 13.0827, lng: 80.2707, timezone: 'Asia/Kolkata', layoutWidthM: W, layoutHeightM: H }).returning();
    const [fac] = await tx.insert(facilities).values({ orgId, siteId: site!.id, ...SIM_PLANT.facility, capacityM3PerDay: 3000, description: 'Physico-chemical and activated-sludge effluent treatment for the textile processing units.' }).returning();
    const polygons: Record<string, [number, number][]> = {
      EQ: [[6, 10], [44, 10], [44, 40], [6, 40]], AER: [[50, 6], [82, 6], [82, 40], [50, 40]], DOS: [[30, 46], [62, 46], [62, 62], [30, 62]],
      CLR: [[68, 44], [100, 44], [100, 62], [68, 62]], DIS: [[86, 64], [116, 64], [116, 78], [86, 78]],
    };
    const areaIds: Record<string, string> = {};
    for (const [i, a] of SIM_PLANT.areas.entries()) {
      const [row] = await tx.insert(processAreas).values({ orgId, siteId: site!.id, facilityId: fac!.id, ...a, sortOrder: i, polygon: polygons[a.code] }).returning();
      areaIds[a.code] = row!.id;
    }
    const specs: Record<string, Record<string, string | number>> = {
      'P-101': { 'Rated flow': '140 m³/h', 'Rated head': '24 m', 'Motor': '15 kW / 28 A', 'Vibration limit': '4.5 mm/s RMS' },
      'BL-102': { 'Type': 'Twin-lobe roots', 'Motor': '30 kW / 56 A', 'Air flow': '1,150 Nm³/h' },
      'DP-301': { 'Type': 'Diaphragm metering', 'Max rate': '0.6 m³/h', 'Chemical': 'Poly-aluminium chloride' },
      'T-101': { 'Volume': '850 m³', 'Usable height': '5.2 m' },
    };
    const mfg: Record<string, [string, string]> = { 'P-101': ['Kirloskar', 'KPD 100/26'], 'BL-102': ['Everest', 'TRB-125'], 'DP-301': ['Milton Roy', 'MRoy B'], 'AN-501': ['Endress+Hauser', 'Liquiline CM44'], 'CL-401': ['In-house', 'Ø 18 m'] };
    const assetIds: Record<string, string> = {};
    for (const a of SIM_PLANT.assets) {
      const [row] = await tx.insert(assets).values({
        orgId, siteId: site!.id, facilityId: fac!.id, processAreaId: areaIds[a.area], tag: a.tag, name: a.name, type: a.type, criticality: a.criticality,
        manufacturer: mfg[a.tag]?.[0], model: mfg[a.tag]?.[1], specs: specs[a.tag] ?? {}, positionX: (a.x / 100) * W, positionY: (a.y / 100) * H, installedOn: '2021-03-15',
      }).returning();
      assetIds[a.tag] = row!.id;
    }
    const sensorIds: Record<string, string> = {};
    for (const s of SIM_PLANT.sensors) {
      const [row] = await tx.insert(sensors).values({
        orgId, siteId: site!.id, assetId: assetIds[s.assetTag], processAreaId: areaIds[SIM_PLANT.assets.find((a) => a.tag === s.assetTag)!.area],
        tag: s.tag, name: `${MEASURAND_DEFS[s.measurand].label} ${s.assetTag}`, measurand: s.measurand, unit: MEASURAND_DEFS[s.measurand].unit, method: 'continuous', expectedIntervalS: 5, sourceRef: `ETP01.${s.tag}`,
      }).returning();
      sensorIds[s.tag] = row!.id;
    }
    // Laboratory parameters: defined with their real provenance; no values are invented.
    for (const m of ['cod', 'bod', 'tss'] as const) {
      await tx.insert(sensors).values({ orgId, siteId: site!.id, assetId: assetIds['AN-501'], processAreaId: areaIds.DIS, tag: `LAB-${m.toUpperCase()}`, name: `${MEASURAND_DEFS[m].label} (lab)`, measurand: m, unit: MEASURAND_DEFS[m].unit, method: 'lab', expectedIntervalS: 86400 });
    }
    const docIds: Record<string, string> = {};
    for (const d of SOPS) {
      const [row] = await tx.insert(documents).values({ orgId, title: d.title, kind: d.kind, assetType: d.assetType, body: d.body, status: 'approved', approvedBy: userIds.manager, approvedAt: new Date(), createdBy: userIds.manager, tags: [d.key] }).returning();
      docIds[d.key] = row!.id;
    }
    const proc: Record<string, { doc: string; action: string }> = {
      'VT-101': { doc: 'vib', action: 'Verify with handheld meter, check suction conditions, inform supervisor above 7.1 mm/s.' },
      'VT-102': { doc: 'do', action: 'Check blower inlet filter and belt condition.' },
      'LT-101': { doc: 'level', action: 'Confirm P-101 is transferring; inform supervisor above 85 %.' },
      'AIT-501': { doc: 'ph', action: 'Verify with grab sample and handheld meter; inform supervisor.' },
      'DO-201': { doc: 'do', action: 'Check BL-102 status and motor current; report trips to supervisor.' },
      'AIT-502': { doc: 'ph', action: 'Check clarifier for sludge carry-over.' },
    };
    for (const t of SIM_PLANT.thresholds) {
      await tx.insert(alarmRules).values({
        orgId, siteId: site!.id, sensorId: sensorIds[t.sensorTag]!, name: `${t.sensorTag} ${t.condition.replace('_', '-')}`, condition: t.condition, threshold: t.threshold,
        deadband: t.sensorTag.startsWith('AIT') ? 0.1 : t.sensorTag === 'LT-101' ? 2 : 0.3, onDelayS: 0, severity: t.severity,
        recommendedAction: proc[t.sensorTag]?.action, procedureDocumentId: proc[t.sensorTag] ? docIds[proc[t.sensorTag]!.doc] : null, createdBy: userIds.manager,
      });
    }
    for (const tag of ['CT-102', 'AIT-501']) {
      await tx.insert(alarmRules).values({ orgId, siteId: site!.id, sensorId: sensorIds[tag]!, name: `${tag} no data`, condition: 'stale', severity: 'medium', recommendedAction: 'Check instrument power and gateway connectivity.', createdBy: userIds.manager });
    }
    const tplIds: Record<string, string> = {};
    const tpls: { key: string; name: string; assetType: 'pump' | 'blower' | 'dosing_pump' | 'tank' | 'analyzer'; steps: InspectionStep[]; minutes: number; safety: string[] }[] = [
      { key: 'pump_routine', name: 'Pump routine inspection', assetType: 'pump', steps: steps.pump, minutes: 8, safety: ['Hearing protection required in the pump house.', 'Do not touch rotating parts or remove guards.'] },
      { key: 'blower_routine', name: 'Blower routine inspection', assetType: 'blower', steps: steps.blower, minutes: 6, safety: ['Blower casing can exceed 80 °C.'] },
      { key: 'dosing_pm', name: 'Dosing pump preventive check', assetType: 'dosing_pump', steps: steps.dosing, minutes: 25, safety: ['Corrosive chemical: face shield and gloves.', 'Lockout/tagout required (SAFE-01).'] },
      { key: 'tank_check', name: 'Tank walk-down', assetType: 'tank', steps: steps.tank, minutes: 4, safety: ['Stay behind handrails at tank edges.'] },
      { key: 'analyzer_verification', name: 'Analyzer verification', assetType: 'analyzer', steps: steps.analyzer, minutes: 15, safety: ['Buffer solutions are mild irritants.'] },
    ];
    for (const t of tpls) {
      const [row] = await tx.insert(inspectionTemplates).values({ orgId, key: t.key, name: t.name, assetType: t.assetType, steps: t.steps, safetyNotices: t.safety, estimatedMinutes: t.minutes, createdBy: userIds.manager }).returning();
      tplIds[t.key] = row!.id;
    }
    const [route] = await tx.insert(inspectionRoutes).values({ orgId, siteId: site!.id, name: 'Morning round · ETP-01', description: 'Daily walk-down from equalization to final discharge.', assetIds: SIM_PLANT.assets.map((a) => assetIds[a.tag]!), createdBy: userIds.supervisor }).returning();
    const now = Date.now();
    await tx.insert(inspections).values([
      { orgId, siteId: site!.id, assetId: assetIds['P-101'], templateId: tplIds.pump_routine, templateVersion: 1, title: 'Pump routine inspection · P-101', steps: steps.pump, safetyNotices: tpls[0]!.safety, assignedTo: userIds.operator, assignedBy: userIds.supervisor, dueAt: new Date(now + 3 * 3600_000), routeId: route!.id },
      { orgId, siteId: site!.id, assetId: assetIds['T-101'], templateId: tplIds.tank_check, templateVersion: 1, title: 'Tank walk-down · T-101', steps: steps.tank, safetyNotices: tpls[3]!.safety, assignedTo: userIds.operator, assignedBy: userIds.supervisor, dueAt: new Date(now + 5 * 3600_000), routeId: route!.id },
      { orgId, siteId: site!.id, assetId: assetIds['AN-501'], templateId: tplIds.analyzer_verification, templateVersion: 1, title: 'Analyzer verification · AN-501', steps: steps.analyzer, safetyNotices: tpls[4]!.safety, assignedTo: userIds.operator2, assignedBy: userIds.supervisor, dueAt: new Date(now - 2 * 3600_000), priority: 'high' },
    ]);
    await tx.insert(maintenanceTasks).values([
      { orgId, siteId: site!.id, assetId: assetIds['BL-102'], title: 'Replace BL-102 inlet filter element', kind: 'preventive', priority: 'medium', status: 'assigned', assignedTo: userIds.engineer, requestedBy: userIds.supervisor, dueAt: new Date(now + 2 * 86400_000), checklist: [{ id: 'a', label: 'Isolate blower (SAFE-01)', done: false }, { id: 'b', label: 'Replace filter element', done: false }, { id: 'c', label: 'Record differential after restart', done: false }] },
      { orgId, siteId: site!.id, assetId: assetIds['CL-401'], title: 'Scraper drive gearbox oil top-up', kind: 'preventive', priority: 'low', status: 'open', requestedBy: userIds.supervisor },
    ]);

    // Labelled synthetic history so trends are visible in the demo tenant.
    if (historyHours > 0) {
      const stepMs = 5 * 60_000;
      const n = Math.floor((historyHours * 3600_000) / stepMs);
      const rows: (typeof telemetryReadings.$inferInsert)[] = [];
      for (const s of SIM_PLANT.sensors) {
        for (let i = n; i >= 1; i--) {
          const v = scenarioValue('normal_operations', s.tag, n - i);
          if (v === null) continue;
          rows.push({ orgId, sensorId: sensorIds[s.tag]!, ts: new Date(now - i * stepMs), value: v, source: 'simulator', synthetic: true, messageId: `seed:${s.tag}:${i}` });
        }
      }
      for (let i = 0; i < rows.length; i += 1000) await tx.insert(telemetryReadings).values(rows.slice(i, i + 1000));
      for (const s of SIM_PLANT.sensors) {
        await tx.update(sensors).set({ lastValue: scenarioValue('normal_operations', s.tag, n - 1), lastTs: new Date(now - stepMs), lastQuality: 'good', lastSource: 'simulator', lastReceivedAt: new Date() })
          .where(and(eq(sensors.id, sensorIds[s.tag]!)));
      }
    }
    // Start the continuous synthetic baseline so the demo tenant shows live (labelled) data.
    await tx.insert(simulationRuns).values({ orgId, siteId: site!.id, scenarioKey: 'normal_operations', startedBy: userIds.manager });
    return site!.id;
  });

  return { orgId, siteId, users: userIds };
}

export type { Tx };
