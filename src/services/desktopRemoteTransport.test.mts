import assert from 'node:assert/strict';
import test from 'node:test';
import { desktopRemoteControlSequence } from './desktopRemoteTransport.ts';

test('paused desktop Next advances before resuming playback', () => {
  assert.deepEqual(
    desktopRemoteControlSequence('next', 'paused'),
    ['next', 'play'],
  );
});

test('desktop Next preserves non-paused transport behavior', () => {
  assert.deepEqual(desktopRemoteControlSequence('next', 'playing'), ['next']);
  assert.deepEqual(desktopRemoteControlSequence('next', 'loading'), ['next']);
  assert.deepEqual(desktopRemoteControlSequence('next', 'stopped'), ['next']);
  assert.deepEqual(desktopRemoteControlSequence('next', undefined), ['next']);
});

test('other desktop commands are never expanded', () => {
  assert.deepEqual(desktopRemoteControlSequence('previous', 'paused'), ['previous']);
  assert.deepEqual(desktopRemoteControlSequence('play', 'paused'), ['play']);
  assert.deepEqual(desktopRemoteControlSequence('seek', 'paused'), ['seek']);
});
