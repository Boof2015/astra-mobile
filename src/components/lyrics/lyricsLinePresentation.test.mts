import assert from 'node:assert/strict';
import test from 'node:test';
import { sameLyricsLinePresentation as same, type LyricsLinePresentation } from './lyricsLinePresentation.ts';
import { DEFAULT_LYRICS_DISPLAY_SETTINGS } from '../../lyrics/displaySettings.ts';

const line: LyricsLinePresentation = {
  line: { timestampMs: 1000, text: 'A test line' }, size: 22, width: 340,
  right: false, label: null, warm: false, reduced: false,
  settings: { ...DEFAULT_LYRICS_DISPLAY_SETTINGS }, onSeek: () => {},
};

test('UI clock ticks never invalidate the React text presentation', () => {
  const clock = { value: 1 } as NonNullable<LyricsLinePresentation['clock']>;
  const active = { ...line, clock };
  clock.value = 1.3;
  assert.equal(same(active, { ...active }), true);
  assert.equal(same(active, { ...active, clock: undefined }), false);
  assert.equal(same(line, active), false);
});

test('layout, singer, animation eligibility and reading aids invalidate text', () => {
  assert.equal(same(line, { ...line }), true);
  for (const next of [
    { size: 26 }, { width: 500 }, { right: true }, { label: 'Singer B' },
    { warm: true }, { reduced: true }, { settings: { ...line.settings, furiganaEnabled: false } },
    { settings: { ...line.settings, wordTimingEnabled: false } },
    { settings: { ...line.settings, translationsEnabled: false } },
    { settings: { ...line.settings, voiceLabelsEnabled: true } },
    { settings: { ...line.settings, translationPriority: ['ja-Latn'] } },
  ]) assert.equal(same(line, { ...line, ...next }), false);
});

test('memoization cannot retain a stale track or seek callback', () => {
  assert.equal(same(line, { ...line, line: { ...line.line, timestampMs: 2000 } }), false);
  assert.equal(same(line, { ...line, onSeek: () => {} }), false);
});
