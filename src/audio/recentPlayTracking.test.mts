import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceRecentPlayCandidate,
  cancelManualRecentPlayTransition,
  consumeManualRecentPlayTransition,
  createRecentPlayCandidate,
  evaluateRecentPlayCandidate,
  finalizeRecentPlayCandidate,
  MANUAL_RECENT_PLAY_TRANSITION_TTL_MS,
  markManualRecentPlayTransition,
  RECENT_PLAY_MIN_SECONDS,
} from './recentPlayTracking.ts';

function listenedCandidate(durationSeconds: number | null, listenedSeconds: number) {
  const started = createRecentPlayCandidate('/music/test.flac', durationSeconds, true, 0);
  return advanceRecentPlayCandidate(started, false, listenedSeconds * 1_000);
}

test('short-track qualification uses the desktop natural-completion tolerance', () => {
  assert.equal(evaluateRecentPlayCandidate(listenedCandidate(5, 4.499), true).recordPath, null);
  assert.equal(
    evaluateRecentPlayCandidate(listenedCandidate(5, 4.5), true).recordPath,
    '/music/test.flac',
  );
  assert.equal(evaluateRecentPlayCandidate(listenedCandidate(1, 0.899), true).recordPath, null);
  assert.equal(
    evaluateRecentPlayCandidate(listenedCandidate(1, 0.9), true).recordPath,
    '/music/test.flac',
  );
});

test('short tracks never qualify from a manual transition', () => {
  assert.equal(evaluateRecentPlayCandidate(listenedCandidate(5, 5), false).recordPath, null);
  assert.equal(evaluateRecentPlayCandidate(listenedCandidate(14.9, 20), false).recordPath, null);
});

test('fifteen-second, long, and unknown-duration tracks retain the fifteen-second rule', () => {
  assert.equal(RECENT_PLAY_MIN_SECONDS, 15);
  for (const duration of [15, 180, 0, null, Number.NaN]) {
    assert.equal(evaluateRecentPlayCandidate(listenedCandidate(duration, 14.999), true).recordPath, null);
    assert.equal(
      evaluateRecentPlayCandidate(listenedCandidate(duration, 15), false).recordPath,
      '/music/test.flac',
    );
  }
});

test('accumulation excludes paused gaps and position is not part of qualification', () => {
  let candidate = createRecentPlayCandidate('/music/test.flac', 180, true, 1_000);
  candidate = advanceRecentPlayCandidate(candidate, false, 6_000);
  candidate = advanceRecentPlayCandidate(candidate, false, 20_000);
  candidate = advanceRecentPlayCandidate(candidate, true, 25_000);
  candidate = advanceRecentPlayCandidate(candidate, false, 35_000);
  assert.equal(candidate.accumulatedMs, 15_000);
  assert.equal(evaluateRecentPlayCandidate(candidate, false).recordPath, '/music/test.flac');
});

test('natural advance and queue-end finalization reset sessions and stay idempotent', () => {
  const gapless = finalizeRecentPlayCandidate(
    createRecentPlayCandidate('/music/repeat.flac', 5, true, 0),
    true,
    4_500,
  );
  assert.equal(gapless.recordPath, '/music/repeat.flac');
  assert.equal(gapless.candidate.path, null);

  const duplicateQueueEnd = finalizeRecentPlayCandidate(gapless.candidate, true, 4_500);
  assert.equal(duplicateQueueEnd.recordPath, null);

  const repeated = finalizeRecentPlayCandidate(
    createRecentPlayCandidate('/music/repeat.flac', 5, true, 5_000),
    true,
    9_500,
  );
  assert.equal(repeated.recordPath, '/music/repeat.flac');
});

test('an already-recorded long play is not recorded again when it later ends', () => {
  const qualified = evaluateRecentPlayCandidate(listenedCandidate(180, 15), false);
  assert.equal(qualified.recordPath, '/music/test.flac');
  assert.equal(finalizeRecentPlayCandidate(qualified.candidate, true, 20_000).recordPath, null);
});

test('manual transition markers are path-matched, one-shot, cancellable, and expiring', () => {
  markManualRecentPlayTransition('/music/a.flac', 1_000);
  assert.equal(consumeManualRecentPlayTransition('/music/b.flac', 1_100), false);
  assert.equal(consumeManualRecentPlayTransition('/music/a.flac', 1_100), true);
  assert.equal(consumeManualRecentPlayTransition('/music/a.flac', 1_100), false);

  const cancelled = markManualRecentPlayTransition('/music/c.flac', 2_000);
  cancelManualRecentPlayTransition(cancelled);
  assert.equal(consumeManualRecentPlayTransition('/music/c.flac', 2_100), false);

  markManualRecentPlayTransition('/music/d.flac', 3_000);
  assert.equal(
    consumeManualRecentPlayTransition(
      '/music/d.flac',
      3_000 + MANUAL_RECENT_PLAY_TRANSITION_TTL_MS + 1,
    ),
    false,
  );
});
