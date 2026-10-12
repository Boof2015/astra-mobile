import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNowPlayingAccentSource } from './artworkAccentPreferences.ts';

test('only TV defaults to artwork accents; saved choices survive on every device', () => {
  assert.equal(parseNowPlayingAccentSource(null, true), 'cover-art');
  assert.equal(parseNowPlayingAccentSource(null, false), 'app');
  for (const isTV of [true, false]) {
    assert.equal(parseNowPlayingAccentSource('app', isTV), 'app');
    assert.equal(parseNowPlayingAccentSource('cover-art', isTV), 'cover-art');
  }
});
