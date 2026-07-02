// Fire-and-forget analysis half of normalization. Bulk registration of every
// ALREADY-ANALYZED queued track's gain lives in gainRegistry.ts (started below);
// this hook covers what the registry can't know synchronously: it measures the
// current track + the next few queued tracks on demand (decode-ahead) and registers
// each late-arriving result natively by URL, so the player picks it up at the media
// transition — or, for the current track, via a smooth native glide (the track is
// already playing at the fallback "temp" gain from sample zero; activation never
// yanks the volume). Also owns the oscilloscope's per-track display gain. Renders
// nothing — mount once near the root.

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
import { ensureGainRegistryStarted } from '@/audio/gainRegistry';

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
    // Idempotent (also started from the headless PlaybackService).
    ensureGainRegistryStarted();

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
      // decodes+stores on a miss (lazy backfill for pre-scan tracks). During the
      // await the track is already playing at the conservative fallback gain
      // (gainRegistry) — never at unity/full volume.
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
      // it active now (mount / settings change / late measurement fire no media-item
      // transition). Activation glides natively (~1.2s) — usually a small upward
      // correction from the fallback gain, never a hard step.
      setTrackGainNative(path, resolved.linearGain);
      activateTrackGainNative(path);

      // Pick the oscilloscope's per-track display gain from the track's peak and the
      // gain we just applied (the scope tap is post-normalization). Held constant for
      // the whole track, so dynamics within the song are preserved.
      const basePeak =
        facts.samplePeak ?? facts.replayGainTrackPeak ?? facts.replayGainAlbumPeak ?? null;
      useScopeStore.getState().setOscGain(computeOscilloscopeGain(basePeak, resolved.linearGain));
    }

    // MEASURE the next several upcoming tracks' loudness while the current one plays
    // (decode-ahead for tracks with no facts yet), and register each late-arriving
    // result natively by URL — so when the player advances, the gain is in the map
    // and applies at the transition with no JS in the loop. Already-analyzed tracks
    // are bulk-registered by gainRegistry; re-registering them here is a harmless
    // cheap DB hit with the same value. Looking a few ahead (not just the immediate
    // next) means a song added several positions back is still measured with plenty
    // of lead time. Derived from the queue mirror, so it re-runs on reorder /
    // add-next / advance. Deduped + DB-cached + native-semaphore-capped.
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
