import assert from 'node:assert/strict';
import test from 'node:test';
import {
  commitPlayerClosed,
  initialPlayerPresence,
  isPlayerMounted,
  isPlayerOnScreen,
  requestPlayerClose,
  requestPlayerOpen,
  settlePlayerOpen,
  type PlayerPresenceState,
} from './playerPresence.ts';

test('a normal open/close round trip settles at both ends', () => {
  let state = initialPlayerPresence;
  assert.equal(isPlayerMounted(state.phase), false);

  state = requestPlayerOpen(state);
  assert.equal(state.phase, 'opening');
  assert.equal(isPlayerMounted(state.phase), true, 'overlay mounts as soon as it is requested');
  assert.equal(isPlayerOnScreen(state.phase), true);

  state = settlePlayerOpen(state);
  assert.equal(state.phase, 'open');

  state = requestPlayerClose(state);
  assert.equal(state.phase, 'closing');
  assert.equal(isPlayerMounted(state.phase), true, 'stays mounted for the exit animation');
  assert.equal(isPlayerOnScreen(state.phase), false);

  state = commitPlayerClosed(state);
  assert.equal(state.phase, 'closed');
  assert.equal(isPlayerMounted(state.phase), false);
});

test('reopening an already-open player still registers as a request', () => {
  // The regression this guards: `openPlayer` used to be `set({ open: true })`,
  // so tapping the mini-player while the flag was already true produced no
  // state change, no re-render, and no enter animation. If the sheet had been
  // stranded off-screen by an interrupted close, it could never be reopened.
  const open: PlayerPresenceState = { phase: 'open', openRequest: 4, exitAnimated: false };
  const reopened = requestPlayerOpen(open);
  assert.equal(reopened.phase, 'opening');
  assert.notEqual(reopened.openRequest, open.openRequest, 'must be a real state change');
});

test('the close request records whether an exit animation is already running', () => {
  const open = settlePlayerOpen(requestPlayerOpen(initialPlayerPresence));

  // Gesture / chevron: the caller drives the sheet with its own velocity-matched
  // spring, so the overlay must not start a competing slide-out.
  assert.equal(requestPlayerClose(open, true).exitAnimated, true);

  // Anything else (e.g. the output picker pushing a route underneath) needs the
  // overlay to animate the sheet away itself.
  assert.equal(requestPlayerClose(open).exitAnimated, false);

  // A reopen clears it so the next close starts from a known state.
  assert.equal(requestPlayerOpen(requestPlayerClose(open, true)).exitAnimated, false);
});

test('closing does not depend on the exit animation completing', () => {
  // A cancelled spring never reports completion, so the fallback timer commits
  // the release instead. Both routes end in the same place.
  let state = requestPlayerOpen(initialPlayerPresence);
  state = requestPlayerClose(state);
  assert.equal(state.phase, 'closing');
  state = commitPlayerClosed(state);
  assert.equal(state.phase, 'closed', 'released with no animation callback involved');
});

test('a stale close commit cannot yank back a player the user reopened', () => {
  // Reopening mid-close leaves the fallback timer from the previous close in
  // flight. Committing must be a no-op unless still closing.
  let state = requestPlayerOpen(initialPlayerPresence);
  state = requestPlayerClose(state);
  state = requestPlayerOpen(state);
  assert.equal(state.phase, 'opening');

  const afterStaleCommit = commitPlayerClosed(state);
  assert.equal(afterStaleCommit.phase, 'opening', 'late commit is ignored');
  assert.equal(isPlayerMounted(afterStaleCommit.phase), true);
});

test('a stale open settle cannot resurrect a closing player', () => {
  let state = requestPlayerOpen(initialPlayerPresence);
  state = requestPlayerClose(state);
  assert.equal(settlePlayerOpen(state).phase, 'closing');
});

test('closing an already-closed player is inert', () => {
  const closed = requestPlayerClose(initialPlayerPresence);
  assert.equal(closed.phase, 'closed');
  assert.equal(closed, initialPlayerPresence, 'no new state object, so no re-render');
});
