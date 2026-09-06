package expo.modules.astralibraryscanner.data

import java.util.Locale

// Version 2 also retains single-entry explicit ARTISTS/ALBUMARTISTS lists.
internal const val CURRENT_METADATA_READER_VERSION = 2

/** Normalization only: scalar credit punctuation is resolved later, using the catalog. */
internal class ContainerTags(pairs: Array<String>) {
  private val values = linkedMapOf<String, MutableList<String>>()
  init {
    pairs.asList().chunked(2).filter { it.size == 2 }.forEach { (rawKey, rawValue) ->
      val key = rawKey.trim().uppercase(Locale.ROOT).replace(Regex("[\\s_-]+"), "")
      values.getOrPut(key) { mutableListOf() }.addAll(
        rawValue.split('\u0000').map(String::trim).filter(String::isNotEmpty),
      )
    }
  }
  private fun all(vararg keys: String): List<String> =
    keys.firstNotNullOfOrNull { values[it]?.takeIf(List<String>::isNotEmpty) }.orEmpty()
  private fun text(vararg keys: String): String? = all(*keys).firstOrNull()
  private fun number(value: String?): Int? = value?.trim()?.toIntOrNull()?.takeIf { it > 0 }
  private fun position(vararg keys: String): Int? = number(text(*keys)?.substringBefore('/'))
  private fun total(positionKeys: Array<String>, vararg totalKeys: String): Int? =
    number(text(*totalKeys)) ?: number(text(*positionKeys)?.substringAfter('/', ""))

  fun toMetadata(): Map<String, Any?> {
    val artists = normalizeArtistNames(all("ARTISTS", "ARTIST", "TPE1"))
    val albumArtists = normalizeArtistNames(all("ALBUMARTISTS", "ALBUMARTIST", "TPE2"))
    return mapOf(
      "title" to text("TITLE", "TIT2"),
      "artist" to (text("ARTIST", "TPE1") ?: artists.takeIf { it.isNotEmpty() }?.joinToString(", ")),
      "artistNames" to artists.takeIf { it.size > 1 || all("ARTISTS").isNotEmpty() }.orEmpty(),
      "album" to text("ALBUM", "TALB"),
      "albumArtist" to (text("ALBUMARTIST", "TPE2") ?: albumArtists.takeIf { it.isNotEmpty() }?.joinToString(", ")),
      "albumArtistNames" to albumArtists.takeIf { it.size > 1 || all("ALBUMARTISTS").isNotEmpty() }.orEmpty(),
      "genre" to all("GENRE", "TCON").takeIf { it.isNotEmpty() }?.distinct()?.joinToString("; "),
      "trackNumber" to position("TRACKNUMBER", "TRACK", "TRCK"),
      "trackTotal" to total(arrayOf("TRACKNUMBER", "TRACK", "TRCK"), "TRACKTOTAL", "TOTALTRACKS"),
      "discNumber" to position("DISCNUMBER", "DISC", "TPOS"),
      "discTotal" to total(arrayOf("DISCNUMBER", "DISC", "TPOS"), "DISCTOTAL", "TOTALDISCS"),
      "year" to sequenceOf(text("DATE"), text("YEAR"), text("RELEASEDATE"))
        .filterNotNull().mapNotNull { Regex("\\d{4}").find(it)?.value?.toIntOrNull() }.firstOrNull(),
    )
  }
}
