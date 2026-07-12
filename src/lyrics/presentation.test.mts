import assert from 'node:assert/strict';
import test from 'node:test';
import type { LyricsLine, LyricsPayload } from './types.ts';
import {
  findActiveSyncedLineIndex,
  getActiveSyncedLyricsLine,
  getCompensatedLyricsTime,
  getLyricsLineSeekTimeSeconds,
  getLyricsMetaChipText,
  getPreferredLyricsTranslation,
  getSyncedLyricsDisplayLines,
  resolveSyncedLyricsTiming,
} from './presentation.ts';

function lines(): LyricsLine[] {
  return [
    { timestampMs: 0, text: 'A' },
    { timestampMs: 1000, text: 'B' },
    { timestampMs: 2000, text: 'C' },
  ];
}

test('active line resolves to the cue at or before the playback time', () => {
  assert.equal(findActiveSyncedLineIndex(lines(), 0.5), 0);
  assert.equal(findActiveSyncedLineIndex(lines(), 1.2), 1);
  assert.equal(findActiveSyncedLineIndex(lines(), 2.9), 2);
});

test('before the first cue there is no active line', () => {
  const timing = resolveSyncedLyricsTiming(
    [
      { timestampMs: 5000, text: 'later' },
    ],
    1
  );
  assert.equal(timing.activeLineIndex, -1);
  assert.equal(timing.isNeutral, true);
});

test('a long instrumental gap inserts a synthetic gap row and neutralizes', () => {
  const withGap: LyricsLine[] = [
    { timestampMs: 0, text: 'A' },
    { timestampMs: 20000, text: 'B' },
  ];
  const display = getSyncedLyricsDisplayLines(withGap);
  assert.ok(display.some((row) => row.kind === 'gap'));

  // 6s in (past the 4s post-line hold, within the 10s+ gap) → neutral.
  const timing = resolveSyncedLyricsTiming(withGap, 6);
  assert.equal(timing.activeLineIndex, -1);
  assert.equal(timing.isNeutral, true);
  assert.equal(getActiveSyncedLyricsLine(withGap, 6), null);
});

test('compact lyric peek resolves the raw active cue', () => {
  assert.equal(getActiveSyncedLyricsLine(lines(), 1.2)?.text, 'B');
  assert.equal(
    getActiveSyncedLyricsLine([{ timestampMs: 5000, text: 'later' }], 1),
    null
  );
});

test('translation selection honors the language priority list', () => {
  const line: LyricsLine = {
    timestampMs: 0,
    text: 'x',
    translations: [
      { lang: 'ja-Latn', text: 'romaji' },
      { lang: 'en', text: 'english' },
    ],
  };
  assert.equal(getPreferredLyricsTranslation(line, ['en', 'ja-Latn'])?.text, 'english');
  assert.equal(getPreferredLyricsTranslation(line, ['ja-Latn'])?.text, 'romaji');
  assert.equal(getPreferredLyricsTranslation(line, ['fr'])?.text, 'romaji'); // falls back to first
});

test('seek + compensation math clamp to duration', () => {
  assert.equal(getLyricsLineSeekTimeSeconds(1500, 200, 0), 1.5);
  assert.equal(getLyricsLineSeekTimeSeconds(1500, 1, 0), 1); // clamped to duration
  assert.equal(getCompensatedLyricsTime(10, 200, 500), 9.5); // 500ms delay subtracted
  assert.equal(getCompensatedLyricsTime(0.2, 200, 500), 0); // never negative
});

function hit(source: LyricsPayload['source'], format: LyricsPayload['format'], cached: boolean) {
  const lyrics: LyricsPayload = {
    source,
    provider: source === 'xlrcdb' ? 'xlrcdb' : 'lrclib',
    format,
    plainLyrics: 'x',
    syncedLyrics: 'x',
    syncedLines: [{ timestampMs: 0, text: 'x' }],
  };
  return { status: 'hit' as const, lyrics, cached };
}

test('meta chip reflects source, sync, and cache state', () => {
  assert.equal(
    getLyricsMetaChipText({ hasTrack: true, result: hit('lrclib', 'lrc', false), hasSyncedLyrics: true, isLoading: false }),
    'LRCLIB • Synced'
  );
  assert.equal(
    getLyricsMetaChipText({ hasTrack: true, result: hit('xlrcdb', 'xlrc', true), hasSyncedLyrics: true, isLoading: false }),
    'XLRCDB • Synced • Cached'
  );
  assert.equal(
    getLyricsMetaChipText({ hasTrack: true, result: null, hasSyncedLyrics: false, isLoading: true }),
    'Loading'
  );
  assert.equal(
    getLyricsMetaChipText({
      hasTrack: true,
      result: { status: 'not_found', reason: 'provider-not-found' },
      hasSyncedLyrics: false,
      isLoading: false,
    }),
    'Not Found'
  );
});
