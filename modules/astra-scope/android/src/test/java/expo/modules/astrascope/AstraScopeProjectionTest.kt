package expo.modules.astrascope

import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AstraScopeProjectionTest {
  @Test
  fun projectionClampsDbValuesAndKeepsLogSpectrumShape() {
    val rawBytes = ByteBuffer.allocateDirect(16 * Float.SIZE_BYTES).order(ByteOrder.nativeOrder())
    val raw = rawBytes.asFloatBuffer()
    for (index in 0 until 16) raw.put(index, -100f + index * 10f)
    val out = FloatArray(8)

    AstraScopeProjection.writeSpectrum(raw, 16, out, 8, -90f, -10f, 0f)

    assertTrue(out.first() >= 0f)
    assertTrue(out.last() <= 1f)
    for (index in 1 until out.size) assertTrue(out[index] >= out[index - 1])
  }

  @Test
  fun clampRejectsInvalidAndOutOfRangeValues() {
    assertEquals(0f, AstraScopeProjection.clamp01(Float.NaN), 0f)
    assertEquals(0f, AstraScopeProjection.clamp01(-2f), 0f)
    assertEquals(1f, AstraScopeProjection.clamp01(3f), 0f)
  }

  @Test
  fun decayMatchesLegacyPauseEnvelope() {
    val values = floatArrayOf(-1f, 0.5f, 0.1f)

    val peak = AstraScopeProjection.decay(values, values.size)

    assertEquals(0.72f, peak, 0.0001f)
    assertEquals(-0.72f, values[0], 0.0001f)
    assertEquals(0.36f, values[1], 0.0001f)
  }

  @Test
  fun cadenceUsesRequestedPolicyOrDisplayRefresh() {
    assertEquals(32L, AstraScopeProjection.cadenceMs(32.0, 120f))
    assertEquals(16L, AstraScopeProjection.cadenceMs(16.0, 120f))
    assertEquals(8L, AstraScopeProjection.cadenceMs(0.0, 120f))
    assertEquals(17L, AstraScopeProjection.cadenceMs(0.0, 60f))
  }

  @Test
  fun sourceAndModeSelectionDefaultSafely() {
    assertEquals(ScopeSource.POST, ScopeSource.from("post"))
    assertEquals(ScopeSource.PRE, ScopeSource.from("unexpected"))
    assertEquals(ScopeMode.OSCILLOSCOPE, ScopeMode.from("oscilloscope"))
    assertEquals(ScopeMode.SPECTRUM, ScopeMode.from("unexpected"))
  }

  @Test
  fun lifecycleGenerationCancelsDetachedOrSupersededWork() {
    val gate = ScopeRenderGate()
    val first = gate.update(true)
    assertTrue(gate.isCurrent(first))

    val second = gate.update(true)
    assertFalse(gate.isCurrent(first))
    assertTrue(gate.isCurrent(second))

    gate.update(false)
    assertFalse(gate.isCurrent(second))
    assertFalse(gate.eligible)
  }
}
