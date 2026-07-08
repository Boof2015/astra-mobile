package com.doublesymmetry.kotlinaudio.scope

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Web Audio BiquadFilterNode coefficients, a0-normalized as b0,b1,b2,a1,a2.
 * Type ordinals match EQ_BAND_TYPE_ORDINAL in src/audio/eq.ts:
 * 0 lowshelf, 1 peaking, 2 highshelf, 3 highpass, 4 lowpass.
 */
internal object EqCoefficients {
  private const val MIN_FILTER_Q = 0.0001

  fun compute(
    type: Int,
    freq: Float,
    gainDb: Float,
    q: Float,
    sr: Float,
    out: FloatArray,
    off: Int
  ) {
    if (sr <= 0f) {
      out[off] = 1f; out[off + 1] = 0f; out[off + 2] = 0f; out[off + 3] = 0f; out[off + 4] = 0f
      return
    }

    val w0 = 2.0 * PI * freq / sr
    val cosW0 = cos(w0)
    val sinW0 = sin(w0)
    val a = 10.0.pow(gainDb / 40.0)
    val alphaQ = sinW0 / (2.0 * q.coerceAtLeast(MIN_FILTER_Q.toFloat()))
    val alphaQDb = sinW0 / (2.0 * 10.0.pow(q / 20.0))
    val alphaShelf = (sinW0 / 2.0) * sqrt(2.0)

    var b0 = 1.0; var b1 = 0.0; var b2 = 0.0
    var a0 = 1.0; var a1 = 0.0; var a2 = 0.0

    when (type) {
      1 -> { // peaking
        b0 = 1 + alphaQ * a; b1 = -2 * cosW0; b2 = 1 - alphaQ * a
        a0 = 1 + alphaQ / a; a1 = -2 * cosW0; a2 = 1 - alphaQ / a
      }
      0 -> { // lowshelf
        val sqrtA = sqrt(a)
        b0 = a * (a + 1 - (a - 1) * cosW0 + 2 * sqrtA * alphaShelf)
        b1 = 2 * a * (a - 1 - (a + 1) * cosW0)
        b2 = a * (a + 1 - (a - 1) * cosW0 - 2 * sqrtA * alphaShelf)
        a0 = a + 1 + (a - 1) * cosW0 + 2 * sqrtA * alphaShelf
        a1 = -2 * (a - 1 + (a + 1) * cosW0)
        a2 = a + 1 + (a - 1) * cosW0 - 2 * sqrtA * alphaShelf
      }
      2 -> { // highshelf
        val sqrtA = sqrt(a)
        b0 = a * (a + 1 + (a - 1) * cosW0 + 2 * sqrtA * alphaShelf)
        b1 = -2 * a * (a - 1 + (a + 1) * cosW0)
        b2 = a * (a + 1 + (a - 1) * cosW0 - 2 * sqrtA * alphaShelf)
        a0 = a + 1 - (a - 1) * cosW0 + 2 * sqrtA * alphaShelf
        a1 = 2 * (a - 1 - (a + 1) * cosW0)
        a2 = a + 1 - (a - 1) * cosW0 - 2 * sqrtA * alphaShelf
      }
      4 -> { // lowpass
        b0 = (1 - cosW0) / 2; b1 = 1 - cosW0; b2 = (1 - cosW0) / 2
        a0 = 1 + alphaQDb; a1 = -2 * cosW0; a2 = 1 - alphaQDb
      }
      3 -> { // highpass
        b0 = (1 + cosW0) / 2; b1 = -(1 + cosW0); b2 = (1 + cosW0) / 2
        a0 = 1 + alphaQDb; a1 = -2 * cosW0; a2 = 1 - alphaQDb
      }
    }

    val inv = 1.0 / a0
    out[off] = (b0 * inv).toFloat()
    out[off + 1] = (b1 * inv).toFloat()
    out[off + 2] = (b2 * inv).toFloat()
    out[off + 3] = (a1 * inv).toFloat()
    out[off + 4] = (a2 * inv).toFloat()
  }
}
