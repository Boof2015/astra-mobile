import assert from 'node:assert/strict';
import test from 'node:test';
import { dbToLinear, type LoudnessFacts, type NormalizationSettings } from './normalization.ts';
import {
  resolveFastStartupFallback,
  resolveStartupTargetGain,
} from './dspStartupGain.ts';

const enabled: NormalizationSettings = {
  enabled: true,
  targetLufs: -12,
  replayGainEnabled: false,
  replayGainMode: 'auto',
};

const emptyFacts: LoudnessFacts = {
  loudnessLufs: null,
  samplePeak: null,
  replayGainTrackDb: null,
  replayGainAlbumDb: null,
  replayGainTrackPeak: null,
  replayGainAlbumPeak: null,
};

test('cold fallback is conservative and clamps a stale loud persisted value', () => {
  assert.equal(resolveFastStartupFallback(enabled, null), dbToLinear(-3));
  assert.equal(resolveFastStartupFallback(enabled, 1), dbToLinear(-3));
});

test('normalization off reaches unity only from loaded disabled settings', () => {
  const disabled = { ...enabled, enabled: false };
  assert.deepEqual(resolveStartupTargetGain('local', emptyFacts, disabled, 0.5), {
    linearGain: 1,
    source: 'disabled',
  });
  assert.equal(resolveFastStartupFallback(disabled, 0.5), 1);
});

test('an analyzed local track uses exact stored gain', () => {
  const facts = { ...emptyFacts, loudnessLufs: -8 };
  assert.deepEqual(resolveStartupTargetGain('local', facts, enabled, 0.5), {
    linearGain: dbToLinear(-4),
    source: 'stored',
  });
});

test('an unanalyzed local track uses fallback while remote tracks stay unity', () => {
  assert.deepEqual(resolveStartupTargetGain('local', emptyFacts, enabled, 0.5), {
    linearGain: 0.5,
    source: 'fallback',
  });
  assert.deepEqual(resolveStartupTargetGain('remote', null, enabled, 0.5), {
    linearGain: 1,
    source: 'remote',
  });
});
