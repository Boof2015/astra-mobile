import assert from 'node:assert/strict';
import test from 'node:test';
import {
  leavingStackResetTarget,
  shouldApplyStackReset,
  type TabsStateLike,
} from './tabStackReset.ts';

/** Home, Library (nested stack), EQ, Settings, plus the hidden stats route. */
function tabsState(
  index: number,
  libraryStack?: { key?: string; index?: number }
): TabsStateLike {
  return {
    key: 'tabs-1',
    index,
    routes: [
      { key: 'index-1', name: 'index' },
      { key: 'library-1', name: 'library', state: libraryStack },
      { key: 'eq-1', name: 'eq' },
      { key: 'settings-1', name: 'settings' },
      { key: 'stats-1', name: 'stats' },
    ],
  };
}

test('a focused library sitting on a detail names its stack for rewinding', () => {
  assert.equal(
    leavingStackResetTarget(tabsState(1, { key: 'library-stack', index: 2 })),
    'library-stack'
  );
});

test('nothing to rewind when the focused stack is already at its root', () => {
  assert.equal(leavingStackResetTarget(tabsState(1, { key: 'library-stack', index: 0 })), null);
  assert.equal(leavingStackResetTarget(tabsState(1, { key: 'library-stack' })), null);
});

test('nothing to rewind for a tab with no nested navigator', () => {
  assert.equal(leavingStackResetTarget(tabsState(0)), null);
  assert.equal(leavingStackResetTarget(tabsState(3)), null);
});

test('a never-visited tab has no stack key to target', () => {
  assert.equal(leavingStackResetTarget(tabsState(1, { index: 2 })), null);
  assert.equal(leavingStackResetTarget(tabsState(1, { key: '', index: 2 })), null);
});

test('undefined or empty state is inert', () => {
  assert.equal(leavingStackResetTarget(undefined), null);
  assert.equal(leavingStackResetTarget({ routes: [] }), null);
  assert.equal(leavingStackResetTarget({ key: 'tabs-1' }), null);
});

// The hidden `stats` route is focused while the Home button is lit; reading the
// pressed item instead of the focused route would look at Library here.
test('reads the genuinely focused route, not the one that looks focused', () => {
  const state = tabsState(4, { key: 'library-stack', index: 2 });
  assert.equal(leavingStackResetTarget(state), null);
});

test('the rewind applies while its tab stays blurred', () => {
  const state = tabsState(0, { key: 'library-stack', index: 2 });
  assert.equal(shouldApplyStackReset(state, 'library-stack'), true);
});

// The race the delayed dispatch exists to survive: tapping a Home album card
// re-enters Library on a fresh detail before the rewind runs.
test('the rewind is abandoned when its tab was re-focused inside the delay', () => {
  const state = tabsState(1, { key: 'library-stack', index: 1 });
  assert.equal(shouldApplyStackReset(state, 'library-stack'), false);
});

test('the rewind is abandoned when its stack is no longer present', () => {
  assert.equal(shouldApplyStackReset(tabsState(0), 'library-stack'), false);
  assert.equal(shouldApplyStackReset(tabsState(0, { key: 'other-stack' }), 'library-stack'), false);
  assert.equal(shouldApplyStackReset(undefined, 'library-stack'), false);
  assert.equal(shouldApplyStackReset({ key: 'tabs-1' }, 'library-stack'), false);
});
