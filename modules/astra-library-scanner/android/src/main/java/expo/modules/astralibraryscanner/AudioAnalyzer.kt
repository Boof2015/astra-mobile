package expo.modules.astralibraryscanner

import android.content.Context
import android.net.Uri
import java.util.concurrent.atomic.AtomicBoolean

internal enum class AnalysisBackend { AUTO, NATIVE, PLATFORM }

/** Both routes are offline analysis only; playback never enters this class. */
internal object AudioAnalyzer {
  // FLAC/MP3/WAV/Ogg Opus passed release-mode correctness and throughput comparisons on
  // SM-S908U1; see docs/waveform-analysis.md. Other containers fall back below.
  internal const val NATIVE_ENABLED = true

  suspend fun analyze(
    context: Context, uri: Uri, bins: Int, withLoudness: Boolean,
    cancelFlag: AtomicBoolean, durationMs: Double = 0.0,
    backend: AnalysisBackend = AnalysisBackend.AUTO,
    timeoutMs: Long = 180_000L,
    onProgress: (FloatArray, Int) -> Unit = { _, _ -> },
  ): AudioAnalysis {
    val started = System.nanoTime()
    fun elapsedMs() = (System.nanoTime() - started) / 1_000_000.0
    if (cancelFlag.get()) return AudioAnalysis().apply { cancelled = true }
    if (backend == AnalysisBackend.PLATFORM || (backend == AnalysisBackend.AUTO && !NATIVE_ENABLED)) {
      return PlatformAudioAnalyzer(context, onProgress).analyze(uri.toString(), bins, withLoudness, cancelFlag, timeoutMs)
    }
    val native = try {
      NativeAudioAnalyzer.analyze(context, uri, bins, withLoudness, durationMs, cancelFlag,
        NativeAnalysisProgress { peaks, filled -> if (!cancelFlag.get()) onProgress(peaks, filled) }, timeoutMs)
    } catch (_: LinkageError) {
      AudioAnalysis().apply { fallbackReason = "Native library unavailable" }
    }
    if (native.completed || native.cancelled || backend == AnalysisBackend.NATIVE) return native
    val nativeMs = elapsedMs()
    if (cancelFlag.get() || nativeMs >= timeoutMs) return native.apply { cancelled = true }
    // Clear any partial native prefix before restarting the fallback at frame zero.
    onProgress(FloatArray(0), 0)
    return PlatformAudioAnalyzer(context, onProgress)
      .analyze(uri.toString(), bins, withLoudness, cancelFlag, (timeoutMs - nativeMs).toLong())
      .also { result ->
        result.fallbackReason = native.fallbackReason ?: "Native analysis incomplete"
        result.setupMs = result.setupMs?.plus(nativeMs)
        result.firstPcmMs = result.firstPcmMs?.plus(nativeMs)
        result.firstProgressMs = result.firstProgressMs?.plus(nativeMs)
        result.decodeMs = elapsedMs()
        result.endToEndMs = result.decodeMs
        result.realtimeFactor = result.durationMs?.takeIf { it > 0 }?.div(result.decodeMs!!.coerceAtLeast(0.001))
      }
  }
}
