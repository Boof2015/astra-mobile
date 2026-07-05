package expo.modules.astralibraryscanner

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.provider.DocumentsContract
import com.google.android.exoplayer2.MediaItem
import com.google.android.exoplayer2.MetadataRetriever
import com.google.android.exoplayer2.metadata.id3.InternalFrame
import com.google.android.exoplayer2.metadata.id3.TextInformationFrame
import com.google.android.exoplayer2.metadata.flac.VorbisComment
import java.nio.ByteOrder
import java.util.concurrent.TimeUnit
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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.roundToInt

class FileRequest : Record {
  @Field val uri: String = ""
  @Field val coverUri: String? = null
}

/** Result of one scan-time decode: waveform peaks + integrated loudness + sample peak. */
class AudioAnalysis : Record {
  @Field var peaks: FloatArray = FloatArray(0)
  @Field var lufs: Double? = null // integrated LUFS (negative dB); null if unmeasured
  @Field var peak: Double? = null // absolute sample peak, linear [0,1]; null if unmeasured
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

  // Waveform decode is whole-file and CPU-heavy; throttle concurrent decodes.
  private val waveformSemaphore = Semaphore(2)

  override fun definition() = ModuleDefinition {
    Name("AstraLibraryScanner")

    Events("onScanProgress")

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

    // Offline waveform peaks for the seek bar: full PCM decode -> RMS per bin,
    // normalized to [0,1]. Heavy (whole-file decode), so cap concurrency and
    // run lazily per track on the JS side; results are cached in SQLite there.
    AsyncFunction("extractWaveform") Coroutine { uri: String, bins: Int ->
      waveformSemaphore.withPermit {
        withContext(Dispatchers.IO) { decodeAndAnalyze(uri, if (bins > 0) bins else 512).peaks }
      }
    }

    // Fast waveform preview for first paint: sparse short-window decode across
    // the file. The JS side shows this immediately but only persists the full
    // extractWaveform result.
    AsyncFunction("extractWaveformPreview") Coroutine { uri: String, bins: Int ->
      waveformSemaphore.withPermit {
        withContext(Dispatchers.IO) { decodeWaveformPreview(uri, if (bins > 0) bins else 96) }
      }
    }

    // Fast loudness (M4): decodes only a few short windows spread across the track
    // (not the whole file) + gated K-weighting -> integrated LUFS + sample peak.
    // Waveform peaks stay lazy/full-decode (extractWaveform), decoupled from this.
    AsyncFunction("measureLoudness") Coroutine { uri: String ->
      waveformSemaphore.withPermit {
        withContext(Dispatchers.IO) { measureLoudness(uri) }
      }
    }

    // ReplayGain tags (M4): reads container metadata only (no PCM decode), so it is
    // cheap and lets us normalize a tagged library without the slow loudness decode.
    AsyncFunction("readReplayGain") Coroutine { uri: String ->
      withContext(Dispatchers.IO) { readReplayGain(uri) }
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
  // Directory walk
  // ---------------------------------------------------------------------------

  private val coverBaseNames = listOf("cover", "folder", "front", "albumart")
  private val coverExtensions = setOf("jpg", "jpeg", "png", "webp")

  private fun listAudioFiles(treeUri: String, extensions: List<String>): Map<String, Any> {
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
      val dirDocId = queue.removeFirst()
      val parentUri = DocumentsContract.buildDocumentUriUsingTree(tree, dirDocId).toString()
      val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(tree, dirDocId)

      val cursor = resolver.query(childrenUri, projection, null, null, null)
        ?: continue // directory disappeared mid-walk; skip it
      cursor.use {
        while (it.moveToNext()) {
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
    val context = requireContext()
    val uri = Uri.parse(request.uri)
    val result = mutableMapOf<String, Any?>("uri" to request.uri, "ok" to true)

    var embeddedPicture: ByteArray? = null
    val retriever = MediaMetadataRetriever()
    try {
      retriever.setDataSource(context, uri)

      result["title"] = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE)
      result["artist"] = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST)
      result["album"] = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM)
      result["albumArtist"] = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUMARTIST)
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
    } catch (t: Throwable) {
      return mapOf(
        "uri" to request.uri,
        "ok" to false,
        "error" to (t.message ?: t.javaClass.simpleName)
      )
    } finally {
      try {
        retriever.release()
      } catch (_: Throwable) {}
    }

    // Header-level facts MMR can't provide (channels, bit depth) or only on
    // API 31+ (sample rate). Failure here is non-fatal — keep the tag data.
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
    }

    try {
      result["artworkHash"] = resolveArtwork(embeddedPicture, request.coverUri)
    } catch (_: Throwable) {
      // Artwork failure never fails the track.
    }

    return result
  }

  // ---------------------------------------------------------------------------
  // Waveform peaks (offline RMS bins)
  // ---------------------------------------------------------------------------

  // One whole-file PCM decode -> per-bin RMS waveform peaks (normalized [0,1]) for the
  // seek bar. Returns empty peaks on any failure (caller falls back to a flat seek
  // bar). Loudness is measured separately by measureLoudness.
  private fun decodeAndAnalyze(uriStr: String, bins: Int): AudioAnalysis {
    val context = requireContext()
    val result = AudioAnalysis()
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
      val format = trackFormat ?: return result
      extractor.selectTrack(trackIndex)

      val sampleRate =
        if (format.containsKey(MediaFormat.KEY_SAMPLE_RATE)) format.getInteger(MediaFormat.KEY_SAMPLE_RATE) else 44100
      val durationUs =
        if (format.containsKey(MediaFormat.KEY_DURATION)) format.getLong(MediaFormat.KEY_DURATION) else 0L
      val totalFrames = max(1L, (durationUs / 1_000_000.0 * sampleRate).toLong())
      var channelCount =
        if (format.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) format.getInteger(MediaFormat.KEY_CHANNEL_COUNT) else 2
      var pcmFloat = false

      val sumSquares = DoubleArray(bins)
      val counts = LongArray(bins)

      codec = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!)
      codec.configure(format, null, null, 0)
      codec.start()

      val info = MediaCodec.BufferInfo()
      var sawInputEOS = false
      var sawOutputEOS = false
      var frame = 0L

      while (!sawOutputEOS) {
        if (!sawInputEOS) {
          val inIndex = codec.dequeueInputBuffer(10_000)
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

        val outIndex = codec.dequeueOutputBuffer(info, 10_000)
        if (outIndex >= 0) {
          if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) sawOutputEOS = true
          if (info.size > 0) {
            val out = codec.getOutputBuffer(outIndex)!!
            out.position(info.offset)
            out.limit(info.offset + info.size)
            out.order(ByteOrder.nativeOrder())
            frame = accumulateAnalyze(out, pcmFloat, channelCount, bins, totalFrames, frame, sumSquares, counts)
          }
          codec.releaseOutputBuffer(outIndex, false)
        } else if (outIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
          val nf = codec.outputFormat
          if (nf.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) channelCount = nf.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
          if (nf.containsKey(MediaFormat.KEY_PCM_ENCODING)) {
            pcmFloat = nf.getInteger(MediaFormat.KEY_PCM_ENCODING) == AudioFormat.ENCODING_PCM_FLOAT
          }
        }
      }

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
      result.peaks = peaks
      return result
    } catch (_: Throwable) {
      return result
    } finally {
      try { codec?.stop() } catch (_: Throwable) {}
      try { codec?.release() } catch (_: Throwable) {}
      try { extractor.release() } catch (_: Throwable) {}
    }
  }

  private data class PcmEnergy(
    val sumSquares: Double,
    val sampleCount: Long,
    val frameCount: Long
  )

  // Sparse preview waveform: seek to a bounded number of points, decode a very
  // short audio window at each point, and normalize those RMS samples. This is
  // intentionally approximate; decodeAndAnalyze remains the accurate cache fill.
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

  // Integrated gated loudness over the WHOLE file (accurate — subset sampling caused
  // too much loudness inconsistency). Decodes the full track and feeds the gated
  // K-weighting meter. Measured on the fly per track (current + queue lookahead) and
  // cached, so the cost is paid once per track, never in a bulk background pass.
  private fun measureLoudness(uriStr: String): AudioAnalysis {
    val context = requireContext()
    val result = AudioAnalysis()
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
      val format = trackFormat ?: return result
      extractor.selectTrack(trackIndex)

      val sampleRate =
        if (format.containsKey(MediaFormat.KEY_SAMPLE_RATE)) format.getInteger(MediaFormat.KEY_SAMPLE_RATE) else 44100
      var channelCount =
        if (format.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) format.getInteger(MediaFormat.KEY_CHANNEL_COUNT) else 2
      var pcmFloat = false

      codec = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!)
      codec.configure(format, null, null, 0)
      codec.start()
      val info = MediaCodec.BufferInfo()

      var meter: LoudnessMeter? = null
      var sawInputEOS = false
      var sawOutputEOS = false
      while (!sawOutputEOS) {
        if (!sawInputEOS) {
          val inIndex = codec.dequeueInputBuffer(10_000)
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
        val outIndex = codec.dequeueOutputBuffer(info, 10_000)
        if (outIndex >= 0) {
          if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) sawOutputEOS = true
          if (info.size > 0) {
            val out = codec.getOutputBuffer(outIndex)!!
            out.position(info.offset)
            out.limit(info.offset + info.size)
            out.order(ByteOrder.nativeOrder())
            val m = meter ?: LoudnessMeter(channelCount, sampleRate).also { meter = it }
            feedMeter(out, pcmFloat, channelCount, m)
          }
          codec.releaseOutputBuffer(outIndex, false)
        } else if (outIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
          val nf = codec.outputFormat
          if (nf.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) channelCount = nf.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
          if (nf.containsKey(MediaFormat.KEY_PCM_ENCODING)) {
            pcmFloat = nf.getInteger(MediaFormat.KEY_PCM_ENCODING) == AudioFormat.ENCODING_PCM_FLOAT
          }
        }
      }

      meter?.let {
        result.lufs = it.lufs()
        result.peak = it.peak
      }
      return result
    } catch (_: Throwable) {
      return result
    } finally {
      try { codec?.stop() } catch (_: Throwable) {}
      try { codec?.release() } catch (_: Throwable) {}
      try { extractor.release() } catch (_: Throwable) {}
    }
  }

  // Feeds one decoded PCM buffer (16-bit or float) to the loudness meter.
  private fun feedMeter(
    out: java.nio.ByteBuffer,
    pcmFloat: Boolean,
    channelCount: Int,
    meter: LoudnessMeter
  ) {
    if (pcmFloat) {
      val fb = out.asFloatBuffer()
      val n = fb.remaining()
      var k = 0
      while (k < n) {
        var c = 0
        while (c < channelCount && k < n) {
          meter.process(fb.get(k).toDouble(), c); k++; c++
        }
      }
    } else {
      val sb = out.asShortBuffer()
      val n = sb.remaining()
      var k = 0
      while (k < n) {
        var c = 0
        while (c < channelCount && k < n) {
          meter.process(sb.get(k) / 32768.0, c); k++; c++
        }
      }
    }
  }

  // Folds one decoded PCM buffer into the per-bin RMS accumulators and, when a
  // loudness meter is provided, the K-weighted loudness + sample peak. Handles
  // 16-bit (default) and float PCM. Returns the updated running frame index.
  private fun accumulateAnalyze(
    out: java.nio.ByteBuffer,
    pcmFloat: Boolean,
    channelCount: Int,
    bins: Int,
    totalFrames: Long,
    startFrame: Long,
    sumSquares: DoubleArray,
    counts: LongArray
  ): Long {
    var frame = startFrame
    if (pcmFloat) {
      val fb = out.asFloatBuffer()
      val n = fb.remaining()
      var k = 0
      while (k < n) {
        val bin = ((frame.toDouble() / totalFrames) * bins).toInt().coerceIn(0, bins - 1)
        var c = 0
        while (c < channelCount && k < n) {
          val s = fb.get(k).toDouble()
          sumSquares[bin] += s * s
          k++; c++
        }
        counts[bin] += c.toLong()
        frame++
      }
    } else {
      val sb = out.asShortBuffer()
      val n = sb.remaining()
      var k = 0
      while (k < n) {
        val bin = ((frame.toDouble() / totalFrames) * bins).toInt().coerceIn(0, bins - 1)
        var c = 0
        while (c < channelCount && k < n) {
          val s = sb.get(k) / 32768.0
          sumSquares[bin] += s * s
          k++; c++
        }
        counts[bin] += c.toLong()
        frame++
      }
    }
    return frame
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

  private fun sniffImageExtension(bytes: ByteArray): String = when {
    bytes.size >= 2 && bytes[0] == 0xFF.toByte() && bytes[1] == 0xD8.toByte() -> ".jpg"
    bytes.size >= 4 && bytes[0] == 0x89.toByte() && bytes[1] == 0x50.toByte() -> ".png"
    bytes.size >= 12 && bytes[8] == 'W'.code.toByte() && bytes[9] == 'E'.code.toByte() &&
      bytes[10] == 'B'.code.toByte() && bytes[11] == 'P'.code.toByte() -> ".webp"
    else -> ".jpg"
  }
}
