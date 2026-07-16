import assert from 'node:assert/strict';
import test from 'node:test';
import { getPhonePlaybackPresentation } from './playbackTargetPresentation.ts';
import type { Track } from '../types/audio.ts';

const track: Track = {
  id: 'track-1',
  path: 'file:///track.flac',
  title: 'Track',
  artist: 'Artist',
  album: 'Wrong Album Guess',
  duration: 180,
  format: 'FLAC',
};

test('phone presentation uses the explicit queue source instead of the track album', () => {
  const presentation = getPhonePlaybackPresentation({
    track,
    playbackState: 'playing',
    source: { kind: 'favorites', label: 'Favorites' },
  });

  assert.equal(presentation.sourceLabel, 'Favorites');
});

test('phone presentation falls back to Queue when source context is missing', () => {
  const presentation = getPhonePlaybackPresentation({
    track,
    playbackState: 'paused',
    source: null,
  });

  assert.equal(presentation.sourceLabel, 'Queue');
  assert.notEqual(presentation.sourceLabel, track.album);
});
