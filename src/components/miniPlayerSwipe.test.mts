import assert from 'node:assert/strict';
import test from 'node:test';
import {
  miniPlayerSwipeDistance,
  resolveMiniPlayerSwipe,
} from './miniPlayerSwipe.ts';

const MEDIA_WIDTH = 200;

test('maps committed left and right drags to next and previous', () => {
  const threshold = miniPlayerSwipeDistance(MEDIA_WIDTH);

  assert.equal(
    resolveMiniPlayerSwipe({ translationX: -threshold, velocityX: 0, mediaWidth: MEDIA_WIDTH }),
    'next'
  );
  assert.equal(
    resolveMiniPlayerSwipe({ translationX: threshold, velocityX: 0, mediaWidth: MEDIA_WIDTH }),
    'previous'
  );
});

test('commits a short same-direction flick', () => {
  assert.equal(
    resolveMiniPlayerSwipe({ translationX: -20, velocityX: -720, mediaWidth: MEDIA_WIDTH }),
    'next'
  );
  assert.equal(
    resolveMiniPlayerSwipe({ translationX: 20, velocityX: 720, mediaWidth: MEDIA_WIDTH }),
    'previous'
  );
});

test('cancels a short slow swipe', () => {
  assert.equal(
    resolveMiniPlayerSwipe({ translationX: -20, velocityX: -300, mediaWidth: MEDIA_WIDTH }),
    null
  );
});

test('rejects flick velocity that opposes the drag', () => {
  assert.equal(
    resolveMiniPlayerSwipe({ translationX: -20, velocityX: 900, mediaWidth: MEDIA_WIDTH }),
    null
  );
  assert.equal(
    resolveMiniPlayerSwipe({ translationX: 20, velocityX: -900, mediaWidth: MEDIA_WIDTH }),
    null
  );
});

test('requires a measured media width', () => {
  assert.equal(
    resolveMiniPlayerSwipe({ translationX: -80, velocityX: -900, mediaWidth: 0 }),
    null
  );
});
