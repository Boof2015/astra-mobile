import assert from 'node:assert/strict';
import test from 'node:test';
import type { EQBand } from '../types/audio.ts';
import {
  EQ_BAND_COLOR_COUNT,
  assignEQBandColors,
  computeCombinedEQMagnitude,
  createNormalizedEQBand,
  nextFreeEQBandColor,
  suggestEQBandFrequency,
  computeEQFilterCoefficients,
  computeEQFilterMagnitude,
  type EQFilterCoefficients,
} from './eq.ts';

function band(overrides: Partial<EQBand> = {}): EQBand {
  return {
    id: overrides.id ?? 'band-1',
    type: overrides.type ?? 'peaking',
    frequency: overrides.frequency ?? 1000,
    gain: overrides.gain ?? 0,
    Q: overrides.Q ?? 1,
    enabled: overrides.enabled ?? true,
    ...(overrides.color !== undefined ? { color: overrides.color } : {}),
  };
}

function assertClose(actual: number, expected: number, tolerance = 1e-6): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`
  );
}

function assertCoefficientsClose(
  actual: EQFilterCoefficients,
  expected: EQFilterCoefficients,
  tolerance = 1e-9
): void {
  assertClose(actual.b0, expected.b0, tolerance);
  assertClose(actual.b1, expected.b1, tolerance);
  assertClose(actual.b2, expected.b2, tolerance);
  assertClose(actual.a1, expected.a1, tolerance);
  assertClose(actual.a2, expected.a2, tolerance);
}

test('peaking filter reaches requested gain at center frequency', () => {
  const boost = band({ type: 'peaking', frequency: 1200, gain: 5.5, Q: 1.25 });

  assertClose(computeEQFilterMagnitude(boost, 1200, 48000), 5.5, 1e-6);
});

test('shelf filters use Q in their coefficients and response', () => {
  const lowWide = band({ type: 'lowshelf', frequency: 100, gain: 6, Q: 0.5 });
  const lowNarrow = band({ type: 'lowshelf', frequency: 100, gain: 6, Q: 2 });
  const highWide = band({ type: 'highshelf', frequency: 8000, gain: -4, Q: 0.5 });
  const highNarrow = band({ type: 'highshelf', frequency: 8000, gain: -4, Q: 2 });

  assertCoefficientsClose(computeEQFilterCoefficients(lowWide, 48000), {
    b0: 1.004523905875,
    b1: -1.978032948597,
    b2: 0.973748440145,
    a1: -1.978092655842,
    a2: 0.978212638774,
  });
  assertCoefficientsClose(computeEQFilterCoefficients(highWide, 48000), {
    b0: 0.746848511923,
    b1: -0.319264680328,
    b2: 0.034120017138,
    a1: -0.641024137473,
    a2: 0.102727986206,
  });

  assert.notDeepEqual(
    computeEQFilterCoefficients(lowWide, 48000),
    computeEQFilterCoefficients(lowNarrow, 48000)
  );
  assert.notDeepEqual(
    computeEQFilterCoefficients(highWide, 48000),
    computeEQFilterCoefficients(highNarrow, 48000)
  );
  assert.ok(
    Math.abs(
      computeEQFilterMagnitude(lowWide, 200, 48000) -
        computeEQFilterMagnitude(lowNarrow, 200, 48000)
    ) > 0.1
  );
  assert.ok(
    Math.abs(
      computeEQFilterMagnitude(highWide, 4000, 48000) -
        computeEQFilterMagnitude(highNarrow, 4000, 48000)
    ) > 0.1
  );
});

test('lowpass and highpass coefficients use Web Audio Q-in-dB semantics', () => {
  assertCoefficientsClose(
    computeEQFilterCoefficients(band({ type: 'lowpass', frequency: 1000, Q: 6 }), 48000),
    {
      b0: 0.004142085705,
      b1: 0.00828417141,
      b2: 0.004142085705,
      a1: -1.920085584611,
      a2: 0.936653927431,
    }
  );
  assertCoefficientsClose(
    computeEQFilterCoefficients(band({ type: 'highpass', frequency: 1000, Q: 6 }), 48000),
    {
      b0: 0.964184878011,
      b1: -1.928369756021,
      b2: 0.964184878011,
      a1: -1.920085584611,
      a2: 0.936653927431,
    }
  );
});

test('combined response skips disabled bands', () => {
  const enabled = band({ id: 'enabled', frequency: 1000, gain: 3, Q: 1, enabled: true });
  const disabled = band({ id: 'disabled', frequency: 1000, gain: 9, Q: 1, enabled: false });

  assertClose(
    computeCombinedEQMagnitude([enabled, disabled], 1000, 48000),
    computeEQFilterMagnitude(enabled, 1000, 48000)
  );
});

test('band colors: valid slots survive normalization, anything else is dropped', () => {
  assert.equal(createNormalizedEQBand({ color: 3 }, 'a').color, 3);
  assert.equal(createNormalizedEQBand({ color: '#FFAA00' }, 'a').color, '#ffaa00');
  for (const bad of [-1, EQ_BAND_COLOR_COUNT, 1.5, '2', '#fff', 'red', null]) {
    assert.equal(createNormalizedEQBand({ color: bad }, 'a').color, undefined, String(bad));
  }
});

test('band colors: stamping fills gaps without moving existing colors', () => {
  const bands = [band({ id: 'a' }), band({ id: 'b', color: 0 }), band({ id: 'c' }), band({ id: 'd', color: 2 })];
  const stamped = assignEQBandColors(bands);
  assert.deepEqual(stamped.map((b) => b.color), [1, 0, 3, 2]);
  // Already complete: the very same array back, so the store sees no change.
  assert.equal(assignEQBandColors(stamped), stamped);
  assert.equal(nextFreeEQBandColor(stamped), 4);
});

test('band colors: a custom color counts as colored but takes no slot', () => {
  const bands = [band({ id: 'a', color: '#ffaa00' }), band({ id: 'b' })];
  assert.deepEqual(assignEQBandColors(bands).map((b) => b.color), ['#ffaa00', 0]);
});

test('band colors: every slot taken wraps instead of failing', () => {
  const full = Array.from({ length: EQ_BAND_COLOR_COUNT }, (_, i) => band({ id: String(i), color: i }));
  const slot = nextFreeEQBandColor(full);
  assert.ok(slot >= 0 && slot < EQ_BAND_COLOR_COUNT);
});

test('new bands go in the widest gap, so repeated adds spread out', () => {
  const bands = [60, 250, 1000, 4000, 12000].map((frequency, i) => band({ id: String(i), frequency }));
  const added: number[] = [];
  for (let i = 0; i < 3; i++) {
    const frequency = suggestEQBandFrequency(bands);
    added.push(frequency);
    bands.push(band({ id: `new-${i}`, frequency }));
  }
  assert.deepEqual(added, [120, 500, 2000]);
  // Every suggestion is new — nothing lands on an existing band.
  assert.equal(new Set(bands.map((b) => b.frequency)).size, bands.length);
});

test('a new band uses the edge gaps too, and stays in range', () => {
  // One band hard against the top leaves the low end as the widest gap.
  assert.equal(suggestEQBandFrequency([band({ frequency: 20000 })]), 630);
  // Stacked bands still leave somewhere sensible to go.
  const stacked = [band({ id: 'a', frequency: 1000 }), band({ id: 'b', frequency: 1000 })];
  const f = suggestEQBandFrequency(stacked);
  assert.ok(f !== 1000 && f >= 20 && f <= 20000);
});
