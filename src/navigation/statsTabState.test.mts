import assert from 'node:assert/strict';
import test from 'node:test';
import { isDisplayedTabFocused } from './statsTabState.ts';
import { TAB_ROUTE_ORDER } from './tabTransition.ts';

const homeIndex = TAB_ROUTE_ORDER.indexOf('index');
const statsIndex = TAB_ROUTE_ORDER.indexOf('stats');
const libraryIndex = TAB_ROUTE_ORDER.indexOf('library');

test('Stats keeps Home visibly selected without selecting another visible tab', () => {
  assert.equal(isDisplayedTabFocused('index', homeIndex, statsIndex, 'stats'), true);
  assert.equal(isDisplayedTabFocused('library', libraryIndex, statsIndex, 'stats'), false);
  assert.equal(isDisplayedTabFocused('stats', statsIndex, statsIndex, 'stats'), true);
});

test('ordinary tabs keep their normal selected state', () => {
  assert.equal(isDisplayedTabFocused('index', homeIndex, libraryIndex, 'library'), false);
  assert.equal(isDisplayedTabFocused('library', libraryIndex, libraryIndex, 'library'), true);
});
