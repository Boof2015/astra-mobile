import type { LyricsLine } from '../../lyrics/types.ts';

export type LyricsLineTier = 'active' | 'near' | 'far' | 'distant';

export interface LyricsLinePresentation {
  line: LyricsLine;
  tier: LyricsLineTier;
  baseSize: number;
  /** Phone fullscreen reading treatment; companion panes keep their spacing. */
  roomy?: boolean;
  browsing?: boolean;
  activeTimeSeconds: number | null;
  wordTimingEnabled: boolean;
  furiganaEnabled: boolean;
  translationsEnabled: boolean;
  translationPriority: string[];
  voiceLabelsEnabled: boolean;
}

/** Ignore fresh event closures from the clock-driven list, but never suppress
 * a visual change such as entering/leaving manual reading mode.
 */
export function sameLyricsLinePresentation(previous: LyricsLinePresentation, next: LyricsLinePresentation): boolean {
  return previous.line === next.line
    && previous.tier === next.tier
    && previous.baseSize === next.baseSize
    && previous.roomy === next.roomy
    && previous.browsing === next.browsing
    && previous.activeTimeSeconds === next.activeTimeSeconds
    && previous.wordTimingEnabled === next.wordTimingEnabled
    && previous.furiganaEnabled === next.furiganaEnabled
    && previous.translationsEnabled === next.translationsEnabled
    && previous.translationPriority === next.translationPriority
    && previous.voiceLabelsEnabled === next.voiceLabelsEnabled;
}
