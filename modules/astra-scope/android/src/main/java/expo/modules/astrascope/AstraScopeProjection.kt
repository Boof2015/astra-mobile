package expo.modules.astrascope

import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.roundToLong

internal enum class ScopeMode {
  SPECTRUM,
  OSCILLOSCOPE;

  companion object {
    fun from(value: String): ScopeMode =
      if (value == "oscilloscope") OSCILLOSCOPE else SPECTRUM
  }
}

internal enum class ScopeSource {
  PRE,
  POST;

  companion object {
    fun from(value: String): ScopeSource = if (value == "post") POST else PRE
  }
}

/**
 * Pure scope math kept separate from the Android view so cadence, projection,
 * clamping, decay, and lifecycle generation changes have inexpensive JVM tests.
 */
internal object AstraScopeProjection {
  const val SPECTRUM_BINS = 1024
  const val OSCILLOSCOPE_POINTS = 256
  const val DECAY_PER_FRAME = 0.72f
  const val REST_EPSILON = 0.004f
  const val MAX_ADAPTIVE_OSCILLOSCOPE_FPS = 90f

  private const val MIN_FREQUENCY = 20.0
  private const val MAX_FREQUENCY = 20_000.0
  private const val TILT_REFERENCE_HZ = 1_000.0
  private const val LN_2 = 0.6931471805599453

  fun cadenceMs(requestedMs: Double, refreshRate: Float): Long {
    if (requestedMs > 0.0) return max(1L, requestedMs.roundToInt().toLong())
    val safeRate = safeRefreshRate(refreshRate)
    return max(1L, (1_000.0 / safeRate).roundToInt().toLong())
  }

  fun cadenceNanos(requestedMs: Double, refreshRate: Float): Long {
    if (requestedMs > 0.0) {
      return max(1L, (requestedMs * NANOS_PER_MILLISECOND).roundToLong())
    }
    return max(1L, (NANOS_PER_SECOND / safeRefreshRate(refreshRate)).roundToLong())
  }

  /**
   * Follows 60 Hz displays directly and uses the measured 90 fps scope budget
   * on faster panels. Power or thermal pressure constrains rendering to 60 fps.
   */
  fun adaptiveOscilloscopeFps(refreshRate: Float, constrained: Boolean): Float {
    val safeRate = safeRefreshRate(refreshRate)
    val limit = if (constrained) 60f else MAX_ADAPTIVE_OSCILLOSCOPE_FPS
    return min(safeRate, limit)
  }

  fun clamp01(value: Float): Float = when {
    !value.isFinite() || value <= 0f -> 0f
    value >= 1f -> 1f
    else -> value
  }

  /**
   * Projects linear FFT bins into log-frequency display points, matching the
   * former React/Skia renderer's 20 Hz–20 kHz presentation and tilt.
   */
  fun writeSpectrum(
    raw: java.nio.FloatBuffer,
    rawCount: Int,
    out: FloatArray,
    pointCount: Int,
    dbMin: Float,
    dbMax: Float,
    tiltDbPerOctave: Float,
    sampleRate: Float = 48_000f
  ) {
    val bins = min(rawCount, raw.capacity())
    val points = min(pointCount, out.size)
    if (bins <= 0 || points < 2) {
      out.fill(0f, 0, max(0, points))
      return
    }

    val nyquist = max(1.0, sampleRate.toDouble() / 2.0)
    val minFrequency = min(MIN_FREQUENCY, nyquist)
    val maxFrequency = max(minFrequency + 1.0, min(MAX_FREQUENCY, nyquist))
    val binWidth = nyquist / bins.toDouble()
    val range = max(1f, dbMax - dbMin)

    for (point in 0 until points) {
      val t0 = point.toDouble() / (points - 1).toDouble()
      val t1 = min(1.0, (point + 1).toDouble() / (points - 1).toDouble())
      val frequency0 = frequencyAt(t0, minFrequency, maxFrequency)
      val frequency1 = frequencyAt(t1, minFrequency, maxFrequency)
      val centerFrequency = (frequency0 + frequency1) * 0.5
      val bin0 = frequency0 / binWidth
      val bin1 = frequency1 / binWidth
      val centerBin = (bin0 + bin1) * 0.5

      val rawDb = if (kotlin.math.abs(bin1 - bin0) <= 1.0) {
        interpolated(raw, bins, min(centerBin, (bins - 1).toDouble()))
      } else {
        peak(raw, bins, bin0, bin1)
      }
      val tiltedDb =
        rawDb + tiltDbPerOctave * (ln(max(1.0, centerFrequency) / TILT_REFERENCE_HZ) / LN_2).toFloat()
      out[point] = clamp01((tiltedDb - dbMin) / range)
    }
  }

  /** Returns the largest absolute value left after one decay step. */
  fun decay(values: FloatArray, count: Int, factor: Float = DECAY_PER_FRAME): Float {
    var peak = 0f
    val n = min(count, values.size)
    for (index in 0 until n) {
      val next = values[index] * factor
      values[index] = next
      peak = max(peak, kotlin.math.abs(next))
    }
    return peak
  }

  private fun frequencyAt(t: Double, minFrequency: Double, maxFrequency: Double): Double =
    minFrequency * (maxFrequency / minFrequency).pow(t)

  private fun safeRefreshRate(refreshRate: Float): Float =
    if (refreshRate.isFinite() && refreshRate >= 30f) refreshRate else 60f

  private fun interpolated(
    values: java.nio.FloatBuffer,
    count: Int,
    position: Double
  ): Float {
    val lower = position.toInt().coerceIn(0, count - 1)
    val upper = min(count - 1, lower + 1)
    val mix = (position - lower.toDouble()).toFloat()
    return values.get(lower) + (values.get(upper) - values.get(lower)) * mix
  }

  private fun peak(
    values: java.nio.FloatBuffer,
    count: Int,
    startPosition: Double,
    endPosition: Double
  ): Float {
    val start = startPosition.toInt().coerceIn(0, count - 1)
    val end = kotlin.math.ceil(endPosition).toInt().coerceIn(start, count - 1)
    var result = values.get(start)
    for (index in (start + 1)..end) result = max(result, values.get(index))
    return result
  }

  private const val NANOS_PER_MILLISECOND = 1_000_000.0
  private const val NANOS_PER_SECOND = 1_000_000_000.0
}

/**
 * A monotonically increasing token makes queued/running work self-cancelling
 * after detach, backgrounding, pause, size loss, or a prop-generation change.
 */
internal class ScopeRenderGate {
  @Volatile
  private var generation = 0

  @Volatile
  var eligible: Boolean = false
    private set

  @Synchronized
  fun update(nextEligible: Boolean): Int {
    eligible = nextEligible
    generation += 1
    return generation
  }

  fun isCurrent(token: Int): Boolean = eligible && generation == token

  fun currentGeneration(): Int = generation
}

/**
 * Keeps fractional target cadences phase-locked to vsync instead of resetting
 * the deadline after each rendered frame (which would turn 90-on-120 into 60).
 */
internal class AdaptiveFrameDeadline {
  private var nextFrameAtNanos = Long.MIN_VALUE

  fun reset() {
    nextFrameAtNanos = Long.MIN_VALUE
  }

  fun isDue(frameTimeNanos: Long, cadenceNanos: Long, toleranceNanos: Long = 0L): Boolean {
    val cadence = max(1L, cadenceNanos)
    if (nextFrameAtNanos == Long.MIN_VALUE) {
      nextFrameAtNanos = frameTimeNanos + cadence
      return true
    }
    if (frameTimeNanos + max(0L, toleranceNanos) < nextFrameAtNanos) return false

    do {
      nextFrameAtNanos += cadence
    } while (nextFrameAtNanos <= frameTimeNanos)
    return true
  }
}
