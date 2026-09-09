package expo.modules.astralibraryscanner

import org.junit.Assert.*
import org.junit.Test

class AudioCodecMetadataTest {
  @Test fun extractorJocUpgradesGenericTagLibMetadata() {
    val metadata = mutableMapOf<String, Any?>()
    metadata.mergeAudioCodecMetadata("audio/eac3")
    assertNull(metadata["isAtmosJoc"])
    metadata.mergeAudioCodecMetadata("audio/eac3-joc")
    assertEquals("audio/eac3-joc", metadata["codecMime"])
    assertEquals("JOC", metadata["codecProfile"])
    assertEquals(true, metadata["isAtmosJoc"])
  }

  @Test fun nativeJocSurvivesGenericOrMissingExtractorMetadata() {
    val metadata = mutableMapOf<String, Any?>()
    metadata.mergeAudioCodecMetadata("audio/eac3", isAtmosJoc = true)
    metadata.mergeAudioCodecMetadata("audio/eac3")
    metadata.mergeAudioCodecMetadata(null)
    assertEquals("audio/eac3-joc", metadata["codecMime"])
    assertEquals(true, metadata["isAtmosJoc"])
  }

  @Test fun ordinaryCodecsNeverImplyAtmos() {
    for (mime in listOf(null, "audio/eac3", "audio/ac3", "audio/flac", "audio/mp4a-latm")) {
      val metadata = mutableMapOf<String, Any?>("channels" to 6)
      metadata.mergeAudioCodecMetadata(mime)
      assertNull(metadata["isAtmosJoc"])
      assertNull(metadata["codecProfile"])
    }
  }
}
