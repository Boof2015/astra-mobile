import assert from 'node:assert/strict';
import test from 'node:test';
import { downsampleWaveform, mergeProgressiveWaveform } from './waveformMath.ts';

const TOTAL = 512;

/** Preview normalized to [0,1] across the whole track, as the native preview returns it. */
function makePreview(values: number[]): Float32Array {
  return Float32Array.from(values);
}

test('merge with no prefix is just the stretched preview', () => {
  const preview = makePreview([0.2, 0.8, 0.4, 1]);
  const merged = mergeProgressiveWaveform(new Float32Array(0), TOTAL, preview);
  assert.equal(merged.length, TOTAL);
  assert.ok(Math.abs(merged[0] - 0.2) < 1e-6);
  assert.ok(Math.abs(merged[TOTAL - 1] - 1) < 1e-6);
  // Each preview value should occupy an equal quarter of the width.
  assert.ok(Math.abs(merged[Math.floor(TOTAL * 0.3)] - 0.8) < 1e-6);
});

test('merge with no preview normalizes the prefix against its own max', () => {
  const prefix = Float32Array.from([0.01, 0.02, 0.04]); // raw RMS, tiny absolute values
  const merged = mergeProgressiveWaveform(prefix, TOTAL, null);
  assert.ok(Math.abs(merged[2] - 1) < 1e-6, 'loudest decoded bin should reach full scale');
  assert.ok(Math.abs(merged[0] - 0.25) < 1e-6);
  assert.equal(merged[3], 0, 'undecoded tail stays empty without a preview');
});

test('prefix is rescaled to the preview, not to its own max', () => {
  // Preview says the first half is quiet (0.25) and the second half is loud (1.0).
  const preview = makePreview([0.25, 0.25, 1, 1]);
  // We have decoded the quiet first half only. Raw RMS values are arbitrary in scale.
  const prefix = new Float32Array(TOTAL / 2).fill(0.003);
  const merged = mergeProgressiveWaveform(prefix, TOTAL, preview);

  // Naive self-normalization would put the decoded half at 1.0 — far louder than the
  // preview says it is, and louder than the not-yet-decoded loud half. It must stay at
  // the preview's amplitude for that region instead.
  assert.ok(Math.abs(merged[0] - 0.25) < 1e-6, `decoded region should match preview scale, got ${merged[0]}`);
  assert.ok(merged[0] < merged[TOTAL - 1], 'quiet decoded half must stay below the loud undecoded half');
  assert.ok(Math.abs(merged[TOTAL - 1] - 1) < 1e-6, 'undecoded tail keeps the preview value');
});

test('merge never exceeds full scale', () => {
  const preview = makePreview([1, 1, 1, 1]);
  const prefix = Float32Array.from([5, 10, 2]);
  const merged = mergeProgressiveWaveform(prefix, TOTAL, preview);
  for (let i = 0; i < merged.length; i++) {
    assert.ok(merged[i] <= 1, `bin ${i} exceeded 1: ${merged[i]}`);
    assert.ok(merged[i] >= 0, `bin ${i} went negative: ${merged[i]}`);
  }
});

test('an all-silent prefix falls back to the preview rather than blanking the bar', () => {
  const preview = makePreview([0.5, 0.6, 0.7, 0.8]);
  const merged = mergeProgressiveWaveform(new Float32Array(64), TOTAL, preview);
  assert.ok(Math.abs(merged[0] - 0.5) < 1e-6);
});

test('downsampling a partially-filled merge keeps the decoded region proportionate', () => {
  // Decoded half is quiet, undecoded half is loud — after downsampling the relationship
  // must survive, i.e. the global normalize must not lift the quiet decoded half.
  const preview = makePreview([0.25, 0.25, 1, 1]);
  const prefix = new Float32Array(TOTAL / 2).fill(0.003);
  const merged = mergeProgressiveWaveform(prefix, TOTAL, preview);

  const bars = downsampleWaveform(merged, 64);
  assert.equal(bars.length, 64);
  const firstQuarter = bars[8];
  const lastQuarter = bars[56];
  assert.ok(
    lastQuarter > firstQuarter * 4,
    `loud half (${lastQuarter}) should dominate the quiet decoded half (${firstQuarter})`
  );
  for (let i = 0; i < bars.length; i++) {
    assert.ok(bars[i] >= 0 && bars[i] <= 1, `bar ${i} out of range: ${bars[i]}`);
  }
});

test('downsample is unchanged for a fully accurate waveform', () => {
  const source = Float32Array.from({ length: TOTAL }, (_, i) => (i < TOTAL / 2 ? 0.2 : 1));
  const bars = downsampleWaveform(source, 32);
  assert.equal(bars.length, 32);
  assert.ok(Math.abs(bars[31] - 1) < 1e-6, 'loudest bar normalizes to full scale');
  assert.ok(bars[0] < 0.1, 'x^2 power curve should push the quiet region well down');
});
