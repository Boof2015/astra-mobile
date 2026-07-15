import assert from 'node:assert/strict';
import test from 'node:test';
import type { Track } from '../types/audio.ts';
import {
  SIGNAL_LINK_PREFIX,
  decodeTrackSignalLink,
  encodeTrackSignalLink,
  signalInputFromTrack,
  signalLayoutFromTrack,
} from './signalShare.ts';

function track(overrides: Partial<Track> = {}): Track {
  return {
    id: 'signal-test',
    path: '/music/replay.flac',
    title: 'Replay',
    artist: 'ナナツカゼ',
    album: 'Signal Tests',
    duration: 213.6,
    format: 'flac',
    ...overrides,
  };
}

test('converts a Track into rounded, database-free Signal metadata', () => {
  assert.deepEqual(signalInputFromTrack(track()), {
    artist: 'ナナツカゼ',
    title: 'Replay',
    durationSec: 214,
  });
  assert.equal(signalInputFromTrack(track({ duration: Number.NaN })).durationSec, 0);
});

test('creates a v3 connected layout and round-trips a Unicode link', () => {
  const source = track();
  const layout = signalLayoutFromTrack(source);
  assert.equal(layout.version, 3);
  assert.equal(layout.columns.length, layout.dataColumns + 8);

  const link = encodeTrackSignalLink(source);
  assert.ok(link.startsWith(SIGNAL_LINK_PREFIX));
  assert.deepEqual(decodeTrackSignalLink(link), {
    version: 3,
    type: 'metadata',
    artist: 'ナナツカゼ',
    title: 'Replay',
    durationSec: 214,
  });
});

test('preserves ASCII case and punctuation in track metadata', () => {
  const source = track({ artist: 'N!GHT', title: '#iwannadance', duration: 222 });
  const layout = signalLayoutFromTrack(source);
  assert.equal(layout.payload.artist, 'N!GHT');
  assert.equal(layout.payload.title, '#iwannadance');
  assert.deepEqual(decodeTrackSignalLink(encodeTrackSignalLink(source)), {
    version: 3,
    type: 'metadata',
    artist: 'N!GHT',
    title: '#iwannadance',
    durationSec: 222,
  });
});

test('rejects non-v3, malformed, and CRC-corrupted links', () => {
  assert.throws(() => decodeTrackSignalLink('astra:signal:v2:AAAA'), /v3 link/);
  assert.throws(() => decodeTrackSignalLink(`${SIGNAL_LINK_PREFIX}%`));
  const valid = encodeTrackSignalLink(track());
  const index = SIGNAL_LINK_PREFIX.length + 5;
  const replacement = valid[index] === 'A' ? 'B' : 'A';
  const corrupted = `${valid.slice(0, index)}${replacement}${valid.slice(index + 1)}`;
  assert.throws(() => decodeTrackSignalLink(corrupted));
});
