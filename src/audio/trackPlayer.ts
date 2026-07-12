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

export function setupPlayer(options: { allowBackgroundSetup?: boolean } = {}): Promise<void> {
  if (!setupPromise) {
    setupPromise = doSetup(options).catch((err) => {
      setupPromise = null; // allow a retry on a genuine failure
      throw err;
    });
  }
  return setupPromise;
}

async function doSetup(options: { allowBackgroundSetup?: boolean }): Promise<void> {
  try {
    await TrackPlayer.setupPlayer({
      autoHandleInterruptions: true,
      // IMPORTANT: pass the WHOLE buffer set. Android reads absent keys as 0
      // (Bundle.getDouble default) and then rejects setup on the
      // `minBuffer >= playBuffer` validation — a partial set silently kills
      // playback entirely. min/max are the ExoPlayer defaults spelled out.
      minBuffer: 50,
      maxBuffer: 50,
      // Start/resume playback once 0.5s is buffered (rebuffer resume = 2×
      // that). ExoPlayer's defaults are 2.5s/5s — waiting for 5s of buffered
      // media was the audible gap after backward seeks. Local files fill 0.5s
      // in milliseconds; LAN streams keep well ahead of it.
      playBuffer: 0.5,
      // Retain 30s behind the playhead so short backward seeks never rebuffer
      // at all (the ExoPlayer default is 0 — ANY backward seek discarded the
      // buffer and re-fetched from the source).
      backBuffer: 30,
      ...(options.allowBackgroundSetup
        ? { android: { allowBackgroundSetup: true } }
        : {}),
    } as Parameters<typeof TrackPlayer.setupPlayer>[0] & {
      android?: { allowBackgroundSetup?: boolean };
    });
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
