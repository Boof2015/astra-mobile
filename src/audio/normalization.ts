// Per-track normalization gain — ported from desktop AudioEngine
// `resolveStaticNormalizationGain` / `resolveGainStateForAnalysis`.
//
// Precedence (desktop-match, locked with the user):
//   normalization off            -> unity
//   ReplayGain on + tag present  -> use the tag (clamped)
//   else                         -> targetLufs - scannedLUFS (clamped)
// then back off so peak * linearGain <= 0.98 (peak limiter).

export const NORM_MIN_GAIN_DB = -18;
export const NORM_MAX_GAIN_DB = 6;
export const NORM_PEAK_CEILING_LINEAR = 0.98;
export const DEFAULT_TARGET_LUFS = -12;

export type ReplayGainMode = 'auto' | 'track' | 'album';
export type NormalizationMode = 'off' | 'replaygain' | 'normalization';

export interface LoudnessFacts {
  loudnessLufs: number | null;
  samplePeak: number | null;
  replayGainTrackDb: number | null;
  replayGainAlbumDb: number | null;
  replayGainTrackPeak: number | null;
  replayGainAlbumPeak: number | null;
}

export interface NormalizationSettings {
  enabled: boolean;
  targetLufs: number;
  replayGainEnabled: boolean;
  replayGainMode: ReplayGainMode;
}

export interface ResolvedGain {
  gainDb: number;
  linearGain: number;
  mode: NormalizationMode;
  peakLimited: boolean;
}

const UNITY: ResolvedGain = { gainDb: 0, linearGain: 1, mode: 'off', peakLimited: false };

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

interface PickedReplayGain {
  gainDb: number;
  /** The peak matching the chosen gain (track gain -> track peak), for clip-limiting. */
  peak: number | null;
}

/** Pick the ReplayGain gain+peak to use for the given mode, or null if unavailable. */
function pickReplayGain(facts: LoudnessFacts, mode: ReplayGainMode): PickedReplayGain | null {
  const useTrack: PickedReplayGain | null =
    facts.replayGainTrackDb != null && Number.isFinite(facts.replayGainTrackDb)
      ? { gainDb: facts.replayGainTrackDb, peak: facts.replayGainTrackPeak }
      : null;
  const useAlbum: PickedReplayGain | null =
    facts.replayGainAlbumDb != null && Number.isFinite(facts.replayGainAlbumDb)
      ? { gainDb: facts.replayGainAlbumDb, peak: facts.replayGainAlbumPeak }
      : null;
  switch (mode) {
    case 'track':
      return useTrack ?? useAlbum;
    case 'album':
      return useAlbum ?? useTrack;
    case 'auto':
    default:
      // Album gain keeps relative loudness within an album; prefer it when present.
      return useAlbum ?? useTrack;
  }
}

/**
 * Whether ReplayGain alone can normalize this track (RG on + a usable tag present),
 * so callers can skip the expensive loudness decode for tagged libraries.
 */
export function hasUsableReplayGain(facts: LoudnessFacts, settings: NormalizationSettings): boolean {
  return settings.replayGainEnabled && pickReplayGain(facts, settings.replayGainMode) != null;
}

/** Apply the peak ceiling to a candidate gain. */
function applyPeakLimit(
  gainDb: number,
  samplePeak: number | null
): { gainDb: number; peakLimited: boolean } {
  if (samplePeak == null || samplePeak <= 0) return { gainDb, peakLimited: false };
  const linear = dbToLinear(gainDb);
  if (samplePeak * linear <= NORM_PEAK_CEILING_LINEAR) return { gainDb, peakLimited: false };
  const maxLinear = NORM_PEAK_CEILING_LINEAR / samplePeak;
  const limitedDb = 20 * Math.log10(maxLinear);
  return { gainDb: limitedDb, peakLimited: true };
}

export function resolveNormalizationGain(
  facts: LoudnessFacts,
  settings: NormalizationSettings
): ResolvedGain {
  if (!settings.enabled) return UNITY;

  let gainDb: number;
  let mode: NormalizationMode;
  // Peak used for clip-limiting: the RG tag's own peak in RG mode (falling back to the
  // measured sample peak), or the measured peak for loudness normalization.
  let peak: number | null;

  const rg = settings.replayGainEnabled ? pickReplayGain(facts, settings.replayGainMode) : null;
  if (rg != null) {
    gainDb = clamp(rg.gainDb, NORM_MIN_GAIN_DB, NORM_MAX_GAIN_DB);
    mode = 'replaygain';
    peak = rg.peak ?? facts.samplePeak;
  } else if (facts.loudnessLufs != null && Number.isFinite(facts.loudnessLufs)) {
    gainDb = clamp(settings.targetLufs - facts.loudnessLufs, NORM_MIN_GAIN_DB, NORM_MAX_GAIN_DB);
    mode = 'normalization';
    peak = facts.samplePeak;
  } else {
    // Enabled but nothing measured yet — unity until analysis backfills.
    return { gainDb: 0, linearGain: 1, mode: 'normalization', peakLimited: false };
  }

  const limited = applyPeakLimit(gainDb, peak);
  return {
    gainDb: limited.gainDb,
    linearGain: dbToLinear(limited.gainDb),
    mode,
    peakLimited: limited.peakLimited,
  };
}

// --- Fallback gain for tracks with no facts yet (Poweramp-style temp attenuation) ---
//
// A track that reaches a media-item transition with no registered gain plays at this
// fallback instead of unity: deliberately a touch QUIET, so the later correction is
// a small upward glide (natural) instead of a blast-then-duck (jarring). Derived
// from the library's median loudness when enough tracks are analyzed; otherwise
// assumes an unknown track is a loud modern master.

/** Temp gain never louder than this: errs quiet by construction. */
export const FALLBACK_CEILING_DB = -3;
/** Assumed integrated loudness of an unknown modern master. */
export const FALLBACK_ASSUMED_LUFS = -9;
/** Below this many analyzed tracks, library stats are noise — use the assumption. */
export const FALLBACK_MIN_SAMPLE = 10;

export interface LibraryLoudnessStats {
  /** Tracks with a measured loudness_lufs. */
  lufsCount: number;
  medianLufs: number | null;
  /** Tracks with a ReplayGain track-gain tag. */
  rgCount: number;
  medianRgTrackDb: number | null;
}

/**
 * Resolve the conservative fallback gain applied natively when a transition hits a
 * track with no registered gain. Unity when normalization is off (that is the
 * mechanism keeping map misses at full volume with the feature disabled).
 */
export function resolveFallbackGain(
  stats: LibraryLoudnessStats,
  settings: NormalizationSettings
): { gainDb: number; linearGain: number } {
  if (!settings.enabled) return { gainDb: 0, linearGain: 1 };

  let candidateDb: number;
  if (
    settings.replayGainEnabled &&
    stats.rgCount >= FALLBACK_MIN_SAMPLE &&
    stats.medianRgTrackDb != null &&
    Number.isFinite(stats.medianRgTrackDb)
  ) {
    // RG tags are already "gain to apply" — the median IS the typical gain.
    candidateDb = stats.medianRgTrackDb;
  } else if (
    stats.lufsCount >= FALLBACK_MIN_SAMPLE &&
    stats.medianLufs != null &&
    Number.isFinite(stats.medianLufs)
  ) {
    candidateDb = settings.targetLufs - stats.medianLufs;
  } else {
    candidateDb = settings.targetLufs - FALLBACK_ASSUMED_LUFS;
  }

  const gainDb = clamp(candidateDb, NORM_MIN_GAIN_DB, FALLBACK_CEILING_DB);
  return { gainDb, linearGain: dbToLinear(gainDb) };
}
