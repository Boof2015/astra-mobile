// Per-track oscilloscope display gain.
//
// The oscilloscope tap sits right after the normalization processor, so each track
// arrives at a different level (loudness normalization scales quiet and loud masters
// by different amounts). A single fixed display gain therefore buries quiet tracks
// and clips loud ones. Instead we pick ONE gain per track that maps the track's peak
// to a consistent display height, and hold it for the whole track — so the song's own
// quiet/loud dynamics are preserved (a constant multiplier doesn't change them) while
// every track lines up to the same reference. It only changes when the track changes.

/** Fallback when the track's peak is unknown (not yet analyzed / untagged). */
export const DEFAULT_OSC_GAIN = 1.8;

// Map the track's (post-normalization) peak to this fraction of the half-height,
// leaving a little headroom so the line doesn't kiss the edges.
const TARGET_LEVEL = 0.85;
const MIN_OSC_GAIN = 0.5;
const MAX_OSC_GAIN = 8; // cap so a very quiet master doesn't blow up to noise

/**
 * Display gain for the oscilloscope given the track's pre-normalization linear peak
 * and the normalization gain currently applied (the tap is post-normalization, so the
 * level it sees is `basePeak * normGain`). Returns {@link DEFAULT_OSC_GAIN} when the
 * peak is unknown.
 */
export function computeOscilloscopeGain(basePeak: number | null, normGain: number): number {
  if (basePeak == null || !(basePeak > 0)) return DEFAULT_OSC_GAIN;
  const postNormPeak = basePeak * (normGain > 0 ? normGain : 1);
  if (!(postNormPeak > 0)) return DEFAULT_OSC_GAIN;
  const gain = TARGET_LEVEL / postNormPeak;
  return Math.max(MIN_OSC_GAIN, Math.min(MAX_OSC_GAIN, gain));
}
