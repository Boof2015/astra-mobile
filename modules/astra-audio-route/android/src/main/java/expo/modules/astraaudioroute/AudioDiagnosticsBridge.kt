package expo.modules.astraaudioroute

/** Plain values only: this bridge never owns or controls a player or audio device. */
data class DiagnosticFormat(
  val sampleRate: Int? = null,
  val encoding: String? = null,
  val channels: Int? = null,
  val mimeType: String? = null,
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "sampleRate" to sampleRate, "encoding" to encoding,
    "channels" to channels, "mimeType" to mimeType,
  )
}

/** Also used for AudioDeviceInfo encodings; unknown values remain explicit. */
fun diagnosticEncoding(value: Int): String? = when (value) {
  0 -> null
  2 -> "pcm-16"
  3 -> "pcm-8"
  4 -> "pcm-float"
  21, 0x20000000 -> "pcm-24"
  22, 0x30000000 -> "pcm-32"
  else -> if (value < 0) null else "encoded:$value"
}

data class DiagnosticSource(
  val trackId: String?,
  val entryId: String?,
  val title: String?,
  val artist: String?,
  val format: String?,
  val sampleRate: Int?,
  val bitDepth: Int?,
  val channels: Int?,
  val codec: String? = null,
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "trackId" to trackId, "entryId" to entryId, "title" to title, "artist" to artist,
    "format" to format, "sampleRate" to sampleRate, "bitDepth" to bitDepth, "channels" to channels, "codec" to codec,
  )
}

/**
 * Updates arrive on the player's application looper, including sink observations posted
 * after the renderer's format events. Synchronization also makes JS getter reads atomic.
 * Object identity binds prefetch observations to the actual native queue item, including
 * duplicate songs. Old-player callbacks cannot overwrite a replacement player's state.
 */
class AudioDiagnosticsState {
  private data class Stream(val owner: Any?, val format: DiagnosticFormat, val decoder: String?)
  private data class Output(val owner: Any?, val input: DiagnosticFormat, val format: DiagnosticFormat?)
  private var generation = 0L
  private var attached = false
  private var sourceOwner: Any? = null
  private var source: DiagnosticSource? = null
  private var state = "stopped"
  private var reading: Stream? = null
  private var currentStream: Stream? = null
  private var decoder: String? = null
  private var pending: Output? = null
  private var active: Output? = null
  private var configured: Output? = null
  private var failed = false

  @Synchronized fun attach(): Long {
    generation += 1
    attached = true
    clear()
    return generation
  }

  @Synchronized fun detach(session: Long) {
    if (!valid(session)) return
    clear()
    attached = false
  }

  private fun valid(session: Long) = attached && session == generation
  private fun clear() {
    sourceOwner = null; source = null; state = "stopped"
    reading = null; currentStream = null; decoder = null
    pending = null; active = null; configured = null; failed = false
  }

  @Synchronized fun source(session: Long, owner: Any?, value: DiagnosticSource?, playbackState: String) {
    if (!valid(session)) return
    sourceOwner = owner
    source = value
    state = playbackState
    if (reading?.owner === owner) currentStream = reading
    if (owner == null || playbackState == "stopped" || playbackState == "error") {
      active = null
    }
  }

  @Synchronized fun input(session: Long, owner: Any?, format: DiagnosticFormat) {
    if (!valid(session)) return
    reading = Stream(owner, format, decoder)
    if (owner != null && owner === sourceOwner) currentStream = reading
  }

  @Synchronized fun decoder(session: Long, name: String?) {
    if (valid(session)) decoder = name
  }

  @Synchronized fun configure(session: Long, input: DiagnosticFormat, output: DiagnosticFormat?) {
    if (!valid(session)) return
    configured = Output(reading?.owner, input, output)
    pending = configured
    failed = false
  }

  @Synchronized fun streamBoundary(session: Long) {
    if (!valid(session)) return
    // A decoder can reuse exactly the same sink configuration across queue entries.
    pending = (pending ?: configured)?.copy(owner = reading?.owner)
    configured = pending
  }

  @Synchronized fun accepted(session: Long) {
    if (!valid(session)) return
    active = pending
    pending = null
    failed = false
  }

  @Synchronized fun flush(session: Long, reset: Boolean = false) {
    if (!valid(session)) return
    active = null
    if (reset) configured = null
    pending = configured
  }

  @Synchronized fun failure(session: Long) {
    if (!valid(session)) return
    active = null
    pending = configured
    failed = true
  }

  @Synchronized fun snapshot(): Map<String, Any?> {
    val canShowOutput = sourceOwner != null && state in setOf("playing", "paused", "loading")
    val output = active?.takeIf { canShowOutput && it.owner === sourceOwner }
    val stream = currentStream?.takeIf { it.owner === sourceOwner && sourceOwner != null }
    return mapOf(
      "generation" to generation, "state" to state, "source" to source?.toMap(),
      "stream" to stream?.format?.toMap(), "decoder" to stream?.decoder,
      "sinkInput" to output?.input?.toMap(), "output" to output?.format?.toMap(),
      "outputStatus" to when {
        !attached || !canShowOutput -> "inactive"
        failed -> "unavailable"
        output?.format != null -> "observed"
        pending != null -> "pending"
        else -> "unavailable"
      },
      "deviceOutput" to null,
    )
  }
}

object AudioDiagnosticsBridge {
  @JvmField val state = AudioDiagnosticsState()
}
