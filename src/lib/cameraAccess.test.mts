import assert from 'node:assert/strict';
import test from 'node:test';
import { cameraAccessStatus } from './cameraAccess.ts';

test('no response yet is still checking', () => {
  assert.equal(cameraAccessStatus(null), 'checking');
});

test('granted wins regardless of canAskAgain', () => {
  assert.equal(cameraAccessStatus({ granted: true, canAskAgain: true }), 'granted');
  assert.equal(cameraAccessStatus({ granted: true, canAskAgain: false }), 'granted');
});

test('a denial that can still be asked prompts again', () => {
  assert.equal(cameraAccessStatus({ granted: false, canAskAgain: true }), 'prompt');
});

test("don't-ask-again sends the user to settings", () => {
  assert.equal(cameraAccessStatus({ granted: false, canAskAgain: false }), 'blocked');
});
