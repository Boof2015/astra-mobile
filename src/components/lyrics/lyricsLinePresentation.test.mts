import assert from 'node:assert/strict';
import test from 'node:test';
import { sameLyricsLinePresentation as same, type LyricsLinePresentation } from './lyricsLinePresentation.ts';

const line: LyricsLinePresentation = {
  line: { timestampMs: 1000, text: 'A test line' },
  tier: 'distant', baseSize: 22, roomy: true, browsing: false,
  activeTimeSeconds: null, wordTimingEnabled: true, furiganaEnabled: true,
  translationsEnabled: true, translationPriority: ['en'], voiceLabelsEnabled: true,
};

test('manual browsing updates inactive rows even when their playback tier stays the same', () => {
  const browsing = { ...line, browsing: true };
  assert.equal(same(line, browsing), false);
  assert.equal(same(browsing, line), false);
});

test('unchanged inactive rows remain memoized while reading layout changes invalidate them', () => {
  assert.equal(same(line, { ...line }), true);
  assert.equal(same(line, { ...line, roomy: false }), false);
  assert.equal(same(line, { ...line, baseSize: 26 }), false);
});

test('active word timing and reading aids continue to invalidate lyric rows', () => {
  const active = { ...line, tier: 'active' as const, activeTimeSeconds: 1 };
  assert.equal(same(active, { ...active, activeTimeSeconds: 1.1 }), false);
  for (const setting of ['furiganaEnabled', 'translationsEnabled', 'wordTimingEnabled', 'voiceLabelsEnabled'] as const) {
    assert.equal(same(line, { ...line, [setting]: false }), false);
  }
  assert.equal(same(line, { ...line, translationPriority: ['ja-Latn'] }), false);
});
