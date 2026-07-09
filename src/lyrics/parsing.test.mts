import assert from 'node:assert/strict';
import test from 'node:test';
import { parseLyricsText, sanitizeLyricsLines } from './parsing.ts';

test('plain LRC parses timestamps and preserves order', () => {
  const payload = parseLyricsText('[00:15.50]World\n[00:12.00]Hello', 'lrclib', 'lrc');
  assert.ok(payload);
  assert.equal(payload.format, 'lrc');
  assert.equal(payload.syncedLines.length, 2);
  // Lines are re-sorted by timestamp.
  assert.deepEqual(
    payload.syncedLines.map((line) => [line.timestampMs, line.text]),
    [
      [12000, 'Hello'],
      [15500, 'World'],
    ]
  );
});

test('plain LRC without timestamps degrades to plain format', () => {
  const payload = parseLyricsText('just some words\nno timing here', 'lrclib', 'lrc');
  assert.ok(payload);
  assert.equal(payload.format, 'plain');
  assert.equal(payload.syncedLines.length, 0);
  assert.ok(payload.plainLyrics?.includes('just some words'));
});

test('XLRC furigana attaches a ruby over the kanji only', () => {
  const payload = parseLyricsText('[00:01.00]私[わたし]は', 'xlrcdb', 'xlrc');
  assert.ok(payload);
  assert.equal(payload.format, 'xlrc');
  const [line] = payload.syncedLines;
  assert.equal(line.text, '私は');
  assert.ok(line.furigana && line.furigana.length === 1);
  assert.deepEqual(line.furigana[0], { start: 0, end: 1, base: '私', reading: 'わたし' });
});

test('XLRC inline translation attaches to the preceding lyric line', () => {
  const payload = parseLyricsText("[00:01.00]君がいいの\n[>en]It's you I want", 'xlrcdb', 'xlrc');
  assert.ok(payload);
  const [line] = payload.syncedLines;
  assert.ok(line.translations && line.translations.length === 1);
  assert.equal(line.translations[0].lang, 'en');
  assert.equal(line.translations[0].text, "It's you I want");
});

test('XLRC word timing yields per-word cues', () => {
  const payload = parseLyricsText('[00:01.00]<00:01.00>Hello <00:01.50>World', 'xlrcdb', 'xlrc');
  assert.ok(payload);
  const [line] = payload.syncedLines;
  assert.ok(line.words && line.words.length === 2);
  assert.equal(line.words[0].text.trim(), 'Hello');
  assert.equal(line.words[1].timestampMs, 1500);
});

test('empty timestamp line becomes a silence cue', () => {
  const payload = parseLyricsText('[00:00.00]Intro\n[00:20.00]', 'xlrcdb', 'xlrc');
  assert.ok(payload);
  const silence = payload.syncedLines.find((line) => line.kind === 'silence');
  assert.ok(silence);
  assert.equal(silence.timestampMs, 20000);
});

test('offset header shifts every timestamp', () => {
  const payload = parseLyricsText('[offset:500]\n[00:10.00]Line', 'lrclib', 'lrc');
  assert.ok(payload);
  assert.equal(payload.syncedLines[0].timestampMs, 10500);
});

test('sanitizeLyricsLines drops out-of-range furigana', () => {
  const lines = sanitizeLyricsLines([
    { timestampMs: 0, text: 'ab', furigana: [{ start: 0, end: 5, base: 'ab', reading: 'x' }] },
  ]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].furigana, undefined);
});
