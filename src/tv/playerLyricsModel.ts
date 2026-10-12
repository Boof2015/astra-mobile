import type { LyricsFurigana, LyricsLine } from '../lyrics/types';

export type TvLyricSegment = { text: string; reading?: string };
export type TvLyricUnit = { segments: TvLyricSegment[]; wordIndex?: number };

/** Same interval convention as resolveLyricsWordTiming, on the UI clock. */
export function lyricWordProgress(startMs: number, endMs: number | undefined, seconds: number): number {
  'worklet';
  const ms = seconds * 1000;
  return ms < startMs ? 0 : endMs === undefined || endMs <= startMs ? 1 : Math.min(1, (ms - startMs) / (endMs - startMs));
}

/** Keep one viewport of measured overscan on both sides of the moving lyrics. */
export function lyricInWindow(top: number, height: number, anchor: number): boolean {
  const viewportTop = anchor - 176;
  return top + height >= viewportTop - 540 && top <= viewportTop + 1080;
}

export function lyricSegments(text: string, readings: LyricsFurigana[] = []): TvLyricSegment[] {
  const result: TvLyricSegment[] = [];
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
export function lyricUnits(line: LyricsLine, furigana: boolean): TvLyricUnit[] {
  if (line.words?.length) return line.words.map((word, wordIndex) => ({
    wordIndex, segments: lyricSegments(word.text, furigana ? word.furigana : []),
  }));
  const result: TvLyricUnit[] = [];
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
  if (current) return 1;
  return distance < -1 ? .20 : distance < 0 ? .34 : distance <= 1 ? .52 : distance === 2 ? .38 : .28;
}
