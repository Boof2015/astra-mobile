import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_LYRICS_DISPLAY_SETTINGS,
  normalizeLyricsDisplaySettings,
  normalizeLyricsLanguagePriority,
} from './displaySettings.ts';

test('lyrics display settings default safely for upgraded installs', () => {
  assert.deepEqual(normalizeLyricsDisplaySettings(null), DEFAULT_LYRICS_DISPLAY_SETTINGS);
  assert.deepEqual(normalizeLyricsDisplaySettings({}), DEFAULT_LYRICS_DISPLAY_SETTINGS);
});

test('lyrics display settings preserve explicit disabled layers and voice labels', () => {
  assert.deepEqual(normalizeLyricsDisplaySettings({
    wordTimingEnabled: false,
    furiganaEnabled: false,
    translationsEnabled: false,
    translationPriority: ['fr'],
    voiceLabelsEnabled: true,
  }), {
    wordTimingEnabled: false,
    furiganaEnabled: false,
    translationsEnabled: false,
    translationPriority: ['fr'],
    voiceLabelsEnabled: true,
  });
});

test('language priority trims, deduplicates case-insensitively, and restores defaults when empty', () => {
  assert.deepEqual(normalizeLyricsLanguagePriority(' en, ja-Latn, EN, fr , '), ['en', 'ja-Latn', 'fr']);
  assert.deepEqual(normalizeLyricsLanguagePriority(' , '), ['en', 'ja-Latn']);
});
