package expo.modules.astraaudioroute

import android.os.Build
import android.os.SystemClock
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The format of the hardware stream Android plays Astra's music through (Android 14+).
 *
 * `AudioTrack.getNativeOutputSampleRate` can name a different output than the one the
 * player is actually on; AOSP's own audio policy notes this discrepancy. Instead the
 * native side opens (never starts) an AAudio stream shaped like Astra's current output,
 * so the policy attaches it to the same output, and reads AAudio's hardware format.
 *
 * Probes run on their own thread and are cached; the diagnostics getter (JS thread,
 * polled once a second) only reads the cache and asks for a refresh.
 */
internal object HardwareOutputProbe {
  private val nativeLoaded by lazy { runCatching { System.loadLibrary("astraaudioroute") }.isSuccess }
  private val executor by lazy {
    Executors.newSingleThreadExecutor { Thread(it, "astra-output-probe").apply { isDaemon = true } }
  }
  private val inFlight = AtomicBoolean(false)

  @Volatile
  private var last: ProbeResult? = null

  /** The latest result for exactly this request; null until the first probe for it lands. */
  fun current(request: ProbeRequest): DiagnosticFormat? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return null
    val cached = last
    if (needsProbe(cached, request, SystemClock.elapsedRealtime()) && inFlight.compareAndSet(false, true)) {
      executor.execute {
        try {
          last = ProbeResult(request, SystemClock.elapsedRealtime(), probe(request))
        } finally {
          inFlight.set(false)
        }
      }
    }
    return cached?.takeIf { it.request == request }?.format
  }

  private fun probe(request: ProbeRequest): DiagnosticFormat? {
    if (!nativeLoaded) return null
    return runCatching {
      hardwareFormat(nativeProbe(request.sampleRate, request.channels, request.aaudioFormat))
    }.getOrNull()
  }

  @JvmStatic
  private external fun nativeProbe(sampleRate: Int, channels: Int, format: Int): IntArray?
}
