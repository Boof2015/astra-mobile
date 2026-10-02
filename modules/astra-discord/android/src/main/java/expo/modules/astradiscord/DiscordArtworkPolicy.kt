package expo.modules.astradiscord

import expo.modules.astracar.AstraCarTrack
import java.net.URI
import java.text.Normalizer
import java.util.Locale

/** Only public search metadata enters this type; paths, embedded images and server URLs never do. */
data class DiscordArtworkQuery(val album: String, val artist: String, val albumArtist: String, val title: String) {
  companion object {
    fun from(track: AstraCarTrack) = DiscordArtworkQuery(track.album.trim(), track.artist.trim(), track.albumArtist.trim(), track.title.trim())
  }
}
data class DiscordCoverCandidate(val album: String, val artist: String, val url: String, val title: String = "")
data class DiscordArtworkResult(val state: String, val url: String? = null, val provider: String? = null)

object DiscordArtworkPolicy {
  fun key(value: String): String = Normalizer.normalize(value, Normalizer.Form.NFKD)
    .replace(Regex("\\p{M}+"), "").lowercase(Locale.ROOT)
    .replace(Regex("[^\\p{L}\\p{N}]+"), " ").trim()

  private fun stripped(value: String): String {
    var result = key(value)
    val suffix = Regex(" (single|ep|lp|super deluxe(?: edition)?|deluxe(?: edition| version)?|expanded(?: edition| version)?|bonus track(?:s| edition| version)?|special edition|remastered(?: \\d{4})?|remaster|anniversary edition)$")
    while (true) {
      val next = result.replace(suffix, "").trim()
      if (next == result) return result
      result = next
    }
  }

  private fun usable(value: String) = key(value).let { it.isNotEmpty() && it !in setOf("unknown", "unknown artist", "unknown album", "various artists", "various", "va") }
  private fun withoutFeature(value: String) = value.replace(Regex("\\s*[\\(\\[]?\\s+(?:feat\\.?|ft\\.?|featuring)\\s+.+$", RegexOption.IGNORE_CASE), "").trim()
  fun artists(query: DiscordArtworkQuery): List<String> = listOf(query.albumArtist, query.artist).flatMap { value ->
    listOf(value, withoutFeature(value)) + value.split(Regex("[;,]|\\s+(?:&|feat\\.?|ft\\.?)\\s+", RegexOption.IGNORE_CASE))
  }.map { it.trim() }.filter(::usable).distinctBy(::key).take(3)
  fun albums(query: DiscordArtworkQuery): List<String> = listOf(query.album, withoutFeature(query.album), query.title, withoutFeature(query.title))
    .filter(::usable).distinctBy(::key).take(3)

  fun publicImage(value: String): String? = runCatching {
    val uri = URI(value.replaceFirst(Regex("^http://"), "https://"))
    val host = uri.host?.lowercase(Locale.ROOT) ?: return null
    if (uri.scheme != "https" || uri.userInfo != null || uri.fragment != null || uri.port !in listOf(-1, 443)) return null
    if (listOf("mzstatic.com", "coverartarchive.org", "archive.org", "theaudiodb.com").none { host == it || host.endsWith(".$it") }) return null
    uri.toASCIIString().takeIf { it.length <= 300 }
  }.getOrNull()

  private fun artistScore(candidate: String, artists: List<String>): Int {
    val actual = key(candidate)
    if (actual.isEmpty()) return 0
    return artists.maxOfOrNull {
      val expected = key(it)
      when {
        expected == actual -> 25
        expected.split(' ').size in 2..4 && expected.split(' ').sorted() == actual.split(' ').sorted() -> 22
        // Match explicit collaboration credits, not arbitrary substrings of an artist name.
        candidate.split(Regex("[;,]|\\s+(?:&|feat\\.?|ft\\.?)\\s+", RegexOption.IGNORE_CASE)).any { part -> key(part) == expected } -> 12
        else -> 0
      }
    } ?: 0
  }

  fun score(candidate: DiscordCoverCandidate, query: DiscordArtworkQuery, allowTitle: Boolean = false): Int {
    val artists = artists(query)
    val artist = artistScore(candidate.artist, artists)
    if (artists.isNotEmpty() && artist == 0) return 0
    // Avoid publishing plausible-looking but unrelated art for untagged files.
    if (artists.isEmpty() && (key(query.album).length < 6 || key(query.album) in setOf("greatest hits", "the album", "album", "unknown album", "best of"))) return 0
    val album = albums(query).maxOfOrNull {
      when {
        key(candidate.album).isNotEmpty() && key(candidate.album) == key(it) -> 40
        stripped(candidate.album).isNotEmpty() && stripped(candidate.album) == stripped(it) -> 30
        else -> 0
      }
    } ?: 0
    val title = if (allowTitle && artists.isNotEmpty() && key(candidate.title).isNotEmpty() &&
      stripped(candidate.title) == stripped(withoutFeature(query.title))) 25 else 0
    return if (album > 0 || title > 0) maxOf(album, title) + artist else 0
  }

  fun choose(candidates: List<DiscordCoverCandidate>, query: DiscordArtworkQuery, allowTitle: Boolean = false): String? = candidates
    .mapNotNull { candidate -> publicImage(candidate.url)?.let { it to score(candidate, query, allowTitle) } }
    .filter { it.second > 0 }.maxByOrNull { it.second }?.first
}

/** Bounded cache. Network failures have a short retry window and never become saved misses. */
class DiscordArtworkCache(private val now: () -> Long) {
  data class Entry(val query: DiscordArtworkQuery, val result: DiscordArtworkResult, val expires: Long)
  private val entries = LinkedHashMap<DiscordArtworkQuery, Entry>(16, 0.75f, true)
  fun get(query: DiscordArtworkQuery): DiscordArtworkResult? {
    val entry = entries[query] ?: return null
    if (entry.expires <= now()) { entries.remove(query); return null }
    return entry.result
  }
  fun put(query: DiscordArtworkQuery, result: DiscordArtworkResult) {
    val ttl = when (result.state) { "found" -> 30 * 86_400_000L; "not-found" -> 86_400_000L; else -> 120_000L }
    restore(Entry(query, result, now() + ttl))
  }
  fun restore(entry: Entry) {
    if (entry.expires <= now()) return
    entries[entry.query] = entry
    while (entries.size > 256) entries.remove(entries.keys.first())
  }
  fun saved(): List<Entry> = entries.values.filter { it.expires > now() && it.result.state in listOf("found", "not-found") }
  fun clear() = entries.clear()
}
