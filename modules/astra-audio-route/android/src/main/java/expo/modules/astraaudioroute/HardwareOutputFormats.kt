package expo.modules.astraaudioroute

/** The probe's shape. Any change (a new track rate, another route) re-probes. */
internal data class ProbeRequest(val deviceId: Int?, val sampleRate: Int, val channels: Int, val aaudioFormat: Int)

internal data class ProbeResult(val request: ProbeRequest, val atMs: Long, val format: DiagnosticFormat?)

internal const val PROBE_REFRESH_MS = 5_000L

internal fun needsProbe(last: ProbeResult?, request: ProbeRequest, nowMs: Long): Boolean =
  last == null || last.request != request || nowMs - last.atMs >= PROBE_REFRESH_MS

/** Astra's sink encodings as AAudio formats; 0 leaves the format unspecified. */
internal fun aaudioFormatFor(encoding: String?): Int = when (encoding) {
  "pcm-16" -> 1
  "pcm-float" -> 2
  "pcm-24" -> 3
  "pcm-32" -> 4
  else -> 0
}

internal fun encodingForAaudioFormat(format: Int): String? = when (format) {
  1 -> "pcm-16"
  2 -> "pcm-float"
  3 -> "pcm-24"
  4 -> "pcm-32"
  else -> null
}

/** Shapes the probe like Astra's observed output; idle probes leave everything unspecified. */
internal fun probeRequest(deviceId: Int?, output: Map<*, *>?): ProbeRequest = ProbeRequest(
  deviceId,
  (output?.get("sampleRate") as? Int)?.takeIf { it > 0 } ?: 0,
  (output?.get("channels") as? Int)?.takeIf { it > 0 } ?: 0,
  aaudioFormatFor(output?.get("encoding") as? String),
)

/** [rate, channels, format, deviceId] from the native probe. */
internal fun hardwareFormat(values: IntArray?): DiagnosticFormat? {
  if (values == null || values.size < 3 || values[0] <= 0) return null
  return DiagnosticFormat(values[0], encodingForAaudioFormat(values[2]), values[1].takeIf { it > 0 })
}
