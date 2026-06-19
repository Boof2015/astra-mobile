package expo.modules.astrascope

/**
 * Holds the current parametric-EQ configuration, set from JS (raw band params, NOT
 * biquad coefficients). The vendored kotlin-audio `EqAudioProcessor` reads these
 * fields lock-free on the ExoPlayer audio thread and recomputes coefficients at the
 * real stream sample rate whenever [revision] changes.
 *
 * Single writer (JS thread via [AstraScopeModule]); single reader (audio thread).
 * `bands` is published before `revision` is bumped, so a reader that observes a new
 * revision also observes the matching band array.
 */
object EqBridge {
  /** Master bypass. When false the processor is passthrough. */
  @Volatile
  var enabled: Boolean = false

  /** EQ preamp as a linear amplitude (1 = unity). */
  @Volatile
  var preampLinear: Float = 1f

  /** 5 floats per band: [typeOrdinal, frequency, gain, Q, enabled?1:0]. */
  @Volatile
  var bands: FloatArray = FloatArray(0)

  /** Bumped on every enabled/preamp/bands change so the processor recomputes. */
  @Volatile
  var revision: Int = 0
}
