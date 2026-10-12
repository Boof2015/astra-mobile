package expo.modules.astralibraryscanner

import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.AudioFormat
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.os.SystemClock
import android.provider.DocumentsContract
import android.util.Log
import com.google.android.exoplayer2.MediaItem
import com.google.android.exoplayer2.MetadataRetriever
import com.google.android.exoplayer2.metadata.id3.BinaryFrame
import com.google.android.exoplayer2.metadata.id3.InternalFrame
import com.google.android.exoplayer2.metadata.id3.TextInformationFrame
import com.google.android.exoplayer2.metadata.flac.VorbisComment
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.astralibraryscanner.data.AstraLibraryRepository
import expo.modules.astralibraryscanner.data.ArtistCreditMetadataReader
import expo.modules.astralibraryscanner.data.ContainerTags
import expo.modules.astralibraryscanner.data.CURRENT_METADATA_READER_VERSION
import expo.modules.astralibraryscanner.data.MediaTagCleanup
import expo.modules.astralibraryscanner.data.LocalAudioFile
import expo.modules.astralibraryscanner.data.LocalAudioMetadata
import expo.modules.astralibraryscanner.data.ScanCancelledException
import expo.modules.astralibraryscanner.data.formatArtistNames
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.roundToInt
import kotlin.math.max

private const val LIBRARY_SCAN_LOG_TAG = "AstraLibraryScan"

private fun nanosToDoubleMs(nanos: Long): Double = nanos / 1_000_000.0

private data class MetadataStageTiming(
  val androidMetadataNanos: Long,
  val multiArtistNanos: Long,
  val technicalFormatNanos: Long,
  val artworkNanos: Long,
  val totalNanos: Long,
)

private data class MetadataTimingSnapshot(
  val count: Int,
  val androidMetadataNanos: Long,
  val multiArtistNanos: Long,
  val technicalFormatNanos: Long,
  val artworkNanos: Long,
  val totalNanos: Long,
  val maximumTotalNanos: Long,
)

private class MetadataTimingAccumulator {
  private var count = 0
  private var androidMetadataNanos = 0L
  private var multiArtistNanos = 0L
  private var technicalFormatNanos = 0L
  private var artworkNanos = 0L
  private var totalNanos = 0L
  private var maximumTotalNanos = 0L

  @Synchronized
  fun record(timing: MetadataStageTiming) {
    count += 1
    androidMetadataNanos += timing.androidMetadataNanos
    multiArtistNanos += timing.multiArtistNanos
    technicalFormatNanos += timing.technicalFormatNanos
    artworkNanos += timing.artworkNanos
    totalNanos += timing.totalNanos
    maximumTotalNanos = maxOf(maximumTotalNanos, timing.totalNanos)
  }

  @Synchronized
  private fun snapshot(): MetadataTimingSnapshot = MetadataTimingSnapshot(
    count = count,
    androidMetadataNanos = androidMetadataNanos,
    multiArtistNanos = multiArtistNanos,
    technicalFormatNanos = technicalFormatNanos,
    artworkNanos = artworkNanos,
    totalNanos = totalNanos,
    maximumTotalNanos = maximumTotalNanos,
  )

  fun logIfDebuggable(context: Context, folderId: Long) {
    val debuggable =
      context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0
    if (!debuggable) return
    val timing = snapshot()
    Log.d(
      LIBRARY_SCAN_LOG_TAG,
      "folderId=$folderId metadataFiles=${timing.count}" +
        " androidMetadataTotalMs=${nanosToMs(timing.androidMetadataNanos)}" +
        " androidMetadataAvgMs=${averageMs(timing.androidMetadataNanos, timing.count)}" +
        " containerMetadataTotalMs=${nanosToMs(timing.multiArtistNanos)}" +
        " containerMetadataAvgMs=${averageMs(timing.multiArtistNanos, timing.count)}" +
        " technicalFormatTotalMs=${nanosToMs(timing.technicalFormatNanos)}" +
        " technicalFormatAvgMs=${averageMs(timing.technicalFormatNanos, timing.count)}" +
        " artworkTotalMs=${nanosToMs(timing.artworkNanos)}" +
        " artworkAvgMs=${averageMs(timing.artworkNanos, timing.count)}" +
        " trackExtractionTotalMs=${nanosToMs(timing.totalNanos)}" +
        " trackExtractionAvgMs=${averageMs(timing.totalNanos, timing.count)}" +
        " trackExtractionMaxMs=${nanosToMs(timing.maximumTotalNanos)}",
    )
  }

  private fun averageMs(totalNanos: Long, count: Int): Double =
    if (count == 0) 0.0 else nanosToMs(totalNanos / count)

  private fun nanosToMs(nanos: Long): Double =
    (nanos / 10_000.0).roundToInt() / 100.0
}

class FileRequest : Record {
  @Field val uri: String = ""
  @Field val coverUri: String? = null
}

/**
 * Waveform, optional loudness/sample peak, and timing from a shared analysis pass.
 * Both native and platform routes use this bridge record.
 */
class AudioAnalysis : Record {
  @Field var completed: Boolean = false
  @Field var decoderRoute: String = "platform"
  @Field var fallbackReason: String? = null
  @Field var peaks: FloatArray = FloatArray(0)
  @Field var lufs: Double? = null // integrated LUFS (negative dB); null if unmeasured
  @Field var peak: Double? = null // absolute sample peak, linear [0,1]; null if unmeasured
  /** True when the decode was cancelled mid-flight; peaks/lufs are then meaningless. */
  @Field var cancelled: Boolean = false
  /** Active analysis time in ms, including setup, fallback, and teardown. */
  @Field var decodeMs: Double? = null
  /** Track duration in ms, from decoder metadata or the library hint. */
  @Field var durationMs: Double? = null
  /** durationMs / decodeMs — "how many times faster than realtime". Higher is better. */
  @Field var realtimeFactor: Double? = null
  /** Decoder implementation (e.g. "dr_flac" or "c2.android.flac.decoder"). */
  @Field var decoderName: String? = null
  /** Audio track mime (e.g. "audio/flac"). */
  @Field var mime: String? = null
  /** Whether the loudness meter rode along on this pass. */
  @Field var withLoudness: Boolean = false
  /** Time spent waiting for one of the two shared native analysis lanes. */
  @Field var queueWaitMs: Double = 0.0
  /** Source opening and decoder initialization. */
  @Field var setupMs: Double? = null
  /** Active-pass time until the first non-empty PCM output buffer. */
  @Field var firstPcmMs: Double? = null
  /** Active-pass time when the first progressive waveform could be emitted. */
  @Field var firstProgressMs: Double? = null
  /** Decoding through end-of-stream, including waveform/loudness accumulation. */
  @Field var decodeToEosMs: Double? = null
  /** Final RMS normalization and/or LUFS gate resolution. */
  @Field var finalizeMs: Double? = null
  /** Decoder/source teardown after the result was finalized, when measured separately. */
  @Field var cleanupMs: Double? = null
  /** Whole native request including semaphore wait and teardown. */
  @Field var endToEndMs: Double? = null
  @Field var sampleRate: Int? = null
  @Field var channelCount: Int? = null
}

/** ReplayGain tags read from the container (no audio decode). Null = tag absent. */
class ReplayGainTags : Record {
  @Field var trackGainDb: Double? = null // REPLAYGAIN_TRACK_GAIN (dB)
  @Field var albumGainDb: Double? = null // REPLAYGAIN_ALBUM_GAIN (dB)
  @Field var trackPeak: Double? = null // REPLAYGAIN_TRACK_PEAK (linear, ~[0,1+])
  @Field var albumPeak: Double? = null // REPLAYGAIN_ALBUM_PEAK (linear, ~[0,1+])
}

class AstraLibraryScannerModule : Module() {
  private val artworkThumbSize = 128

  // Cover-art hashes memoized per cover URI for the duration of one scan
  // (cleared on each listAudioFiles call) so an album folder's cover.jpg is
  // read and hashed once, not once per track.
  private val coverHashMemo = ConcurrentHashMap<String, String>()

  // Analysis decode is whole-file and CPU-heavy; throttle concurrent decodes. Also keeps
  // us from monopolising decoder instances while a track is actually playing.
  private val waveformSemaphore = Semaphore(2)

  // Parsing large embedded covers must not multiply the scan's 24 I/O lanes
  // into 24 simultaneous native picture allocations.
  private val metadataSemaphore = java.util.concurrent.Semaphore(4, true)

  // Cancellation flags for in-flight analyses, keyed by attempt ID. Set by cancelAnalysis
  // so a skipped-past track stops burning CPU instead of running to completion holding a
  // semaphore permit. Registered before the permit is acquired, so a queued-but-unstarted
  // decode can be cancelled too.
  private val activeAnalyses = AnalysisCancellationRegistry()

  // Scans are serialized by the repository, but register before acquiring that lock so
  // cancelScan also stops a queued scan. A set keeps the native boundary robust if a
  // caller ever bypasses the JS single-scan guard.
  private val activeScans = ConcurrentHashMap.newKeySet<AtomicBoolean>()

  override fun definition() = ModuleDefinition {
    Name("AstraLibraryScanner")

    Events("onScanProgress", "onWaveformProgress")

    AsyncFunction("listAudioFiles") Coroutine { treeUri: String, extensions: List<String> ->
      withContext(Dispatchers.IO) { listAudioFiles(treeUri, extensions) }
    }

    AsyncFunction("discoverTvMusic") Coroutine { extensions: List<String> ->
      withContext(Dispatchers.IO) { TvMusicStorage.discover(requireContext(), extensions.map { it.lowercase() }.toSet()) }
    }

    AsyncFunction("extractMetadata") Coroutine { files: List<FileRequest> ->
      val semaphore = Semaphore(4)
      coroutineScope {
        files.map { request ->
          async(Dispatchers.IO) { semaphore.withPermit { extractOne(request) } }
        }.awaitAll()
      }
    }

    AsyncFunction("scanFolderNative") Coroutine {
        folderId: Double,
        mode: String,
        extensions: List<String>,
      ->
      val context = requireContext().applicationContext
      val cancelFlag = AtomicBoolean(false)
      val metadataTimings = MetadataTimingAccumulator()
      activeScans.add(cancelFlag)
      try {
        withContext(Dispatchers.IO) {
          val repository = AstraLibraryRepository.get(context)
          repository.withUserRecovery { scanLocalFolder(
            folderId = folderId.toLong(),
            full = mode == "full",
            discover = { treeUri ->
              val listing = listAudioFiles(treeUri, extensions, cancelFlag)
              @Suppress("UNCHECKED_CAST")
              val files = listing["files"] as? List<Map<String, Any?>> ?: emptyList()
              @Suppress("UNCHECKED_CAST")
              val covers = listing["covers"] as? Map<String, String> ?: emptyMap()
              files.mapNotNull { file ->
                val uri = file["uri"] as? String ?: return@mapNotNull null
                val parentUri = file["parentUri"] as? String ?: ""
                LocalAudioFile(
                  uri = uri,
                  name = file["name"] as? String ?: uri.substringAfterLast('/'),
                  size = (file["size"] as? Number)?.toLong(),
                  lastModified = (file["lastModified"] as? Number)?.toLong() ?: 0L,
                  mimeType = file["mimeType"] as? String,
                  parentUri = parentUri,
                  coverUri = covers[parentUri],
                )
              }
            },
            extract = { file ->
              extractOne(file.uri, file.coverUri, metadataTimings::record, file.name, cancelFlag).toLocalAudioMetadata()
            },
            onProgress = { phase, processed, total, folderName ->
              sendEvent(
                "onScanProgress",
                mapOf(
                  "phase" to phase,
                  "processed" to processed,
                  "total" to total,
                  "folderName" to folderName,
                ),
              )
            },
            isCancelled = cancelFlag::get,
          ).toMap() }
        }
      } finally {
        runCatching { metadataTimings.logIfDebuggable(context, folderId.toLong()) }
        activeScans.remove(cancelFlag)
      }
    }

    // Request cooperative cancellation for every active or queued library scan.
    // Each scan unwinds at a safe checkpoint and discards its staging generation.
    Function("cancelScan") {
      activeScans.forEach { it.set(true) }
    }

    // Shared waveform/loudness pass with attempt-scoped cancellation and progress.
    // JS owns priority and caching; the semaphore enforces the native concurrency cap.
    AsyncFunction("analyzeTrack") Coroutine { uri: String, bins: Int, withLoudness: Boolean, attemptId: String, durationMs: Double ->
      val flag = activeAnalyses.register(attemptId)
      val requestedNanos = System.nanoTime()
      try {
        waveformSemaphore.withPermit {
          val queueWaitMs = nanosToDoubleMs(System.nanoTime() - requestedNanos)
          // Cancelled while queued behind another decode — don't start at all.
          if (flag.get()) AudioAnalysis().apply {
            cancelled = true
            this.queueWaitMs = queueWaitMs
            endToEndMs = nanosToDoubleMs(System.nanoTime() - requestedNanos)
          }
          else withContext(Dispatchers.IO) {
            AudioAnalyzer.analyze(
              context = requireContext(), uri = Uri.parse(uri), bins = bins.coerceIn(1, 16384),
              withLoudness = withLoudness, cancelFlag = flag, durationMs = durationMs,
              onProgress = { peaks, filled ->
                if (!flag.get()) runCatching {
                  sendEvent("onWaveformProgress", mapOf(
                    "uri" to uri, "attemptId" to attemptId, "filledBins" to filled,
                    "totalBins" to bins, "peaks" to peaks,
                  ))
                }
              },
            ).also { analysis ->
              analysis.queueWaitMs = queueWaitMs
              analysis.endToEndMs = nanosToDoubleMs(System.nanoTime() - requestedNanos)
            }
          }
        }
      } finally {
        activeAnalyses.finish(attemptId, flag)
      }
    }

    // Stop one attempt, including cancellation arriving before coroutine registration.
    AsyncFunction("cancelAnalysis") Coroutine { attemptId: String ->
      activeAnalyses.cancel(attemptId)
    }

    // ReplayGain tags (M4): reads container metadata only (no PCM decode), so it is
    // cheap and lets us normalize a tagged library without the slow loudness decode.
    AsyncFunction("readReplayGain") Coroutine { uri: String ->
      withContext(Dispatchers.IO) { readReplayGain(uri) }
    }

    // Sidecar lyrics: a `<name>.xlrc` (preferred) or `<name>.lrc` next to the track.
    // Returns { text, format } or null. Read fresh on demand so files authored after
    // a scan are picked up.
    AsyncFunction("readSidecarLyrics") Coroutine { uri: String ->
      withContext(Dispatchers.IO) { readSidecarLyrics(uri) }
    }

    // Embedded lyrics from container tags (Vorbis comments, ID3 USLT/SYLT/TXXX,
    // and MP4 lyric atoms), metadata-only (no PCM decode). Distinguishing a true
    // miss from an I/O failure lets JS invalidate only genuinely stale cache rows.
    AsyncFunction("readEmbeddedLyrics") Coroutine { uri: String ->
      withContext(Dispatchers.IO) { readEmbeddedLyrics(uri) }
    }

    Function("getArtworkDirPath") {
      artworkDir().absolutePath
    }

    Function("getArtworkThumbDirPath") {
      artworkThumbDir().absolutePath
    }

    AsyncFunction("ensureArtworkThumbnails") Coroutine { hashes: List<String> ->
      withContext(Dispatchers.IO) { ensureArtworkThumbnails(hashes) }
    }

    AsyncFunction("cacheArtworkFromUri") Coroutine { uri: String ->
      withContext(Dispatchers.IO) { cacheArtworkFromUri(uri) }
    }

    Function("getPersistedTreeUris") {
      requireContext().contentResolver.persistedUriPermissions
        .filter { it.isReadPermission }
        .map { it.uri.toString() }
    }

    AsyncFunction("takePersistableUriPermission") { uri: String ->
      try {
        requireContext().contentResolver.takePersistableUriPermission(
          Uri.parse(uri),
          Intent.FLAG_GRANT_READ_URI_PERMISSION
        )
        true
      } catch (t: Throwable) {
        false
      }
    }

    AsyncFunction("releasePersistedUriPermission") { uri: String ->
      try {
        requireContext().contentResolver.releasePersistableUriPermission(
          Uri.parse(uri),
          Intent.FLAG_GRANT_READ_URI_PERMISSION
        )
      } catch (_: Throwable) {
        // Already released or never persisted — nothing to do.
      }
    }

    // Foreground-service keepalive around a scan (see ScanForegroundService) so a big
    // scan survives backgrounding / screen-off. Fire-and-forget; JS owns the lifecycle.
    Function("startScanService") { title: String, text: String ->
      ScanForegroundService.start(requireContext(), title, text)
    }

    Function("updateScanNotification") { title: String, text: String, subText: String?, current: Int, total: Int, indeterminate: Boolean ->
      ScanForegroundService.update(title, text, subText, current, total, indeterminate)
    }

    Function("stopScanService") {
      ScanForegroundService.stop(requireContext())
    }

    /**
     * A wait that still elapses while Astra is backgrounded.
     *
     * React Native drives `setTimeout` from a Choreographer frame callback that
     * `JavaTimerManager.onHostPause()` removes, so JS timers simply stop firing
     * once the activity is paused — a foreground service keeps the process alive
     * but does not bring them back. Work that must pace itself across a
     * backgrounded stretch has to wait on native instead, because a promise
     * resolved from here reaches the JS thread without the frame callback.
     */
    AsyncFunction("backgroundDelay") Coroutine { milliseconds: Int ->
      delay(milliseconds.toLong().coerceIn(0L, 60_000L))
    }
  }

  private fun requireContext(): Context =
    appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private fun artworkDir(): File =
    File(requireContext().filesDir, "artwork").apply { if (!exists()) mkdirs() }

  private fun artworkThumbDir(): File =
    File(requireContext().filesDir, "artwork-thumbs").apply { if (!exists()) mkdirs() }

  // ---------------------------------------------------------------------------
  // ReplayGain tags (container metadata only — no audio decode)
  // ---------------------------------------------------------------------------

  // Cap MetadataRetriever per file so a malformed/huge container can't hang a worker.
  private val metadataTimeoutMs = 12_000L

  /**
   * Read ReplayGain track/album gain (dB) + peak (linear) from container tags via
   * ExoPlayer's MetadataRetriever (parses ID3 TXXX, Vorbis comments, MP4 freeform
   * atoms without decoding PCM). Mirrors the desktop's extractReplayGainDb fuzzy
   * matching. Returns all-null on any failure (unsupported container, IO, timeout).
   */
  private fun readReplayGain(uriStr: String): ReplayGainTags {
    val result = ReplayGainTags()
    try {
      val mediaItem = MediaItem.fromUri(Uri.parse(uriStr))
      val trackGroups = MetadataRetriever.retrieveMetadata(requireContext(), mediaItem)
        .get(metadataTimeoutMs, TimeUnit.MILLISECONDS)

      // R128 (Opus / EBU) is a fallback used only when no REPLAYGAIN_* tag is present.
      var r128Track: Double? = null
      var r128Album: Double? = null

      fun consider(rawKey: String?, rawValue: String?) {
        if (rawKey == null || rawValue == null) return
        val key = normalizeRgKey(rawKey)
        when {
          result.trackGainDb == null && (key.contains("replaygain_track_gain") || key.contains("rg_track_gain")) ->
            result.trackGainDb = parseRgDb(rawValue)
          result.albumGainDb == null && (key.contains("replaygain_album_gain") || key.contains("rg_album_gain")) ->
            result.albumGainDb = parseRgDb(rawValue)
          result.trackPeak == null && (key.contains("replaygain_track_peak") || key.contains("rg_track_peak")) ->
            result.trackPeak = parsePeak(rawValue)
          result.albumPeak == null && (key.contains("replaygain_album_peak") || key.contains("rg_album_peak")) ->
            result.albumPeak = parsePeak(rawValue)
          r128Track == null && key.contains("r128_track_gain") -> r128Track = parseR128(rawValue)
          r128Album == null && key.contains("r128_album_gain") -> r128Album = parseR128(rawValue)
        }
      }

      for (g in 0 until trackGroups.length) {
        val group = trackGroups.get(g)
        for (f in 0 until group.length) {
          val metadata = group.getFormat(f).metadata ?: continue
          for (i in 0 until metadata.length()) {
            when (val entry = metadata.get(i)) {
              // ID3 user-defined text frame: description is the key, value the text.
              is TextInformationFrame -> if (entry.id == "TXXX") consider(entry.description, entry.value)
              // FLAC/Ogg/Opus Vorbis comments (vorbis.VorbisComment extends this).
              is VorbisComment -> consider(entry.key, entry.value)
              // MP4 iTunes freeform "----:com.apple.iTunes:replaygain_*" atoms.
              is InternalFrame -> consider(entry.description, entry.text)
            }
          }
        }
      }

      if (result.trackGainDb == null) result.trackGainDb = r128Track
      if (result.albumGainDb == null) result.albumGainDb = r128Album
    } catch (_: Throwable) {
      // Unsupported container, IO error, or timeout -> no tags.
    }
    return result
  }

  private fun normalizeRgKey(id: String): String =
    id.trim().lowercase().replace(Regex("[\\s-]+"), "_")

  /** Parse a ReplayGain dB value like "-6.54 dB", "-6,54", or "+3.2". */
  private fun parseRgDb(raw: String): Double? {
    val trimmed = raw.trim()
    if (trimmed.isEmpty()) return null
    trimmed.toDoubleOrNull()?.let { return it }
    trimmed.replace(Regex("(?i)\\s*dB\\s*$"), "").trim().toDoubleOrNull()?.let { return it }
    val m = Regex("[+-]?\\d+(?:[.,]\\d+)?").find(trimmed) ?: return null
    return m.value.replace(',', '.').toDoubleOrNull()
  }

  /** Parse a ReplayGain peak (linear amplitude, > 0). */
  private fun parsePeak(raw: String): Double? {
    val trimmed = raw.trim()
    trimmed.toDoubleOrNull()?.let { return if (it > 0.0) it else null }
    val m = Regex("[+-]?\\d+(?:[.,]\\d+)?").find(trimmed) ?: return null
    val v = m.value.replace(',', '.').toDoubleOrNull() ?: return null
    return if (v > 0.0) v else null
  }

  /** R128_*_GAIN is Q7.8 dB relative to -23 LUFS; +5 dB realigns to the RG reference. */
  private fun parseR128(raw: String): Double? {
    val v = raw.trim().toIntOrNull() ?: return null
    return v / 256.0 + 5.0
  }

  // ---------------------------------------------------------------------------
  // Lyrics (v2 local sources)
  // ---------------------------------------------------------------------------

  /**
   * Look for a sibling lyrics file next to the track: `<name>.xlrc` first, then
   * `<name>.lrc`. Builds the sibling document URI by swapping the audio file's
   * extension (the same tree grant covers it), so no directory listing is needed for
   * the common case. Returns { text, format } or null.
   */
  private fun readSidecarLyrics(uriStr: String): Map<String, Any?>? {
    return try {
      val uri = Uri.parse(uriStr)
      val docId = DocumentsContract.getDocumentId(uri) ?: return null
      val stem = docId.substringBeforeLast('.', "")
      if (stem.isEmpty()) return null
      for ((ext, format) in listOf("xlrc" to "xlrc", "lrc" to "lrc")) {
        val siblingUri = DocumentsContract.buildDocumentUriUsingTree(uri, "$stem.$ext")
        val text = readTextOrNull(siblingUri) ?: continue
        if (text.isBlank()) continue
        return mapOf("text" to text, "format" to format)
      }
      null
    } catch (_: Throwable) {
      null
    }
  }

  private fun readTextOrNull(uri: Uri): String? {
    return try {
      requireContext().contentResolver.openInputStream(uri)?.use { input ->
        input.bufferedReader(Charsets.UTF_8).readText()
      }
    } catch (_: Throwable) {
      null
    }
  }

  private val embeddedLyricKeys = setOf("lyrics", "unsyncedlyrics", "unsynced_lyrics", "syncedlyrics")

  /**
   * Read embedded lyrics from container metadata via ExoPlayer's MetadataRetriever.
   * ExoPlayer decodes Vorbis/TXXX/MP4 text entries directly and exposes ID3 lyric
   * frames as BinaryFrame payloads, which Id3LyricsParser handles without reading
   * or decoding PCM.
   */
  private fun readEmbeddedLyrics(uriStr: String): Map<String, Any?> {
    return try {
      val mediaItem = MediaItem.fromUri(Uri.parse(uriStr))
      val trackGroups = MetadataRetriever.retrieveMetadata(requireContext(), mediaItem)
        .get(metadataTimeoutMs, TimeUnit.MILLISECONDS)

      val collector = EmbeddedLyricsCollector()
      fun consider(rawKey: String?, rawValue: String?) {
        if (rawKey == null || rawValue == null) return
        val key = rawKey.trim().lowercase()
        val isLyricKey = key in embeddedLyricKeys || key.contains("lyric") || key == "©lyr"
        if (!isLyricKey) return
        collector.considerPlain(rawValue)
      }

      for (g in 0 until trackGroups.length) {
        val group = trackGroups.get(g)
        for (f in 0 until group.length) {
          val metadata = group.getFormat(f).metadata ?: continue
          for (i in 0 until metadata.length()) {
            when (val entry = metadata.get(i)) {
              is TextInformationFrame -> when (entry.id) {
                "TXXX" -> consider(entry.description, entry.value)
                // ExoPlayer maps the standard MP4/M4A ©lyr atom to USLT text.
                "USLT", "ULT" -> collector.considerPlain(entry.value)
                else -> Unit
              }
              is VorbisComment -> consider(entry.key, entry.value)
              is InternalFrame -> consider(entry.description, entry.text)
              is BinaryFrame -> collector.consider(Id3LyricsParser.parse(entry.id, entry.data))
            }
          }
        }
      }

      val lyrics = collector.valueOrNull()
        ?: return mapOf("status" to "missing")
      mapOf(
        "status" to "hit",
        "text" to lyrics.text,
        "syncText" to lyrics.syncText.map { entry ->
          mapOf("timestampMs" to entry.timestampMs, "text" to entry.text)
        },
      )
    } catch (_: Throwable) {
      mapOf("status" to "unavailable")
    }
  }

  // ---------------------------------------------------------------------------
  // Directory walk
  // ---------------------------------------------------------------------------

  private val coverBaseNames = listOf("cover", "folder", "front", "albumart")
  private val coverExtensions = setOf("jpg", "jpeg", "png", "webp")

  private fun listAudioFiles(
    treeUri: String,
    extensions: List<String>,
    cancelFlag: AtomicBoolean? = null,
  ): Map<String, Any> {
    coverHashMemo.clear()

    TvMusicStorage.scope(treeUri)?.let { scope ->
      return mapOf("files" to TvMusicStorage.files(requireContext(), scope, extensions.map { it.lowercase() }.toSet(), cancelFlag), "covers" to emptyMap<String, String>())
    }

    val resolver = requireContext().contentResolver
    val tree = Uri.parse(treeUri)
    val extensionSet = extensions.map { it.lowercase() }.toSet()

    val projection = arrayOf(
      DocumentsContract.Document.COLUMN_DOCUMENT_ID,
      DocumentsContract.Document.COLUMN_DISPLAY_NAME,
      DocumentsContract.Document.COLUMN_MIME_TYPE,
      DocumentsContract.Document.COLUMN_SIZE,
      DocumentsContract.Document.COLUMN_LAST_MODIFIED
    )

    val files = mutableListOf<Map<String, Any?>>()
    // parent document uri -> (cover rank, cover document uri); lower rank wins
    val covers = mutableMapOf<String, Pair<Int, String>>()

    val queue = ArrayDeque<String>()
    queue.add(DocumentsContract.getTreeDocumentId(tree))

    while (queue.isNotEmpty()) {
      if (cancelFlag?.get() == true) throw ScanCancelledException()
      val dirDocId = queue.removeFirst()
      val parentUri = DocumentsContract.buildDocumentUriUsingTree(tree, dirDocId).toString()
      val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(tree, dirDocId)

      val cursor = resolver.query(childrenUri, projection, null, null, null)
        ?: continue // directory disappeared mid-walk; skip it
      cursor.use {
        while (it.moveToNext()) {
          if (cancelFlag?.get() == true) throw ScanCancelledException()
          val docId = it.getString(0) ?: continue
          val name = it.getString(1) ?: continue
          val mime = it.getString(2) ?: ""

          if (mime == DocumentsContract.Document.MIME_TYPE_DIR) {
            queue.add(docId)
            continue
          }

          val extension = name.substringAfterLast('.', "").lowercase()
          if (extension in extensionSet) {
            files.add(
              mapOf(
                "uri" to DocumentsContract.buildDocumentUriUsingTree(tree, docId).toString(),
                "name" to name,
                "size" to if (it.isNull(3)) null else it.getLong(3),
                "lastModified" to if (it.isNull(4)) 0L else it.getLong(4),
                "mimeType" to mime.ifEmpty { null },
                "parentUri" to parentUri
              )
            )
            if (files.size % 100 == 0) {
              sendEvent("onScanProgress", mapOf("phase" to "discovering", "found" to files.size))
            }
          } else if (extension in coverExtensions) {
            val rank = coverBaseNames.indexOf(name.substringBeforeLast('.').lowercase())
            if (rank >= 0) {
              val existing = covers[parentUri]
              if (existing == null || rank < existing.first) {
                covers[parentUri] =
                  rank to DocumentsContract.buildDocumentUriUsingTree(tree, docId).toString()
              }
            }
          }
        }
      }
    }

    sendEvent("onScanProgress", mapOf("phase" to "discovering", "found" to files.size))

    return mapOf(
      "files" to files,
      "covers" to covers.mapValues { (_, ranked) -> ranked.second }
    )
  }

  // ---------------------------------------------------------------------------
  // Metadata extraction
  // ---------------------------------------------------------------------------

  private fun extractOne(request: FileRequest): Map<String, Any?> {
    return extractOne(request.uri, request.coverUri)
  }

  private fun extractOne(
    uriString: String,
    coverUri: String?,
    timingRecorder: ((MetadataStageTiming) -> Unit)? = null,
    fileName: String? = null,
    cancelled: AtomicBoolean = AtomicBoolean(false),
  ): Map<String, Any?> {
    while (!metadataSemaphore.tryAcquire(100, TimeUnit.MILLISECONDS)) {
      if (cancelled.get()) throw ScanCancelledException()
    }
    val totalStartedNanos = SystemClock.elapsedRealtimeNanos()
    var androidMetadataNanos = 0L
    var multiArtistNanos = 0L
    var technicalFormatNanos = 0L
    var artworkNanos = 0L
    val result = mutableMapOf<String, Any?>("uri" to uriString, "ok" to true)

    try {
      val context = requireContext()
      val uri = Uri.parse(uriString)
      val nativeStarted = SystemClock.elapsedRealtimeNanos()
      var nativeError: Throwable? = null
      val native = try {
        NativeTagReader.read(context, uri, fileName, cancelled, metadataTimeoutMs.toInt())
      } catch (error: Exception) {
        nativeError = error
        null
      }
      multiArtistNanos = SystemClock.elapsedRealtimeNanos() - nativeStarted
      if (cancelled.get()) throw ScanCancelledException()
      if (native != null) {
        result.putAll(ContainerTags(native.properties).toMetadata())
        result["durationMs"] = native.durationMs.takeIf { it > 0 }?.toLong()
        result["bitrate"] = native.bitrate.takeIf { it > 0 }
        result["sampleRate"] = native.sampleRate.takeIf { it > 0 }
        result["channels"] = native.channels.takeIf { it > 0 }
        result["bitsPerSample"] = native.bitsPerSample.takeIf { it > 0 }
        result.mergeAudioCodecMetadata(native.codecMime, native.isAtmosJoc)
        result["mimeType"] = native.codecMime
      }
      var embeddedPicture = native?.picture()
      var androidRead = false
      var androidMetadataError: Throwable? = null
      fun fill(key: String, value: Any?) {
        if (result[key] == null && value != null) result[key] = value
      }
      // Android supplements missing values; its failure cannot veto container tags.
      if (native == null || embeddedPicture == null || listOf(
          "title", "artist", "album", "albumArtist", "genre", "year",
          "trackNumber", "discNumber", "durationMs", "bitrate",
        ).any { result[it] == null }) {
        val started = SystemClock.elapsedRealtimeNanos()
        val retriever = MediaMetadataRetriever()
        try {
          retriever.setDataSource(context, uri)
          androidRead = true
          fun tag(key: Int): String? = MediaTagCleanup.clean(retriever.extractMetadata(key))
          fill("title", tag(MediaMetadataRetriever.METADATA_KEY_TITLE))
          fill("artist", tag(MediaMetadataRetriever.METADATA_KEY_ARTIST))
          fill("album", tag(MediaMetadataRetriever.METADATA_KEY_ALBUM))
          fill("albumArtist", tag(MediaMetadataRetriever.METADATA_KEY_ALBUMARTIST))
          fill("genre", tag(MediaMetadataRetriever.METADATA_KEY_GENRE))
          fill("mimeType", tag(MediaMetadataRetriever.METADATA_KEY_MIMETYPE))
          fill("durationMs", tag(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull())
          fill("bitrate", tag(MediaMetadataRetriever.METADATA_KEY_BITRATE)?.toIntOrNull())
          val track = tag(MediaMetadataRetriever.METADATA_KEY_CD_TRACK_NUMBER)
          val disc = tag(MediaMetadataRetriever.METADATA_KEY_DISC_NUMBER)
          fill("trackNumber", parseTagNumber(track))
          fill("trackTotal", parseTagNumber(track?.substringAfter('/', "")))
          fill("discNumber", parseTagNumber(disc))
          fill("discTotal", parseTagNumber(disc?.substringAfter('/', "")))
          fill("year", parseYear(tag(MediaMetadataRetriever.METADATA_KEY_YEAR), tag(MediaMetadataRetriever.METADATA_KEY_DATE)))
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            fill("sampleRate", tag(MediaMetadataRetriever.METADATA_KEY_SAMPLERATE)?.toIntOrNull())
          }
          if (embeddedPicture == null) embeddedPicture = retriever.embeddedPicture
        } catch (error: Exception) {
          androidMetadataError = error
        } finally {
          runCatching { retriever.release() }
          androidMetadataNanos = SystemClock.elapsedRealtimeNanos() - started
        }
      }
      if (native == null && !cancelled.get()) {
        val credits = ArtistCreditMetadataReader.read(context, uri, metadataTimeoutMs)
        result["artistNames"] = credits.artists.takeIf { it.size > 1 }.orEmpty()
        result["albumArtistNames"] = credits.albumArtists.takeIf { it.size > 1 }.orEmpty()
        fill("artist", credits.artists.takeIf { it.isNotEmpty() }?.let(::formatArtistNames))
        fill("albumArtist", credits.albumArtists.takeIf { it.isNotEmpty() }?.let(::formatArtistNames))
      }
      var technicalRead = false
      // Header-level facts MMR can't provide (channels, bit depth) or only on
      // API 31+ (sample rate). Failure here is non-fatal — keep the tag data.
      val technicalFormatStartedNanos = SystemClock.elapsedRealtimeNanos()
      val extractor = MediaExtractor()
      try {
        extractor.setDataSource(context, uri, null)
        for (i in 0 until extractor.trackCount) {
          val format = extractor.getTrackFormat(i)
          val trackMime = format.getString(MediaFormat.KEY_MIME) ?: continue
          if (!trackMime.startsWith("audio/")) continue

          technicalRead = true
          result.mergeAudioCodecMetadata(trackMime)
          fill("mimeType", trackMime)
          if (format.containsKey(MediaFormat.KEY_DURATION)) {
            fill("durationMs", format.getLong(MediaFormat.KEY_DURATION) / 1000)
          }
          if (format.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) {
            fill("channels", format.getInteger(MediaFormat.KEY_CHANNEL_COUNT))
          }
          if (result["sampleRate"] == null && format.containsKey(MediaFormat.KEY_SAMPLE_RATE)) {
            result["sampleRate"] = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
          }
          fill("bitsPerSample", readBitsPerSample(format))
          break
        }
      } catch (_: Throwable) {
        // Container not supported by MediaExtractor — tag data already collected.
      } finally {
        try {
          extractor.release()
        } catch (_: Throwable) {}
        technicalFormatNanos =
          SystemClock.elapsedRealtimeNanos() - technicalFormatStartedNanos
      }

      if (cancelled.get()) throw ScanCancelledException()
      result["ok"] = native != null || androidRead || technicalRead || result["artist"] != null
      result["metadataReaderVersion"] = if (nativeError == null) CURRENT_METADATA_READER_VERSION else 0
      if (result["ok"] == false) result["error"] = (nativeError ?: androidMetadataError)?.message ?: "Unsupported audio container"
      if (nativeError != null || androidMetadataError != null) {
        Log.d(LIBRARY_SCAN_LOG_TAG, "metadata fallback native=${nativeError?.javaClass?.simpleName} android=${androidMetadataError?.javaClass?.simpleName} recovered=${result["ok"]}")
      }

      val artworkStartedNanos = SystemClock.elapsedRealtimeNanos()
      try {
        result["artworkHash"] = resolveArtwork(embeddedPicture, coverUri)
      } catch (_: Throwable) {
        // Artwork failure never fails the track.
      } finally {
        artworkNanos = SystemClock.elapsedRealtimeNanos() - artworkStartedNanos
      }

      return result
    } finally {
      metadataSemaphore.release()
      runCatching {
        timingRecorder?.invoke(
          MetadataStageTiming(
            androidMetadataNanos = androidMetadataNanos,
            multiArtistNanos = multiArtistNanos,
            technicalFormatNanos = technicalFormatNanos,
            artworkNanos = artworkNanos,
            totalNanos = SystemClock.elapsedRealtimeNanos() - totalStartedNanos,
          ),
        )
      }
    }
  }

  private fun Map<String, Any?>.toLocalAudioMetadata(): LocalAudioMetadata =
    LocalAudioMetadata(
      ok = this["ok"] as? Boolean ?: false,
      title = this["title"] as? String,
      artist = this["artist"] as? String,
      artistNames = (this["artistNames"] as? List<*>)?.filterIsInstance<String>().orEmpty(),
      album = this["album"] as? String,
      albumArtist = this["albumArtist"] as? String,
      albumArtistNames =
        (this["albumArtistNames"] as? List<*>)?.filterIsInstance<String>().orEmpty(),
      genre = this["genre"] as? String,
      mimeType = this["mimeType"] as? String,
      durationMs = (this["durationMs"] as? Number)?.toLong(),
      bitrate = (this["bitrate"] as? Number)?.toInt(),
      trackNumber = (this["trackNumber"] as? Number)?.toInt(),
      trackTotal = (this["trackTotal"] as? Number)?.toInt(),
      discTotal = (this["discTotal"] as? Number)?.toInt(),
      metadataReaderVersion = (this["metadataReaderVersion"] as? Number)?.toInt() ?: 0,
      discNumber = (this["discNumber"] as? Number)?.toInt(),
      year = (this["year"] as? Number)?.toInt(),
      sampleRate = (this["sampleRate"] as? Number)?.toInt(),
      channels = (this["channels"] as? Number)?.toInt(),
      bitsPerSample = (this["bitsPerSample"] as? Number)?.toInt(),
      codecMime = this["codecMime"] as? String,
      codecProfile = this["codecProfile"] as? String,
      isAtmosJoc = this["isAtmosJoc"] as? Boolean,
      artworkHash = this["artworkHash"] as? String,
      error = this["error"] as? String,
    )

  // ---------------------------------------------------------------------------
  // Track analysis: waveform peaks + loudness in ONE decode pass
  // ---------------------------------------------------------------------------

  private fun readBitsPerSample(format: MediaFormat): Int? {
    // The framework FLAC/WAV extractors expose "bits-per-sample"; other codecs
    // may expose a PCM encoding instead. Both are best-effort.
    if (format.containsKey("bits-per-sample")) {
      return format.getInteger("bits-per-sample")
    }
    if (format.containsKey(MediaFormat.KEY_PCM_ENCODING)) {
      return when (format.getInteger(MediaFormat.KEY_PCM_ENCODING)) {
        AudioFormat.ENCODING_PCM_8BIT -> 8
        AudioFormat.ENCODING_PCM_16BIT -> 16
        AudioFormat.ENCODING_PCM_24BIT_PACKED -> 24
        AudioFormat.ENCODING_PCM_32BIT, AudioFormat.ENCODING_PCM_FLOAT -> 32
        else -> null
      }
    }
    return null
  }

  private fun parseTagNumber(raw: String?): Int? =
    raw?.split('/')?.firstOrNull()?.trim()?.toIntOrNull()?.takeIf { it > 0 }

  private fun parseYear(year: String?, date: String?): Int? {
    for (candidate in listOf(year, date)) {
      if (candidate == null) continue
      val match = Regex("\\d{4}").find(candidate) ?: continue
      return match.value.toIntOrNull()
    }
    return null
  }

  // ---------------------------------------------------------------------------
  // Artwork cache (mirrors desktop: file name = md5(bytes) + extension)
  // ---------------------------------------------------------------------------

  private fun resolveArtwork(embedded: ByteArray?, coverUri: String?): String? {
    if (embedded != null && isDecodableArtwork(embedded)) {
      runCatching { writeArtwork(embedded) }.getOrNull()?.let { return it }
    }
    if (coverUri == null) return null
    return coverHashMemo.getOrPut(coverUri) {
      val bytes = requireContext().contentResolver.openInputStream(Uri.parse(coverUri))
        ?.use(::readImportedArtworkBytes)
        ?: return null
      if (!isDecodableArtwork(bytes)) return null
      writeArtwork(bytes)
    }
  }

  private fun writeArtwork(bytes: ByteArray): String {
    val fileName = md5Hex(bytes) + sniffImageExtension(bytes)
    val target = File(artworkDir(), fileName)
    if (!target.exists()) {
      val temp = File(artworkDir(), "$fileName.tmp-${System.nanoTime()}")
      temp.writeBytes(bytes)
      if (!temp.renameTo(target)) {
        temp.delete()
      }
    }
    writeArtworkThumbnailFromBytes(bytes, fileName)
    return fileName
  }

  private fun cacheArtworkFromUri(rawUri: String): String {
    val uri = Uri.parse(rawUri.trim().ifEmpty { error("An image URI is required") })
    val bytes = requireContext().contentResolver.openInputStream(uri)
      ?.use(::readImportedArtworkBytes)
      ?: error("The selected image could not be opened")
    return ImportedArtworkCache(
      artworkDirectory = artworkDir(),
      thumbnailDirectory = artworkThumbDir(),
      thumbnailSize = artworkThumbSize,
    ).cache(bytes)
  }

  private fun ensureArtworkThumbnails(hashes: List<String>): Int {
    var generated = 0
    val seen = mutableSetOf<String>()
    for (hash in hashes) {
      val cleanHash = hash.trim()
      if (cleanHash.isEmpty() || !seen.add(cleanHash)) continue

      val thumb = File(artworkThumbDir(), artworkThumbFileName(cleanHash))
      if (thumb.exists()) continue

      val source = File(artworkDir(), cleanHash)
      if (!source.exists()) continue

      val bitmap = decodeSampledBitmap(source) ?: continue
      if (writeThumbnail(bitmap, thumb)) generated += 1
    }
    return generated
  }

  private fun writeArtworkThumbnailFromBytes(bytes: ByteArray, artworkHash: String): Boolean {
    val thumb = File(artworkThumbDir(), artworkThumbFileName(artworkHash))
    if (thumb.exists()) return false
    val bitmap = decodeSampledBitmap(bytes) ?: return false
    return writeThumbnail(bitmap, thumb)
  }

  private fun artworkThumbFileName(artworkHash: String): String {
    val stem = artworkHash.substringBeforeLast('.', artworkHash)
    return "$stem.jpg"
  }

  private fun decodeSampledBitmap(source: File): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(source.absolutePath, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

    val options = BitmapFactory.Options().apply {
      inSampleSize = calculateInSampleSize(bounds.outWidth, bounds.outHeight)
      inPreferredConfig = Bitmap.Config.RGB_565
    }
    return BitmapFactory.decodeFile(source.absolutePath, options)
  }

  private fun decodeSampledBitmap(bytes: ByteArray): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

    val options = BitmapFactory.Options().apply {
      inSampleSize = calculateInSampleSize(bounds.outWidth, bounds.outHeight)
      inPreferredConfig = Bitmap.Config.RGB_565
    }
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
  }

  private fun calculateInSampleSize(width: Int, height: Int): Int {
    var sample = 1
    val largest = max(width, height)
    val decodeBound = artworkThumbSize * 2
    while (largest / sample > decodeBound) {
      sample *= 2
    }
    return sample
  }

  private fun writeThumbnail(bitmap: Bitmap, target: File): Boolean {
    val thumb = scaleThumbnail(bitmap)
    val temp = File(artworkThumbDir(), "${target.name}.tmp-${System.nanoTime()}")
    var wrote = false
    try {
      temp.outputStream().use { out ->
        wrote = thumb.compress(Bitmap.CompressFormat.JPEG, 84, out)
      }
      if (!wrote || target.exists()) {
        temp.delete()
        return false
      }
      if (!temp.renameTo(target)) {
        temp.delete()
        return false
      }
      return true
    } finally {
      if (temp.exists() && !wrote) temp.delete()
      if (thumb !== bitmap && !bitmap.isRecycled) bitmap.recycle()
      if (!thumb.isRecycled) thumb.recycle()
    }
  }

  private fun scaleThumbnail(bitmap: Bitmap): Bitmap {
    val largest = max(bitmap.width, bitmap.height)
    if (largest <= artworkThumbSize) return bitmap

    val scale = artworkThumbSize.toFloat() / largest
    val width = max(1, (bitmap.width * scale).roundToInt())
    val height = max(1, (bitmap.height * scale).roundToInt())
    return Bitmap.createScaledBitmap(bitmap, width, height, true)
  }

  private fun md5Hex(bytes: ByteArray): String =
    MessageDigest.getInstance("MD5").digest(bytes).joinToString("") { "%02x".format(it) }

  private fun sniffSupportedImageExtension(bytes: ByteArray): String? = when {
    bytes.size >= 2 && bytes[0] == 0xFF.toByte() && bytes[1] == 0xD8.toByte() -> ".jpg"
    bytes.size >= 8 &&
      bytes[0] == 0x89.toByte() && bytes[1] == 0x50.toByte() &&
      bytes[2] == 0x4E.toByte() && bytes[3] == 0x47.toByte() -> ".png"
    bytes.size >= 12 &&
      bytes[0] == 'R'.code.toByte() && bytes[1] == 'I'.code.toByte() &&
      bytes[2] == 'F'.code.toByte() && bytes[3] == 'F'.code.toByte() &&
      bytes[8] == 'W'.code.toByte() && bytes[9] == 'E'.code.toByte() &&
      bytes[10] == 'B'.code.toByte() && bytes[11] == 'P'.code.toByte() -> ".webp"
    else -> null
  }

  private fun sniffImageExtension(bytes: ByteArray): String =
    sniffSupportedImageExtension(bytes) ?: ".jpg"
}
