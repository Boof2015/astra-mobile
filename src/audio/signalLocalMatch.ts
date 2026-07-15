import type { SignalPayload } from '@boof2015/astra-signal';

export interface SignalMatchableTrack {
  path: string;
  title: string;
  artist: string;
  duration: number;
}

export interface SignalLocalCandidate<T extends SignalMatchableTrack> {
  track: T;
  match: 'exact' | 'normalized';
  durationDeltaSec: number | null;
}

export type SignalLocalMatchResult<T extends SignalMatchableTrack> =
  | { kind: 'match'; candidate: SignalLocalCandidate<T> }
  | { kind: 'ambiguous'; candidates: SignalLocalCandidate<T>[] }
  | { kind: 'none' };

type SignalIdentity = Pick<SignalPayload, 'artist' | 'title' | 'durationSec'>;

const EXACT_DURATION_TOLERANCE_SEC = 3;
const NORMALIZED_DURATION_TOLERANCE_SEC = 2;

function exactTextForm(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

function relaxedTextForm(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function usableDuration(value: number): number | null {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function byDurationThenPath<T extends SignalMatchableTrack>(
  left: SignalLocalCandidate<T>,
  right: SignalLocalCandidate<T>
): number {
  const leftDelta = left.durationDeltaSec ?? Number.POSITIVE_INFINITY;
  const rightDelta = right.durationDeltaSec ?? Number.POSITIVE_INFINITY;
  return leftDelta - rightDelta || left.track.path.localeCompare(right.track.path);
}

function resultFromCandidates<T extends SignalMatchableTrack>(
  candidates: SignalLocalCandidate<T>[]
): SignalLocalMatchResult<T> {
  candidates.sort(byDurationThenPath);
  if (candidates.length === 0) return { kind: 'none' };
  if (candidates.length === 1) return { kind: 'match', candidate: candidates[0] };
  return { kind: 'ambiguous', candidates };
}

/**
 * Resolve a decoded Signal against the already-loaded on-device library.
 *
 * Punctuation-preserving comparisons always win. A punctuation/diacritic-
 * insensitive fallback is only accepted when both sides have usable, closely
 * matching durations, so names such as N!GHT retain their stronger identity.
 */
export function matchSignalToLibrary<T extends SignalMatchableTrack>(
  signal: SignalIdentity,
  tracks: readonly T[]
): SignalLocalMatchResult<T> {
  const signalTitle = exactTextForm(signal.title);
  const signalArtist = exactTextForm(signal.artist);
  if (!signalTitle || !signalArtist) return { kind: 'none' };

  const relaxedSignalTitle = relaxedTextForm(signal.title);
  const relaxedSignalArtist = relaxedTextForm(signal.artist);
  const signalDuration = usableDuration(signal.durationSec);
  const exact: SignalLocalCandidate<T>[] = [];
  const normalized: SignalLocalCandidate<T>[] = [];

  for (const track of tracks) {
    const title = exactTextForm(track.title);
    const artist = exactTextForm(track.artist);
    const trackDuration = usableDuration(track.duration);
    const durationDeltaSec = signalDuration !== null && trackDuration !== null
      ? Math.abs(signalDuration - trackDuration)
      : null;

    if (title === signalTitle && artist === signalArtist) {
      if (signalDuration !== null && trackDuration === null) continue;
      if (durationDeltaSec !== null && durationDeltaSec > EXACT_DURATION_TOLERANCE_SEC) continue;
      exact.push({ track, match: 'exact', durationDeltaSec });
      continue;
    }

    // Relaxed matching without duration would be too eager: punctuation can be
    // meaningful artist/title data, and a false local match is worse than none.
    if (signalDuration === null || trackDuration === null) continue;
    if (durationDeltaSec === null || durationDeltaSec > NORMALIZED_DURATION_TOLERANCE_SEC) continue;
    if (
      relaxedTextForm(track.title) === relaxedSignalTitle
      && relaxedTextForm(track.artist) === relaxedSignalArtist
    ) {
      normalized.push({ track, match: 'normalized', durationDeltaSec });
    }
  }

  return resultFromCandidates(exact.length > 0 ? exact : normalized);
}
