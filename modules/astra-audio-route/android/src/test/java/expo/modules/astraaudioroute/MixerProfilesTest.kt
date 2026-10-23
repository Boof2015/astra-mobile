package expo.modules.astraaudioroute

import org.junit.Assert.assertEquals
import org.junit.Test

class MixerProfilesTest {
  @Test fun dropsUnspecifiedRatesAndRepeatsAndSortsByRate() {
    val maps = mixerProfileMaps(listOf(
      MixerProfile(96_000, "pcm-24", 2, false),
      MixerProfile(0, "pcm-16", 2, false),
      MixerProfile(44_100, "pcm-16", 2, true),
      MixerProfile(96_000, "pcm-24", 2, false),
      MixerProfile(44_100, "pcm-16", 2, false),
    ))
    assertEquals(listOf(44_100, 44_100, 96_000), maps.map { it["sampleRate"] })
    assertEquals(listOf(false, true, false), maps.map { it["bitPerfect"] })
  }

  @Test fun unknownChannelCountStaysExplicit() {
    val map = mixerProfileMaps(listOf(MixerProfile(48_000, null, 0, true))).single()
    assertEquals(null, map["channels"])
    assertEquals(null, map["encoding"])
    assertEquals(true, map["bitPerfect"])
  }
}
