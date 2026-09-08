import TrackPlayer, { Event } from 'react-native-track-player';
import { initializeCarContextSync } from './carSync';
import { syncWidgetNowPlayingFromTrackPlayer } from './widgetSync';
import { applyNormalizationForActiveTrack } from './applyNormalization';
import { startAudioProcessingWarmup } from './audioProcessingStartup';
import {
  handleVirtualQueueEnded,
  handleVirtualPlaybackAdvance,
  playForCar,
  skipToNext,
  skipToPrevious,
} from './playbackController';
import { nativeIndexToAbsolute } from './queueLoader';
import { useQueueStore } from '@/stores/queueStore';
import { useSleepTimerStore } from '@/stores/sleepTimerStore';
import {
  handleListeningPlaybackState,
  handleListeningProgress,
  handleListeningQueueEnded,
  handleListeningTrackChanged,
  initializeListeningHistoryTracking,
} from './listeningHistoryTracker';

/**
 * RNTP playback service — registered in `index.js`. Runs in a headless context
 * and wires MediaSession / lock-screen / notification / Bluetooth remote
 * controls to the player. Must not depend on React or the JS UI tree.
 */
export async function PlaybackService(): Promise<void> {
  initializeCarContextSync();
  initializeListeningHistoryTracking();
  void useSleepTimerStore.getState().hydrate().catch(() => {});
  // Begin the small fail-closed warm-up before a car/Bluetooth play command can
  // arrive. Full-queue registration and analysis start only after it is safe.
  void startAudioProcessingWarmup('playback-service-start').catch((error) => {
    console.warn('[dsp-startup] headless warm failed', {
      at: Date.now(),
      error: error instanceof Error ? error.name : 'UnknownError',
    });
  });

  // Widgets use an immediate, single-flight refresh. JS timers can suspend
  // after the headless task returns while the Activity is backgrounded.
  let syncingWidget = false;
  let widgetDirty = false;
  const scheduleSync = () => {
    widgetDirty = true;
    if (syncingWidget) return;
    syncingWidget = true;
    void (async () => {
      try {
        while (widgetDirty) {
          widgetDirty = false;
          await syncWidgetNowPlayingFromTrackPlayer();
        }
      } finally { syncingWidget = false; }
    })().catch(() => {});
  };

  // Deferred past the transition frame like the UI hook's recompute: the track
  // already plays at its natively-registered (or fallback) gain from sample
  // zero; this only late-corrects unanalyzed tracks. Rapid skips coalesce.
  let normalizeTimer: ReturnType<typeof setTimeout> | null = null;
  TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, (event) => {
    handleListeningTrackChanged(event);
    // Keep the queue mirror's active index fresh while the tray is unmounted.
    // Natural track advances otherwise leave it stale, and the tray's
    // synchronous first paint would show the old head for a frame before its
    // refreshActiveIndex correction lands (visible flicker on open). Skips and
    // jumps already update it via playbackController; this covers the rest.
    // Cheap: the event carries the index, no queue marshal. Skipped while the
    // mirror is cold so a headless Auto/Bluetooth session never pays for it.
    const queueStore = useQueueStore.getState();
    if (queueStore.hasSnapshot) {
      queueStore.setActiveIndex(
        event.index != null ? nativeIndexToAbsolute(event.index) : -1
      );
    }
    void handleVirtualPlaybackAdvance(event.index).catch((error) => {
      console.warn('[playback] virtual queue replenish failed', error);
    });
    scheduleSync();
    // Apply normalization here too (not just in the UI hook) so playback started from
    // Android Auto / Bluetooth with the app closed is still normalized.
    if (normalizeTimer) clearTimeout(normalizeTimer);
    normalizeTimer = setTimeout(() => {
      normalizeTimer = null;
      void applyNormalizationForActiveTrack();
    }, 300);
  });
  TrackPlayer.addEventListener(Event.PlaybackState, ({ state }) => {
    handleListeningPlaybackState(state);
    scheduleSync();
    void useSleepTimerStore.getState().reconcile();
  });
  TrackPlayer.addEventListener(Event.PlaybackProgressUpdated, ({ position, duration }) => {
    handleListeningProgress(position, duration);
    const timer = useSleepTimerStore.getState();
    void timer.reconcile();
    if (timer.timer?.mode === 'end-of-track') {
      void TrackPlayer.getPlayWhenReady()
        .then((playWhenReady) => timer.reconcileEndOfTrack(position, duration, playWhenReady))
        .catch(() => {});
    }
  });
  TrackPlayer.addEventListener(Event.PlaybackPlayWhenReadyChanged, ({ playWhenReady }) => {
    if (playWhenReady || useSleepTimerStore.getState().timer?.mode !== 'end-of-track') return;
    void TrackPlayer.getProgress()
      .then(({ position, duration }) => useSleepTimerStore.getState().reconcileEndOfTrack(position, duration, playWhenReady))
      .catch(() => {});
  });
  TrackPlayer.addEventListener(Event.PlaybackQueueEnded, ({ position }) => {
    handleListeningQueueEnded(position);
    void handleVirtualQueueEnded().catch((error) => {
      console.warn('[playback] virtual queue end recovery failed', error);
    });
    if (useSleepTimerStore.getState().timer?.mode !== 'end-of-track') return;
    void TrackPlayer.getProgress()
      .then(({ position, duration }) => useSleepTimerStore.getState().reconcileEndOfTrack(position, duration, false))
      .catch(() => {});
  });
  TrackPlayer.addEventListener(Event.RemotePlay, () => {
    void playForCar()
      .catch(() => {})
      .finally(scheduleSync);
  });
  TrackPlayer.addEventListener(Event.RemotePause, () => {
    void TrackPlayer.pause().finally(scheduleSync);
  });
  TrackPlayer.addEventListener(Event.RemoteStop, () => {
    void TrackPlayer.stop().finally(scheduleSync);
  });
  TrackPlayer.addEventListener(Event.RemoteNext, () => {
    void skipToNext()
      .catch(() => {})
      .finally(scheduleSync);
  });
  TrackPlayer.addEventListener(Event.RemotePrevious, () => {
    void skipToPrevious()
      .catch(() => {})
      .finally(scheduleSync);
  });
  TrackPlayer.addEventListener(Event.RemoteSeek, ({ position }) =>
    TrackPlayer.seekTo(position).finally(scheduleSync),
  );
}
