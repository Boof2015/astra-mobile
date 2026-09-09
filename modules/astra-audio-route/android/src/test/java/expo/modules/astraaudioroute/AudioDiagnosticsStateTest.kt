package expo.modules.astraaudioroute

import org.junit.Assert.*
import org.junit.Test

class AudioDiagnosticsStateTest {
  @Test fun externalNamePrefersConcreteProducts() {
    assertEquals("SNOWSKY TINY B", externalDeviceLabel("usb", " SNOWSKY TINY B ", "USB"))
    assertEquals("Living room", externalDeviceLabel("bluetooth", "Bluetooth", "Living room"))
    assertEquals("Phone speaker", externalDeviceLabel("speaker", "SM-S908U1", "Phone speaker"))
    assertEquals("USB audio", externalDeviceLabel("usb", null, "USB audio"))
  }
  private val pcm48 = DiagnosticFormat(48_000, "pcm-16", 2)
  private val pcm96 = DiagnosticFormat(96_000, "pcm-24", 2)
  private fun source(entry: String) = DiagnosticSource("song", entry, "Song", "Artist", "flac", 48_000, 24, 2)

  @Test fun prefetchNeverPairsNextOutputWithCurrentSong() {
    val state = AudioDiagnosticsState()
    val session = state.attach()
    val first = Any(); val next = Any()
    state.source(session, first, source("first"), "playing")
    state.input(session, first, pcm48)
    state.configure(session, pcm48, pcm48)
    state.accepted(session)
    assertEquals(pcm48.toMap(), state.snapshot()["output"])
    state.input(session, next, pcm96)
    state.configure(session, pcm96, pcm96)
    assertEquals(pcm48.toMap(), state.snapshot()["output"])
    assertEquals(pcm48.toMap(), state.snapshot()["stream"])
    state.source(session, next, source("second"), "playing")
    assertNull(state.snapshot()["output"])
    assertEquals("pending", state.snapshot()["outputStatus"])
    state.accepted(session)
    assertEquals(pcm96.toMap(), state.snapshot()["output"])
  }

  @Test fun sameFormatReuseStillRequiresAcceptedStreamBoundary() {
    val state = AudioDiagnosticsState(); val session = state.attach()
    val first = Any(); val next = Any()
    state.source(session, first, source("first"), "playing")
    state.input(session, first, pcm48); state.configure(session, pcm48, pcm48); state.accepted(session)
    state.input(session, next, pcm48)
    state.source(session, next, source("duplicate song"), "playing")
    assertNull(state.snapshot()["output"])
    state.streamBoundary(session)
    assertNull(state.snapshot()["output"])
    state.accepted(session)
    assertEquals(pcm48.toMap(), state.snapshot()["output"])
  }

  @Test fun flushResetStopAndPlayerReplacementClearLiveClaims() {
    val state = AudioDiagnosticsState(); val session = state.attach(); val owner = Any()
    state.source(session, owner, source("one"), "playing")
    state.input(session, owner, pcm48); state.configure(session, pcm48, pcm48); state.accepted(session)
    state.source(session, owner, source("one"), "paused")
    assertEquals(pcm48.toMap(), state.snapshot()["output"])
    state.flush(session)
    assertNull(state.snapshot()["output"])
    state.accepted(session)
    assertEquals(pcm48.toMap(), state.snapshot()["output"])
    state.source(session, owner, source("one"), "stopped")
    assertNull(state.snapshot()["output"])
    val replacement = state.attach()
    state.input(session, owner, pcm96); state.configure(session, pcm96, pcm96); state.accepted(session)
    state.source(session, owner, source("stale"), "playing"); state.detach(session)
    assertEquals(replacement, state.snapshot()["generation"])
    assertNull(state.snapshot()["source"])
    state.detach(replacement)
    assertEquals("inactive", state.snapshot()["outputStatus"])
  }

  @Test fun unavailableObservationsStayUnknown() {
    val state = AudioDiagnosticsState(); val session = state.attach(); val owner = Any()
    state.source(session, owner, source("one"), "playing")
    state.configure(session, pcm48, pcm48) // No known renderer identity.
    state.accepted(session)
    assertNull(state.snapshot()["output"])
    state.input(session, owner, pcm48); state.configure(session, pcm48, null); state.accepted(session)
    assertNull(state.snapshot()["output"])
    state.failure(session)
    assertEquals("unavailable", state.snapshot()["outputStatus"])
    state.flush(session, true)
    assertNull(state.snapshot()["output"])
  }

  @Test fun integerAndFloatEncodingsRemainDistinct() {
    assertEquals("pcm-float", diagnosticEncoding(4))
    assertEquals("pcm-24", diagnosticEncoding(21))
    assertEquals("pcm-24", diagnosticEncoding(0x20000000))
    assertEquals("pcm-32", diagnosticEncoding(22))
    assertEquals("encoded:5", diagnosticEncoding(5))
    assertNull(diagnosticEncoding(-1))
  }
}
