package com.doublesymmetry.kotlinaudio.scope

import com.google.android.exoplayer2.C
import com.google.android.exoplayer2.audio.AudioProcessor
import com.google.android.exoplayer2.audio.BaseAudioProcessor
import expo.modules.astrascope.ScopeBridge
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Pass-through ExoPlayer AudioProcessor (M3 pre-EQ tap). Output == input so the
 * audio path stays bit-exact; when the scope is active it also copies a mono
 * downmix-ready interleaved float frame to the native analyzer via ScopeBridge.
 * Allocation-free in steady state (reuses a scratch buffer); the ScopeBridge.active
 * gate keeps a backgrounded/paused app's audio callback at ~zero cost.
 */
class ScopeTapAudioProcessor : BaseAudioProcessor() {
  private var scratch = FloatArray(0)

  override fun onConfigure(
    inputAudioFormat: AudioProcessor.AudioFormat
  ): AudioProcessor.AudioFormat {
    if (inputAudioFormat.encoding == C.ENCODING_PCM_16BIT ||
      inputAudioFormat.encoding == C.ENCODING_PCM_FLOAT
    ) {
      ScopeBridge.nativeConfigure(inputAudioFormat.sampleRate, inputAudioFormat.channelCount)
    }
    // Always pass the format through unchanged.
    return inputAudioFormat
  }

  override fun queueInput(inputBuffer: ByteBuffer) {
    val remaining = inputBuffer.remaining()
    if (remaining <= 0) return

    if (ScopeBridge.active) {
      tap(inputBuffer)
    }

    // Forward the audio unchanged (reads inputBuffer's own position/limit).
    val out = replaceOutputBuffer(remaining)
    out.put(inputBuffer)
    out.flip()
  }

  // Reads from a duplicate so inputBuffer's position is left intact for forwarding.
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
        ScopeBridge.nativePushFrames(scratch, n / channels, channels)
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
        ScopeBridge.nativePushFrames(scratch, n / channels, channels)
      }
      else -> { /* unsupported PCM encoding — forward only */ }
    }
  }
}
