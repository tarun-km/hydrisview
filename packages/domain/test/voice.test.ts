import { test } from 'node:test';
import assert from 'node:assert/strict';
import { afterWake, detectMeasurand, WAKE_RE } from '../src/voice';

test('wake phrase variants and the question after it', () => {
  assert.equal(afterWake('Hey Hydris, what is the current pH value?'), 'what is the current pH value?');
  assert.equal(afterWake('hey hydras'), '');
  assert.equal(afterWake('okay hi dris any alarms'), 'any alarms');
  assert.equal(afterWake('the hydraulic pump is noisy'), null);
  assert.ok(!WAKE_RE.test('pH is fine'));
});

test('measurand detection prefers specific phrases and ignores filler words', () => {
  assert.equal(detectMeasurand('what is the current pH value'), 'ph');
  assert.equal(detectMeasurand('hey hydris dissolved oxygen in the aeration tank'), 'dissolved_oxygen');
  assert.equal(detectMeasurand('residual chlorine at the outlet'), 'residual_chlorine');
  assert.equal(detectMeasurand('motor current on the blower'), 'motor_current');
  assert.equal(detectMeasurand('how are you'), null);
});
