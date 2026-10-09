import test from 'node:test';
import assert from 'node:assert/strict';
import { balancedLyricWidth, lyricSegments, lyricUnits, lyricVoices } from './playerLyricsModel.ts';

test('timing units retain readings and trailing kana as one wrapping unit', () => {
  const words = [{ timestampMs: 1000, text: '誘う ', furigana: [{ start: 0, end: 1, base: '誘', reading: 'さそ' }] }, { timestampMs: 1700, text: "Fallin'" }];
  const line = { timestampMs: 1000, text: "誘う Fallin'", words };
  assert.deepEqual(lyricUnits(line, true), [
    { wordIndex: 0, segments: [{ text: '誘', reading: 'さそ' }, { text: 'う ' }] },
    { wordIndex: 1, segments: [{ text: "Fallin'" }] },
  ]);
  assert.equal(lyricUnits(line, false).length, 2);
  assert.deepEqual(lyricUnits(line, false)[0].segments, [{ text: '誘う ' }]);
});

test('untimed ruby retains okurigana and faithfully reconstructs mixed scripts', () => {
  const line = { timestampMs: 0, text: '誘う Fallin’ 音楽。', furigana: [{ start: 0, end: 1, base: '誘', reading: 'さそ' }, { start: 11, end: 13, base: '音楽', reading: 'おんがく' }] };
  const units = lyricUnits(line, true);
  assert.equal(units.flatMap(unit => unit.segments.map(segment => segment.text)).join(''), line.text);
  assert.deepEqual(units[0].segments, [{ text: '誘', reading: 'さそ' }, { text: 'う' }]);
  assert.deepEqual(units.at(-1)?.segments, [{ text: '音楽', reading: 'おんがく' }, { text: '。' }]);
  assert.deepEqual(lyricSegments('abc', [{ start: -1, end: 2, base: '', reading: '?' }, { start: 1, end: 9, base: '', reading: '?' }]), [{ text: 'abc' }]);
});

test('balancing prevents a one-word final row without making extra rows', () => {
  assert.equal(balancedLyricWidth([100, 100, 100, 100, 100], 472), 301);
  assert.equal(balancedLyricWidth([100, 100], 472), 472);
  assert.equal(balancedLyricWidth([100, 0, 100], 472), 472);
  assert.equal(balancedLyricWidth([600, 30], 472), 472);
});

test('real singer names label voice changes, not every line, across silence', () => {
  const lines = [
    { voice: 'Singer A' }, { voice: 'Singer A' }, { voice: 'Singer B' },
    { kind: 'silence' as const }, { voice: 'Singer B' }, { voice: 'Singer A' }, {}, { voice: 'Singer A' },
  ].map((line, index) => ({ timestampMs: index * 1000, text: 'A line', ...line }));
  assert.deepEqual(lyricVoices(lines), [
    { right: false, label: 'Singer A' }, { right: false, label: null },
    { right: true, label: 'Singer B' }, { right: false, label: null },
    { right: true, label: null }, { right: false, label: 'Singer A' },
    { right: false, label: null }, { right: false, label: 'Singer A' },
  ]);
});
