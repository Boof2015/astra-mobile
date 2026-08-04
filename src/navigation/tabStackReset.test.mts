import assert from 'node:assert/strict';
import test from 'node:test';
import {
  leavingStackResetTarget,
  shouldApplyStackReset,
  type TabsStateLike,
} from './tabStackReset.ts';
import { TAB_ROUTE_ORDER } from './tabTransition.ts';

const routeIndex = (name: (typeof TAB_ROUTE_ORDER)[number]) => TAB_ROUTE_ORDER.indexOf(name);

/** Home, Library (nested stack), EQ, Settings, plus the hidden stats route. */
function tabsState(
  index: number,
  libraryStack?: { key?: string; index?: number }
): TabsStateLike {
  return {
    key: 'tabs-1',
    index,
    routes: TAB_ROUTE_ORDER.map((name) => ({
      key: `${name}-1`,
      name,
      ...(name === 'library' ? { state: libraryStack } : {}),
    })),
  };
}

test('a focused library sitting on a detail names its stack for rewinding', () => {
  assert.equal(
    leavingStackResetTarget(tabsState(routeIndex('library'), { key: 'library-stack', index: 2 })),
    'library-stack'
  );
});

test('nothing to rewind when the focused stack is already at its root', () => {
  assert.equal(leavingStackResetTarget(tabsState(routeIndex('library'), { key: 'library-stack', index: 0 })), null);
  assert.equal(leavingStackResetTarget(tabsState(routeIndex('library'), { key: 'library-stack' })), null);
});

test('nothing to rewind for a tab with no nested navigator', () => {
  assert.equal(leavingStackResetTarget(tabsState(routeIndex('index'))), null);
  assert.equal(leavingStackResetTarget(tabsState(routeIndex('settings'))), null);
});

test('a never-visited tab has no stack key to target', () => {
  assert.equal(leavingStackResetTarget(tabsState(routeIndex('library'), { index: 2 })), null);
  assert.equal(leavingStackResetTarget(tabsState(routeIndex('library'), { key: '', index: 2 })), null);
});

test('undefined or empty state is inert', () => {
  assert.equal(leavingStackResetTarget(undefined), null);
  assert.equal(leavingStackResetTarget({ routes: [] }), null);
  assert.equal(leavingStackResetTarget({ key: 'tabs-1' }), null);
});

// The hidden `stats` route is focused while the Home button is lit; reading the
// pressed item instead of the focused route would look at Library here.
test('reads the genuinely focused route, not the one that looks focused', () => {
  const state = tabsState(routeIndex('stats'), { key: 'library-stack', index: 2 });
  assert.equal(leavingStackResetTarget(state), null);
});

test('the rewind applies while its tab stays blurred', () => {
  const state = tabsState(routeIndex('index'), { key: 'library-stack', index: 2 });
  assert.equal(shouldApplyStackReset(state, 'library-stack'), true);
});

// The race the delayed dispatch exists to survive: tapping a Home album card
// re-enters Library on a fresh detail before the rewind runs.
test('the rewind is abandoned when its tab was re-focused inside the delay', () => {
  const state = tabsState(routeIndex('library'), { key: 'library-stack', index: 1 });
  assert.equal(shouldApplyStackReset(state, 'library-stack'), false);
});

test('the rewind is abandoned when its stack is no longer present', () => {
  assert.equal(shouldApplyStackReset(tabsState(routeIndex('index')), 'library-stack'), false);
  assert.equal(shouldApplyStackReset(tabsState(routeIndex('index'), { key: 'other-stack' }), 'library-stack'), false);
  assert.equal(shouldApplyStackReset(undefined, 'library-stack'), false);
  assert.equal(shouldApplyStackReset({ key: 'tabs-1' }, 'library-stack'), false);
});
