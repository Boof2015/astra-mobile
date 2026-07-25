import assert from 'node:assert/strict';
import test from 'node:test';
import { needsTabsCollapse, TABS_ROUTE_NAME } from './tabsAnchor.ts';

test('no collapse needed while the tab tree is the focused root route', () => {
  const rootState = {
    index: 0,
    routes: [{ name: TABS_ROUTE_NAME }],
  };
  assert.equal(needsTabsCollapse(rootState), false);
});

test('a root sibling above the anchor must be collapsed first', () => {
  // This is the shape that dead-ends back-navigation: navigating to a route
  // inside `(tabs)` from here diverges at the ROOT stack, and Expo Router's
  // StackRouter mints a second `(tabs)` without de-duplicating by name.
  const rootState = {
    index: 1,
    routes: [{ name: TABS_ROUTE_NAME }, { name: 'eq/scan' }],
  };
  assert.equal(needsTabsCollapse(rootState), true);
});

test('an already-duplicated stack still reports a needed collapse', () => {
  const rootState = {
    index: 2,
    routes: [{ name: TABS_ROUTE_NAME }, { name: TABS_ROUTE_NAME }, { name: 'notification.click' }],
  };
  assert.equal(needsTabsCollapse(rootState), true);
});

test('a focused duplicate of the anchor needs no collapse', () => {
  // Nothing to pop toward: the focused route already is a `(tabs)` instance, so
  // navigation diverges inside the tab tree rather than at the root stack.
  const rootState = {
    index: 1,
    routes: [{ name: TABS_ROUTE_NAME }, { name: TABS_ROUTE_NAME }],
  };
  assert.equal(needsTabsCollapse(rootState), false);
});

test('a missing or unready root state never triggers navigation surgery', () => {
  assert.equal(needsTabsCollapse(undefined), false);
  assert.equal(needsTabsCollapse({ index: 0, routes: [] }), false);
});

test('a root state without an index falls back to the topmost route', () => {
  assert.equal(
    needsTabsCollapse({ routes: [{ name: TABS_ROUTE_NAME }, { name: 'sources/edit' }] }),
    true
  );
  assert.equal(needsTabsCollapse({ routes: [{ name: TABS_ROUTE_NAME }] }), false);
});
