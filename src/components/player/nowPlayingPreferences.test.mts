import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNowPlayingCompanion } from './nowPlayingPreferences.ts';
import { splitCollaborators } from '../../shared/library/albumGrouping.ts';
import { buildArtistNameTokens } from '../../shared/library/artistCredits.ts';

test('defaults missing and invalid companion preferences to queue', () => {
  assert.equal(parseNowPlayingCompanion(null), 'queue');
  assert.equal(parseNowPlayingCompanion(''), 'queue');
  assert.equal(parseNowPlayingCompanion('spectrum'), 'queue');
});

test('restores persisted queue and lyrics companion preferences', () => {
  assert.equal(parseNowPlayingCompanion('queue'), 'queue');
  assert.equal(parseNowPlayingCompanion('lyrics'), 'lyrics');
});

test('builds separate clickable credits for collaborative track artists', () => {
  const artists = splitCollaborators('Dazbee feat. 9Lana & ValkyR');
  assert.deepEqual(artists, ['Dazbee', '9Lana', 'ValkyR']);
  assert.deepEqual(buildArtistNameTokens(artists), [
    { artist: 'Dazbee', separator: ', ' },
    { artist: '9Lana', separator: ' & ' },
    { artist: 'ValkyR', separator: null },
  ]);
});
