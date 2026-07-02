package expo.modules.astrascope

import java.util.concurrent.ConcurrentHashMap

/**
 * Per-track normalization / ReplayGain gain, read lock-free by the vendored
 * kotlin-audio `NormalizationGainProcessor` on the audio thread. Applied BEFORE the
 * scope taps so the scopes see normalized levels.
 *
 * JS pre-registers queued tracks' gains by URL ([putGain]/[putGains]); the player
 * swaps the active gain to the matching one natively at the real media-item
 * transition ([activateFor], called from BaseAudioPlayer.onMediaItemTransition).
 * That lands the gain at the actual audio boundary instead of after a JS round-trip.
 *
 * Gains are published as a (target, rampMs) pair under a [revision] counter — the
 * same pattern as [EqBridge.revision]. The processor re-arms its ramp whenever the
 * revision moves: effectively instant at media boundaries ([TRANSITION_RAMP_MS]),
 * an audible glide for mid-track corrections ([CORRECTION_RAMP_MS]) such as a late
 * loudness measurement landing or a settings toggle.
 *
 * A URL with no registered gain activates at [fallbackGain] instead of unity — a
 * conservative temporary attenuation (Poweramp-style) so an unanalyzed loud track
 * starts slightly quiet and glides up, rather than blasting and ducking. JS keeps
 * fallbackGain pinned to 1 while normalization is disabled.
 *
 * Publication race note: a reader could pair a fresh [targetGain] with a stale
 * [rampMs] for one buffer (5-20 ms); the next buffer's revision check corrects it.
 * Deliberately unfixed — no locking on the audio-thread read path.
 */
object GainBridge {
  /** Declick ramp for media-item boundaries (effectively instant). */
  const val TRANSITION_RAMP_MS = 30

  /** Audible glide for mid-track corrections (late measurement, settings toggle). */
  const val CORRECTION_RAMP_MS = 1200

  /** Linear amplitude target the processor ramps toward (1 = unity). */
  @Volatile
  var targetGain: Float = 1f
    private set

  /** Ramp duration for the most recent target change. */
  @Volatile
  var rampMs: Int = 0
    private set

  /** Bumped LAST on every target change; the processor re-arms when it moves. */
  @Volatile
  var revision: Int = 0
    private set

  /**
   * Applied when a transition hits a URL with no registered gain (track not yet
   * analyzed). Errs quiet by construction; JS sets 1 while normalization is off.
   */
  @Volatile
  var fallbackGain: Float = 1f

  // url -> linear gain, seeded from JS ahead of playback.
  private val gains = ConcurrentHashMap<String, Float>()

  /** Register (or update) the gain for a track URL. */
  fun putGain(url: String, gain: Float) {
    gains[url] = gain
  }

  /**
   * Bulk-register the whole queue's gains in one call. With [clearExisting] the map
   * is cleared first (bounds it to the live queue, drops stale-settings entries);
   * a transition landing in the microsecond clear-to-putAll window would activate
   * [fallbackGain] — errs quiet, acceptable.
   */
  fun putGains(entries: Map<String, Float>, clearExisting: Boolean) {
    if (clearExisting) gains.clear()
    gains.putAll(entries)
  }

  /**
   * Make the gain registered for [url] active at the audio boundary (declick-fast
   * ramp). Misses fall back to [fallbackGain], NOT unity — that is the core fix for
   * the "loud first seconds" burst on unanalyzed tracks.
   */
  fun activateFor(url: String?) {
    setTarget(url?.let { gains[it] } ?: fallbackGain, TRANSITION_RAMP_MS)
  }

  /** Like [activateFor] but glides — for JS-initiated mid-track corrections. */
  fun activateSmoothFor(url: String) {
    setTarget(gains[url] ?: fallbackGain, CORRECTION_RAMP_MS)
  }

  /** Glide to an explicit gain (unity paths: no track / remote track / disabled). */
  fun setGainSmooth(linear: Float) {
    setTarget(linear, CORRECTION_RAMP_MS)
  }

  /** Drop all registered gains (e.g. on full queue reset). */
  fun clearGains() {
    gains.clear()
  }

  @Synchronized
  private fun setTarget(gain: Float, durationMs: Int) {
    targetGain = gain
    rampMs = durationMs
    revision += 1
  }
}
