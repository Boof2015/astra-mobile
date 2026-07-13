import assert from 'node:assert/strict';
import test from 'node:test';
import { materializePlaybackQueue } from './playbackMaterialization.ts';

test('materializes in load-repeat-seek order without playing', async () => {
  const calls: string[] = [];
  await materializePlaybackQueue(
    { tracks: ['a', 'b'], activeIndex: 1, position: 37, repeat: 'all' },
    {
      loadQueue: async (tracks, index) => {
        calls.push(`load:${tracks.join(',')}:${index}`);
      },
      setRepeat: async (repeat) => {
        calls.push(`repeat:${repeat}`);
      },
      seek: async (position) => {
        calls.push(`seek:${position}`);
      },
    }
  );

  assert.deepEqual(calls, ['load:a,b:1', 'repeat:all', 'seek:37']);
});

test('does not seek a restored session at the beginning', async () => {
  let seeks = 0;
  await materializePlaybackQueue(
    { tracks: ['a'], activeIndex: 0, position: 0, repeat: 'none' },
    {
      loadQueue: async () => {},
      setRepeat: async () => {},
      seek: async () => {
        seeks += 1;
      },
    }
  );
  assert.equal(seeks, 0);
});

