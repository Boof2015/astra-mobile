package expo.modules.astrascope

import androidx.test.ext.junit.runners.AndroidJUnit4
import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ScopeBridgeBoundaryTest {
  @Test
  fun rejectsIncompleteOrOverflowingPcmDescriptions() {
    ScopeBridge.nativeConfigure(48_000, 2)

    // These calls complete without entering the native reader.
    ScopeBridge.nativePushFrames(FloatArray(3), frameCount = 2, channelCount = 2)
    ScopeBridge.nativePushFrames(
      FloatArray(1),
      frameCount = Int.MAX_VALUE,
      channelCount = Int.MAX_VALUE
    )
    ScopeBridge.nativePushFramesPostEq(FloatArray(3), frameCount = 2, channelCount = 2)
    ScopeBridge.nativePushFramesPostEq(
      FloatArray(1),
      frameCount = Int.MAX_VALUE,
      channelCount = Int.MAX_VALUE
    )
  }

  @Test
  fun capsNativeWritesToTheDirectBufferCapacity() {
    ScopeBridge.nativeConfigure(48_000, 1)
    ScopeBridge.nativePushFrames(FloatArray(12_000), frameCount = 12_000, channelCount = 1)

    val spectrum = directFloats(4)
    val oscilloscope = directFloats(4)
    val postEqSpectrum = directFloats(4)

    assertEquals(
      4,
      ScopeBridge.nativeFillSpectrum(spectrum, Int.MAX_VALUE, smoothing = 0.92f)
    )
    assertEquals(
      4,
      ScopeBridge.nativeFillOscilloscope(oscilloscope, Int.MAX_VALUE)
    )
    assertEquals(
      4,
      ScopeBridge.nativeFillSpectrumPostEq(
        postEqSpectrum,
        Int.MAX_VALUE,
        smoothing = 0.92f
      )
    )
  }

  @Test
  fun rejectsNonDirectUndersizedAndMisalignedBuffers() {
    val heap = ByteBuffer.allocate(16).order(ByteOrder.nativeOrder())
    val undersized = ByteBuffer.allocateDirect(Float.SIZE_BYTES - 1)
      .order(ByteOrder.nativeOrder())
    val misaligned = ByteBuffer.allocateDirect(17).apply { position(1) }
      .slice()
      .order(ByteOrder.nativeOrder())

    assertEquals(0, ScopeBridge.nativeFillSpectrum(heap, 4, smoothing = 0.92f))
    assertEquals(0, ScopeBridge.nativeFillSpectrum(undersized, 4, smoothing = 0.92f))
    assertEquals(0, ScopeBridge.nativeFillSpectrum(misaligned, 4, smoothing = 0.92f))
    assertEquals(0, ScopeBridge.nativeFillOscilloscope(heap, 4))
    assertEquals(
      0,
      ScopeBridge.nativeFillSpectrumPostEq(heap, 4, smoothing = 0.92f)
    )
  }

  private fun directFloats(count: Int): ByteBuffer =
    ByteBuffer.allocateDirect(count * Float.SIZE_BYTES).order(ByteOrder.nativeOrder())
}
