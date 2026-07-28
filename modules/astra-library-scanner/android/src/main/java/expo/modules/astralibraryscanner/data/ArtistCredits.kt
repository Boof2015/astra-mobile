package expo.modules.astralibraryscanner.data

import android.content.Context
import android.net.Uri
import com.google.android.exoplayer2.MediaItem
import com.google.android.exoplayer2.MetadataRetriever
import com.google.android.exoplayer2.metadata.flac.VorbisComment
import com.google.android.exoplayer2.metadata.id3.InternalFrame
import com.google.android.exoplayer2.metadata.id3.TextInformationFrame
import java.util.concurrent.TimeUnit
import org.json.JSONArray

internal const val CURRENT_ARTIST_CREDIT_VERSION = 2
internal const val LEGACY_ARTIST_CREDIT_VERSION = 1

internal data class ArtistCreditNames(
  val artists: List<String> = emptyList(),
  val albumArtists: List<String> = emptyList(),
)

internal fun normalizeArtistNames(values: Iterable<String?>): List<String> {
  val result = LinkedHashMap<String, String>()
  for (value in values) {
    val display = MediaTagCleanup.clean(value)
      ?.replace(Regex("\\s+"), " ")
      ?.trim()
      ?.takeIf(String::isNotEmpty)
      ?: continue
    val key = display.lowercase()
    result.putIfAbsent(key, display)
  }
  return result.values.toList()
}

internal fun formatArtistNames(values: Iterable<String?>): String {
  val names = normalizeArtistNames(values)
  return when (names.size) {
    0 -> ""
    1 -> names[0]
    2 -> "${names[0]} & ${names[1]}"
    else -> "${names.dropLast(1).joinToString(", ")} & ${names.last()}"
  }
}

internal fun serializeArtistNames(values: Iterable<String?>): String? {
  val names = normalizeArtistNames(values)
  return if (names.size > 1) JSONArray(names).toString() else null
}

internal fun deserializeArtistNames(value: String?): List<String> {
  if (value.isNullOrBlank()) return emptyList()
  return runCatching {
    val json = JSONArray(value)
    normalizeArtistNames((0 until json.length()).map { index -> json.optString(index, null) })
  }.getOrDefault(emptyList())
}

/**
 * Order-preserving collector for multi-value artist tags. Container-specific
 * metadata walkers feed raw key/value pairs here; normalization is kept pure so
 * repeated Vorbis comments and repeated ID3 frames share identical behavior.
 */
internal class ArtistCreditCollector {
  private val artists = mutableListOf<String?>()
  private val albumArtists = mutableListOf<String?>()

  fun consider(rawKey: String?, rawValue: String?) {
    if (rawKey == null || rawValue == null) return
    val key = rawKey.trim().uppercase().replace(Regex("[\\s_-]+"), "")
    val target = when (key) {
      "ARTIST", "ARTISTS", "TPE1" -> artists
      "ALBUMARTIST", "ALBUMARTISTS", "TPE2" -> albumArtists
      else -> null
    } ?: return

    // ID3 text frames may expose multiple values joined with NUL even when the
    // decoder returns a single string. Do not split punctuation: commas and
    // ampersands are valid parts of an individual artist name.
    rawValue.split('\u0000').forEach(target::add)
  }

  fun build(): ArtistCreditNames = ArtistCreditNames(
    artists = normalizeArtistNames(artists),
    albumArtists = normalizeArtistNames(albumArtists),
  )
}

internal object ArtistCreditMetadataReader {
  fun read(context: Context, uri: Uri, timeoutMs: Long): ArtistCreditNames {
    return try {
      val trackGroups = MetadataRetriever.retrieveMetadata(context, MediaItem.fromUri(uri))
        .get(timeoutMs, TimeUnit.MILLISECONDS)
      val collector = ArtistCreditCollector()

      for (groupIndex in 0 until trackGroups.length) {
        val group = trackGroups.get(groupIndex)
        for (formatIndex in 0 until group.length) {
          val metadata = group.getFormat(formatIndex).metadata ?: continue
          for (entryIndex in 0 until metadata.length()) {
            when (val entry = metadata.get(entryIndex)) {
              is VorbisComment -> collector.consider(entry.key, entry.value)
              is TextInformationFrame ->
                entry.values.forEach { value -> collector.consider(entry.id, value) }
              is InternalFrame -> collector.consider(entry.description, entry.text)
            }
          }
        }
      }
      collector.build()
    } catch (_: Throwable) {
      // Unsupported container, malformed tags, I/O failure, or timeout.
      ArtistCreditNames()
    }
  }
}
