import assert from 'node:assert/strict';
import test from 'node:test';
import type { EQBand } from '../types/audio.ts';
import {
  computeCombinedEQMagnitude,
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

test('shelf filters ignore Q like Web Audio BiquadFilterNode', () => {
  const lowLoose = band({ type: 'lowshelf', frequency: 100, gain: 6, Q: 0.1 });
  const lowTight = band({ type: 'lowshelf', frequency: 100, gain: 6, Q: 18 });
  const highLoose = band({ type: 'highshelf', frequency: 8000, gain: -4, Q: 0.1 });
  const highTight = band({ type: 'highshelf', frequency: 8000, gain: -4, Q: 18 });

  assertCoefficientsClose(
    computeEQFilterCoefficients(lowLoose, 48000),
    computeEQFilterCoefficients(lowTight, 48000)
  );
  assertCoefficientsClose(
    computeEQFilterCoefficients(highLoose, 48000),
    computeEQFilterCoefficients(highTight, 48000)
  );
  assertClose(
    computeEQFilterMagnitude(lowLoose, 40, 48000),
    computeEQFilterMagnitude(lowTight, 40, 48000)
  );
  assertClose(
    computeEQFilterMagnitude(highLoose, 12000, 48000),
    computeEQFilterMagnitude(highTight, 12000, 48000)
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
