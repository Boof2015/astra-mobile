import assert from 'node:assert/strict';
import test from 'node:test';
import type { Track } from '../types/audio.ts';
import { SIGNAL_LINK_PREFIX, encodeTrackSignalLink } from './signalShare.ts';
import { getSignalShareRedirectPath } from './signalShareIntent.ts';

const source: Track = {
  id: 'intent-test',
  path: '/music/replay.flac',
  title: 'Replay',
  artist: 'ナナツカゼ',
  album: 'Signal Tests',
  duration: 214,
  format: 'flac',
};

test('routes native and percent-encoded Astra Signal v3 links', () => {
  const link = encodeTrackSignalLink(source);
  const payload = link.slice(SIGNAL_LINK_PREFIX.length);
  assert.equal(getSignalShareRedirectPath(link), `/signal/import?data=${payload}`);
  assert.equal(getSignalShareRedirectPath(encodeURIComponent(link)), `/signal/import?data=${payload}`);
  assert.equal(getSignalShareRedirectPath(`astra://signal:v3:${payload}`), `/signal/import?data=${payload}`);
});

test('ignores unrelated, v2, and empty Signal intents', () => {
  assert.equal(getSignalShareRedirectPath('https://example.com'), null);
  assert.equal(getSignalShareRedirectPath('astra:signal:v2:AAAA'), null);
  assert.equal(getSignalShareRedirectPath('astra:signal:v3:'), null);
});
