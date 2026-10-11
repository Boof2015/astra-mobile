package expo.modules.astralibraryscanner

import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.*
import org.junit.Test

class WaveContainerBoundsTest {
  private fun header(size: Long, id: String = "RIFF", type: String = "WAVE"): ByteArray =
    ByteBuffer.allocate(12).order(if (id == "RIFX") ByteOrder.BIG_ENDIAN else ByteOrder.LITTLE_ENDIAN)
      .put(id.toByteArray()).putInt(size.toInt()).put(type.toByteArray()).array()

  @Test fun rejectsMissingDeclaredContainerBytes() {
    for (id in listOf("RIFF", "RIFX")) {
      assertTrue(WaveContainerBounds.exceedsAvailableBytes(header(249636, id), 100))
      assertTrue(WaveContainerBounds.exceedsAvailableBytes(header(92, id), 99))
    }
  }

  @Test fun permitsCompleteTinyFilesAndTrailingBytes() {
    assertFalse(WaveContainerBounds.exceedsAvailableBytes(header(38), 46))
    assertFalse(WaveContainerBounds.exceedsAvailableBytes(header(92), 100))
    assertFalse(WaveContainerBounds.exceedsAvailableBytes(header(92), 120))
  }

  @Test fun sizesAreUnsignedAndDoNotOverflowOn32BitDevices() {
    assertTrue(WaveContainerBounds.exceedsAvailableBytes(header(0xffff_fffeL), 100))
    assertFalse(WaveContainerBounds.exceedsAvailableBytes(header(0xffff_fffeL), 0x1_0000_0006L))
  }

  @Test fun leavesUnknownSizesAndOtherFormatsToDecoder() {
    for (size in listOf(0L, 0xffff_ffffL)) {
      assertFalse(WaveContainerBounds.exceedsAvailableBytes(header(size), 100))
    }
    assertFalse(WaveContainerBounds.exceedsAvailableBytes(header(1000, "RF64"), 100))
    assertFalse(WaveContainerBounds.exceedsAvailableBytes(header(1000, type = "AVI "), 100))
    assertFalse(WaveContainerBounds.exceedsAvailableBytes(ByteArray(8), 8))
    assertFalse(WaveContainerBounds.exceedsAvailableBytes(header(1000), -1))
  }
}
