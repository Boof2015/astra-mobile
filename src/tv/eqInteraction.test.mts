import assert from 'node:assert/strict';
import test from 'node:test';
import type { EQBand } from '../types/audio.ts';
import { stepEqBand, stepEqPreamp, stepEqQ, stepEqSlider } from './eqInteraction.ts';

const band: EQBand = { id: 'kept-identity', type: 'peaking', frequency: 1000, gain: 0, Q: 1, enabled: true };
test('grabbed bands move by sixth-octaves and half-decibels without changing identity', () => {
  assert.deepEqual(stepEqBand(band, 'right'), { frequency: 1122 });
  assert.deepEqual(stepEqBand(band, 'left'), { frequency: 891 });
  assert.deepEqual(stepEqBand(band, 'up'), { gain: .5 });
  assert.deepEqual(stepEqBand(band, 'down'), { gain: -.5 });
  assert.deepEqual(stepEqBand({ ...band, frequency: 19999 }, 'right'), { frequency: 20000 });
  assert.deepEqual(stepEqBand({ ...band, frequency: 20 }, 'left'), { frequency: 20 });
  assert.deepEqual(stepEqBand({ ...band, gain: 12 }, 'up'), { gain: 12 });
  assert.deepEqual(stepEqBand({ ...band, gain: -12 }, 'down'), { gain: -12 });
  assert.equal(band.id, 'kept-identity');
});
test('pass filters ignore vertical gain edits but keep frequency adjustment', () => {
  for (const type of ['highpass', 'lowpass'] as const) {
    assert.deepEqual(stepEqBand({ ...band, type }, 'up'), {});
    assert.deepEqual(stepEqBand({ ...band, type }, 'down'), {});
    assert.equal(stepEqBand({ ...band, type }, 'right').frequency, 1122);
  }
});
test('Q and preamp grabs own arrows without turning vertical navigation into an adjustment', () => {
  assert.equal(stepEqQ(1, 'right'), 1.15);
  assert.equal(stepEqQ(1, 'left'), .87);
  assert.equal(stepEqQ(.1, 'left'), .1);
  assert.equal(stepEqQ(18, 'right'), 18);
  assert.equal(stepEqQ(2, 'up'), 2);
  assert.equal(stepEqPreamp(-3, 'right'), -2.5);
  assert.equal(stepEqPreamp(-12, 'left'), -12);
  assert.equal(stepEqPreamp(12, 'right'), 12);
  assert.equal(stepEqPreamp(3, 'down'), 3);
});
test('graphic adjustment moves between sliders without wrapping or changing the previous gain', () => {
  assert.deepEqual(stepEqSlider(0, 3, 'left', 5), { index: 0, gain: 3 });
  assert.deepEqual(stepEqSlider(4, -3, 'right', 5), { index: 4, gain: -3 });
  assert.deepEqual(stepEqSlider(1, 3, 'right', 5), { index: 2, gain: 3 });
  assert.deepEqual(stepEqSlider(2, 3, 'up', 5), { index: 2, gain: 3.5 });
  assert.deepEqual(stepEqSlider(2, -12, 'down', 5), { index: 2, gain: -12 });
});
