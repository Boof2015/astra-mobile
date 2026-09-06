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

internal const val LEGACY_ARTIST_CREDIT_VERSION = 1
internal const val INITIAL_MULTI_ARTIST_CREDIT_VERSION = 2
// Version 3 removes synthesized ampersands from stored display strings.
// Keeping this independent of the Room schema version lets existing local
// version-2 catalogs use the normal stale-source full-reindex path.
internal const val CURRENT_ARTIST_CREDIT_VERSION = 3

internal data class ArtistCreditNames(
  val artists: List<String> = emptyList(),
  val albumArtists: List<String> = emptyList(),
)

internal fun normalizeArtistNames(values: Iterable<String?>): List<String> {
  val result = LinkedHashMap<String, String>()
  for (value in values) {
    val display = value?.trim()?.takeIf(String::isNotEmpty)
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
  return normalizeArtistNames(values).joinToString(", ")
}

internal fun serializeArtistNames(values: Iterable<String?>): String? {
  val names = normalizeArtistNames(values)
  return if (names.isNotEmpty()) JSONArray(names).toString() else null
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
  private val explicitArtists = mutableListOf<String?>()
  private val explicitAlbumArtists = mutableListOf<String?>()

  fun consider(rawKey: String?, rawValue: String?) {
    if (rawKey == null || rawValue == null) return
    val key = rawKey.trim().uppercase().replace(Regex("[\\s_-]+"), "")
    val target = when (key) {
      "ARTISTS" -> explicitArtists
      "ALBUMARTISTS" -> explicitAlbumArtists
      "ARTIST", "TPE1" -> artists
      "ALBUMARTIST", "TPE2" -> albumArtists
      else -> null
    } ?: return

    // ID3 text frames may expose multiple values joined with NUL even when the
    // decoder returns a single string. Do not split punctuation: commas and
    // ampersands are valid parts of an individual artist name.
    rawValue.split('\u0000').forEach(target::add)
  }

  fun build(): ArtistCreditNames = ArtistCreditNames(
    artists = normalizeArtistNames(explicitArtists).ifEmpty { normalizeArtistNames(artists) },
    albumArtists = normalizeArtistNames(explicitAlbumArtists).ifEmpty { normalizeArtistNames(albumArtists) },
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
                entry.values.forEach { value -> collector.consider(if (entry.id == "TXXX") entry.description else entry.id, value) }
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
