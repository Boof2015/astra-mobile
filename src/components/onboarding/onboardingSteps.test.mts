import assert from 'node:assert/strict';
import test from 'node:test';
import {
  backFrom,
  nextPage,
  onboardingSequence,
  onboardingSteps,
  progressFill,
  stepPosition,
  type OnboardingContext,
} from './onboardingSteps.ts';

const fresh: OnboardingContext = { localMusic: false, notificationPermission: 'prompt', notificationsShown: false };
const scanning: OnboardingContext = { ...fresh, localMusic: true };

test('a server-only or empty setup never asks for notifications', () => {
  assert.deepEqual(onboardingSequence(fresh), ['welcome', 'music', 'portraits', 'theme', 'player', 'done']);
});

test('a folder scan adds the notifications page while the grant is missing', () => {
  assert.deepEqual(onboardingSequence(scanning), ['welcome', 'music', 'notifications', 'portraits', 'theme', 'player', 'done']);
  assert.ok(onboardingSequence({ ...scanning, notificationPermission: null }).includes('notifications'));
  assert.ok(onboardingSequence({ ...scanning, notificationPermission: 'denied' }).includes('notifications'));
});

test('an already-held or unneeded grant skips the page', () => {
  assert.ok(!onboardingSequence({ ...scanning, notificationPermission: 'granted' }).includes('notifications'));
  assert.ok(!onboardingSequence({ ...scanning, notificationPermission: 'not_required' }).includes('notifications'));
});

test('once shown, the notifications page stays even after the grant lands', () => {
  const granted: OnboardingContext = { ...scanning, notificationPermission: 'granted', notificationsShown: true };
  assert.ok(onboardingSequence(granted).includes('notifications'));
  assert.deepEqual(backFrom('portraits', granted), { page: 'notifications' });
});

test('continue walks the sequence and the server sub-page continues from music', () => {
  assert.equal(nextPage('welcome', fresh), 'music');
  assert.equal(nextPage('music', scanning), 'notifications');
  assert.equal(nextPage('server', fresh), 'portraits');
  assert.equal(nextPage('player', fresh), 'done');
  assert.equal(nextPage('done', fresh), null);
});

test('back: sub-page to its step, step to the previous step, bookends special', () => {
  assert.deepEqual(backFrom('server', fresh), { page: 'music' });
  assert.deepEqual(backFrom('music', fresh), { page: 'welcome' });
  assert.deepEqual(backFrom('theme', fresh), { page: 'portraits' });
  assert.equal(backFrom('welcome', fresh), 'exit');
  assert.equal(backFrom('done', fresh), 'stay');
  assert.equal(backFrom('server', fresh, { busy: true }), 'stay');
});

test('progress: appearance is one step that half-fills on the theme page', () => {
  assert.deepEqual(onboardingSteps(fresh), ['music', 'portraits', 'appearance']);
  assert.deepEqual(progressFill('music', fresh), [1, 0, 0]);
  assert.deepEqual(progressFill('server', fresh), [1, 0, 0]);
  assert.deepEqual(progressFill('theme', fresh), [1, 1, 0.5]);
  assert.deepEqual(progressFill('player', fresh), [1, 1, 1]);
  assert.deepEqual(stepPosition('portraits', scanning), { index: 3, count: 4 });
  assert.equal(stepPosition('welcome', fresh), null);
});
