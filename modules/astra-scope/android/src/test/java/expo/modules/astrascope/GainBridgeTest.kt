package expo.modules.astrascope

import org.junit.Assert.assertEquals
import org.junit.Test

class GainBridgeTest {
  @Test
  fun pausedPrimePublishesTargetWithoutCorrectionRamp() {
    GainBridge.putGain("test-track", 0.25f)

    GainBridge.primeFor("test-track")

    assertEquals(0.25f, GainBridge.targetGain, 0.0001f)
    assertEquals(0, GainBridge.rampMs)
  }

  @Test
  fun pausedPrimeUsesFallbackForUnanalyzedTrack() {
    GainBridge.fallbackGain = 0.5f

    GainBridge.primeFor("missing-track")

    assertEquals(0.5f, GainBridge.targetGain, 0.0001f)
    assertEquals(0, GainBridge.rampMs)
  }
}
