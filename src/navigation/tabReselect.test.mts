import assert from 'node:assert/strict';
import test from 'node:test';
import {
  emitTabReselect,
  subscribeTabReselect,
  tabReselectListenerCount,
} from './tabReselect.ts';

test('an emit reaches every listener on that tab and none on another', () => {
  const seen: string[] = [];
  const offLibraryA = subscribeTabReselect('library', () => seen.push('library-a'));
  const offLibraryB = subscribeTabReselect('library', () => seen.push('library-b'));
  const offHome = subscribeTabReselect('index', () => seen.push('index'));

  emitTabReselect('library');
  assert.deepEqual(seen, ['library-a', 'library-b']);

  emitTabReselect('index');
  assert.deepEqual(seen, ['library-a', 'library-b', 'index']);

  offLibraryA();
  offLibraryB();
  offHome();
});

// `eq` and `settings` never subscribe, so every press on them lands here.
test('an emit for a tab with no listeners is inert', () => {
  assert.doesNotThrow(() => emitTabReselect('eq'));
});

test('unsubscribing removes only that listener and is safe to repeat', () => {
  const seen: string[] = [];
  const offA = subscribeTabReselect('library', () => seen.push('a'));
  const offB = subscribeTabReselect('library', () => seen.push('b'));

  offA();
  offA();
  emitTabReselect('library');
  assert.deepEqual(seen, ['b']);

  offB();
});

// The screen unsubscribes on unmount, which a sibling's handler can trigger.
test('a listener unsubscribing mid-dispatch does not skip its sibling', () => {
  const seen: string[] = [];
  let offB = () => {};
  const offA = subscribeTabReselect('library', () => {
    seen.push('a');
    offB();
  });
  offB = subscribeTabReselect('library', () => seen.push('b'));

  emitTabReselect('library');
  assert.deepEqual(seen, ['a', 'b']);

  offA();
});

test('the last listener to leave takes its bucket with it', () => {
  const off = subscribeTabReselect('library', () => {});
  assert.equal(tabReselectListenerCount('library'), 1);
  off();
  assert.equal(tabReselectListenerCount('library'), 0);
});
