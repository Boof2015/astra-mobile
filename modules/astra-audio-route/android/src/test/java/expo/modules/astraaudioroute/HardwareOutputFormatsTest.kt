package expo.modules.astraaudioroute

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class HardwareOutputFormatsTest {
  private val request = ProbeRequest(7, 96_000, 2, 1)

  @Test fun probeIsShapedLikeAstrasObservedOutput() {
    assertEquals(request, probeRequest(7, mapOf("sampleRate" to 96_000, "channels" to 2, "encoding" to "pcm-16")))
    assertEquals(ProbeRequest(null, 0, 0, 0), probeRequest(null, null))
    assertEquals(ProbeRequest(3, 0, 0, 0), probeRequest(3, mapOf("sampleRate" to -1, "channels" to null, "encoding" to "encoded:7")))
  }

  @Test fun reprobesOnNewShapeOrAfterRefreshWindow() {
    val last = ProbeResult(request, 1_000, null)
    assertTrue(needsProbe(null, request, 0))
    assertFalse(needsProbe(last, request, 1_000 + PROBE_REFRESH_MS - 1))
    assertTrue(needsProbe(last, request, 1_000 + PROBE_REFRESH_MS))
    assertTrue(needsProbe(last, request.copy(sampleRate = 44_100), 1_001))
    assertTrue(needsProbe(last, request.copy(deviceId = 8), 1_001))
  }

  @Test fun aaudioFormatsRoundTripAndHardwareValuesStayHonest() {
    for (encoding in listOf("pcm-16", "pcm-float", "pcm-24", "pcm-32")) {
      assertEquals(encoding, encodingForAaudioFormat(aaudioFormatFor(encoding)))
    }
    assertEquals(0, aaudioFormatFor(null))
    assertEquals(DiagnosticFormat(96_000, "pcm-24", 2), hardwareFormat(intArrayOf(96_000, 2, 3, 7)))
    assertEquals(DiagnosticFormat(48_000, null, null), hardwareFormat(intArrayOf(48_000, 0, 0, 7)))
    assertNull(hardwareFormat(intArrayOf(0, 2, 1, 7)))
    assertNull(hardwareFormat(null))
  }
}
