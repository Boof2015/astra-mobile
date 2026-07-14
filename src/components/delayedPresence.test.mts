import assert from 'node:assert/strict';
import test from 'node:test';
import {
  delayedPresenceReducer,
  scheduleDelayedPresenceHide,
} from './delayedPresence.ts';
import {
  EQ_GRAPH_UNMOUNT_DELAY_MS,
  NOW_PLAYING_CLOSE_UNMOUNT_MS,
} from './renderPresenceTiming.ts';

const wait = (delayMs: number) => new Promise((resolve) => setTimeout(resolve, delayMs));

test('Now Playing remains mounted through close timing, then releases', async () => {
  let retained = false;
  retained = delayedPresenceReducer(retained, 'show');
  assert.equal(retained, true);
  scheduleDelayedPresenceHide(NOW_PLAYING_CLOSE_UNMOUNT_MS, () => {
    retained = delayedPresenceReducer(retained, 'hide');
  });
  await wait(NOW_PLAYING_CLOSE_UNMOUNT_MS - 20);
  assert.equal(retained, true, 'surface must survive the close animation');
  await wait(35);
  assert.equal(retained, false);
});

test('rapid close/reopen cancels the pending release', async () => {
  let retained = delayedPresenceReducer(false, 'show');
  const cancelHide = scheduleDelayedPresenceHide(20, () => {
    retained = delayedPresenceReducer(retained, 'hide');
  });
  cancelHide();
  retained = delayedPresenceReducer(retained, 'show');
  await wait(30);
  assert.equal(retained, true);
});

test('background drop releases immediately and foreground open restores', () => {
  let retained = delayedPresenceReducer(false, 'show');
  retained = delayedPresenceReducer(retained, 'drop');
  assert.equal(retained, false);
  retained = delayedPresenceReducer(retained, 'show');
  assert.equal(retained, true);
});

test('focused EQ surface remains through the tab settling window', async () => {
  assert.equal(EQ_GRAPH_UNMOUNT_DELAY_MS, 190);
  let retained = delayedPresenceReducer(false, 'show');
  scheduleDelayedPresenceHide(EQ_GRAPH_UNMOUNT_DELAY_MS, () => {
    retained = delayedPresenceReducer(retained, 'hide');
  });
  await wait(EQ_GRAPH_UNMOUNT_DELAY_MS - 20);
  assert.equal(retained, true);
  await wait(35);
  assert.equal(retained, false);
});
