import assert from 'node:assert/strict';
import test from 'node:test';
import { SETTINGS_SEARCH_ROUTES } from './settingsSearchRoutes.ts';

test('Quick Search exposes the new stable settings destinations', () => {
  assert.deepEqual(Object.values(SETTINGS_SEARCH_ROUTES), [
    '/settings/playback',
    '/settings/lyrics',
    '/settings/troubleshooting',
  ]);
});
