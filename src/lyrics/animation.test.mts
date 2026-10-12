import assert from 'node:assert/strict';
import test from 'node:test';
import { lyricGapProgress, lyricOpacity, lyricStagger, lyricWordProgress, mobileLyricRipple, mobileLyricStagger, MOBILE_LYRICS_MOTION, MOBILE_NATIVE_SCROLL_MS } from './animation.ts';
import { getSyncedLyricsDisplayLines, getSyncedLyricsGapProgress, resolveLyricsWordTiming } from './presentation.ts';

test('shared UI word clock matches presentation through duplicate cues and backward seeks', () => {
  const words = [1000, 1600, 1600, 3000].map(timestampMs => ({ timestampMs, text: 'word' }));
  for (const time of [0, 1, 1.3, 1.6, 2, 3, 10, 1.1, 0]) {
    assert.deepEqual(words.map((word, i) => lyricWordProgress(word.timestampMs, words[i + 1]?.timestampMs, time)), resolveLyricsWordTiming(words, time).progressByIndex);
  }
});

test('gap UI clock matches instrumental presentation, including seeks and unknown ends', () => {
  const gap = getSyncedLyricsDisplayLines([
    { timestampMs: 1000, text: '', kind: 'silence' }, { timestampMs: 6000, text: 'Hello' },
  ]).find(item => item.kind === 'gap')!;
  assert.equal(gap.kind, 'gap');
  if (gap.kind !== 'gap') return;
  for (const time of [0, 1, 3, 6, 9, 2]) assert.equal(lyricGapProgress(gap.progressStartMs, gap.progressEndMs, time), getSyncedLyricsGapProgress(gap, time));
  assert.equal(lyricGapProgress(1000, null, 5), 0);
  assert.equal(lyricGapProgress(1000, 1000, 5), 0);
});

test('TV motion defaults retain readable emphasis and a bounded upcoming stagger', () => {
  assert.equal(lyricStagger(-3), 0);
  assert.equal(lyricStagger(2), 90);
  assert.equal(lyricStagger(100), 360);
  assert.equal(lyricOpacity(0, true), 1);
  assert.ok(lyricOpacity(-1, false) > lyricOpacity(-2, false));
  assert.ok(lyricOpacity(1, false) > lyricOpacity(2, false));
});

test('mobile keeps the active cue immediate and caps its ripple on tall viewports', () => {
  assert.equal(mobileLyricStagger(-1), 0);
  assert.equal(mobileLyricStagger(0), 0);
  assert.ok(mobileLyricStagger(1) > 0);
  assert.ok(mobileLyricStagger(2) > mobileLyricStagger(1));
  assert.equal(mobileLyricStagger(50), mobileLyricStagger(4));
  assert.ok(MOBILE_LYRICS_MOTION.moveMs + mobileLyricStagger(50) < 400);
  assert.equal(MOBILE_LYRICS_MOTION.emphasisMs, MOBILE_LYRICS_MOTION.moveMs);
});

test('native scrolling needs no whole-line compensation at either end of a ripple', () => {
  for (const delta of [-200, 0, 80, 250]) {
    for (const distance of [-2, 0, 1, 4, 20]) {
      const delay = mobileLyricStagger(distance);
      assert.equal(Math.abs(mobileLyricRipple(delta, 0, delay)), 0);
      assert.equal(Math.abs(mobileLyricRipple(delta, MOBILE_NATIVE_SCROLL_MS + delay, delay)), 0);
      for (let time = 0; time <= 400; time += 4) {
        const offset = mobileLyricRipple(delta, time, delay);
        assert.ok(Math.abs(offset) <= Math.abs(delta));
        if (distance <= 0) assert.equal(Math.abs(offset), 0);
        // A delayed row follows a continuous, monotonic path, including the
        // interval after the native scroll has reached its destination.
        const nativeAt = (t: number) => delta * (1 - Math.cos(Math.PI * Math.min(1, t / MOBILE_NATIVE_SCROLL_MS))) / 2;
        const before = nativeAt(time) - offset;
        const after = nativeAt(time + 1) - mobileLyricRipple(delta, time + 1, delay);
        assert.ok(delta >= 0 ? after >= before - 1e-10 : after <= before + 1e-10);
      }
    }
  }
});
