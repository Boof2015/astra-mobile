import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmbeddedLyricsPayload, isLocalLyricsPath } from './embedded.ts';
import { getLyricsPayloadSourceLabel } from './presentation.ts';

test('plain embedded text becomes an Embedded plain payload', () => {
  const payload = createEmbeddedLyricsPayload({
    status: 'hit',
    text: 'First line\nSecond line',
    syncText: [],
  });

  assert.equal(payload?.source, 'embedded');
  assert.equal(payload?.format, 'plain');
  assert.equal(payload?.plainLyrics, 'First line\nSecond line');
  assert.equal(getLyricsPayloadSourceLabel(payload!), 'Embedded');
});

test('timestamped text embedded in a plain tag is parsed as LRC', () => {
  const payload = createEmbeddedLyricsPayload({
    status: 'hit',
    text: '[00:01.00]First\n[00:02.50]Second',
    syncText: [],
  });

  assert.equal(payload?.format, 'lrc');
  assert.deepEqual(payload?.syncedLines.map((line) => [line.timestampMs, line.text]), [
    [1_000, 'First'],
    [2_500, 'Second'],
  ]);
});

test('structured SYLT entries take precedence over timestamps in raw text', () => {
  const payload = createEmbeddedLyricsPayload({
    status: 'hit',
    text: '[00:09.00]Raw fallback',
    syncText: [
      { timestampMs: 2_000, text: 'Second' },
      { timestampMs: 1_000, text: 'First' },
    ],
  });

  assert.equal(payload?.format, 'lrc');
  assert.deepEqual(payload?.syncedLines.map((line) => [line.timestampMs, line.text]), [
    [1_000, 'First'],
    [2_000, 'Second'],
  ]);
});

test('only local file schemes are eligible for native embedded inspection', () => {
  assert.equal(isLocalLyricsPath('content://media/track/1'), true);
  assert.equal(isLocalLyricsPath('file:///music/track.mp3'), true);
  assert.equal(isLocalLyricsPath('subsonic://server/track/1'), false);
  assert.equal(isLocalLyricsPath('jellyfin://server/track/1'), false);
});
