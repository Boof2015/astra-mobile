import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canStartDesktopSync,
  decideDesktopSyncEnabled,
  identityMatchesPinnedConnection,
} from './desktopSyncPolicy.ts';

test('legacy automatic-sync migration preserves explicit off and defaults to on', () => {
  assert.equal(decideDesktopSyncEnabled(null, '0'), false);
  assert.equal(decideDesktopSyncEnabled(null, '1'), true);
  assert.equal(decideDesktopSyncEnabled(null, null), true);
  assert.equal(decideDesktopSyncEnabled('0', '1'), false);
});

test('master switch gates manual, automatic, and follow-up starts', () => {
  assert.equal(canStartDesktopSync(false, 'idle'), false);
  assert.equal(canStartDesktopSync(false, 'error'), false);
  assert.equal(canStartDesktopSync(true, 'syncing'), false);
  assert.equal(canStartDesktopSync(true, 'idle'), true);
});

test('discovered address requires v3 identity and the paired endpoint UUID', () => {
  assert.equal(identityMatchesPinnedConnection('endpoint-1', 3, 'endpoint-1'), true);
  assert.equal(identityMatchesPinnedConnection('endpoint-1', 3, 'impostor'), false);
  assert.equal(identityMatchesPinnedConnection('endpoint-1', 2, 'endpoint-1'), false);
});
