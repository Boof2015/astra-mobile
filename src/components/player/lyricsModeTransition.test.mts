import assert from 'node:assert/strict';
import test from 'node:test';
import {
  initialLyricsModeTransition,
  reduceLyricsModeTransition as reduce,
} from './lyricsModeTransition.ts';

test('keeps the outgoing body until hidden, then mounts only the requested mode', () => {
  const opening = reduce(initialLyricsModeTransition(false), { type: 'request', lyrics: true, animate: true });
  assert.equal(opening.displayed, false);
  assert.equal(opening.phase, 'exiting');
  const entering = reduce(opening, { type: 'hidden', generation: opening.generation });
  assert.equal(entering.displayed, true);
  assert.equal(entering.phase, 'entering');
  const settled = reduce(entering, { type: 'visible', generation: entering.generation });
  assert.equal(settled.phase, 'idle');
  assert.equal(settled.displayed, true);
});

test('a reversal during exit restores the current body and ignores its cancelled completion', () => {
  const outgoing = reduce(initialLyricsModeTransition(false), { type: 'request', lyrics: true, animate: true });
  const reversed = reduce(outgoing, { type: 'request', lyrics: false, animate: true });
  assert.equal(reversed.phase, 'entering');
  assert.equal(reversed.displayed, false);
  assert.equal(reduce(reversed, { type: 'hidden', generation: outgoing.generation }), reversed);
  assert.equal(reduce(reversed, { type: 'visible', generation: reversed.generation }).phase, 'idle');
});

test('rapid toggles during entrance settle on the latest request', () => {
  let state = initialLyricsModeTransition(false);
  for (let i = 0; i < 31; i += 1) {
    state = reduce(state, { type: 'request', lyrics: !state.requested, animate: true });
    if (i % 3 === 0) state = reduce(state, { type: 'hidden', generation: state.generation });
  }
  if (state.phase === 'exiting') state = reduce(state, { type: 'hidden', generation: state.generation });
  state = reduce(state, { type: 'visible', generation: state.generation });
  assert.equal(state.displayed, true);
  assert.equal(state.requested, true);
  assert.equal(state.phase, 'idle');
});

test('close, background, reduced motion and capability changes cancel pending work', () => {
  for (const lyrics of [false, true]) {
    let state = reduce(initialLyricsModeTransition(false), { type: 'request', lyrics: true, animate: true });
    const exitGeneration = state.generation;
    state = reduce(state, { type: 'hidden', generation: exitGeneration });
    const enterGeneration = state.generation;
    state = reduce(state, { type: 'request', lyrics, animate: false });
    assert.equal(state.phase, 'idle');
    assert.equal(state.displayed, lyrics);
    assert.equal(reduce(state, { type: 'visible', generation: enterGeneration }), state);
    assert.equal(reduce(state, { type: 'hidden', generation: exitGeneration }), state);
  }
});

test('cold opening into persisted lyrics starts visible without an art-body flash', () => {
  assert.deepEqual(initialLyricsModeTransition(true), {
    requested: true, displayed: true, phase: 'idle', generation: 0,
  });
});
