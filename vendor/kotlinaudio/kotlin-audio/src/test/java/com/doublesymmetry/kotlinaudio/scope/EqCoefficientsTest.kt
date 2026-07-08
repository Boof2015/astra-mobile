package com.doublesymmetry.kotlinaudio.scope

import org.junit.Assert.assertEquals
import org.junit.Test

class EqCoefficientsTest {
  @Test
  fun passFiltersUseWebAudioQDbSemantics() {
    assertCoefficients(
      coeffs(type = 4, freq = 1000f, gainDb = 0f, q = 6f),
      doubleArrayOf(
        0.004142085705,
        0.008284171410,
        0.004142085705,
        -1.920085584611,
        0.936653927431
      )
    )
    assertCoefficients(
      coeffs(type = 3, freq = 1000f, gainDb = 0f, q = 6f),
      doubleArrayOf(
        0.964184878011,
        -1.928369756021,
        0.964184878011,
        -1.920085584611,
        0.936653927431
      )
    )
  }

  @Test
  fun shelfFiltersIgnoreQ() {
    assertCoefficients(
      coeffs(type = 0, freq = 100f, gainDb = 6f, q = 0.1f),
      coeffs(type = 0, freq = 100f, gainDb = 6f, q = 18f)
    )
    assertCoefficients(
      coeffs(type = 2, freq = 8000f, gainDb = -4f, q = 0.1f),
      coeffs(type = 2, freq = 8000f, gainDb = -4f, q = 18f)
    )
  }

  private fun coeffs(type: Int, freq: Float, gainDb: Float, q: Float): FloatArray {
    val out = FloatArray(5)
    EqCoefficients.compute(type, freq, gainDb, q, 48000f, out, 0)
    return out
  }

  private fun assertCoefficients(actual: FloatArray, expected: DoubleArray) {
    assertEquals("coefficient count", expected.size, actual.size)
    for (i in expected.indices) {
      assertEquals("coefficient $i", expected[i], actual[i].toDouble(), 1e-6)
    }
  }

  private fun assertCoefficients(actual: FloatArray, expected: FloatArray) {
    assertEquals("coefficient count", expected.size, actual.size)
    for (i in expected.indices) {
      assertEquals("coefficient $i", expected[i].toDouble(), actual[i].toDouble(), 0.0)
    }
  }
}
