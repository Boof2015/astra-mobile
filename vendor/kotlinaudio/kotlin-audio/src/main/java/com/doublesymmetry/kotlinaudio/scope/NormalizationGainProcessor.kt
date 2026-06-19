package com.doublesymmetry.kotlinaudio.scope

import com.google.android.exoplayer2.C
import com.google.android.exoplayer2.audio.AudioProcessor
import com.google.android.exoplayer2.audio.BaseAudioProcessor
import expo.modules.astrascope.GainBridge
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.roundToInt

/**
 * Applies the per-track normalization / ReplayGain gain from [GainBridge] (set from
 * JS on track/settings change). Sits FIRST in the chain — before the scope taps —
 * so the visualizers see normalized levels (the user's "better for scopes" goal).
 *
 * Bit-exact passthrough when the gain is unity. Handles PCM float and 16-bit; the
 * 16-bit path clamps to int16 range. The gain resolver already backs off so the
 * post-gain peak stays <= 0.98, so clipping should not occur here in practice.
 */
class NormalizationGainProcessor : BaseAudioProcessor() {
  private var floatScratch = FloatArray(0)

  override fun onConfigure(
    inputAudioFormat: AudioProcessor.AudioFormat
  ): AudioProcessor.AudioFormat = inputAudioFormat

  override fun queueInput(inputBuffer: ByteBuffer) {
    val remaining = inputBuffer.remaining()
    if (remaining <= 0) return

    val gain = GainBridge.linearGain
    if (gain == 1f) {
      val out = replaceOutputBuffer(remaining)
      out.put(inputBuffer)
      out.flip()
      return
    }

    when (inputAudioFormat.encoding) {
      C.ENCODING_PCM_FLOAT -> {
        val fb = inputBuffer.asFloatBuffer()
        val n = fb.remaining()
        if (n <= 0) return
        if (floatScratch.size < n) floatScratch = FloatArray(n)
        fb.get(floatScratch, 0, n)
        inputBuffer.position(inputBuffer.limit())
        var i = 0
        while (i < n) {
          floatScratch[i] = floatScratch[i] * gain
          i++
        }
        val out = replaceOutputBuffer(n * 4).order(ByteOrder.nativeOrder())
        out.asFloatBuffer().put(floatScratch, 0, n)
        out.position(n * 4)
        out.flip()
      }
      C.ENCODING_PCM_16BIT -> {
        val sb = inputBuffer.asShortBuffer()
        val n = sb.remaining()
        if (n <= 0) return
        val out = replaceOutputBuffer(n * 2).order(ByteOrder.nativeOrder())
        val osb = out.asShortBuffer()
        var i = 0
        while (i < n) {
          val v = (sb.get(i) * gain).roundToInt().coerceIn(-32768, 32767)
          osb.put(v.toShort())
          i++
        }
        inputBuffer.position(inputBuffer.limit())
        out.position(n * 2)
        out.flip()
      }
      else -> {
        val out = replaceOutputBuffer(remaining)
        out.put(inputBuffer)
        out.flip()
      }
    }
  }
}
