// Analyze the current track and prefetch upcoming waveforms, including when
// normalization is disabled. Register measured gains for native playback and update
// the oscilloscope's display gain. gainRegistry handles cached gains for the full queue.
// Mount once near the root; this hook renders nothing.

import { useEffect } from 'react';
import { usePlayerStore } from '@/stores/playerStore';
import { useQueueStore } from '@/stores/queueStore';
import { useAudioSettingsStore } from '@/stores/audioSettingsStore';
import { resolveNormalizationGain, type LoudnessFacts } from '@/audio/normalization';
import {
  reconcileAnalysisPrefetch,
  activeAnalysisPaths,
  cancelTrackAnalysis,
  setCurrentAnalysisPath,
  ensureTrackAnalysis,
} from '@/audio/trackAnalysis';
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

      // Remote sources never enter the offline analysis coordinator.
      if (current?.sourceType && current.sourceType !== 'local') {
        setNormalizationGainNative(1);
        useScopeStore.getState().setOscGain(DEFAULT_OSC_GAIN);
        return;
      }
      // Waveforms are independent of normalization. Restore unity immediately while
      // the waveform-only job continues in the background.
      if (!settings.enabled) {
        setNormalizationGainNative(1);
        setTrackGainNative(path, 1);
        activateTrackGainNative(path);
        useScopeStore.getState().setOscGain(DEFAULT_OSC_GAIN);
        void ensureTrackAnalysis(path, { durationMs: (current?.duration ?? 0) * 1000 }).catch(() => {});
        return;
      }

      // ensureTrackAnalysis is cheap when already analyzed (two DB reads) and decodes on a
      // miss — one pass covering both loudness and the seek bar's waveform. During the
      // await the track is already playing at the conservative fallback gain
      // (gainRegistry) — never at unity/full volume.
      let facts = EMPTY_FACTS;
      try {
        const result = await ensureTrackAnalysis(path, { durationMs: (current?.duration ?? 0) * 1000 });
        if (result.cancelled) return;
        facts = result.facts;
        if (cancelled) return;
        // Track changed during the await — let the newer recompute win.
        if (usePlayerStore.getState().currentTrack?.path !== path) return;
      } catch {
        /* fall back to unity via EMPTY_FACTS */
      }

      const resolved = resolveNormalizationGain(facts, useAudioSettingsStore.getState().asNormalizationSettings());
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

    // Reconcile the prefetch window before submitting work so skips, reorders, and
    // removals release obsolete jobs. Waveforms and any needed loudness share a pass;
    // registering gains by URL makes them available at the native track transition.
    function prefetchUpcoming(): void {
      const { tracks, activeIndex } = useQueueStore.getState();
      const upcoming = activeIndex < 0
        ? []
        : tracks.slice(activeIndex + 1, activeIndex + 1 + PREFETCH_AHEAD).filter((track) =>
          typeof track.url === 'string' &&
          (track.url.startsWith('file://') || track.url.startsWith('content://')) &&
          (!track.sourceType || track.sourceType === 'local')
        );
      reconcileAnalysisPrefetch(upcoming.map((track) => track.url as string));
      const currentPath = usePlayerStore.getState().currentTrack?.path;
      for (const queued of upcoming) {
        const url = queued.url as string;
        if (url === currentPath) continue;
        void ensureTrackAnalysis(url, {
          priority: 'prefetch', durationMs: (queued.duration ?? 0) * 1000,
        }).then(({ facts, cancelled: analysisCancelled }) => {
          if (cancelled || analysisCancelled) return;
          const settings = useAudioSettingsStore.getState().asNormalizationSettings();
          setTrackGainNative(url, resolveNormalizationGain(facts, settings).linearGain);
        }).catch(() => {});
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

    // Register foreground intent synchronously; prefetch remains debounced.
    const unsubTrack = usePlayerStore.subscribe((state, prev) => {
      if (state.currentTrack?.path !== prev.currentTrack?.path) {
        setCurrentAnalysisPath(state.currentTrack?.path ?? null);
        void recompute();
        schedulePrefetch();
      }
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
        if (state.normalizationEnabled !== prev.normalizationEnabled || state.replayGainEnabled !== prev.replayGainEnabled) {
          // A waveform-only pass cannot retroactively meter samples already consumed.
          // Re-request under the new requirements after the old attempts drain.
          for (const path of activeAnalysisPaths()) cancelTrackAnalysis(path);
        }
        void recompute();
        // Upcoming tracks' gains depend on the same settings — re-register them.
        schedulePrefetch();
      }
    });
    setCurrentAnalysisPath(usePlayerStore.getState().currentTrack?.path ?? null);
    void recompute();
    schedulePrefetch();

    return () => {
      cancelled = true;
      if (prefetchTimer) clearTimeout(prefetchTimer);
      unsubTrack();
      unsubQueue();
      unsubSettings();
    };
  }, []);
}
