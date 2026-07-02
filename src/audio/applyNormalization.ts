// Headless-safe per-track normalization. `useNormalizationSync` (the richer version with
// upcoming-track prefetch + oscilloscope gain) is a React hook that only runs while the UI
// is mounted — so playback started from Android Auto / Bluetooth with the app closed never
// got normalized. This applies the current track's gain from the headless PlaybackService.

import TrackPlayer from 'react-native-track-player';
import { useAudioSettingsStore } from '@/stores/audioSettingsStore';
import { resolveNormalizationGain, type LoudnessFacts } from '@/audio/normalization';
import { ensureTrackLoudness } from '@/audio/trackAnalysis';
import {
  activateTrackGainNative,
  setNormalizationGainNative,
  setTrackGainNative,
} from '@/audio/eqNative';

const EMPTY_FACTS: LoudnessFacts = {
  loudnessLufs: null,
  samplePeak: null,
  replayGainTrackDb: null,
  replayGainAlbumDb: null,
  replayGainTrackPeak: null,
  replayGainAlbumPeak: null,
};

/**
 * Resolve + apply the active RNTP track's normalization gain natively. Idempotent and safe
 * to call alongside `useNormalizationSync` (both compute the same gain). Remote tracks get
 * unity (no local file / synced facts, and decoding would download the stream).
 */
export async function applyNormalizationForActiveTrack(): Promise<void> {
  const track = await TrackPlayer.getActiveTrack();
  const url = typeof track?.url === 'string' ? track.url : null;
  if (!url) {
    setNormalizationGainNative(1);
    return;
  }

  const sourceType = typeof track?.sourceType === 'string' ? track.sourceType : undefined;
  if (sourceType && sourceType !== 'local') {
    setNormalizationGainNative(1);
    return;
  }

  await useAudioSettingsStore.getState().load();
  const settings = useAudioSettingsStore.getState().asNormalizationSettings();

  let facts = EMPTY_FACTS;
  try {
    facts = await ensureTrackLoudness(url);
    // Track advanced while we were analyzing — let the newer change win.
    const now = await TrackPlayer.getActiveTrack();
    if (typeof now?.url !== 'string' || now.url !== url) return;
  } catch {
    /* fall back to unity via EMPTY_FACTS */
  }

  const resolved = resolveNormalizationGain(facts, settings);
  // Register by URL (the key the native player swaps on at the media transition) and
  // activate it now, since no transition fires for the already-current track. The
  // track has been playing at the fallback "temp" gain (gainRegistry) meanwhile, and
  // activation glides natively — no burst, no step.
  setTrackGainNative(url, resolved.linearGain);
  activateTrackGainNative(url);
}
