package expo.modules.astrascope

/**
 * Process-wide bridge to the native scope driver (libastrascope.so).
 *
 * Loaded once here; the vendored kotlin-audio PCM tap (ScopeTapAudioProcessor)
 * calls [nativePushFrames]/[nativeConfigure] from the ExoPlayer audio thread,
 * while [AstraScopeModule] calls [nativeFillSpectrum] from the JS thread. The
 * native side is single-producer/single-consumer and lock-free on the audio
 * path; see scope_ring.h.
 *
 * [active] gates the tap so a backgrounded/paused app pays ~zero in the audio
 * callback. The lifecycle owner (RN side) flips it via AstraScope.setActive().
 */
object ScopeBridge {
  init {
    System.loadLibrary("astrascope")
  }

  /** Set by the lifecycle owner; checked cheaply in the audio callback. */
  @Volatile
  var active: Boolean = false

  /**
   * Gates the POST-EQ tap specifically (true only while the EQ screen is open).
   * The post-EQ tap runs when [active] && [postEqActive], so the second downmix
   * costs nothing unless the EQ overlay is actually being viewed.
   */
  @Volatile
  var postEqActive: Boolean = false

  /** Audio thread. Tell the analyzer the stream's sample rate / channels. */
  external fun nativeConfigure(sampleRate: Int, channelCount: Int)

  /** Audio thread. Push interleaved float PCM (frameCount * channelCount). */
  external fun nativePushFrames(frames: FloatArray, frameCount: Int, channelCount: Int)

  /**
   * Render thread. Fill `buffer` (a direct ByteBuffer over the JS Float32Array's
   * memory) with the latest dB spectrum, up to `capacityFloats` floats.
   * Returns the number of bins written. Zero-copy: writes straight into JS memory.
   */
  external fun nativeFillSpectrum(
    buffer: java.nio.ByteBuffer,
    capacityFloats: Int,
    smoothing: Float
  ): Int

  /**
   * Render thread. Fill `buffer` (a direct ByteBuffer over the JS Float32Array's
   * memory) with render-ready, evenly spaced points from the latest triggered
   * oscilloscope window. Returns the number of points written. Zero-copy:
   * writes straight into JS memory.
   */
  external fun nativeFillOscilloscope(buffer: java.nio.ByteBuffer, capacityFloats: Int): Int

  /** Audio thread. Push POST-EQ interleaved float PCM (the M4 second tap). */
  external fun nativePushFramesPostEq(frames: FloatArray, frameCount: Int, channelCount: Int)

  /**
   * Render thread. Fill `buffer` with the latest POST-EQ dB spectrum (feeds the
   * EQ screen's response-curve overlay). Returns bins written. Zero-copy.
   */
  external fun nativeFillSpectrumPostEq(
    buffer: java.nio.ByteBuffer,
    capacityFloats: Int,
    smoothing: Float
  ): Int
}
