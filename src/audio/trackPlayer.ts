import TrackPlayer, {
  AppKilledPlaybackBehavior,
  Capability,
} from 'react-native-track-player';

/**
 * Idempotent RNTP setup. RNTP runs on Media3/ExoPlayer under the hood, which
 * gives us MediaSession (lock screen / notification / Bluetooth / Android Auto)
 * and background playback. The custom Media3 AudioProcessor chain (EQ + PCM
 * scope tap) lands at M3/M4 behind this same module.
 */
let setupPromise: Promise<void> | null = null;

export function setupPlayer(): Promise<void> {
  if (!setupPromise) {
    setupPromise = doSetup().catch((err) => {
      setupPromise = null; // allow a retry on a genuine failure
      throw err;
    });
  }
  return setupPromise;
}

async function doSetup(): Promise<void> {
  try {
    await TrackPlayer.setupPlayer({ autoHandleInterruptions: true });
  } catch (err) {
    // setupPlayer rejects if the player was already initialized (e.g. across a
    // Fast Refresh). That case is safe to ignore; anything else should surface.
    const message = err instanceof Error ? err.message : String(err);
    if (!/already.*initialized/i.test(message)) throw err;
  }

  await TrackPlayer.updateOptions({
    android: {
      appKilledPlaybackBehavior:
        AppKilledPlaybackBehavior.StopPlaybackAndRemoveNotification,
    },
    capabilities: [
      Capability.Play,
      Capability.Pause,
      Capability.Stop,
      Capability.SeekTo,
      Capability.SkipToNext,
      Capability.SkipToPrevious,
    ],
    compactCapabilities: [Capability.Play, Capability.Pause, Capability.SkipToNext],
    progressUpdateEventInterval: 1,
  });
}
