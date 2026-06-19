package expo.modules.astrascope

import java.util.concurrent.ConcurrentHashMap

/**
 * Per-track normalization / ReplayGain gain, read lock-free by the vendored
 * kotlin-audio `NormalizationGainProcessor` on the audio thread. Applied BEFORE the
 * scope taps so the scopes see normalized levels.
 *
 * JS pre-registers each queued track's gain by URL ([putGain]); the player then swaps
 * the active gain to the matching one natively at the real media-item transition
 * ([activateFor], called from BaseAudioPlayer.onMediaItemTransition). That lands the
 * gain at the actual audio boundary instead of after a JS round-trip on track change.
 */
object GainBridge {
  /** Active linear amplitude multiplier (1 = unity). Read on the audio thread. */
  @Volatile
  var linearGain: Float = 1f

  // url -> linear gain, seeded from JS ahead of playback.
  private val gains = ConcurrentHashMap<String, Float>()

  /** Register (or update) the gain for a track URL. */
  fun putGain(url: String, gain: Float) {
    gains[url] = gain
  }

  /** Make the gain registered for [url] active (unity if unknown/null). */
  fun activateFor(url: String?) {
    linearGain = if (url != null) gains[url] ?: 1f else 1f
  }

  /** Drop all registered gains (e.g. on full queue reset). */
  fun clearGains() {
    gains.clear()
  }
}
