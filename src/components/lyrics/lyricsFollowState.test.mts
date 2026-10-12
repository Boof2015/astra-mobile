import assert from 'node:assert/strict';
import test from 'node:test';
import { canApplyLyricsFollowCommand, initialLyricsFollowState, reduceLyricsFollow as reduce, lyricsAnchorOffset, lyricsRowInWindow } from './lyricsFollowState.ts';

const measured = { type: 'sync' as const, focus: 4, target: 400, layoutRevision: 1, active: true, reduced: false };

test('opening mid-song waits for measured geometry and settles at the current cue', () => {
  const waiting = reduce(initialLyricsFollowState, { ...measured, target: null });
  assert.equal(waiting.command, null);
  const ready = reduce(waiting, measured);
  assert.deepEqual(ready.command, { target: 400, animate: false, reason: 'sync' });
  assert.equal(reduce(ready, measured), ready);
});

test('adjacent cues replace in-flight targets; multi-cue and backward jumps settle', () => {
  let state = reduce(initialLyricsFollowState, measured);
  state = reduce(state, { ...measured, focus: 5, target: 500 });
  assert.equal(state.command?.animate, true);
  state = reduce(state, { ...measured, focus: 6, target: 610 });
  assert.equal(state.command?.target, 610);
  assert.equal(state.command?.animate, true);
  state = reduce(state, { ...measured, focus: 20, target: 2100 });
  assert.equal(state.command?.animate, false);
  state = reduce(state, { ...measured, focus: 2, target: 150 });
  assert.equal(state.command?.animate, false);
});

test('drag owns scrolling through new cues, seeks and measurements until explicit Recenter', () => {
  let state = reduce(reduce(initialLyricsFollowState, measured), { type: 'browse' });
  state = reduce(state, { ...measured, focus: 25, target: 2500 });
  assert.equal(state.command, null);
  state = reduce(state, { ...measured, focus: 25, target: 2700, layoutRevision: 2 });
  assert.equal(state.browsing, true);
  assert.equal(state.command, null);
  state = reduce(state, { type: 'recenter', generation: 4 });
  assert.equal(state.browsing, false);
  assert.deepEqual(state.command, { target: 2700, animate: true, reason: 'recenter', expectedGeneration: 4 });
});

test('layout revisions, reduced motion and background/resume cancel movement', () => {
  const ready = reduce(initialLyricsFollowState, measured);
  for (const change of [{ layoutRevision: 2 }, { reduced: true }, { active: false }]) {
    const next = reduce(ready, { ...measured, focus: 5, target: 510, ...change });
    assert.equal(next.command?.animate, false);
  }
  const hidden = reduce(ready, { ...measured, active: false });
  assert.equal(reduce(hidden, { ...measured, focus: 9, target: 900 }).command?.animate, false);
  const reduced = reduce(ready, { ...measured, reduced: true });
  assert.equal(reduce(reduce(reduced, { type: 'browse' }), { type: 'recenter', generation: 4 }).command?.animate, false);
});

test('anchor waits for current native measurements and clamps to scrollable bounds', () => {
  assert.equal(lyricsAnchorOffset(undefined, 50, 500, 2000), null);
  assert.equal(lyricsAnchorOffset(600, undefined, 500, 2000), null);
  assert.equal(lyricsAnchorOffset(600, 80, 500, 0), null);
  assert.equal(lyricsAnchorOffset(600, 80, 500, 2000), 440);
  assert.equal(lyricsAnchorOffset(0, 80, 500, 2000), 0);
  assert.equal(lyricsAnchorOffset(1950, 50, 500, 2000), 1500);
});

test('animation window retains tall overlapping rows and limits work on long songs', () => {
  assert.equal(lyricsRowInWindow(0, 1200, 1500, 500), true);
  assert.equal(lyricsRowInWindow(0, 50, 1500, 500), false);
  assert.equal(lyricsRowInWindow(undefined, undefined, 0, 500), false);
  const rows = Array.from({ length: 1000 }, (_, i) => i * 70);
  assert.ok(rows.filter(top => lyricsRowInWindow(top, 65, 35000, 500)).length < 25);
});

test('a native drag rejects queued cue and Recenter commands from an older gesture', () => {
  assert.equal(canApplyLyricsFollowCommand({ target: 400, animate: true, reason: 'sync' }, 'browse', 5), false);
  const recenter = { target: 400, animate: true, reason: 'recenter' as const, expectedGeneration: 4 };
  assert.equal(canApplyLyricsFollowCommand(recenter, 'browse', 4), true);
  assert.equal(canApplyLyricsFollowCommand(recenter, 'browse', 5), false);
});

test('Recenter cannot discard browse ownership before a target has been measured', () => {
  const waiting = reduce(initialLyricsFollowState, { type: 'browse' });
  assert.equal(reduce(waiting, { type: 'recenter', generation: 4 }), waiting);
});
