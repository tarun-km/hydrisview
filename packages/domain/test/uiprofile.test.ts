import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_UI_PROFILE_CONFIG, applyMeasurementProfile, diffUiProfileConfigs, normalizeUiProfileConfig, resolveUiAssignment, screenEnabled } from '../src/index.js';

test('ui profile: precedence device > user > role > org, unusable profiles fall through', () => {
  const as = [
    { scope: 'org' as const, profileId: 'O' },
    { scope: 'role' as const, profileId: 'R', role: 'field_operator' as const },
    { scope: 'user' as const, profileId: 'U', userId: 'u1' },
    { scope: 'device' as const, profileId: 'D', deviceId: 'd1' },
  ];
  assert.equal(resolveUiAssignment(as, { deviceId: 'd1', userId: 'u1', role: 'field_operator' })?.profileId, 'D');
  assert.equal(resolveUiAssignment(as, { deviceId: 'd2', userId: 'u1', role: 'field_operator' })?.profileId, 'U');
  assert.equal(resolveUiAssignment(as, { userId: 'u2', role: 'field_operator' })?.profileId, 'R');
  assert.equal(resolveUiAssignment(as, { userId: 'u2', role: 'supervisor' })?.profileId, 'O');
  assert.equal(resolveUiAssignment(as, { deviceId: 'd1' }, (id) => id !== 'D')?.profileId, 'O');
  assert.equal(resolveUiAssignment([], { deviceId: 'd1' }), null);
});

test('ui profile: normalization keeps required screens and fills defaults', () => {
  const c = normalizeUiProfileConfig({ screens: [{ id: 'status', enabled: false }, { id: 'map', enabled: false }, { id: 'bogus' }], measurements: { allow: ['ph', 'nope'] }, layout: { textScale: 9 } });
  assert.ok(screenEnabled(c, 'status'));
  assert.ok(!screenEnabled(c, 'map'));
  assert.equal(c.screens[0]!.id, 'status');
  assert.equal(c.screens.length, DEFAULT_UI_PROFILE_CONFIG.screens.length);
  assert.deepEqual(c.measurements.allow, ['ph']);
  assert.equal(c.layout.textScale, 1.4);
  assert.deepEqual(normalizeUiProfileConfig(undefined), DEFAULT_UI_PROFILE_CONFIG);
});

test('ui profile: measurement filter/order and diff summary', () => {
  const c = normalizeUiProfileConfig({ measurements: { allow: ['vibration', 'pressure'], orderByAssetType: { pump: ['pressure'] } } });
  const rows = applyMeasurementProfile(c, [{ measurand: 'vibration' }, { measurand: 'ph' }, { measurand: 'pressure' }], 'pump');
  assert.deepEqual(rows.map((r) => r.measurand), ['pressure', 'vibration']);
  const d = diffUiProfileConfigs(DEFAULT_UI_PROFILE_CONFIG, { actions: { acknowledge_alarm: false } });
  assert.deepEqual(d, ['Blocked action: Acknowledge alarms']);
});
