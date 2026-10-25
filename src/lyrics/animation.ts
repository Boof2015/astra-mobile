import type { LyricsFurigana, LyricsLine, LyricsWord } from './types';

export type LyricSegment = { text: string; reading?: string };
export type LyricUnit = { segments: LyricSegment[]; wordIndex?: number };

/** Same interval convention as resolveLyricsWordTiming, on the UI clock. */
export function lyricWordProgress(startMs: number, endMs: number | undefined, seconds: number): number {
  'worklet';
  const ms = seconds * 1000;
  return ms < startMs ? 0 : endMs === undefined || endMs <= startMs ? 1 : Math.min(1, (ms - startMs) / (endMs - startMs));
}

/**
 * The last word has no next tag to end its sweep, and real files don't carry
 * Enhanced LRC's trailing end tag (none of 281 word-timed lines checked,
 * 2026-10-24), so it used to fill the instant it started. Its hold is inferred
 * from the line's own pace, and it finishes `releaseMs` before the line stops
 * being current, where the row loses its clock.
 */
export const LAST_WORD_HOLD = { paceFactor: 2.5, minMs: 500, maxMs: 1600, singleWordMs: 1000, releaseMs: 120 } as const;

/** End of a word's sweep; undefined fills it at once (lyricWordProgress). */
export function lyricWordEndMs(words: LyricsWord[], index: number, rowEndMs: number | null): number | undefined {
  const next = words[index + 1];
  if (next) return next.timestampMs;
  const start = words[index]?.timestampMs;
  if (start === undefined) return undefined;
  const durations = words.slice(1).map((word, i) => word.timestampMs - words[i].timestampMs).filter(ms => ms > 0).sort((a, b) => a - b);
  const hold = durations.length
    ? Math.max(LAST_WORD_HOLD.minMs, Math.min(LAST_WORD_HOLD.maxMs, durations[Math.floor(durations.length / 2)] * LAST_WORD_HOLD.paceFactor))
    : LAST_WORD_HOLD.singleWordMs;
  const end = Math.min(start + hold, rowEndMs === null ? Infinity : rowEndMs - LAST_WORD_HOLD.releaseMs);
  return end > start ? end : undefined;
}

export function lyricSegments(text: string, readings: LyricsFurigana[] = []): LyricSegment[] {
  const result: LyricSegment[] = [];
  let cursor = 0;
  for (const ruby of [...readings].sort((a, b) => a.start - b.start)) {
    if (ruby.start < cursor || ruby.end <= ruby.start || ruby.end > text.length) continue;
    if (ruby.start > cursor) result.push({ text: text.slice(cursor, ruby.start) });
    result.push({ text: text.slice(ruby.start, ruby.end), reading: ruby.reading });
    cursor = ruby.end;
  }
  if (cursor < text.length) result.push({ text: text.slice(cursor) });
  return result;
}

/** Timing units always stay intact, even when the karaoke setting is off. */
export function lyricUnits(line: LyricsLine, furigana: boolean): LyricUnit[] {
  if (line.words?.length) return line.words.map((word, wordIndex) => ({
    wordIndex, segments: lyricSegments(word.text, furigana ? word.furigana : []),
  }));
  const result: LyricUnit[] = [];
  for (const segment of lyricSegments(line.text, furigana ? line.furigana : [])) {
    if (segment.reading) { result.push({ segments: [segment] }); continue; }
    let text = segment.text;
    // Keep okurigana attached to its annotated stem when untimed XLRC has ruby.
    const tail = result.at(-1)?.segments.some(part => part.reading) ? text.match(/^[\p{Script=Hiragana}]+/u)?.[0] : null;
    if (tail) { result.at(-1)!.segments.push({ text: tail }); text = text.slice(tail.length); }
    for (const token of text.match(/(?:[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]\p{Mark}*|[^\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+)\s*|\s+/gu) ?? []) {
      if (/^[、。！？）」』]/u.test(token) && result.length) result.at(-1)!.segments.push({ text: token });
      else result.push({ segments: [{ text: token }] });
    }
  }
  return result;
}

/** Tighten the native flex row until it uses the same number of balanced rows.
 * Widths come from native font measurement, never estimates of CJK/Latin width. */
export function balancedLyricWidth(widths: number[], available: number): number {
  if (!widths.length || widths.some(width => !(width > 0))) return available;
  const rowCount = (limit: number) => {
    let rows = 1, used = 0;
    for (const width of widths) {
      if (used > 0 && used + width > limit + .01) { rows++; used = 0; }
      used += width;
    }
    return rows;
  };
  const rows = rowCount(available);
  if (rows === 1) return available;
  let low = Math.min(available, Math.max(...widths)), high = available;
  for (let i = 0; i < 16; i++) {
    const mid = (low + high) / 2;
    if (rowCount(mid) > rows) low = mid; else high = mid;
  }
  // Yoga rounds to device pixels. Leave a small tolerance at the wrap boundary.
  return Math.min(available, Math.ceil(high) + 1);
}

export function lyricVoices(lines: LyricsLine[]) {
  const voices = [...new Set(lines.filter(line => line.kind !== 'silence').map(line => line.voice?.trim()).filter(Boolean))];
  let previous: string | undefined;
  return lines.map(line => {
    if (line.kind === 'silence') return { right: false, label: null };
    const voice = line.voice?.trim() || undefined;
    const label = voice && voice !== previous ? voice : null;
    previous = voice;
    return { right: !!voice && voices.indexOf(voice) === 1, label };
  });
}

export function lyricOpacity(distance: number, current: boolean) {
  'worklet';
  if (current) return 1;
  return distance < -1 ? .20 : distance < 0 ? .34 : distance <= 1 ? .52 : distance === 2 ? .38 : .28;
}

/** TV motion, expressed in milliseconds and TV-size ratios. */
export const LYRICS_MOTION = {
  moveMs: 820, emphasisMs: 520, liftMs: 320, staggerMs: 45,
  maxStagger: 8, releaseMs: 160, inactiveScale: .965,
} as const;

/** Mobile retains a small ripple, but the entire wave settles in 352ms even on
 * a tall viewport. Emphasis follows the same short transition as movement. */
export const MOBILE_LYRICS_MOTION = {
  moveMs: 280, emphasisMs: 280, liftMs: 160, staggerMs: 18,
  maxStagger: 4, releaseMs: 100, inactiveScale: .965,
} as const;

export function mobileLyricStagger(distance: number): number {
  'worklet';
  return Math.max(0, Math.min(distance, MOBILE_LYRICS_MOTION.maxStagger)) * MOBILE_LYRICS_MOTION.staggerMs;
}

/** Android's native ScrollView uses a 250ms accelerate/decelerate scroll.
 * Add only the small difference between that path and a delayed row. Never
 * compensate a whole native scroll jump: Fabric can draw it a frame later. */
export const MOBILE_NATIVE_SCROLL_MS = 250;

export function mobileLyricRipple(delta: number, elapsed: number, delay: number): number {
  'worklet';
  const progress = (time: number) => {
    'worklet';
    return (1 - Math.cos(Math.PI * Math.max(0, Math.min(1, time / MOBILE_NATIVE_SCROLL_MS)))) / 2;
  };
  return delta * (progress(elapsed) - progress(elapsed - delay));
}

export function lyricStagger(distance: number): number {
  'worklet';
  return Math.max(0, Math.min(distance, LYRICS_MOTION.maxStagger)) * LYRICS_MOTION.staggerMs;
}

export function lyricGapProgress(start: number, end: number | null, seconds: number): number {
  'worklet';
  return end === null || end <= start ? 0 : Math.max(0, Math.min(1, (seconds * 1000 - start) / (end - start)));
}
