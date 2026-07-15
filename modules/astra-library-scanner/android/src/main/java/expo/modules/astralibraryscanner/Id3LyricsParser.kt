package expo.modules.astralibraryscanner

import java.nio.ByteBuffer
import java.nio.charset.Charset
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets

internal data class SyncedLyricText(
  val timestampMs: Long,
  val text: String,
)

internal sealed interface Id3LyricsCandidate {
  data class Plain(val text: String) : Id3LyricsCandidate
  data class Synced(val entries: List<SyncedLyricText>) : Id3LyricsCandidate
}

internal data class EmbeddedLyricsValue(
  val text: String?,
  val syncText: List<SyncedLyricText>,
)

/**
 * Collects lyric candidates from every metadata entry in a container. A valid
 * synchronized frame wins; otherwise the longest plain body wins. This keeps a
 * stray short tag from displacing a full lyric body while remaining deterministic.
 */
internal class EmbeddedLyricsCollector {
  private var bestPlain: String? = null
  private var bestSynced: List<SyncedLyricText>? = null

  fun considerPlain(rawText: String?) {
    val text = normalizePlainText(rawText) ?: return
    if (bestPlain == null || text.length > bestPlain!!.length) bestPlain = text
  }

  fun consider(candidate: Id3LyricsCandidate?) {
    when (candidate) {
      is Id3LyricsCandidate.Plain -> considerPlain(candidate.text)
      is Id3LyricsCandidate.Synced -> considerSynced(candidate.entries)
      null -> Unit
    }
  }

  private fun considerSynced(rawEntries: List<SyncedLyricText>) {
    val entries = rawEntries.filter { it.text.isNotBlank() }
    if (entries.isEmpty()) return
    val current = bestSynced
    if (
      current == null ||
      entries.size > current.size ||
      (entries.size == current.size && entries.sumOf { it.text.length } > current.sumOf { it.text.length })
    ) {
      bestSynced = entries
    }
  }

  fun valueOrNull(): EmbeddedLyricsValue? {
    val synced = bestSynced
    if (synced != null) {
      val text = normalizePlainText(synced.joinToString(separator = "") { it.text })
      return EmbeddedLyricsValue(text = text, syncText = synced)
    }
    return bestPlain?.let { EmbeddedLyricsValue(text = it, syncText = emptyList()) }
  }
}

/** Decoder for the payload bytes ExoPlayer exposes in ID3 BinaryFrame entries. */
internal object Id3LyricsParser {
  private const val TIMESTAMP_FORMAT_MILLISECONDS = 2
  private val acceptedSyncedContentTypes = setOf(1, 2) // lyrics, text transcription

  fun parse(frameId: String, data: ByteArray): Id3LyricsCandidate? = when (frameId.uppercase()) {
    "USLT", "ULT" -> parseUnsynchronized(data)
    "SYLT", "SLT" -> parseSynchronized(data)
    else -> null
  }

  private fun parseUnsynchronized(data: ByteArray): Id3LyricsCandidate.Plain? {
    if (data.size < 5) return null
    val encoding = data[0].toInt() and 0xff
    if (!isSupportedEncoding(encoding)) return null

    // Encoding byte + ISO-639-2 language. The content descriptor is not part of
    // the displayed lyrics, but its BOM can establish UTF-16 byte order.
    val descriptor = readTerminated(data, 4, encoding) ?: return null
    val lyrics = decodeRange(data, descriptor.nextIndex, data.size, encoding, descriptor.utf16Charset)
      ?: return null
    val normalized = normalizePlainText(lyrics) ?: return null
    return Id3LyricsCandidate.Plain(normalized)
  }

  private fun parseSynchronized(data: ByteArray): Id3LyricsCandidate.Synced? {
    if (data.size < 7) return null
    val encoding = data[0].toInt() and 0xff
    if (!isSupportedEncoding(encoding)) return null
    val timestampFormat = data[4].toInt() and 0xff
    val contentType = data[5].toInt() and 0xff
    if (timestampFormat != TIMESTAMP_FORMAT_MILLISECONDS) return null
    if (contentType !in acceptedSyncedContentTypes) return null

    val descriptor = readTerminated(data, 6, encoding) ?: return null
    var offset = descriptor.nextIndex
    val entries = mutableListOf<SyncedLyricText>()

    while (offset < data.size) {
      val decoded = readTerminated(data, offset, encoding, descriptor.utf16Charset) ?: return null
      offset = decoded.nextIndex
      if (offset + 4 > data.size) return null

      val timestamp =
        ((data[offset].toLong() and 0xff) shl 24) or
          ((data[offset + 1].toLong() and 0xff) shl 16) or
          ((data[offset + 2].toLong() and 0xff) shl 8) or
          (data[offset + 3].toLong() and 0xff)
      offset += 4

      val text = normalizeSyncedText(decoded.text)
      if (text.isNotBlank()) entries += SyncedLyricText(timestampMs = timestamp, text = text)
    }

    return entries.takeIf { it.isNotEmpty() }?.let { Id3LyricsCandidate.Synced(it) }
  }

  private data class DecodedTerminatedString(
    val text: String,
    val nextIndex: Int,
    val utf16Charset: Charset?,
  )

  private fun readTerminated(
    data: ByteArray,
    start: Int,
    encoding: Int,
    inheritedUtf16Charset: Charset? = null,
  ): DecodedTerminatedString? {
    if (start !in 0..data.size) return null
    val terminatorLength = if (encoding == 1 || encoding == 2) 2 else 1
    val end = findTerminator(data, start, terminatorLength) ?: return null
    val charset = resolveUtf16Charset(data, start, end, encoding, inheritedUtf16Charset)
    val text = decodeRange(data, start, end, encoding, charset) ?: return null
    return DecodedTerminatedString(text, end + terminatorLength, charset)
  }

  private fun findTerminator(data: ByteArray, start: Int, terminatorLength: Int): Int? {
    if (terminatorLength == 1) {
      for (index in start until data.size) if (data[index].toInt() == 0) return index
      return null
    }

    var index = start
    while (index + 1 < data.size) {
      if (data[index].toInt() == 0 && data[index + 1].toInt() == 0) return index
      index += 2
    }
    return null
  }

  private fun resolveUtf16Charset(
    data: ByteArray,
    start: Int,
    end: Int,
    encoding: Int,
    inherited: Charset?,
  ): Charset? {
    if (encoding == 2) return StandardCharsets.UTF_16BE
    if (encoding != 1) return null
    if (end - start >= 2) {
      val first = data[start].toInt() and 0xff
      val second = data[start + 1].toInt() and 0xff
      if (first == 0xfe && second == 0xff) return StandardCharsets.UTF_16BE
      if (first == 0xff && second == 0xfe) return StandardCharsets.UTF_16LE
    }
    return inherited ?: StandardCharsets.UTF_16BE
  }

  private fun decodeRange(
    data: ByteArray,
    start: Int,
    end: Int,
    encoding: Int,
    utf16Charset: Charset? = null,
  ): String? {
    if (start < 0 || end < start || end > data.size) return null
    val charset = when (encoding) {
      0 -> StandardCharsets.ISO_8859_1
      1 -> utf16Charset ?: resolveUtf16Charset(data, start, end, encoding, null) ?: return null
      2 -> StandardCharsets.UTF_16BE
      3 -> StandardCharsets.UTF_8
      else -> return null
    }
    var contentStart = start
    if (encoding == 1 && end - start >= 2) {
      val first = data[start].toInt() and 0xff
      val second = data[start + 1].toInt() and 0xff
      if ((first == 0xfe && second == 0xff) || (first == 0xff && second == 0xfe)) {
        contentStart += 2
      }
    }
    val contentLength = end - contentStart
    if ((encoding == 1 || encoding == 2) && contentLength % 2 != 0) return null
    return try {
      charset.newDecoder()
        .onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT)
        .decode(ByteBuffer.wrap(data, contentStart, contentLength))
        .toString()
    } catch (_: Throwable) {
      null
    }
  }

  private fun isSupportedEncoding(encoding: Int): Boolean = encoding in 0..3
}

private fun normalizePlainText(value: String?): String? {
  if (value == null) return null
  val normalized = value.replace("\r\n", "\n").replace('\r', '\n').trim().trim('\u0000')
  return normalized.takeIf { it.isNotEmpty() }
}

private fun normalizeSyncedText(value: String): String =
  value.replace("\r\n", "\n").replace('\r', '\n').trim('\u0000')
