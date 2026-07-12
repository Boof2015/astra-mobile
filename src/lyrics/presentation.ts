// Lyrics timing + presentation — ported from desktop
// (astra/src/renderer/utils/lyricsPresentation.ts). Pure functions that map a
// playback position onto an active line/word and expand a line list into a
// display list with synthetic instrumental-gap rows. No RN dependencies, so it
// runs under `node --test`. The desktop-only body-state/display-settings copy is
// intentionally omitted; v1 renders furigana + translations unconditionally.

import type {
  LyricsFormat,
  LyricsLine,
  LyricsPayload,
  LyricsSource,
  LyricsTranslation,
  LyricsWord,
} from './types';

export function getLyricsSourceLabel(source: LyricsSource, format?: LyricsFormat): string {
  if (source === 'embedded') return 'Embedded';
  if (source === 'manual') return format === 'xlrc' ? 'Manual XLRC' : 'Manual';
  if (source === 'xlrc') return 'XLRC File';
  if (source === 'lrc') return 'LRC File';
  if (source === 'xlrcdb') return 'XLRCDB';
  return 'LRCLIB';
}

export function getLyricsPayloadSourceLabel(payload: LyricsPayload): string {
  return getLyricsSourceLabel(payload.source, payload.format);
}

export const LYRICS_INFERRED_GAP_THRESHOLD_MS = 10_000;
export const LYRICS_POST_LINE_HOLD_MS = 4_000;
/** Shared display compensation for the full lyrics view and compact lyric peek. */
export const LYRICS_DISPLAY_LEAD_MS = 350;

export interface RenderableSyncedLine {
  line: LyricsLine;
  cueIndex: number;
  displayIndex: number;
}

export type SyncedLyricsDisplayLine =
  | {
      kind: 'lyric';
      line: LyricsLine;
      cueIndex: number;
      afterCueIndex: null;
      displayIndex: number;
      key: string;
      timestampMs: number;
      text: string;
    }
  | {
      kind: 'gap';
      cueIndex: number | null;
      afterCueIndex: number | null;
      displayIndex: number;
      key: string;
      timestampMs: number;
      text: '';
      progressStartMs: number;
      progressEndMs: number | null;
    };

export interface SyncedLyricsTimingOptions {
  durationSeconds?: number | null;
  neutralGapThresholdMs?: number;
  postLineHoldMs?: number;
}

export interface SyncedLyricsTimingState {
  activeCueIndex: number;
  activeLineIndex: number;
  focusLineIndex: number;
  isNeutral: boolean;
}

function toPlaybackTimeMs(currentTimeSeconds: number): number {
  return Number.isFinite(currentTimeSeconds) ? Math.max(0, Math.floor(currentTimeSeconds * 1000)) : 0;
}

function toDurationMs(durationSeconds: number | null | undefined): number | null {
  if (typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return null;
  }
  return Math.floor(durationSeconds * 1000);
}

export function getCompensatedLyricsTime(
  currentTimeSeconds: number,
  durationSeconds: number | null | undefined,
  effectiveDelayMs: number
): number {
  const normalizedTime = Number.isFinite(currentTimeSeconds) ? Math.max(0, currentTimeSeconds) : 0;
  const normalizedDelaySeconds = Number.isFinite(effectiveDelayMs) ? Math.max(0, effectiveDelayMs) / 1000 : 0;
  const compensatedTime = Math.max(0, normalizedTime - normalizedDelaySeconds);
  if (typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return compensatedTime;
  }
  return Math.min(durationSeconds, compensatedTime);
}

export function getLyricsLineSeekTimeSeconds(
  timestampMs: number,
  durationSeconds: number | null | undefined,
  effectiveDelayMs: number
): number | null {
  if (!Number.isFinite(timestampMs) || timestampMs < 0) return null;

  const normalizedDelaySeconds = Number.isFinite(effectiveDelayMs) ? Math.max(0, effectiveDelayMs) / 1000 : 0;
  const seekTimeSeconds = Math.max(0, timestampMs / 1000 + normalizedDelaySeconds);
  if (typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return seekTimeSeconds;
  }
  return Math.min(durationSeconds, seekTimeSeconds);
}

export function isRenderableSyncedLine(line: LyricsLine): boolean {
  return line.kind !== 'silence' && line.text.trim().length > 0;
}

export function getRenderableSyncedLines(lines: LyricsLine[]): RenderableSyncedLine[] {
  const renderableLines: RenderableSyncedLine[] = [];
  lines.forEach((line, cueIndex) => {
    if (!isRenderableSyncedLine(line)) return;
    renderableLines.push({
      line,
      cueIndex,
      displayIndex: renderableLines.length,
    });
  });
  return renderableLines;
}

function findNextRenderableLineTimestamp(lines: LyricsLine[], startIndex: number): number | null {
  for (let index = startIndex; index < lines.length; index += 1) {
    if (isRenderableSyncedLine(lines[index])) return lines[index].timestampMs;
  }
  return null;
}

export function getSyncedLyricsDisplayLines(
  lines: LyricsLine[],
  options: SyncedLyricsTimingOptions = {}
): SyncedLyricsDisplayLine[] {
  const displayLines: SyncedLyricsDisplayLine[] = [];
  const postLineHoldMs = options.postLineHoldMs ?? LYRICS_POST_LINE_HOLD_MS;
  const neutralGapThresholdMs = options.neutralGapThresholdMs ?? LYRICS_INFERRED_GAP_THRESHOLD_MS;
  const durationMs = toDurationMs(options.durationSeconds);

  lines.forEach((line, cueIndex) => {
    const displayIndex = displayLines.length;
    if (isRenderableSyncedLine(line)) {
      displayLines.push({
        kind: 'lyric',
        line,
        cueIndex,
        afterCueIndex: null,
        displayIndex,
        key: `lyric:${line.timestampMs}:${cueIndex}`,
        timestampMs: line.timestampMs,
        text: line.text,
      });

      const nextCue = lines[cueIndex + 1] ?? null;
      const nextCueGapMs = nextCue ? nextCue.timestampMs - line.timestampMs : null;
      const outroGapMs = durationMs === null ? null : durationMs - line.timestampMs;
      const shouldInsertGap =
        (nextCueGapMs !== null && nextCueGapMs >= neutralGapThresholdMs) ||
        (!nextCue && outroGapMs !== null && outroGapMs >= neutralGapThresholdMs);

      if (shouldInsertGap) {
        const gapTimestampMs = line.timestampMs + postLineHoldMs;
        const progressEndMs = findNextRenderableLineTimestamp(lines, cueIndex + 1) ?? durationMs;
        displayLines.push({
          kind: 'gap',
          cueIndex: null,
          afterCueIndex: cueIndex,
          displayIndex: displayLines.length,
          key: `gap-after:${line.timestampMs}:${cueIndex}`,
          timestampMs: gapTimestampMs,
          text: '',
          progressStartMs: line.timestampMs,
          progressEndMs,
        });
      }
      return;
    }

    if (line.kind !== 'silence') return;
    const progressEndMs = findNextRenderableLineTimestamp(lines, cueIndex + 1) ?? durationMs;
    displayLines.push({
      kind: 'gap',
      cueIndex,
      afterCueIndex: null,
      displayIndex,
      key: `gap-cue:${line.timestampMs}:${cueIndex}`,
      timestampMs: line.timestampMs,
      text: '',
      progressStartMs: line.timestampMs,
      progressEndMs,
    });
  });

  return displayLines;
}

export function getSyncedLyricsGapProgress(line: SyncedLyricsDisplayLine, currentTimeSeconds: number): number | null {
  if (line.kind !== 'gap') return null;
  if (line.progressEndMs === null || line.progressEndMs <= line.progressStartMs) return null;

  const currentTimeMs = toPlaybackTimeMs(currentTimeSeconds);
  const progress = (currentTimeMs - line.progressStartMs) / (line.progressEndMs - line.progressStartMs);
  return Math.max(0, Math.min(1, progress));
}

export function getPreferredLyricsTranslation(
  line: LyricsLine,
  languagePriority: string[]
): LyricsTranslation | null {
  const translations = line.translations ?? [];
  if (translations.length === 0) return null;

  const normalizedPriority = languagePriority.map((lang) => lang.trim().toLocaleLowerCase()).filter(Boolean);
  for (const preferredLang of normalizedPriority) {
    const match = translations.find((translation) => translation.lang.toLocaleLowerCase() === preferredLang);
    if (match) return match;
  }

  return translations[0] ?? null;
}

export interface LyricsWordTimingState {
  activeWordIndex: number;
  progressByIndex: number[];
}

export function resolveLyricsWordTiming(words: LyricsWord[], currentTimeSeconds: number): LyricsWordTimingState {
  if (words.length === 0) {
    return {
      activeWordIndex: -1,
      progressByIndex: [],
    };
  }

  const currentTimeMs = toPlaybackTimeMs(currentTimeSeconds);
  let activeWordIndex = -1;
  for (let index = 0; index < words.length; index += 1) {
    if (words[index].timestampMs <= currentTimeMs) {
      activeWordIndex = index;
      continue;
    }
    break;
  }

  const progressByIndex = words.map((word, index) => {
    if (index < activeWordIndex) return 1;
    if (index > activeWordIndex || activeWordIndex < 0) return 0;

    const nextWord = words[index + 1] ?? null;
    if (!nextWord || nextWord.timestampMs <= word.timestampMs) return 1;
    return Math.max(0, Math.min(1, (currentTimeMs - word.timestampMs) / (nextWord.timestampMs - word.timestampMs)));
  });

  return {
    activeWordIndex,
    progressByIndex,
  };
}

export function hasRenderableSyncedLines(lines: LyricsLine[]): boolean {
  return lines.some(isRenderableSyncedLine);
}

function findCueIndexAtOrBefore(lines: LyricsLine[], currentTimeMs: number): number {
  if (lines.length === 0) return -1;

  let low = 0;
  let high = lines.length - 1;
  let best = -1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (lines[mid].timestampMs <= currentTimeMs) {
      best = mid;
      low = mid + 1;
      continue;
    }
    high = mid - 1;
  }

  return best;
}

function findDisplayIndexForCueIndex(displayLines: SyncedLyricsDisplayLine[], cueIndex: number): number {
  const match = displayLines.find((line) => line.cueIndex === cueIndex);
  return match?.displayIndex ?? -1;
}

function findGapDisplayIndexAfterCue(displayLines: SyncedLyricsDisplayLine[], cueIndex: number): number {
  const match = displayLines.find((line) => line.kind === 'gap' && line.afterCueIndex === cueIndex);
  return match?.displayIndex ?? -1;
}

function findPreviousDisplayIndex(displayLines: SyncedLyricsDisplayLine[], cueIndex: number): number {
  for (let index = displayLines.length - 1; index >= 0; index -= 1) {
    const displayLineCueIndex = displayLines[index].cueIndex ?? displayLines[index].afterCueIndex;
    if (displayLineCueIndex !== null && displayLineCueIndex <= cueIndex) return displayLines[index].displayIndex;
  }
  return -1;
}

function findNextDisplayIndex(displayLines: SyncedLyricsDisplayLine[], cueIndex: number): number {
  for (const line of displayLines) {
    const displayLineCueIndex = line.cueIndex ?? line.afterCueIndex;
    if (displayLineCueIndex !== null && displayLineCueIndex > cueIndex) return line.displayIndex;
  }
  return -1;
}

function resolveNeutralFocusLineIndex(displayLines: SyncedLyricsDisplayLine[], cueIndex: number): number {
  const currentLineIndex = findDisplayIndexForCueIndex(displayLines, cueIndex);
  if (currentLineIndex >= 0) return currentLineIndex;
  const previousLineIndex = findPreviousDisplayIndex(displayLines, cueIndex);
  if (previousLineIndex >= 0) return previousLineIndex;
  const nextLineIndex = findNextDisplayIndex(displayLines, cueIndex);
  if (nextLineIndex >= 0) return nextLineIndex;
  return -1;
}

export function resolveSyncedLyricsTiming(
  lines: LyricsLine[],
  currentTimeSeconds: number,
  options: SyncedLyricsTimingOptions = {}
): SyncedLyricsTimingState {
  const renderableLines = getRenderableSyncedLines(lines);
  const displayLines = getSyncedLyricsDisplayLines(lines, options);
  if (renderableLines.length === 0) {
    return {
      activeCueIndex: -1,
      activeLineIndex: -1,
      focusLineIndex: -1,
      isNeutral: true,
    };
  }

  const currentTimeMs = toPlaybackTimeMs(currentTimeSeconds);
  const latestCueIndex = findCueIndexAtOrBefore(lines, currentTimeMs);
  if (latestCueIndex < 0) {
    return {
      activeCueIndex: -1,
      activeLineIndex: -1,
      focusLineIndex: 0,
      isNeutral: true,
    };
  }

  const latestCue = lines[latestCueIndex];
  if (!isRenderableSyncedLine(latestCue)) {
    return {
      activeCueIndex: latestCueIndex,
      activeLineIndex: -1,
      focusLineIndex: resolveNeutralFocusLineIndex(displayLines, latestCueIndex),
      isNeutral: true,
    };
  }

  const displayIndex = findDisplayIndexForCueIndex(displayLines, latestCueIndex);
  const postLineHoldMs = options.postLineHoldMs ?? LYRICS_POST_LINE_HOLD_MS;
  const neutralGapThresholdMs = options.neutralGapThresholdMs ?? LYRICS_INFERRED_GAP_THRESHOLD_MS;
  const nextCue = lines[latestCueIndex + 1] ?? null;
  const nextCueGapMs = nextCue ? nextCue.timestampMs - latestCue.timestampMs : null;
  const shouldNeutralizeForNextCue =
    nextCueGapMs !== null &&
    nextCueGapMs >= neutralGapThresholdMs &&
    currentTimeMs >= latestCue.timestampMs + postLineHoldMs;

  const durationMs = toDurationMs(options.durationSeconds);
  const outroGapMs = durationMs === null ? null : durationMs - latestCue.timestampMs;
  const shouldNeutralizeForOutro =
    !nextCue &&
    outroGapMs !== null &&
    outroGapMs >= neutralGapThresholdMs &&
    currentTimeMs >= latestCue.timestampMs + postLineHoldMs;

  if (shouldNeutralizeForNextCue || shouldNeutralizeForOutro) {
    const gapDisplayIndex = findGapDisplayIndexAfterCue(displayLines, latestCueIndex);
    return {
      activeCueIndex: latestCueIndex,
      activeLineIndex: -1,
      focusLineIndex: gapDisplayIndex >= 0 ? gapDisplayIndex : displayIndex,
      isNeutral: true,
    };
  }

  return {
    activeCueIndex: latestCueIndex,
    activeLineIndex: displayIndex,
    focusLineIndex: displayIndex,
    isNeutral: false,
  };
}

export function findActiveSyncedLineIndex(
  lines: LyricsLine[],
  currentTimeSeconds: number,
  options: SyncedLyricsTimingOptions = {}
): number {
  return resolveSyncedLyricsTiming(lines, currentTimeSeconds, options).activeLineIndex;
}

/** The raw active lyric cue, or null while playback is in a neutral gap. */
export function getActiveSyncedLyricsLine(
  lines: LyricsLine[],
  currentTimeSeconds: number,
  options: SyncedLyricsTimingOptions = {}
): LyricsLine | null {
  const timing = resolveSyncedLyricsTiming(lines, currentTimeSeconds, options);
  if (timing.isNeutral || timing.activeCueIndex < 0) return null;
  const line = lines[timing.activeCueIndex] ?? null;
  return line && isRenderableSyncedLine(line) ? line : null;
}

/**
 * The "MANUAL XLRC • SYNCED" style status chip. Trimmed from the desktop
 * variant so it takes only the pieces the mobile band has, not the full Track.
 */
export function getLyricsMetaChipText(options: {
  hasTrack: boolean;
  result: { status: 'hit'; lyrics: LyricsPayload; cached: boolean } | { status: string; reason?: string } | null;
  hasSyncedLyrics: boolean;
  isLoading: boolean;
}): string {
  const { hasTrack, result, hasSyncedLyrics, isLoading } = options;
  if (!hasTrack) return 'No Track';
  if (isLoading && !result) return 'Loading';
  if (result?.status === 'hit') {
    const hit = result as { status: 'hit'; lyrics: LyricsPayload; cached: boolean };
    const sourceLabel = getLyricsPayloadSourceLabel(hit.lyrics);
    const syncLabel = hasSyncedLyrics ? 'Synced' : 'Unsynced';
    const cachedLabel = hit.cached ? ' • Cached' : '';
    return `${sourceLabel} • ${syncLabel}${cachedLabel}`;
  }
  if (result?.status === 'transient_error') return 'Error';
  if (result?.status === 'not_found') {
    const reason = (result as { reason?: string }).reason;
    if (reason === 'online-disabled') return 'Online Off';
    if (reason === 'provider-unavailable') return 'Lyrics Slow';
    return 'Not Found';
  }
  return 'Ready';
}
