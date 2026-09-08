import test from 'node:test';
import assert from 'node:assert/strict';
import { createCarCommandQueue, createCarCommandCoordinator, carCommandError } from './carCommandQueue.ts';
import { voiceIntent, constrainedTrackScore } from './carSearchPolicy.ts';

test('commands stay ordered while initialization is pending and a failure does not poison later requests', async () => {
  const queue = createCarCommandQueue();
  const calls: string[] = [];
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { release = resolve; });
  const first = queue(async () => { calls.push('initialize'); await ready; calls.push('play-next'); });
  const failed = queue(async () => { calls.push('failed-seek'); throw new Error('unavailable'); });
  const caught = assert.rejects(failed, /unavailable/);
  const last = queue(async () => { calls.push('append'); });
  await Promise.resolve();
  assert.deepEqual(calls, ['initialize']);
  release();
  await Promise.all([first, caught, last]);
  assert.deepEqual(calls, ['initialize', 'play-next', 'failed-seek', 'append']);
});

test('song focus and title beat an artist extra; title and artist constrain the same result', () => {
  assert.deepEqual(voiceIntent({ query: 'song by artist', focus: 'track', title: 'Song', artist: 'Artist' }), { focus: 'track', term: 'Song' });
  assert.deepEqual(voiceIntent({ title: 'Song', artist: 'Artist', album: 'Album' }), { focus: 'track', term: 'Song' });
  assert.equal(constrainedTrackScore({ title: 'Song', artist: 'Other', album: 'Album' }, 'Song', 'Artist'), Infinity);
  assert.equal(constrainedTrackScore({ title: 'Song', artist: 'Artist', album: 'Album' }, 'Song', 'Artist', 'Album'), 0);
});

test('explicit focus chooses albums, artists, and playlists despite conflicting metadata', () => {
  for (const focus of ['album', 'artist', 'playlist']) {
    assert.deepEqual(voiceIntent({ focus, query: 'Requested', title: 'Wrong song' }), { focus, term: 'Requested' });
  }
});

test('empty voice request resumes and unstructured requests search across categories', () => {
  assert.deepEqual(voiceIntent({ query: '   ' }), { focus: null, term: null });
  assert.deepEqual(voiceIntent({ query: '  My   music ' }), { focus: null, term: 'My music' });
});

test('expired requests never run and completion always carries the original request ID', async () => {
  const results: [string, string | null][] = [];
  const executed: string[] = [];
  const coordinate = createCarCommandCoordinator<{ requestId: string }>({
    isActive: async (id) => id !== 'expired',
    execute: async ({ requestId }) => {
      executed.push(requestId);
      if (requestId === 'missing') throw new Error('This queue item is no longer available.');
    },
    complete: (id, error) => results.push([id, error]),
    formatError: carCommandError,
  });
  await Promise.all(['missing', 'expired', 'append'].map((requestId) => coordinate({ requestId })));
  assert.deepEqual(executed, ['missing', 'append']);
  assert.deepEqual(results, [['missing', 'This queue item is no longer available.'], ['append', null]]);
});

test('car failures cannot expose authenticated URLs from engine or network errors', () => {
  assert.equal(carCommandError(new Error('This request failed: https://server/?token=secret')),
    'Unable to complete this action. Check that the music is available and try again.');
});
