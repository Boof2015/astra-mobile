import assert from 'node:assert/strict';
import test from 'node:test';
import { isDisplayedTabFocused } from './statsTabState.ts';

test('Stats keeps Home visibly selected without selecting another visible tab', () => {
  assert.equal(isDisplayedTabFocused('index', 0, 4, 'stats'), true);
  assert.equal(isDisplayedTabFocused('library', 1, 4, 'stats'), false);
  assert.equal(isDisplayedTabFocused('stats', 4, 4, 'stats'), true);
});

test('ordinary tabs keep their normal selected state', () => {
  assert.equal(isDisplayedTabFocused('index', 0, 1, 'library'), false);
  assert.equal(isDisplayedTabFocused('library', 1, 1, 'library'), true);
});
