package com.doublesymmetry.kotlinaudio.scope

import com.google.android.exoplayer2.C
import com.google.android.exoplayer2.audio.AudioProcessor
import com.google.android.exoplayer2.audio.BaseAudioProcessor
import expo.modules.astrascope.GainBridge
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Applies the per-track normalization / ReplayGain gain from [GainBridge] (set from
 * JS on track/settings change, activated natively at media-item transitions). Sits
 * FIRST in the chain — before the scope taps — so the visualizers see normalized
 * levels (the user's "better for scopes" goal).
 *
 * Gain changes ramp linearly, stepped once per FRAME (not per sample) so interleaved
 * channels stay balanced: ~instant declick at media boundaries, an audible glide for
 * mid-track corrections (see GainBridge.TRANSITION_RAMP_MS / CORRECTION_RAMP_MS).
 * The bridge publishes (target, rampMs) under a revision counter; [syncFromBridge]
 * re-arms the ramp when it moves (the EqAudioProcessor.rebuildIfNeeded pattern).
 *
 * [onFlush] snaps to the bridge target: a seek needs no declick (ExoPlayer flushes
 * the output anyway), and a freshly created/reinitialized sink must start at the
 * bridge's gain, never at a stale 1.0. Manual-skip ordering: the sink flush
 * (playback thread) may run before activateFor (player thread) — flush snaps to the
 * old target, then the next queueInput sees the new revision and does the 30 ms
 * ramp. Correct either way.
 *
 * Bit-exact passthrough only at unity WITH no ramp in flight — a ramp passing
 * through 1.0 keeps processing until it lands. Handles PCM float and 16-bit; the
 * 16-bit path clamps to int16 range. The gain resolver already backs off so the
 * post-gain peak stays <= 0.98, so clipping should not occur here in practice.
 */
class NormalizationGainProcessor : BaseAudioProcessor() {
  private var floatScratch = FloatArray(0)
  private var channels = 0
  private var sampleRate = 0

  private var lastRevision = Int.MIN_VALUE
  private var currentGain = 1f
  private var targetGain = 1f
  private var stepPerFrame = 0f
  private var rampFramesRemaining = 0

  override fun onConfigure(
    inputAudioFormat: AudioProcessor.AudioFormat
  ): AudioProcessor.AudioFormat {
    channels = inputAudioFormat.channelCount
    sampleRate = inputAudioFormat.sampleRate
    return inputAudioFormat
  }

  override fun onFlush() {
    // Position discontinuity / sink (re)init: adopt the bridge state with no ramp.
    lastRevision = GainBridge.revision
    currentGain = GainBridge.targetGain
    targetGain = currentGain
    stepPerFrame = 0f
    rampFramesRemaining = 0
  }

  private fun syncFromBridge() {
    val rev = GainBridge.revision
    if (rev == lastRevision) return
    lastRevision = rev
    targetGain = GainBridge.targetGain
    if (targetGain == currentGain) {
      rampFramesRemaining = 0
      return
    }
    val frames = max(1, GainBridge.rampMs * sampleRate / 1000)
    rampFramesRemaining = frames
    stepPerFrame = (targetGain - currentGain) / frames
  }

  /** Advance the ramp by one frame; lands exactly on the target (no float drift). */
  private fun stepFrame() {
    if (rampFramesRemaining == 0) return
    rampFramesRemaining -= 1
    currentGain = if (rampFramesRemaining == 0) targetGain else currentGain + stepPerFrame
  }

  override fun queueInput(inputBuffer: ByteBuffer) {
    val remaining = inputBuffer.remaining()
    if (remaining <= 0) return

    syncFromBridge()

    // Bit-exact passthrough only when settled at unity (never mid-ramp).
    if (rampFramesRemaining == 0 && currentGain == 1f) {
      val out = replaceOutputBuffer(remaining)
      out.put(inputBuffer)
      out.flip()
      return
    }

    val ch = channels.coerceAtLeast(1)
    when (inputAudioFormat.encoding) {
      C.ENCODING_PCM_FLOAT -> {
        val fb = inputBuffer.asFloatBuffer()
        val n = fb.remaining()
        if (n <= 0) return
        if (floatScratch.size < n) floatScratch = FloatArray(n)
        fb.get(floatScratch, 0, n)
        inputBuffer.position(inputBuffer.limit())
        var c = 0
        var i = 0
        while (i < n) {
          floatScratch[i] = floatScratch[i] * currentGain
          i++
          c++
          if (c == ch) {
            c = 0
            stepFrame()
          }
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
        var c = 0
        var i = 0
        while (i < n) {
          val v = (sb.get(i) * currentGain).roundToInt().coerceIn(-32768, 32767)
          osb.put(v.toShort())
          i++
          c++
          if (c == ch) {
            c = 0
            stepFrame()
          }
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
