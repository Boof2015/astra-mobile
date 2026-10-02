package expo.modules.astralibraryscanner

import android.content.Context
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.*
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull

private fun nanosToDoubleMs(nanos: Long): Double = nanos / 1_000_000.0

internal class PlatformAudioAnalyzer(
  private val context: Context,
  private val onProgress: (FloatArray, Int) -> Unit,
) {
  /** Throttle for onWaveformProgress — ~12 emits/sec is plenty for a fill animation. */
  private val progressEmitNanos = 80L * 1_000_000L

  /**
   * One whole-file PCM decode producing per-bin RMS waveform peaks (normalized to [0,1])
   * and, when `withLoudness`, gated integrated LUFS + absolute sample peak. Both analyses
   * need every sample, so they share a pass.
   *
   * Uses MediaCodec in async (callback) mode: the old synchronous dequeue loop burned a
   * 10ms timeout every time a buffer wasn't ready, thousands of times per track. All four
   * callbacks land on one handler thread, so the extractor and accumulator are touched from
   * exactly one thread and need no locking.
   *
   * Results are persistable only when `completed` is true and `cancelled` is false.
   * The timeout bounds the decode so corrupt input cannot hold a permit indefinitely.
   */
  suspend fun analyze(
    uriStr: String,
    bins: Int,
    withLoudness: Boolean,
    cancelFlag: AtomicBoolean,
    timeoutMs: Long = 180_000L,
  ): AudioAnalysis {
    val result = AudioAnalysis()
    result.withLoudness = withLoudness
    val uri = Uri.parse(uriStr)
    val extractor = MediaExtractor()
    var codec: MediaCodec? = null
    var handlerThread: HandlerThread? = null
    val startNanos = System.nanoTime()
    var codecStartNanos = 0L
    var finalizedNanos = 0L

    try {
      extractor.setDataSource(context, uri, null)

      var trackFormat: MediaFormat? = null
      var trackIndex = -1
      for (i in 0 until extractor.trackCount) {
        val f = extractor.getTrackFormat(i)
        if (f.getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true) {
          trackFormat = f; trackIndex = i; break
        }
      }
      val format = trackFormat ?: return result
      extractor.selectTrack(trackIndex)

      val mime = format.getString(MediaFormat.KEY_MIME) ?: return result
      result.mime = mime

      val sampleRate =
        if (format.containsKey(MediaFormat.KEY_SAMPLE_RATE)) format.getInteger(MediaFormat.KEY_SAMPLE_RATE) else 44100
      result.sampleRate = sampleRate
      val durationUs =
        if (format.containsKey(MediaFormat.KEY_DURATION)) format.getLong(MediaFormat.KEY_DURATION) else 0L
      result.durationMs = durationUs / 1000.0
      val totalFrames = max(1L, (durationUs / 1_000_000.0 * sampleRate).toLong())

      val initialChannels =
        if (format.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) format.getInteger(MediaFormat.KEY_CHANNEL_COUNT) else 2
      result.channelCount = initialChannels
      val acc = AnalyzeAccumulator(bins, totalFrames, withLoudness).also {
        it.sampleRate = sampleRate
        it.channelCount = initialChannels
      }

      val decoder = createAnalysisDecoder(mime)
      codec = decoder
      result.decoderName = decoder.name

      handlerThread = HandlerThread("astra-analyze").also { it.start() }
      val done = CompletableDeferred<Unit>()
      var sawInputEOS = false
      var lastEmitNanos = 0L
      var lastEmitBin = 0

      decoder.setCallback(
        object : MediaCodec.Callback() {
          override fun onInputBufferAvailable(mc: MediaCodec, index: Int) {
            if (done.isCompleted) return
            try {
              if (cancelFlag.get()) {
                result.cancelled = true
                done.complete(Unit)
                return
              }
              if (sawInputEOS) return
              val buf = mc.getInputBuffer(index) ?: return
              val size = extractor.readSampleData(buf, 0)
              if (size < 0) {
                mc.queueInputBuffer(index, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                sawInputEOS = true
              } else {
                mc.queueInputBuffer(index, 0, size, extractor.sampleTime, 0)
                extractor.advance()
              }
            } catch (_: Throwable) {
              done.complete(Unit)
            }
          }

          override fun onOutputBufferAvailable(
            mc: MediaCodec,
            index: Int,
            info: MediaCodec.BufferInfo,
          ) {
            if (done.isCompleted) return
            try {
              if (cancelFlag.get()) {
                result.cancelled = true
                done.complete(Unit)
                return
              }
              if (info.size > 0) {
                if (result.firstPcmMs == null) {
                  result.firstPcmMs = nanosToDoubleMs(System.nanoTime() - startNanos)
                }
                val out = mc.getOutputBuffer(index)
                if (out != null) {
                  out.position(info.offset)
                  out.limit(info.offset + info.size)
                  out.order(ByteOrder.nativeOrder())
                  acc.accumulate(out)
                }
              }
              val eos = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
              mc.releaseOutputBuffer(index, false)

              // Progressive emit so the seek bar fills left-to-right instead of snapping
              // in at the end. Skipped on the EOS buffer — the promise carries the final,
              // globally-normalized result a moment later.
              val now = System.nanoTime()
              if (
                !eos &&
                acc.filledBins > lastEmitBin &&
                now - lastEmitNanos >= progressEmitNanos
              ) {
                lastEmitNanos = now
                lastEmitBin = acc.filledBins
                if (result.firstProgressMs == null) {
                  result.firstProgressMs = nanosToDoubleMs(now - startNanos)
                }
                emitWaveformProgress(acc, lastEmitBin)
              }
              if (eos) {
                result.decodeToEosMs = nanosToDoubleMs(now - codecStartNanos)
                result.completed = true
                done.complete(Unit)
              }
            } catch (_: Throwable) {
              done.complete(Unit)
            }
          }

          override fun onOutputFormatChanged(mc: MediaCodec, fmt: MediaFormat) {
            if (fmt.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) {
              val channels = fmt.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
              result.channelCount = channels
              acc.channelCount = channels
            }
            if (fmt.containsKey(MediaFormat.KEY_SAMPLE_RATE)) {
              val rate = fmt.getInteger(MediaFormat.KEY_SAMPLE_RATE)
              result.sampleRate = rate
              acc.sampleRate = rate
            }
            if (fmt.containsKey(MediaFormat.KEY_PCM_ENCODING)) {
              acc.pcmFloat =
                fmt.getInteger(MediaFormat.KEY_PCM_ENCODING) == AudioFormat.ENCODING_PCM_FLOAT
            }
          }

          override fun onError(mc: MediaCodec, e: MediaCodec.CodecException) {
            done.complete(Unit)
          }
        },
        Handler(handlerThread.looper),
      )

      codec.configure(format, null, null, 0)
      codecStartNanos = System.nanoTime()
      codec.start()
      result.setupMs = nanosToDoubleMs(System.nanoTime() - startNanos)

      while (!done.isCompleted && !cancelFlag.get() && nanosToDoubleMs(System.nanoTime() - startNanos) < timeoutMs) {
        withTimeoutOrNull(100) { done.await() }
      }
      if (!done.isCompleted) {
        result.cancelled = true
        done.complete(Unit)
      }
      if (cancelFlag.get()) result.cancelled = true
      if (result.cancelled || !result.completed) { result.completed = false; return result }
      // EOS after an empty or severely truncated stream must not seed a permanent cache.
      // Allow encoder delay/padding and small container-duration rounding differences.
      if (acc.decodedFrames == 0L || (durationUs > 0 &&
          acc.decodedFrames + maxOf(4096L, totalFrames / 100) < totalFrames)) {
        result.completed = false
        return result
      }

      val finalizeStartNanos = System.nanoTime()
      result.peaks = acc.finalPeaks()
      if (withLoudness) {
        result.lufs = acc.loudness
        result.peak = acc.samplePeak
      }
      finalizedNanos = System.nanoTime()
      result.finalizeMs = nanosToDoubleMs(finalizedNanos - finalizeStartNanos)
      val decodeMs = nanosToDoubleMs(finalizedNanos - startNanos)
      result.decodeMs = decodeMs
      val dur = result.durationMs
      if (dur != null && dur > 0 && decodeMs > 0) result.realtimeFactor = dur / decodeMs
      return result
    } catch (_: Throwable) {
      result.completed = false
      return result
    } finally {
      val cleanupStartNanos = System.nanoTime()
      // Order matters: stopping the codec while a callback is mid-flight on the handler
      // thread can crash. Quit the looper and wait for the in-flight callback to drain
      // first, THEN tear the codec down.
      try {
        handlerThread?.quitSafely()
        handlerThread?.join(1_000)
      } catch (_: Throwable) {}
      try { codec?.stop() } catch (_: Throwable) {}
      try { codec?.release() } catch (_: Throwable) {}
      try { extractor.release() } catch (_: Throwable) {}
      val finishedNanos = System.nanoTime()
      result.cleanupMs = nanosToDoubleMs(finishedNanos - cleanupStartNanos)
      if (result.decodeMs == null && finalizedNanos == 0L) {
        result.decodeMs = nanosToDoubleMs(cleanupStartNanos - startNanos)
      }
      result.endToEndMs = result.queueWaitMs + nanosToDoubleMs(finishedNanos - startNanos)
    }
  }

  // Emits the raw (un-normalized) RMS prefix; JS normalizes against its own max, so the
  // bars rescale slightly as louder material arrives rather than needing a global max we
  // don't have yet.
  private fun emitWaveformProgress(acc: AnalyzeAccumulator, filledBins: Int) {
    runCatching { onProgress(acc.rmsPrefix(filledBins), filledBins) }
  }

  // Offline analysis wants raw throughput. Hardware audio decoders are tuned for low-power
  // realtime playback, not bulk decode, and the instance is a scarce global resource shared
  // with the track that is actually playing — so prefer a software decoder and fall back to
  // the platform's default pick.
  private fun createAnalysisDecoder(
    mime: String,
  ): MediaCodec {
    try {
      val info = MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.firstOrNull { c ->
        !c.isEncoder &&
          c.supportedTypes.any { it.equals(mime, ignoreCase = true) } &&
          isSoftwareDecoder(c)
      }
      if (info != null) return MediaCodec.createByCodecName(info.name)
    } catch (_: Throwable) {
      // Fall through to the platform default.
    }
    return MediaCodec.createDecoderByType(mime)
  }

  private fun isSoftwareDecoder(info: MediaCodecInfo): Boolean {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) return info.isSoftwareOnly
    val name = info.name.lowercase()
    return name.startsWith("omx.google.") || name.startsWith("c2.android.")
  }

  /**
   * Per-bin RMS accumulation over the decoded PCM stream, with the K-weighted loudness
   * meter folded in when requested.
   *
   * Two things matter here because this runs ~20M times for a 4-minute stereo track: PCM is
   * bulk-copied out of the codec buffer into a reused scratch array rather than read one
   * sample at a time, and frames are consumed in runs (every frame landing in the same bin
   * is summed in one tight loop) instead of recomputing the bin index per frame with a
   * floating-point division.
   */
  internal class AnalyzeAccumulator(
    val bins: Int,
    private val totalFrames: Long,
    private val withLoudness: Boolean,
  ) {
    private val sumSquares = DoubleArray(bins)
    private val counts = LongArray(bins)

    var channelCount = 2
    var sampleRate = 44100
    var pcmFloat = false

    /** Index of the highest bin reached — every bin below it is fully accumulated. */
    var filledBins = 0
      private set

    private var frame = 0L
    val decodedFrames: Long get() = frame
    private var meter: LoudnessMeter? = null
    private var floatScratch = FloatArray(0)
    private var shortScratch = ShortArray(0)

    val loudness: Double? get() = meter?.lufs()
    val samplePeak: Double? get() = meter?.peak

    fun accumulate(out: ByteBuffer) {
      val ch = channelCount.coerceAtLeast(1)
      // Created lazily: the true output channel count / rate only arrive with the first
      // onOutputFormatChanged, which always precedes the first output buffer.
      if (withLoudness && meter == null) meter = LoudnessMeter(ch, sampleRate)
      if (pcmFloat) {
        val fb = out.asFloatBuffer()
        val n = fb.remaining()
        if (floatScratch.size < n) floatScratch = FloatArray(n)
        fb.get(floatScratch, 0, n)
        consume(floatScratch, null, n, ch)
      } else {
        val sb = out.asShortBuffer()
        val n = sb.remaining()
        if (shortScratch.size < n) shortScratch = ShortArray(n)
        sb.get(shortScratch, 0, n)
        consume(null, shortScratch, n, ch)
      }
    }

    private fun consume(f: FloatArray?, s: ShortArray?, n: Int, ch: Int) {
      val m = meter
      var k = 0
      while (k < n) {
        var bin = ((frame * bins) / totalFrames).toInt()
        if (bin < 0) bin = 0 else if (bin >= bins) bin = bins - 1
        // First frame belonging to the next bin: ceil((bin + 1) * totalFrames / bins).
        val boundary = ((bin + 1).toLong() * totalFrames + bins - 1L) / bins
        val framesAvail = (n - k) / ch
        if (framesAvail <= 0) break // trailing partial frame; drop it
        var run = (boundary - frame).coerceAtLeast(1L)
        if (run > framesAvail) run = framesAvail.toLong()
        val end = k + run.toInt() * ch

        var acc = 0.0
        var j = k
        if (m == null) {
          if (f != null) {
            while (j < end) { val v = f[j].toDouble(); acc += v * v; j++ }
          } else if (s != null) {
            while (j < end) { val v = s[j] / 32768.0; acc += v * v; j++ }
          }
        } else {
          var c = 0
          if (f != null) {
            while (j < end) {
              val v = f[j].toDouble(); acc += v * v; m.process(v, c)
              j++; c++; if (c == ch) c = 0
            }
          } else if (s != null) {
            while (j < end) {
              val v = s[j] / 32768.0; acc += v * v; m.process(v, c)
              j++; c++; if (c == ch) c = 0
            }
          }
        }

        sumSquares[bin] += acc
        counts[bin] += run * ch
        frame += run
        k = end
        if (bin > filledBins) filledBins = bin
      }
    }

    /** Raw, un-normalized RMS for the first `count` bins (progressive emit). */
    fun rmsPrefix(count: Int): FloatArray {
      val n = count.coerceIn(0, bins)
      val out = FloatArray(n)
      for (i in 0 until n) {
        if (counts[i] > 0) out[i] = sqrt(sumSquares[i] / counts[i]).toFloat()
      }
      return out
    }

    /** Final peaks, normalized against the global max across every bin. */
    fun finalPeaks(): FloatArray {
      val peaks = FloatArray(bins)
      var globalMax = 0.0
      for (i in 0 until bins) {
        if (counts[i] > 0) {
          val rms = sqrt(sumSquares[i] / counts[i])
          peaks[i] = rms.toFloat()
          if (rms > globalMax) globalMax = rms
        }
      }
      if (globalMax > 0) {
        for (i in 0 until bins) peaks[i] = (peaks[i] / globalMax).toFloat()
      }
      return peaks
    }
  }

  // Gated integrated K-weighted loudness per ITU-R BS.1770 + absolute sample peak.
  // Two cascaded biquads (high-shelf pre-filter + RLB high-pass) per channel with
  // pyloudnorm-reference coefficients (so the -0.691 offset holds), accumulated into
  // 400 ms blocks, then a two-stage gate (-70 LUFS absolute, -10 LU relative). Unity
  // channel weights (fine for mono/stereo). Non-overlapping blocks (vs the spec's 75%
  // overlap) — within ~0.1 LU and much cheaper.
  private class LoudnessMeter(private val channels: Int, sampleRate: Int) {
    private val b0a: Double; private val b1a: Double; private val b2a: Double
    private val a1a: Double; private val a2a: Double
    private val a1b: Double; private val a2b: Double

    private val s1a = DoubleArray(channels)
    private val s2a = DoubleArray(channels)
    private val s1b = DoubleArray(channels)
    private val s2b = DoubleArray(channels)

    private val blockSumSq = DoubleArray(channels)
    private val blockFrames: Int
    private var framesInBlock = 0
    // Per-block summed-channel mean-square energy (z), for gating.
    private val blockEnergies = ArrayList<Double>()

    var peak: Double = 0.0
      private set

    init {
      val fs = sampleRate.coerceAtLeast(1).toDouble()
      // Stage 1: high-shelf pre-filter.
      val f0a = 1681.974450955533
      val ga = 3.999843853973347
      val qa = 0.7071752369554196
      val ka = tan(PI * f0a / fs)
      val vh = Math.pow(10.0, ga / 20.0)
      val vb = Math.pow(vh, 0.4996667741545416)
      val a0a = 1.0 + ka / qa + ka * ka
      b0a = (vh + vb * ka / qa + ka * ka) / a0a
      b1a = 2.0 * (ka * ka - vh) / a0a
      b2a = (vh - vb * ka / qa + ka * ka) / a0a
      a1a = 2.0 * (ka * ka - 1.0) / a0a
      a2a = (1.0 - ka / qa + ka * ka) / a0a
      // Stage 2: RLB high-pass (b = [1, -2, 1]).
      val f0b = 38.13547087602444
      val qb = 0.5003270373238773
      val kb = tan(PI * f0b / fs)
      val a0b = 1.0 + kb / qb + kb * kb
      a1b = 2.0 * (kb * kb - 1.0) / a0b
      a2b = (1.0 - kb / qb + kb * kb) / a0b

      blockFrames = max(1L, (0.4 * fs).toLong()).toInt() // 400 ms gating block
    }

    fun process(sample: Double, ch: Int) {
      if (ch >= channels) return
      val a = abs(sample)
      if (a > peak) peak = a
      // Stage 1 (transposed direct form II).
      val y1 = b0a * sample + s1a[ch]
      s1a[ch] = b1a * sample - a1a * y1 + s2a[ch]
      s2a[ch] = b2a * sample - a2a * y1
      // Stage 2: b0=1, b1=-2, b2=1.
      val y2 = y1 + s1b[ch]
      s1b[ch] = -2.0 * y1 - a1b * y2 + s2b[ch]
      s2b[ch] = y1 - a2b * y2
      blockSumSq[ch] += y2 * y2
      // One frame completes when the last channel of the frame is processed.
      if (ch == channels - 1) {
        framesInBlock++
        if (framesInBlock >= blockFrames) finalizeBlock()
      }
    }

    private fun finalizeBlock() {
      if (framesInBlock <= 0) return
      var energy = 0.0
      for (c in 0 until channels) {
        energy += blockSumSq[c] / framesInBlock
        blockSumSq[c] = 0.0
      }
      framesInBlock = 0
      if (energy > 0.0) blockEnergies.add(energy)
    }

    fun lufs(): Double {
      finalizeBlock() // flush the trailing partial block
      if (blockEnergies.isEmpty()) return -70.0

      // Absolute gate at -70 LUFS (energy terms).
      val absThresh = Math.pow(10.0, (-70.0 + 0.691) / 10.0)
      var sum = 0.0
      var cnt = 0
      for (e in blockEnergies) if (e >= absThresh) { sum += e; cnt++ }
      if (cnt == 0) return -70.0

      // Relative gate: -10 LU below the abs-gated mean.
      val relLoudness = -0.691 + 10.0 * log10(sum / cnt)
      val relThresh = Math.pow(10.0, (relLoudness - 10.0 + 0.691) / 10.0)
      sum = 0.0
      cnt = 0
      for (e in blockEnergies) if (e >= absThresh && e >= relThresh) { sum += e; cnt++ }
      if (cnt == 0) return -70.0

      return -0.691 + 10.0 * log10(sum / cnt)
    }
  }

}
