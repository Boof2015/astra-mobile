import assert from 'node:assert/strict';
import test from 'node:test';
import { downsampleWaveform, normalizeProgressiveWaveform } from './waveformMath.ts';

const TOTAL = 512;

test('an empty progressive prefix leaves the waveform empty', () => {
  const progressive = normalizeProgressiveWaveform(new Float32Array(0), TOTAL);
  assert.equal(progressive.length, TOTAL);
  assert.ok(progressive.every((value) => value === 0));
});

test('progressive prefix normalizes against its current maximum', () => {
  const prefix = Float32Array.from([0.01, 0.02, 0.04]); // raw RMS, tiny absolute values
  const progressive = normalizeProgressiveWaveform(prefix, TOTAL);
  assert.ok(Math.abs(progressive[2] - 1) < 1e-6, 'loudest decoded bin should reach full scale');
  assert.ok(Math.abs(progressive[0] - 0.25) < 1e-6);
  assert.equal(progressive[3], 0, 'undecoded tail stays empty');
});

test('progressive waveform never exceeds full scale', () => {
  const prefix = Float32Array.from([5, 10, 2]);
  const progressive = normalizeProgressiveWaveform(prefix, TOTAL);
  for (let i = 0; i < progressive.length; i++) {
    assert.ok(progressive[i] <= 1, `bin ${i} exceeded 1: ${progressive[i]}`);
    assert.ok(progressive[i] >= 0, `bin ${i} went negative: ${progressive[i]}`);
  }
});

test('an all-silent progressive prefix remains empty', () => {
  const progressive = normalizeProgressiveWaveform(new Float32Array(64), TOTAL);
  assert.ok(progressive.every((value) => value === 0));
});

test('downsample is unchanged for a fully accurate waveform', () => {
  const source = Float32Array.from({ length: TOTAL }, (_, i) => (i < TOTAL / 2 ? 0.2 : 1));
  const bars = downsampleWaveform(source, 32);
  assert.equal(bars.length, 32);
  assert.ok(Math.abs(bars[31] - 1) < 1e-6, 'loudest bar normalizes to full scale');
  assert.ok(bars[0] < 0.1, 'x^2 power curve should push the quiet region well down');
});
