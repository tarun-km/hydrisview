import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALARM_TRANSITIONS,
  ROLES,
  SCENARIO_KEYS,
  SIM_PLANT,
  assignableRoles,
  isAllowedSignupEmail,
  mapLegacyRole,
  parseSignupDomains,
  can,
  canTransitionAlarm,
  canTransitionInspection,
  canTransitionMaintenance,
  deriveDeviceState,
  evaluateThreshold,
  formatPairingCode,
  freshness,
  inspectionProgress,
  isValidPairingCode,
  normalizeMeasurement,
  normalizePairingCode,
  scenarioFrame,
  scenarioValue,
  shouldRaise,
  stepOutcome,
} from '../src/index.js';

test('permission matrix: two account types, least privilege', () => {
  assert.deepEqual([...ROLES], ['admin', 'operator']);
  assert.ok(can('admin', 'member.manage'));
  assert.ok(can('admin', 'console.access'));
  assert.ok(!can('operator', 'console.access'));
  assert.ok(!can('operator', 'member.read'));
  assert.ok(!can('operator', 'alarm.close'));
  assert.ok(can('operator', 'alarm.acknowledge'));
  assert.ok(can('operator', 'inspection.execute'));
  assert.ok(can('operator', 'maintenance.execute'));
  assert.ok(can('operator', 'device.pair'));
  assert.ok(can('operator', 'auditdoc.capture'));
  assert.ok(!can('operator', 'device.manage'));
  assert.ok(!can('operator', 'audit.read'));
  for (const r of ROLES) assert.ok(can(r, 'site.read'), `${r} can read sites`);
});

test('role assignment: only administrators manage people', () => {
  assert.deepEqual(assignableRoles('operator'), []);
  assert.deepEqual(assignableRoles('admin'), ['admin', 'operator']);
});

test('legacy role migration mapping', () => {
  assert.equal(mapLegacyRole('org_admin'), 'admin');
  assert.equal(mapLegacyRole('factory_manager'), 'admin');
  assert.equal(mapLegacyRole('supervisor'), 'admin');
  assert.equal(mapLegacyRole('field_operator'), 'operator');
  assert.equal(mapLegacyRole('maintenance_engineer'), 'operator');
  assert.equal(mapLegacyRole('viewer'), 'operator');
});

test('admin sign-up domain rule', () => {
  const d = parseSignupDomains(undefined);
  assert.deepEqual(d, ['hydris.ai']);
  assert.ok(isAllowedSignupEmail('tarun@hydris.ai', d));
  assert.ok(isAllowedSignupEmail('Tarun@Hydris.AI', d));
  assert.ok(!isAllowedSignupEmail('someone@gmail.com', d));
  assert.ok(!isAllowedSignupEmail('x@evil-hydris.ai', d));
  assert.ok(!isAllowedSignupEmail('x@sub.hydris.ai', d));
  assert.ok(!isAllowedSignupEmail('x@hydris.ai.evil.com', d));
  assert.deepEqual(parseSignupDomains(' @Hydris.ai, acme.com '), ['hydris.ai', 'acme.com']);
});

test('unit normalization converts and validates', () => {
  assert.deepEqual(normalizeMeasurement('temperature', 212, '°F'), { ok: true, value: 100, unit: '°C' });
  const flow = normalizeMeasurement('flow_rate', 10, 'L/s');
  assert.ok(flow.ok && Math.abs(flow.value - 36) < 1e-9);
  assert.deepEqual(normalizeMeasurement('ph', 15, undefined), { ok: false, reason: 'out_of_range' });
  assert.deepEqual(normalizeMeasurement('ph', 7, 'mg/L'), { ok: false, reason: 'unknown_unit' });
  assert.deepEqual(normalizeMeasurement('ph', Number.NaN, 'pH'), { ok: false, reason: 'not_finite' });
});

test('freshness never treats missing data as a value', () => {
  const now = new Date('2026-10-14T10:00:00Z');
  assert.equal(freshness(null, 5, now), 'no_data');
  assert.equal(freshness('2026-10-14T09:59:55Z', 5, now), 'live');
  assert.equal(freshness('2026-10-14T09:59:40Z', 5, now), 'delayed');
  assert.equal(freshness('2026-10-14T09:58:00Z', 5, now), 'stale');
});

test('threshold evaluation with deadband (hysteresis)', () => {
  const rule = { condition: 'high' as const, threshold: 4.5, deadband: 0.3 };
  assert.equal(evaluateThreshold(rule, 4.6, false), 'breach');
  assert.equal(evaluateThreshold(rule, 4.4, false), 'normal');
  assert.equal(evaluateThreshold(rule, 4.4, true), 'holding');
  assert.equal(evaluateThreshold(rule, 4.1, true), 'normal');
  const low = { condition: 'low_low' as const, threshold: 0.6, deadband: 0.1 };
  assert.equal(evaluateThreshold(low, 0.5, false), 'breach');
  assert.equal(evaluateThreshold(low, 0.65, true), 'holding');
});

test('on-delay suppresses transient breaches', () => {
  const t0 = new Date('2026-01-01T00:00:00Z');
  assert.equal(shouldRaise(t0, new Date(t0.getTime() + 5000), 10), false);
  assert.equal(shouldRaise(t0, new Date(t0.getTime() + 10000), 10), true);
  assert.equal(shouldRaise(null, t0, 0), true);
});

test('alarm lifecycle: acknowledgement is not resolution', () => {
  assert.ok(canTransitionAlarm('active', 'acknowledge'));
  assert.ok(!canTransitionAlarm('active', 'close'));
  assert.ok(!canTransitionAlarm('closed', 'acknowledge'));
  assert.ok(canTransitionAlarm('investigating', 'resolve'));
  assert.equal(ALARM_TRANSITIONS.resolve.requiresNote, true);
});

test('inspection and maintenance state machines', () => {
  assert.ok(canTransitionInspection('scheduled', 'start'));
  assert.ok(canTransitionInspection('paused', 'start'));
  assert.ok(!canTransitionInspection('approved', 'submit'));
  assert.ok(canTransitionInspection('submitted', 'reject'));
  assert.ok(canTransitionMaintenance('on_hold', 'start'));
  assert.ok(!canTransitionMaintenance('completed', 'complete'));
});

test('step outcome and progress', () => {
  const steps = [
    { id: 'a', kind: 'reading' as const, title: 'Vibration', required: true, expectedMax: 4.5 },
    { id: 'b', kind: 'check' as const, title: 'Guard in place', required: true },
    { id: 'c', kind: 'text' as const, title: 'Notes', required: false },
  ];
  assert.equal(stepOutcome(steps[0]!, { kind: 'reading', value: 6 }), 'abnormal');
  assert.equal(stepOutcome(steps[1]!, { kind: 'check', checked: true }), 'ok');
  const p = inspectionProgress(steps, new Map([['a', { outcome: 'abnormal' as const }], ['b', { outcome: 'ok' as const }]]));
  assert.equal(p.complete, true);
  assert.equal(p.abnormal, 1);
  assert.equal(p.percent, 67);
});

test('device state derivation', () => {
  const now = new Date('2026-10-14T10:00:00Z');
  assert.equal(deriveDeviceState({ status: 'revoked', assignedUserId: 'u', lastSeenAt: now, streamOpen: true, now }), 'revoked');
  assert.equal(deriveDeviceState({ status: 'active', assignedUserId: 'u', lastSeenAt: null, streamOpen: true, now }), 'connected');
  assert.equal(deriveDeviceState({ status: 'active', assignedUserId: 'u', lastSeenAt: '2026-10-14T09:00:00Z', streamOpen: false, now }), 'disconnected');
  assert.equal(deriveDeviceState({ status: 'active', assignedUserId: null, lastSeenAt: null, streamOpen: false, now }), 'paired');
});

test('pairing codes: format and normalization', () => {
  assert.equal(formatPairingCode('abcd2345'), 'ABCD-2345');
  assert.equal(normalizePairingCode(' abcd-2345 '), 'ABCD2345');
  assert.ok(isValidPairingCode('ABCD-2345'));
  assert.ok(!isValidPairingCode('ABCD-0345'), 'excluded characters invalidate the code');
});

test('scenarios are deterministic and produce expected excursions', () => {
  for (const k of SCENARIO_KEYS) {
    assert.deepEqual(scenarioFrame(k, 37), scenarioFrame(k, 37), `${k} deterministic`);
  }
  const vib = scenarioValue('pump_vibration', 'VT-101', 80)!;
  assert.ok(vib > 7.1, `vibration crosses high-high (${vib})`);
  assert.ok(scenarioValue('normal_operations', 'VT-101', 80)! < 4.5);
  assert.equal(scenarioValue('equipment_offline', 'CT-102', 50), null);
  assert.ok(scenarioValue('abnormal_ph', 'AIT-501', 50)! < 6.5);
  assert.ok(scenarioValue('tank_high_level', 'LT-101', 100)! > 92);
  assert.ok(scenarioValue('high_priority_alert', 'DO-201', 60)! < 0.6);
  for (const s of SIM_PLANT.sensors) {
    for (let step = 0; step < 120; step++) {
      const v = scenarioValue('normal_operations', s.tag, step);
      assert.ok(v !== null && v >= s.min && v <= s.max);
    }
  }
});
