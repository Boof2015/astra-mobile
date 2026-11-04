import assert from 'node:assert/strict';
import test from 'node:test';
import {
  currentLyricPeekLine,
  initialLyricPeekTransition,
  PEEK_ENTER_MS,
  PEEK_EXIT_MS,
  PEEK_SETTLE_GRACE_MS,
  releaseLyricPeekSlot,
  requestLyricPeek,
  scheduleLyricPeekCompletion,
  watchLyricPeekLine,
  type LyricPeekCue,
  type LyricPeekSelection,
  type LyricPeekSource,
} from './lyricPeekState.ts';

const lines = [
  { timestampMs: 0, text: 'A', words: [{ timestampMs: 0, text: 'A' }] },
  { timestampMs: 2000, text: 'B' },
  { timestampMs: 4000, text: 'C' },
  { timestampMs: 5000, text: '', kind: 'silence' as const },
];
const source: LyricPeekSource = { path: '/a.mp3', lines, duration: 10 };
const [a, b, c]: LyricPeekCue[] = lines.slice(0, 3).map((line, i) => ({ line, endMs: (i + 1) * 2000 }));
const showingA = () => requestLyricPeek(initialLyricPeekTransition(source), source, a, true);

test('ordinary cue changes retain each cue and its timing until the outgoing slot completes', () => {
  const first = showingA();
  const next = requestLyricPeek(first, source, b, true);
  assert.equal(next.slots[next.front]?.cue, b);
  assert.equal(next.slots[first.front]?.cue, a);
  assert.equal(next.slots[first.front]?.cue.line.words, lines[0].words);
  const settled = releaseLyricPeekSlot(next, first.front, next.generation);
  assert.equal(settled.slots[first.front], null);
  assert.equal(settled.slots[settled.front]?.cue, b);
  assert.equal(requestLyricPeek(settled, source, b, true), settled);
});

test('rapid A → B → C and A → B → A cannot stack text or clear a reused slot', () => {
  for (const destination of [a, c]) {
    const first = showingA();
    const second = requestLyricPeek(first, source, b, true);
    const third = requestLyricPeek(second, source, destination, true);
    assert.equal(third.slots.filter(Boolean).length, 2);
    assert.equal(third.slots[third.front]?.cue, destination);
    assert.equal(third.slots[second.front]?.cue, b);
    assert.notEqual(third.slots[third.front]?.id, first.slots[first.front]?.id);
    assert.equal(releaseLyricPeekSlot(third, first.front, second.generation), third);
    assert.equal(releaseLyricPeekSlot(third, third.front, third.generation), third);
    assert.equal(releaseLyricPeekSlot(third, second.front, third.generation).slots[second.front], null);
  }
});

test('a gap fades only the current cue and the next cue cannot revive the discarded exit', () => {
  const second = requestLyricPeek(showingA(), source, b, true);
  const gap = requestLyricPeek(second, source, null, true);
  assert.equal(gap.slots[gap.front], null);
  assert.deepEqual(gap.slots.filter(Boolean).map(slot => slot!.cue), [b]);
  const next = requestLyricPeek(gap, source, c, true);
  assert.deepEqual(next.slots.filter(Boolean).map(slot => slot!.cue), [c]);
  assert.equal(releaseLyricPeekSlot(next, second.front, gap.generation), next);
});

test('track, payload, hidden, background and absent-lyrics sources clear both old slots immediately', () => {
  const pending = requestLyricPeek(showingA(), source, b, true);
  for (const replacement of [
    { ...source, path: '/b.mp3' },
    { ...source, lines: [...lines] },
    { ...source, lines: null },
    { ...source, lines: [] },
  ]) {
    const cleared = requestLyricPeek(pending, replacement, null, true);
    assert.deepEqual(cleared.slots, [null, null]);
    assert.equal(releaseLyricPeekSlot(cleared, 1 - pending.front, pending.generation), cleared);
    const restored = requestLyricPeek(cleared, source, c, true);
    assert.deepEqual(restored.slots.filter(Boolean).map(slot => slot!.cue), [c]);
    assert.equal(restored.slots[restored.front]?.cue.line.text, 'C');
  }
});

test('reduced motion settles to the newest cue and enabling animation does not replay it', () => {
  const pending = requestLyricPeek(showingA(), source, b, true);
  const settled = requestLyricPeek(pending, source, b, false);
  assert.deepEqual(settled.slots.filter(Boolean).map(slot => slot!.cue), [b]);
  assert.equal(settled.animate, false);
  assert.equal(releaseLyricPeekSlot(settled, 1 - pending.front, pending.generation), settled);
  const enabled = requestLyricPeek(settled, source, b, true);
  assert.equal(enabled.animate, false);
  assert.equal(enabled.generation, settled.generation);
  assert.equal(requestLyricPeek(enabled, source, c, true).animate, true);
  assert.deepEqual(requestLyricPeek(settled, source, null, false).slots, [null, null]);
});

test('native completion cancels its fallback and duplicate completion is ignored', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let completed = 0;
  let settled = 0;
  const lease = scheduleLyricPeekCompletion(PEEK_EXIT_MS, () => completed++, () => settled++);
  lease.finish();
  lease.finish();
  t.mock.timers.tick(1000);
  assert.equal(completed, 1);
  assert.equal(settled, 0);
});

test('missing native completion settles styles before releasing text, for entrance and exit', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const duration of [PEEK_ENTER_MS, PEEK_EXIT_MS]) {
    const events: string[] = [];
    const lease = scheduleLyricPeekCompletion(duration, () => events.push('release'), () => events.push('settle'));
    t.mock.timers.tick(duration + PEEK_SETTLE_GRACE_MS - 1);
    assert.deepEqual(events, []);
    t.mock.timers.tick(1);
    assert.deepEqual(events, ['settle', 'release']);
    lease.finish();
    assert.equal(events.length, 2);
  }
});

test('slot reuse and unmount cancel both the timer and queued native completion', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const lease = scheduleLyricPeekCompletion(PEEK_EXIT_MS, () => calls++, () => calls++);
  lease.cancel();
  lease.finish();
  t.mock.timers.tick(1000);
  assert.equal(calls, 0);
});

function playbackFixture(isPlaying: boolean, input = source) {
  let playback = { path: input.path, currentTime: 0.5 };
  let listener: (() => void) | null = null;
  const selections: LyricPeekSelection[] = [];
  const stop = watchLyricPeekLine({
    source: input, isPlaying, readPlayback: () => playback,
    subscribe: (update) => { listener = update; return () => { listener = null; }; },
    changed: (selection) => selections.push(selection),
  });
  return {
    stop, selections,
    change: (next: typeof playback) => { playback = next; listener?.(); },
    latest: () => selections.at(-1)?.line,
    subscribed: () => listener !== null,
  };
}

test('the initial playing tick anchors at the current wall time, then follows cue changes and gaps', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 1_800_000_000_000 });
  const fixture = playbackFixture(true);
  await Promise.resolve();
  assert.equal(fixture.latest(), lines[0]);
  t.mock.timers.tick(2000);
  assert.equal(fixture.latest(), lines[1]);
  fixture.change({ path: source.path, currentTime: 4.5 });
  assert.equal(fixture.latest(), lines[2]);
  fixture.change({ path: source.path, currentTime: 0.5 });
  assert.equal(fixture.latest(), lines[0]);
  fixture.change({ path: source.path, currentTime: 5.5 });
  assert.equal(fixture.latest(), null);
  fixture.stop();
});

test('paused playback retains its cue while authoritative seeks still update it', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 100_000 });
  const fixture = playbackFixture(false);
  await Promise.resolve();
  t.mock.timers.tick(10_000);
  assert.equal(fixture.latest(), lines[0]);
  assert.equal(fixture.selections.length, 1);
  fixture.change({ path: source.path, currentTime: 3 });
  assert.equal(fixture.latest(), lines[1]);
  fixture.stop();
});

test('source cleanup before the queued tick prevents any publication or later polling', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 100_000 });
  const fixture = playbackFixture(true);
  fixture.stop();
  await Promise.resolve();
  t.mock.timers.tick(5000);
  assert.equal(fixture.subscribed(), false);
  assert.deepEqual(fixture.selections, []);
});

test('a playback track change cannot publish the previous track using the new progress', async () => {
  const fixture = playbackFixture(false);
  fixture.change({ path: '/b.mp3', currentTime: 4.5 });
  await Promise.resolve();
  assert.deepEqual(fixture.selections, []);
  fixture.stop();
});

test('render rejects an old source before effects run, even across A → B → A or refreshed lyrics', () => {
  const old = { source, line: lines[0] };
  assert.equal(currentLyricPeekLine(source, old), lines[0]);
  for (const next of [{ ...source }, { ...source, path: '/b.mp3' }, { ...source, lines: [...lines] }, { ...source, lines: null }]) {
    assert.equal(currentLyricPeekLine(next, old), null);
  }
});

test('missing and empty synced lyrics stay empty and cleanly dispose their initial tick', async () => {
  for (const lines of [null, []]) {
    const fixture = playbackFixture(false, { ...source, lines });
    await Promise.resolve();
    assert.equal(fixture.latest(), null);
    fixture.stop();
  }
});
