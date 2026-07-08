package com.doublesymmetry.kotlinaudio.scope

import com.google.android.exoplayer2.C
import com.google.android.exoplayer2.audio.AudioProcessor
import com.google.android.exoplayer2.audio.BaseAudioProcessor
import expo.modules.astrascope.EqBridge
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.roundToInt

/**
 * Parametric EQ as an ExoPlayer AudioProcessor (M4). Reads raw band params from
 * [EqBridge] (set from JS) and computes Web Audio BiquadFilterNode-compatible
 * coefficients at the real stream sample rate, matching desktop Astra.
 * A cascade of transposed-direct-form-II biquads runs per channel after a preamp.
 *
 * Passthrough (bit-exact) when the EQ is disabled or has no active bands and unity
 * preamp, so toggling EQ off is lossless. Handles PCM float and 16-bit; coefficients
 * are rebuilt only when [EqBridge.revision] changes (cheap, off the per-sample path).
 */
class EqAudioProcessor : BaseAudioProcessor() {
  private var channels = 0
  private var sampleRate = 0f

  private var lastRevision = Int.MIN_VALUE
  private var enabled = false
  private var preamp = 1f
  private var bandCount = 0
  private var coeffs = FloatArray(0) // 5 per band: b0,b1,b2,a1,a2 (a0-normalized)
  private var z1 = FloatArray(0) // bandCount * channels
  private var z2 = FloatArray(0)

  private var floatScratch = FloatArray(0)

  override fun onConfigure(
    inputAudioFormat: AudioProcessor.AudioFormat
  ): AudioProcessor.AudioFormat {
    channels = inputAudioFormat.channelCount
    sampleRate = inputAudioFormat.sampleRate.toFloat()
    lastRevision = Int.MIN_VALUE // force a rebuild on the next buffer
    return inputAudioFormat
  }

  override fun queueInput(inputBuffer: ByteBuffer) {
    val remaining = inputBuffer.remaining()
    if (remaining <= 0) return

    rebuildIfNeeded()

    val passthrough = !enabled || channels <= 0 || (bandCount == 0 && preamp == 1f)
    if (passthrough) {
      val out = replaceOutputBuffer(remaining)
      out.put(inputBuffer)
      out.flip()
      return
    }

    when (inputAudioFormat.encoding) {
      C.ENCODING_PCM_FLOAT -> processFloat(inputBuffer, remaining)
      C.ENCODING_PCM_16BIT -> process16(inputBuffer, remaining)
      else -> {
        val out = replaceOutputBuffer(remaining)
        out.put(inputBuffer)
        out.flip()
      }
    }
  }

  override fun onFlush() {
    z1.fill(0f)
    z2.fill(0f)
  }

  private fun rebuildIfNeeded() {
    val rev = EqBridge.revision
    if (rev == lastRevision) return
    lastRevision = rev

    enabled = EqBridge.enabled
    preamp = EqBridge.preampLinear
    val params = EqBridge.bands
    val total = params.size / 5

    var active = 0
    for (i in 0 until total) if (params[i * 5 + 4] != 0f) active++

    // Reset filter state only when the band count changes (avoid clicks on tweaks).
    if (active != bandCount) {
      bandCount = active
      coeffs = FloatArray(active * 5)
      z1 = FloatArray(active * channels.coerceAtLeast(1))
      z2 = FloatArray(active * channels.coerceAtLeast(1))
    }

    var bi = 0
    for (i in 0 until total) {
      if (params[i * 5 + 4] == 0f) continue
      EqCoefficients.compute(
        params[i * 5].toInt(),
        params[i * 5 + 1],
        params[i * 5 + 2],
        params[i * 5 + 3],
        sampleRate,
        coeffs,
        bi * 5
      )
      bi++
    }
  }

  private fun processFloat(inputBuffer: ByteBuffer, remaining: Int) {
    val fb = inputBuffer.asFloatBuffer()
    val n = fb.remaining()
    if (n <= 0) return
    if (floatScratch.size < n) floatScratch = FloatArray(n)
    fb.get(floatScratch, 0, n)
    inputBuffer.position(inputBuffer.limit()) // mark input consumed

    processSamples(floatScratch, n)

    val out = replaceOutputBuffer(n * 4).order(ByteOrder.nativeOrder())
    out.asFloatBuffer().put(floatScratch, 0, n)
    out.position(n * 4)
    out.flip()
  }

  private fun process16(inputBuffer: ByteBuffer, remaining: Int) {
    val sb = inputBuffer.asShortBuffer()
    val n = sb.remaining()
    if (n <= 0) return
    if (floatScratch.size < n) floatScratch = FloatArray(n)
    var i = 0
    while (i < n) {
      floatScratch[i] = sb.get(i) / 32768f
      i++
    }
    inputBuffer.position(inputBuffer.limit())

    processSamples(floatScratch, n)

    val out = replaceOutputBuffer(n * 2).order(ByteOrder.nativeOrder())
    val osb = out.asShortBuffer()
    i = 0
    while (i < n) {
      val v = (floatScratch[i] * 32768f).roundToInt().coerceIn(-32768, 32767)
      osb.put(v.toShort())
      i++
    }
    out.position(n * 2)
    out.flip()
  }

  /** Apply preamp + the biquad cascade in place over interleaved samples. */
  private fun processSamples(buf: FloatArray, n: Int) {
    val ch = channels
    val bc = bandCount
    val pre = preamp
    var c = 0
    var i = 0
    while (i < n) {
      var x = buf[i] * pre
      var b = 0
      while (b < bc) {
        val co = b * 5
        val b0 = coeffs[co]
        val b1 = coeffs[co + 1]
        val b2 = coeffs[co + 2]
        val a1 = coeffs[co + 3]
        val a2 = coeffs[co + 4]
        val si = b * ch + c
        val s1 = z1[si]
        val s2 = z2[si]
        val y = b0 * x + s1
        z1[si] = b1 * x - a1 * y + s2
        z2[si] = b2 * x - a2 * y
        x = y
        b++
      }
      buf[i] = x
      c++
      if (c == ch) c = 0
      i++
    }
  }

}
