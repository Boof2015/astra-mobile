package expo.modules.astralibraryscanner

import android.content.Context
import android.content.Intent
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.provider.DocumentsContract
import java.nio.ByteOrder
import kotlin.math.max
import kotlin.math.sqrt
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

class FileRequest : Record {
  @Field val uri: String = ""
  @Field val coverUri: String? = null
}

class AstraLibraryScannerModule : Module() {
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
        withContext(Dispatchers.IO) { extractWaveform(uri, if (bins > 0) bins else 512) }
      }
    }

    Function("getArtworkDirPath") {
      artworkDir().absolutePath
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

  // Decodes the whole file to PCM and accumulates RMS energy per bin (mirrors
  // desktop waveformExtractor.extractWaveformPeaks), normalized to [0,1]. Returns
  // an empty array on any failure (caller falls back to a flat seek bar).
  private fun extractWaveform(uriStr: String, bins: Int): FloatArray {
    val context = requireContext()
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
            frame = accumulate(out, pcmFloat, channelCount, bins, totalFrames, frame, sumSquares, counts)
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
      return peaks
    } catch (_: Throwable) {
      return FloatArray(0)
    } finally {
      try { codec?.stop() } catch (_: Throwable) {}
      try { codec?.release() } catch (_: Throwable) {}
      try { extractor.release() } catch (_: Throwable) {}
    }
  }

  // Folds one decoded PCM buffer into the per-bin RMS accumulators. Handles
  // 16-bit (default) and float PCM. Returns the updated running frame index.
  private fun accumulate(
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
      val temp = File(artworkDir(), "$fileName.tmp-${Thread.currentThread().id}")
      temp.writeBytes(bytes)
      if (!temp.renameTo(target)) {
        temp.delete()
      }
    }
    return fileName
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
