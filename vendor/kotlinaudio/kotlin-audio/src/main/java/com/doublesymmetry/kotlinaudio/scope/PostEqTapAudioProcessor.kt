package com.doublesymmetry.kotlinaudio.scope

import com.google.android.exoplayer2.C
import com.google.android.exoplayer2.audio.AudioProcessor
import com.google.android.exoplayer2.audio.BaseAudioProcessor
import expo.modules.astrascope.ScopeBridge
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Pass-through tap placed AFTER the EQ processor (M4). Identical to
 * ScopeTapAudioProcessor but pushes to the native post-EQ ring (ring #2) which
 * feeds the EQ screen's response-curve spectrum overlay. Gated by
 * `ScopeBridge.active && ScopeBridge.postEqActive` so it costs ~zero unless the
 * EQ screen is open and the app is foregrounded + playing.
 */
class PostEqTapAudioProcessor : BaseAudioProcessor() {
  private var scratch = FloatArray(0)

  override fun onConfigure(
    inputAudioFormat: AudioProcessor.AudioFormat
  ): AudioProcessor.AudioFormat = inputAudioFormat

  override fun queueInput(inputBuffer: ByteBuffer) {
    val remaining = inputBuffer.remaining()
    if (remaining <= 0) return

    if (ScopeBridge.active && ScopeBridge.postEqActive) {
      tap(inputBuffer)
    }

    val out = replaceOutputBuffer(remaining)
    out.put(inputBuffer)
    out.flip()
  }

  private fun tap(inputBuffer: ByteBuffer) {
    val channels = inputAudioFormat.channelCount
    if (channels <= 0) return
    val dup = inputBuffer.duplicate().order(ByteOrder.nativeOrder())

    when (inputAudioFormat.encoding) {
      C.ENCODING_PCM_FLOAT -> {
        val fb = dup.asFloatBuffer()
        val n = fb.remaining()
        if (n <= 0) return
        if (scratch.size < n) scratch = FloatArray(n)
        fb.get(scratch, 0, n)
        ScopeBridge.nativePushFramesPostEq(scratch, n / channels, channels)
      }
      C.ENCODING_PCM_16BIT -> {
        val sb = dup.asShortBuffer()
        val n = sb.remaining()
        if (n <= 0) return
        if (scratch.size < n) scratch = FloatArray(n)
        var i = 0
        while (i < n) {
          scratch[i] = sb.get(i) / 32768f
          i++
        }
        ScopeBridge.nativePushFramesPostEq(scratch, n / channels, channels)
      }
      else -> { /* unsupported PCM encoding — forward only */ }
    }
  }
}
