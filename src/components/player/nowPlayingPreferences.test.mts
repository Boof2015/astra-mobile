import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNowPlayingCompanion } from './nowPlayingPreferences.ts';
import {
  buildArtistNameTokens,
  formatArtistNames,
  parseArtistMetadata,
} from '../../shared/library/artistCredits.ts';

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
  const artists = ['Dazbee', '9Lana', 'ValkyR'];
  assert.equal(formatArtistNames(artists), 'Dazbee, 9Lana, ValkyR');
  assert.deepEqual(buildArtistNameTokens(artists), [
    { artist: 'Dazbee', separator: ', ' },
    { artist: '9Lana', separator: ', ' },
    { artist: 'ValkyR', separator: null },
  ]);
});

test('structured credits preserve commas and ampersands inside one artist name', () => {
  assert.deepEqual(buildArtistNameTokens(['Earth, Wind & Fire', 'The Emotions']), [
    { artist: 'Earth, Wind & Fire', separator: ', ' },
    { artist: 'The Emotions', separator: null },
  ]);
});

test('legacy display credits keep their literal separators', () => {
  assert.deepEqual(parseArtistMetadata('1, 2, 3'), [
    { artist: '1', separator: ', ' },
    { artist: '2', separator: ', ' },
    { artist: '3', separator: null },
  ]);
  assert.deepEqual(parseArtistMetadata('Simon & Garfunkel'), [
    { artist: 'Simon & Garfunkel', separator: null },
  ]);
  assert.deepEqual(parseArtistMetadata('One; Two'), [
    { artist: 'One', separator: '; ' },
    { artist: 'Two', separator: null },
  ]);
});
