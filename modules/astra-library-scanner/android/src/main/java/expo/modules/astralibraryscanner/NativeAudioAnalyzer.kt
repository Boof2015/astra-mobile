package expo.modules.astralibraryscanner

import android.content.Context
import android.net.Uri
import android.system.Os
import android.system.OsConstants
import androidx.annotation.Keep
import java.util.concurrent.atomic.AtomicBoolean

@Keep
internal class NativeAudioAnalysisData {
  @JvmField var completed = false
  @JvmField var cancelled = false
  @JvmField var error: String? = null
  @JvmField var decoderName: String? = null
  @JvmField var mime: String? = null
  @JvmField var peaks = FloatArray(0)
  @JvmField var lufs = Double.NaN
  @JvmField var peak = Double.NaN
  @JvmField var durationMs = 0.0
  @JvmField var setupMs = 0.0
  @JvmField var firstPcmMs = -1.0
  @JvmField var firstProgressMs = -1.0
  @JvmField var decodeToEosMs = 0.0
  @JvmField var finalizeMs = 0.0
  @JvmField var decodeMs = 0.0
  @JvmField var sampleRate = 0
  @JvmField var channelCount = 0
}

@Keep
internal fun interface NativeAnalysisProgress {
  fun emit(peaks: FloatArray, filledBins: Int)
}

@Keep
internal object NativeAudioAnalyzer {
  init { System.loadLibrary("astraanalysis") }

  private external fun analyzeDescriptor(
    fd: Int, offset: Long, length: Long, bins: Int, withLoudness: Boolean,
    durationMs: Double, cancelled: AtomicBoolean, progress: NativeAnalysisProgress, timeoutMs: Long,
  ): NativeAudioAnalysisData

  fun analyze(
    context: Context, uri: Uri, bins: Int, withLoudness: Boolean,
    durationMs: Double, cancelled: AtomicBoolean, progress: NativeAnalysisProgress, timeoutMs: Long,
  ): AudioAnalysis {
    val started = System.nanoTime()
    val result = AudioAnalysis().apply { decoderRoute = "native"; this.withLoudness = withLoudness }
    try {
      if (cancelled.get()) return result.apply { this.cancelled = true }
      if (uri.scheme !in listOf("file", "content")) return result.apply { fallbackReason = "Non-local source" }
      context.contentResolver.openAssetFileDescriptor(uri, "r")?.use { asset ->
        val seekable = runCatching { Os.lseek(asset.fileDescriptor, 0, OsConstants.SEEK_CUR) }.isSuccess
        if (!seekable) return result.apply { fallbackReason = "Nonseekable source" }
        val remainingMs = timeoutMs - ((System.nanoTime() - started) / 1_000_000)
        if (remainingMs <= 0 || cancelled.get()) return result.apply { this.cancelled = true }
        val data = analyzeDescriptor(
          asset.parcelFileDescriptor.fd, asset.startOffset, asset.declaredLength, bins,
          withLoudness, durationMs, cancelled, progress, remainingMs,
        )
        result.completed = data.completed
        result.cancelled = data.cancelled
        result.peaks = data.peaks
        result.lufs = data.lufs.takeIf { it.isFinite() }
        result.peak = data.peak.takeIf { it.isFinite() }
        result.decoderName = data.decoderName
        result.mime = data.mime
        result.fallbackReason = data.error
        result.durationMs = data.durationMs
        result.sampleRate = data.sampleRate
        result.channelCount = data.channelCount
        val openingMs = (System.nanoTime() - started) / 1_000_000.0 - data.decodeMs
        result.setupMs = openingMs + data.setupMs
        result.firstPcmMs = data.firstPcmMs.takeIf { it >= 0 }?.plus(openingMs)
        result.firstProgressMs = data.firstProgressMs.takeIf { it >= 0 }?.plus(openingMs)
        result.decodeToEosMs = data.decodeToEosMs
        result.finalizeMs = data.finalizeMs
      } ?: run { result.fallbackReason = "Cannot open source" }
    } catch (_: Exception) {
      result.fallbackReason = "Native source or decoder failure"
    } finally {
      result.decodeMs = (System.nanoTime() - started) / 1_000_000.0
      result.endToEndMs = result.decodeMs
      result.cleanupMs = 0.0
      result.realtimeFactor = result.durationMs?.takeIf { it > 0 }?.div(result.decodeMs!!.coerceAtLeast(0.001))
      if (cancelled.get()) { result.cancelled = true; result.completed = false }
    }
    return result
  }
}
