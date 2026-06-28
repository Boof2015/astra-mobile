// Owns per-track normalization gain. It reads each track's loudness facts from
// SQLite, resolves the gain, and registers it natively keyed by URL — for the current
// track AND the next few queued tracks. The player then swaps to the matching gain
// natively at the real media-item transition (no JS round-trip on track change). The
// current track is also activated directly here, since on mount / settings change no
// transition fires. Renders nothing — mount once near the root.

import { useEffect } from 'react';
import { usePlayerStore } from '@/stores/playerStore';
import { useQueueStore } from '@/stores/queueStore';
import { useAudioSettingsStore } from '@/stores/audioSettingsStore';
import { resolveNormalizationGain, type LoudnessFacts } from '@/audio/normalization';
import { ensureTrackLoudness } from '@/audio/trackAnalysis';
import {
  setNormalizationGainNative,
  setTrackGainNative,
  activateTrackGainNative,
} from '@/audio/eqNative';
import { useScopeStore } from '@/scope/scopeStore';
import { computeOscilloscopeGain, DEFAULT_OSC_GAIN } from '@/scope/oscilloscopeGain';

const EMPTY_FACTS: LoudnessFacts = {
  loudnessLufs: null,
  samplePeak: null,
  replayGainTrackDb: null,
  replayGainAlbumDb: null,
  replayGainTrackPeak: null,
  replayGainAlbumPeak: null,
};

// How many upcoming queue tracks to pre-measure. Bounded work (native decode
// concurrency is capped at 2); covers songs queued a few positions ahead.
const PREFETCH_AHEAD = 5;

export function useNormalizationSync(): void {
  useEffect(() => {
    let cancelled = false;

    async function recompute(): Promise<void> {
      const current = usePlayerStore.getState().currentTrack;
      const path = current?.path ?? null;
      const settings = useAudioSettingsStore.getState().asNormalizationSettings();
      if (!path) {
        setNormalizationGainNative(1);
        useScopeStore.getState().setOscGain(DEFAULT_OSC_GAIN);
        return;
      }

      // Remote tracks have no local file to decode and no synced loudness/RG facts,
      // so normalization is unity. Skip analysis (it would try to download the stream).
      if (current?.sourceType && current.sourceType !== 'local') {
        setNormalizationGainNative(1);
        useScopeStore.getState().setOscGain(DEFAULT_OSC_GAIN);
        return;
      }

      // ensureTrackLoudness is cheap when already analyzed (single DB read) and
      // decodes+stores on a miss (lazy backfill for pre-scan tracks).
      let facts = EMPTY_FACTS;
      try {
        facts = await ensureTrackLoudness(path);
        if (cancelled) return;
        // Track changed during the await — let the newer recompute win.
        if (usePlayerStore.getState().currentTrack?.path !== path) return;
      } catch {
        /* fall back to unity via EMPTY_FACTS */
      }

      const resolved = resolveNormalizationGain(facts, settings);
      // Seed the native map (so transitioning back to this track picks it up) and make
      // it active now (mount / settings change fire no media-item transition).
      setTrackGainNative(path, resolved.linearGain);
      activateTrackGainNative(path);

      // Pick the oscilloscope's per-track display gain from the track's peak and the
      // gain we just applied (the scope tap is post-normalization). Held constant for
      // the whole track, so dynamics within the song are preserved.
      const basePeak =
        facts.samplePeak ?? facts.replayGainTrackPeak ?? facts.replayGainAlbumPeak ?? null;
      useScopeStore.getState().setOscGain(computeOscilloscopeGain(basePeak, resolved.linearGain));
    }

    // Warm the next several upcoming tracks' loudness while the current one plays, and
    // register each one's resolved gain natively by URL — so when the player advances,
    // the gain is already in the map and gets applied at the transition with no JS in
    // the loop. Looking a few ahead (not just the immediate next) means a song added
    // several positions back is still measured + registered with plenty of lead time.
    // Derived from the queue mirror, so it re-runs on reorder / add-next / advance.
    // Deduped + DB-cached + native-semaphore-capped, so it stays cheap and gentle.
    function prefetchUpcoming(): void {
      const { tracks, activeIndex } = useQueueStore.getState();
      if (activeIndex < 0) return;
      const settings = useAudioSettingsStore.getState().asNormalizationSettings();
      for (let i = 1; i <= PREFETCH_AHEAD; i++) {
        const queued = tracks[activeIndex + i];
        const url = queued?.url;
        if (typeof url !== 'string' || url.length === 0) continue;
        // Remote tracks: unity gain, and decoding the stream URL would download it.
        if (queued?.sourceType && queued.sourceType !== 'local') continue;
        void ensureTrackLoudness(url)
          .then((facts) => {
            if (cancelled) return;
            const resolved = resolveNormalizationGain(facts, settings);
            setTrackGainNative(url, resolved.linearGain);
          })
          .catch(() => {
            /* leave unregistered — defaults to unity at the transition */
          });
      }
    }

    // The queue can change rapidly (drag-reorder); coalesce re-warms.
    let prefetchTimer: ReturnType<typeof setTimeout> | null = null;
    function schedulePrefetch(): void {
      if (prefetchTimer) clearTimeout(prefetchTimer);
      prefetchTimer = setTimeout(() => {
        prefetchTimer = null;
        prefetchUpcoming();
      }, 250);
    }

    const unsubTrack = usePlayerStore.subscribe((state, prev) => {
      if (state.currentTrack?.path !== prev.currentTrack?.path) void recompute();
    });
    const unsubQueue = useQueueStore.subscribe((state, prev) => {
      // Re-warm when the upcoming order changes (reorder, add-next, remove, advance).
      if (state.tracks !== prev.tracks || state.activeIndex !== prev.activeIndex) {
        schedulePrefetch();
      }
    });
    const unsubSettings = useAudioSettingsStore.subscribe((state, prev) => {
      if (
        state.normalizationEnabled !== prev.normalizationEnabled ||
        state.normalizationTargetLufs !== prev.normalizationTargetLufs ||
        state.replayGainEnabled !== prev.replayGainEnabled ||
        state.replayGainMode !== prev.replayGainMode
      ) {
        void recompute();
        // Upcoming tracks' gains depend on the same settings — re-register them.
        schedulePrefetch();
      }
    });
    void recompute();
    prefetchUpcoming();

    return () => {
      cancelled = true;
      if (prefetchTimer) clearTimeout(prefetchTimer);
      unsubTrack();
      unsubQueue();
      unsubSettings();
    };
  }, []);
}
