import type { SharedValue } from 'react-native-reanimated';
import type { LyricsLine } from '../../lyrics/types.ts';
import type { LyricsDisplaySettings } from '../../lyrics/displaySettings.ts';

export interface LyricsLinePresentation {
  line: LyricsLine;
  /** When the line stops being current; bounds its last word's sweep. */
  endMs: number | null;
  size: number;
  width: number;
  right: boolean;
  label: string | null;
  clock?: SharedValue<number>;
  warm: boolean;
  reduced: boolean;
  settings: LyricsDisplaySettings;
  onSeek: () => void;
}

/** Clock identity is stable: reading its value here would turn every karaoke
 * frame into a React render. Compare callbacks too, so seeks cannot go stale. */
export function sameLyricsLinePresentation(previous: LyricsLinePresentation, next: LyricsLinePresentation): boolean {
  return previous.line === next.line && previous.endMs === next.endMs && previous.size === next.size && previous.width === next.width
    && previous.right === next.right && previous.label === next.label && previous.clock === next.clock
    && previous.warm === next.warm && previous.reduced === next.reduced && previous.settings === next.settings
    && previous.onSeek === next.onSeek;
}
