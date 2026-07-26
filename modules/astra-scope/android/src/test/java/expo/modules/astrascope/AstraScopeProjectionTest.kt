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
    assertEquals(16_000_000L, AstraScopeProjection.cadenceNanos(16.0, 120f))
    assertEquals(8_333_333L, AstraScopeProjection.cadenceNanos(0.0, 120f))
    assertEquals(11_111_111L, AstraScopeProjection.cadenceNanos(0.0, 90f))
  }

  @Test
  fun adaptiveOscilloscopeUsesNinetyFpsOnFastDisplaysAndSixtyWhenConstrained() {
    assertEquals(60f, AstraScopeProjection.adaptiveOscilloscopeFps(60f, false), 0f)
    assertEquals(90f, AstraScopeProjection.adaptiveOscilloscopeFps(90f, false), 0f)
    assertEquals(90f, AstraScopeProjection.adaptiveOscilloscopeFps(120f, false), 0f)
    assertEquals(90f, AstraScopeProjection.adaptiveOscilloscopeFps(144f, false), 0f)

    assertEquals(60f, AstraScopeProjection.adaptiveOscilloscopeFps(120f, true), 0f)
    assertEquals(60f, AstraScopeProjection.adaptiveOscilloscopeFps(90f, true), 0f)
    assertEquals(60f, AstraScopeProjection.adaptiveOscilloscopeFps(Float.NaN, false), 0f)
  }

  @Test
  fun fractionalDeadlineProducesNineFramesAcrossTwelve120HzVsyncs() {
    val deadline = AdaptiveFrameDeadline()
    val vsyncCadence = AstraScopeProjection.cadenceNanos(0.0, 120f)
    val renderCadence = AstraScopeProjection.cadenceNanos(0.0, 90f)
    var rendered = 0

    repeat(12) { frame ->
      if (deadline.isDue(frame * vsyncCadence, renderCadence, 500_000L)) rendered += 1
    }

    assertEquals(9, rendered)
    deadline.reset()
    assertTrue(deadline.isDue(200_000_000L, renderCadence))
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
