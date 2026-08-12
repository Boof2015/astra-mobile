package expo.modules.astralibraryscanner

import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.provider.DocumentsContract
import android.util.Log
import com.google.android.exoplayer2.MediaItem
import com.google.android.exoplayer2.MetadataRetriever
import com.google.android.exoplayer2.metadata.id3.BinaryFrame
import com.google.android.exoplayer2.metadata.id3.InternalFrame
import com.google.android.exoplayer2.metadata.id3.TextInformationFrame
import com.google.android.exoplayer2.metadata.flac.VorbisComment
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.sqrt
import kotlin.math.tan
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.astralibraryscanner.data.AstraLibraryRepository
import expo.modules.astralibraryscanner.data.ArtistCreditMetadataReader
import expo.modules.astralibraryscanner.data.LocalAudioFile
import expo.modules.astralibraryscanner.data.LocalAudioMetadata
import expo.modules.astralibraryscanner.data.ScanCancelledException
import expo.modules.astralibraryscanner.data.formatArtistNames
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.roundToInt

private const val LIBRARY_SCAN_LOG_TAG = "AstraLibraryScan"

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
        " multiArtistTotalMs=${nanosToMs(timing.multiArtistNanos)}" +
        " multiArtistAvgMs=${averageMs(timing.multiArtistNanos, timing.count)}" +
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
 * Result of ONE decode pass over a track: waveform peaks + integrated loudness + sample
 * peak, plus timing so the JS side can report how fast the decode actually ran. Peaks and
 * loudness share a pass because both need every sample; decoding twice was pure waste.
 */
class AudioAnalysis : Record {
  @Field var peaks: FloatArray = FloatArray(0)
  @Field var lufs: Double? = null // integrated LUFS (negative dB); null if unmeasured
  @Field var peak: Double? = null // absolute sample peak, linear [0,1]; null if unmeasured
  /** True when the decode was cancelled mid-flight; peaks/lufs are then meaningless. */
  @Field var cancelled: Boolean = false
  /** Wall-clock decode time in ms — the number that decides whether we need a native decoder. */
  @Field var decodeMs: Double? = null
  /** Track duration in ms, from the container. */
  @Field var durationMs: Double? = null
  /** durationMs / decodeMs — "how many times faster than realtime". Higher is better. */
  @Field var realtimeFactor: Double? = null
  /** Which MediaCodec actually ran (e.g. "c2.android.flac.decoder"). */
  @Field var decoderName: String? = null
  /** Audio track mime (e.g. "audio/flac"). */
  @Field var mime: String? = null
  /** Whether the loudness meter rode along on this pass. */
  @Field var withLoudness: Boolean = false
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

  // Cancellation flags for in-flight analyses, keyed by track URI. Set by cancelAnalysis
  // so a skipped-past track stops burning CPU instead of running to completion holding a
  // semaphore permit. Registered before the permit is acquired, so a queued-but-unstarted
  // decode can be cancelled too.
  private val activeAnalyses = ConcurrentHashMap<String, AtomicBoolean>()

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
              extractOne(file.uri, file.coverUri, metadataTimings::record).toLocalAudioMetadata()
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

    // ONE whole-file PCM decode producing waveform peaks and (when withLoudness) gated
    // integrated loudness + sample peak. Both need every sample, so they ride the same
    // pass — running them separately meant decoding each track twice. Heavy, so cap
    // concurrency; the JS side caches results in SQLite and prefetches the queue ahead.
    // Emits onWaveformProgress as bins finalize so the seek bar can fill in left-to-right.
    AsyncFunction("analyzeTrack") Coroutine { uri: String, bins: Int, withLoudness: Boolean ->
      val flag = AtomicBoolean(false)
      activeAnalyses[uri] = flag
      try {
        waveformSemaphore.withPermit {
          // Cancelled while queued behind another decode — don't start at all.
          if (flag.get()) AudioAnalysis().apply { cancelled = true }
          else withContext(Dispatchers.IO) {
            runAnalysis(uri, if (bins > 0) bins else 512, withLoudness, flag)
          }
        }
      } finally {
        activeAnalyses.remove(uri, flag)
      }
    }

    // Stop an in-flight (or still-queued) analysis for this URI. Safe to call for a URI
    // with no analysis running. The decode bails at the next buffer boundary.
    AsyncFunction("cancelAnalysis") Coroutine { uri: String ->
      activeAnalyses[uri]?.set(true)
    }

    // Fast waveform preview for first paint: sparse short-window decode across
    // the file. The JS side shows this immediately as the coarse full-width shape
    // that the progressive accurate pass then fills over; only analyzeTrack persists.
    AsyncFunction("extractWaveformPreview") Coroutine { uri: String, bins: Int ->
      waveformSemaphore.withPermit {
        withContext(Dispatchers.IO) { decodeWaveformPreview(uri, if (bins > 0) bins else 96) }
      }
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
  ): Map<String, Any?> {
    val totalStartedNanos = SystemClock.elapsedRealtimeNanos()
    var androidMetadataNanos = 0L
    var multiArtistNanos = 0L
    var technicalFormatNanos = 0L
    var artworkNanos = 0L
    val context = requireContext()
    val uri = Uri.parse(uriString)
    val result = mutableMapOf<String, Any?>("uri" to uriString, "ok" to true)

    try {
      var embeddedPicture: ByteArray? = null
      var androidMetadataError: Throwable? = null
      val androidMetadataStartedNanos = SystemClock.elapsedRealtimeNanos()
      val retriever = MediaMetadataRetriever()
      try {
        retriever.setDataSource(context, uri)

        result["title"] = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE)
        result["artist"] = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST)
        result["album"] = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM)
        result["albumArtist"] =
          retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUMARTIST)
        result["genre"] = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_GENRE)
        result["mimeType"] = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_MIMETYPE)
        result["durationMs"] =
          retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()
        result["bitrate"] =
          retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_BITRATE)?.toIntOrNull()
        result["trackNumber"] = parseTagNumber(
          retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_CD_TRACK_NUMBER)
        )
        result["discNumber"] = parseTagNumber(
          retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DISC_NUMBER)
        )
        result["year"] = parseYear(
          retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_YEAR),
          retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DATE)
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          result["sampleRate"] =
            retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_SAMPLERATE)?.toIntOrNull()
        }
        embeddedPicture = retriever.embeddedPicture
      } catch (error: Throwable) {
        androidMetadataError = error
      } finally {
        try {
          retriever.release()
        } catch (_: Throwable) {}
        androidMetadataNanos = SystemClock.elapsedRealtimeNanos() - androidMetadataStartedNanos
      }
      androidMetadataError?.let { error ->
        return mapOf(
          "uri" to uriString,
          "ok" to false,
          "error" to (error.message ?: error.javaClass.simpleName),
        )
      }

      val multiArtistStartedNanos = SystemClock.elapsedRealtimeNanos()
      val credits = try {
        ArtistCreditMetadataReader.read(context, uri, metadataTimeoutMs)
      } finally {
        multiArtistNanos = SystemClock.elapsedRealtimeNanos() - multiArtistStartedNanos
      }
      val artistNames = credits.artists.takeIf { it.size > 1 }.orEmpty()
      val albumArtistNames = credits.albumArtists.takeIf { it.size > 1 }.orEmpty()
      result["artistNames"] = artistNames
      result["albumArtistNames"] = albumArtistNames
      if (artistNames.isNotEmpty()) {
        result["artist"] = formatArtistNames(artistNames)
      } else if (result["artist"] == null && credits.artists.size == 1) {
        result["artist"] = credits.artists[0]
      }
      if (albumArtistNames.isNotEmpty()) {
        result["albumArtist"] = formatArtistNames(albumArtistNames)
      } else if (result["albumArtist"] == null && credits.albumArtists.size == 1) {
        result["albumArtist"] = credits.albumArtists[0]
      }

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

          result["codecMime"] = trackMime
          if (format.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) {
            result["channels"] = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
          }
          if (result["sampleRate"] == null && format.containsKey(MediaFormat.KEY_SAMPLE_RATE)) {
            result["sampleRate"] = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
          }
          result["bitsPerSample"] = readBitsPerSample(format)
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
      discNumber = (this["discNumber"] as? Number)?.toInt(),
      year = (this["year"] as? Number)?.toInt(),
      sampleRate = (this["sampleRate"] as? Number)?.toInt(),
      channels = (this["channels"] as? Number)?.toInt(),
      bitsPerSample = (this["bitsPerSample"] as? Number)?.toInt(),
      codecMime = this["codecMime"] as? String,
      artworkHash = this["artworkHash"] as? String,
      error = this["error"] as? String,
    )

  // ---------------------------------------------------------------------------
  // Track analysis: waveform peaks + loudness in ONE decode pass
  // ---------------------------------------------------------------------------

  /** Throttle for onWaveformProgress — ~12 emits/sec is plenty for a fill animation. */
  private val progressEmitNanos = 80L * 1_000_000L

  /** Hard ceiling so a corrupt file can't hang a decode forever holding a semaphore permit. */
  private val analysisTimeoutMs = 180_000L

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
   * Returns empty peaks on any failure and sets `cancelled` if it bailed early — callers
   * must not persist a cancelled result.
   */
  private suspend fun runAnalysis(
    uriStr: String,
    bins: Int,
    withLoudness: Boolean,
    cancelFlag: AtomicBoolean,
  ): AudioAnalysis {
    val context = requireContext()
    val result = AudioAnalysis()
    result.withLoudness = withLoudness
    val uri = Uri.parse(uriStr)
    val extractor = MediaExtractor()
    var codec: MediaCodec? = null
    var handlerThread: HandlerThread? = null
    val startNanos = System.nanoTime()

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
      val durationUs =
        if (format.containsKey(MediaFormat.KEY_DURATION)) format.getLong(MediaFormat.KEY_DURATION) else 0L
      result.durationMs = durationUs / 1000.0
      val totalFrames = max(1L, (durationUs / 1_000_000.0 * sampleRate).toLong())

      val acc = AnalyzeAccumulator(bins, totalFrames, withLoudness)
      acc.sampleRate = sampleRate
      acc.channelCount =
        if (format.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) format.getInteger(MediaFormat.KEY_CHANNEL_COUNT) else 2

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
              if (!eos && acc.filledBins > lastEmitBin && now - lastEmitNanos >= progressEmitNanos) {
                lastEmitNanos = now
                lastEmitBin = acc.filledBins
                emitWaveformProgress(uriStr, acc, lastEmitBin)
              }
              if (eos) done.complete(Unit)
            } catch (_: Throwable) {
              done.complete(Unit)
            }
          }

          override fun onOutputFormatChanged(mc: MediaCodec, fmt: MediaFormat) {
            if (fmt.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) {
              acc.channelCount = fmt.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
            }
            if (fmt.containsKey(MediaFormat.KEY_SAMPLE_RATE)) {
              acc.sampleRate = fmt.getInteger(MediaFormat.KEY_SAMPLE_RATE)
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
      codec.start()

      if (withTimeoutOrNull(analysisTimeoutMs) { done.await() } == null) {
        // Timed out: peaks are partial, so treat it as a cancellation rather than caching
        // a truncated waveform.
        result.cancelled = true
      }
      if (result.cancelled) return result

      result.peaks = acc.finalPeaks()
      if (withLoudness) {
        result.lufs = acc.loudness
        result.peak = acc.samplePeak
      }
      val decodeMs = (System.nanoTime() - startNanos) / 1_000_000.0
      result.decodeMs = decodeMs
      val dur = result.durationMs
      if (dur != null && dur > 0 && decodeMs > 0) result.realtimeFactor = dur / decodeMs
      return result
    } catch (_: Throwable) {
      return result
    } finally {
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
    }
  }

  // Emits the raw (un-normalized) RMS prefix; JS normalizes against its own max, so the
  // bars rescale slightly as louder material arrives rather than needing a global max we
  // don't have yet.
  private fun emitWaveformProgress(uri: String, acc: AnalyzeAccumulator, filledBins: Int) {
    try {
      sendEvent(
        "onWaveformProgress",
        mapOf(
          "uri" to uri,
          "filledBins" to filledBins,
          "totalBins" to acc.bins,
          "peaks" to acc.rmsPrefix(filledBins),
        ),
      )
    } catch (_: Throwable) {
      // Best-effort: the final result still arrives via the promise.
    }
  }

  // Offline analysis wants raw throughput. Hardware audio decoders are tuned for low-power
  // realtime playback, not bulk decode, and the instance is a scarce global resource shared
  // with the track that is actually playing — so prefer a software decoder and fall back to
  // the platform's default pick.
  private fun createAnalysisDecoder(mime: String): MediaCodec {
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
  private class AnalyzeAccumulator(
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

  private data class PcmEnergy(
    val sumSquares: Double,
    val sampleCount: Long,
    val frameCount: Long
  )

  // Sparse preview waveform: seek to a bounded number of points, decode a very
  // short audio window at each point, and normalize those RMS samples. This is
  // intentionally approximate; runAnalysis remains the accurate cache fill.
  private fun decodeWaveformPreview(uriStr: String, bins: Int): FloatArray {
    val context = requireContext()
    val previewBins = bins.coerceIn(16, 128)
    val uri = Uri.parse(uriStr)
    val extractor = MediaExtractor()
    var codec: MediaCodec? = null
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
      val format = trackFormat ?: return FloatArray(0)
      extractor.selectTrack(trackIndex)

      val mime = format.getString(MediaFormat.KEY_MIME) ?: return FloatArray(0)
      val durationUs =
        if (format.containsKey(MediaFormat.KEY_DURATION)) format.getLong(MediaFormat.KEY_DURATION) else 0L
      if (durationUs <= 0L) return FloatArray(0)

      val sampleRate =
        if (format.containsKey(MediaFormat.KEY_SAMPLE_RATE)) format.getInteger(MediaFormat.KEY_SAMPLE_RATE) else 44100
      var channelCount =
        if (format.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) format.getInteger(MediaFormat.KEY_CHANNEL_COUNT) else 2
      var pcmFloat = false
      val windowFrames = max(512L, (sampleRate * 0.018).roundToInt().toLong())
      val peaks = FloatArray(previewBins)

      codec = MediaCodec.createDecoderByType(mime)
      codec.configure(format, null, null, 0)
      codec.start()
      val info = MediaCodec.BufferInfo()

      for (bin in 0 until previewBins) {
        val targetUs = ((durationUs.toDouble() * bin) / previewBins).toLong()
          .coerceIn(0L, max(0L, durationUs - 1))
        try {
          extractor.seekTo(targetUs, MediaExtractor.SEEK_TO_CLOSEST_SYNC)
          codec.flush()
        } catch (_: Throwable) {
          continue
        }

        var sawInputEOS = false
        var frames = 0L
        var sumSquares = 0.0
        var sampleCount = 0L
        var safety = 0

        while (frames < windowFrames && safety++ < 180) {
          if (!sawInputEOS) {
            val inIndex = codec.dequeueInputBuffer(2_000)
            if (inIndex >= 0) {
              val inBuf = codec.getInputBuffer(inIndex)!!
              val size = extractor.readSampleData(inBuf, 0)
              if (size < 0) {
                codec.queueInputBuffer(inIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                sawInputEOS = true
              } else {
                codec.queueInputBuffer(inIndex, 0, size, extractor.sampleTime, 0)
                extractor.advance()
              }
            }
          }

          when (val outIndex = codec.dequeueOutputBuffer(info, 2_000)) {
            MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
              val nf = codec.outputFormat
              if (nf.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) channelCount = nf.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
              if (nf.containsKey(MediaFormat.KEY_PCM_ENCODING)) {
                pcmFloat = nf.getInteger(MediaFormat.KEY_PCM_ENCODING) == AudioFormat.ENCODING_PCM_FLOAT
              }
            }
            MediaCodec.INFO_TRY_AGAIN_LATER -> {
              if (sawInputEOS) break
            }
            else -> if (outIndex >= 0) {
              if (info.size > 0) {
                val out = codec.getOutputBuffer(outIndex)!!
                out.position(info.offset)
                out.limit(info.offset + info.size)
                out.order(ByteOrder.nativeOrder())
                val energy = collectEnergy(out, pcmFloat, channelCount, windowFrames - frames)
                frames += energy.frameCount
                sumSquares += energy.sumSquares
                sampleCount += energy.sampleCount
              }
              val ended = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
              codec.releaseOutputBuffer(outIndex, false)
              if (ended) break
            }
          }
        }

        if (sampleCount > 0) {
          peaks[bin] = sqrt(sumSquares / sampleCount).toFloat()
        }
      }

      var globalMax = 0f
      for (value in peaks) if (value > globalMax) globalMax = value
      if (globalMax > 0f) {
        for (i in peaks.indices) peaks[i] /= globalMax
      }
      return peaks
    } catch (_: Throwable) {
      return FloatArray(0)
    } finally {
      try { codec?.stop() } catch (_: Throwable) {}
      try { codec?.release() } catch (_: Throwable) {}
      try { extractor.release() } catch (_: Throwable) {}
    }
  }

  private fun collectEnergy(
    out: java.nio.ByteBuffer,
    pcmFloat: Boolean,
    channelCount: Int,
    maxFrames: Long
  ): PcmEnergy {
    if (maxFrames <= 0) return PcmEnergy(0.0, 0L, 0L)
    var sumSquares = 0.0
    var sampleCount = 0L
    var frameCount = 0L
    if (pcmFloat) {
      val fb = out.asFloatBuffer()
      while (fb.hasRemaining() && frameCount < maxFrames) {
        var c = 0
        while (c < channelCount && fb.hasRemaining()) {
          val s = fb.get().toDouble()
          sumSquares += s * s
          sampleCount++
          c++
        }
        frameCount++
      }
    } else {
      val sb = out.asShortBuffer()
      while (sb.hasRemaining() && frameCount < maxFrames) {
        var c = 0
        while (c < channelCount && sb.hasRemaining()) {
          val s = sb.get() / 32768.0
          sumSquares += s * s
          sampleCount++
          c++
        }
        frameCount++
      }
    }
    return PcmEnergy(sumSquares, sampleCount, frameCount)
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
    if (embedded != null && embedded.isNotEmpty()) {
      return writeArtwork(embedded)
    }
    if (coverUri == null) return null
    return coverHashMemo.getOrPut(coverUri) {
      val bytes = requireContext().contentResolver.openInputStream(Uri.parse(coverUri))
        ?.use { it.readBytes() }
        ?: return null
      if (bytes.isEmpty()) return null
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
