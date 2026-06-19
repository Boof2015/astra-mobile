package com.doublesymmetry.kotlinaudio.scope

import com.google.android.exoplayer2.C
import com.google.android.exoplayer2.audio.AudioProcessor
import com.google.android.exoplayer2.audio.BaseAudioProcessor
import expo.modules.astrascope.EqBridge
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Parametric EQ as an ExoPlayer AudioProcessor (M4). Reads raw band params from
 * [EqBridge] (set from JS) and computes Audio-EQ-Cookbook biquad coefficients at
 * the real stream sample rate — mirroring Web Audio's BiquadFilterNode on desktop.
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
      computeCoeffs(
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

  /**
   * Audio-EQ-Cookbook biquad coefficients (a0-normalized) into out[off..off+4].
   * Type ordinals match EQ_BAND_TYPE_ORDINAL in src/audio/eq.ts:
   * 0 lowshelf, 1 peaking, 2 highshelf, 3 highpass, 4 lowpass.
   */
  private fun computeCoeffs(
    type: Int,
    freq: Float,
    gainDb: Float,
    q: Float,
    sr: Float,
    out: FloatArray,
    off: Int
  ) {
    if (sr <= 0f) {
      out[off] = 1f; out[off + 1] = 0f; out[off + 2] = 0f; out[off + 3] = 0f; out[off + 4] = 0f
      return
    }
    val w0 = 2.0 * PI * freq / sr
    val cosW0 = cos(w0)
    val sinW0 = sin(w0)
    val a = 10.0.pow(gainDb / 40.0)
    val alpha = sinW0 / (2.0 * q.coerceAtLeast(0.0001f))

    var b0 = 1.0; var b1 = 0.0; var b2 = 0.0
    var a0 = 1.0; var a1 = 0.0; var a2 = 0.0

    when (type) {
      1 -> { // peaking
        b0 = 1 + alpha * a; b1 = -2 * cosW0; b2 = 1 - alpha * a
        a0 = 1 + alpha / a; a1 = -2 * cosW0; a2 = 1 - alpha / a
      }
      0 -> { // lowshelf
        val sqrtA = sqrt(a)
        b0 = a * (a + 1 - (a - 1) * cosW0 + 2 * sqrtA * alpha)
        b1 = 2 * a * (a - 1 - (a + 1) * cosW0)
        b2 = a * (a + 1 - (a - 1) * cosW0 - 2 * sqrtA * alpha)
        a0 = a + 1 + (a - 1) * cosW0 + 2 * sqrtA * alpha
        a1 = -2 * (a - 1 + (a + 1) * cosW0)
        a2 = a + 1 + (a - 1) * cosW0 - 2 * sqrtA * alpha
      }
      2 -> { // highshelf
        val sqrtA = sqrt(a)
        b0 = a * (a + 1 + (a - 1) * cosW0 + 2 * sqrtA * alpha)
        b1 = -2 * a * (a - 1 + (a + 1) * cosW0)
        b2 = a * (a + 1 + (a - 1) * cosW0 - 2 * sqrtA * alpha)
        a0 = a + 1 - (a - 1) * cosW0 + 2 * sqrtA * alpha
        a1 = 2 * (a - 1 - (a + 1) * cosW0)
        a2 = a + 1 - (a - 1) * cosW0 - 2 * sqrtA * alpha
      }
      4 -> { // lowpass
        b0 = (1 - cosW0) / 2; b1 = 1 - cosW0; b2 = (1 - cosW0) / 2
        a0 = 1 + alpha; a1 = -2 * cosW0; a2 = 1 - alpha
      }
      3 -> { // highpass
        b0 = (1 + cosW0) / 2; b1 = -(1 + cosW0); b2 = (1 + cosW0) / 2
        a0 = 1 + alpha; a1 = -2 * cosW0; a2 = 1 - alpha
      }
    }

    val inv = 1.0 / a0
    out[off] = (b0 * inv).toFloat()
    out[off + 1] = (b1 * inv).toFloat()
    out[off + 2] = (b2 * inv).toFloat()
    out[off + 3] = (a1 * inv).toFloat()
    out[off + 4] = (a2 * inv).toFloat()
  }
}
