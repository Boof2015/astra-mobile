export { balancedLyricWidth, lyricOpacity, lyricSegments, lyricUnits, lyricVoices, lyricWordProgress, type LyricSegment as TvLyricSegment, type LyricUnit as TvLyricUnit } from '../lyrics/animation.ts';

/** Keep one viewport of measured overscan on both sides of the moving lyrics. */
export function lyricInWindow(top: number, height: number, anchor: number): boolean {
  const viewportTop = anchor - 176;
  return top + height >= viewportTop - 540 && top <= viewportTop + 1080;
}
