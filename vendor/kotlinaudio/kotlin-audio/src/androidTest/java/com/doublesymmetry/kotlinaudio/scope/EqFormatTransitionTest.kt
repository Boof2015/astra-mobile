package com.doublesymmetry.kotlinaudio.scope

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.google.android.exoplayer2.C
import com.google.android.exoplayer2.audio.AudioProcessor
import expo.modules.astrascope.EqBridge
import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class EqFormatTransitionTest {
  private fun input(channels: Int): ByteBuffer = ByteBuffer.allocateDirect(channels * 32 * 4).order(ByteOrder.nativeOrder()).apply {
    repeat(channels * 32) { putFloat(0.125f) }; flip()
  }

  @Test fun unchangedEqBandsHandleMonoStereoAndSurroundTransitions() {
    val enabled = EqBridge.enabled
    val preamp = EqBridge.preampLinear
    val bands = EqBridge.bands
    try {
      EqBridge.enabled = true
      EqBridge.preampLinear = 1f
      EqBridge.bands = FloatArray(25).apply {
        repeat(5) { band ->
          this[band * 5] = 1f; this[band * 5 + 1] = 200f * (band + 1)
          this[band * 5 + 2] = 3f; this[band * 5 + 3] = 1f; this[band * 5 + 4] = 1f
        }
      }
      EqBridge.revision++
      val reused = EqAudioProcessor()
      for (channels in listOf(2, 6, 1, 8, 2)) {
        val format = AudioProcessor.AudioFormat(if (channels == 1) 44_100 else 48_000, channels, C.ENCODING_PCM_FLOAT)
        reused.configure(format)
        reused.flush()
        val fresh = EqAudioProcessor()
        fresh.configure(format); fresh.flush()
        reused.queueInput(input(channels)); fresh.queueInput(input(channels))
        val actual = reused.output.order(ByteOrder.nativeOrder()).asFloatBuffer()
        val expected = fresh.output.order(ByteOrder.nativeOrder()).asFloatBuffer()
        assertEquals(channels * 32, actual.remaining())
        while (expected.hasRemaining()) assertEquals(expected.get(), actual.get(), 0.000001f)
        fresh.reset()
      }
      // ExoPlayer may configure the next track before the old format finishes draining.
      reused.configure(AudioProcessor.AudioFormat(48_000, 6, C.ENCODING_PCM_FLOAT))
      reused.queueInput(input(2))
      assertEquals(2 * 32 * 4, reused.output.remaining())
      reused.flush()
      reused.queueInput(input(6))
      assertEquals(6 * 32 * 4, reused.output.remaining())
      reused.reset()
    } finally {
      EqBridge.enabled = enabled; EqBridge.preampLinear = preamp; EqBridge.bands = bands; EqBridge.revision++
    }
  }
}
